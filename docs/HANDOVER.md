# Pingexa — Handover

Everything needed to run, verify and operate Pingexa locally, plus the
application-side facts you need in order to deploy it yourself.

**Status: local application complete and verified locally. Real SMTP delivery is
unverified** — see [What is not verified](#what-is-not-verified).

---

## 1. What Pingexa is

A user signs up, confirms their email, adds up to three public HTTP/HTTPS URLs,
and Pingexa checks each one every 5 minutes from the outside. It records every
check, opens an incident after three consecutive failures, emails one alert when
that happens and one when the site recovers, and can publish a shareable status
page showing only what the owner chose to publish.

Three processes, two of which you run:

| Process | Command | Responsibility |
|---|---|---|
| **API** | `npm run start:api` | HTTP only. Sessions, monitor CRUD, status pages, health. Enqueues email jobs; runs no consumers and no scheduler. |
| **Worker** | `npm run start:worker` | The scheduler tick, the check queue consumer, the email queue consumer, retention cleanup, and the alert outbox reconciliation. |
| **Web** | static files from `apps/web/dist` | The SPA. Build output only; no server-side runtime. |

The API and the worker are independent: either can be restarted, scaled or
stopped without the other. Neither is required for the other to start.

---

## 2. Requirements

* Node.js **>= 22.12** (developed and verified on v24.19.0)
* npm 11+ (the repo uses npm workspaces and one root lockfile)
* PostgreSQL **16+** (verified on 17)
* Redis **7+**, configured with `maxmemory-policy noeviction`
* An SMTP server
* Docker + Docker Compose, if you want the provided local backing services

---

## 3. Local setup, from a clean clone

```bash
git clone <this repo> && cd Pingexa

# 1. Install. This also generates the Prisma client from the committed schema.
npm install

# 2. Configuration.
cp .env.example .env
# Then set a real SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# ...and paste it into SESSION_SECRET in .env

# 3. Backing services (DEVELOPMENT ONLY — see the warning in the file).
docker compose -f docker-compose.dev.yml up -d

# 4. Database schema, from the committed migrations.
npm run migrate:deploy

# 5. Optional: demo data. Every name is prefixed [DEMO].
npm run seed

# 6. Run it. Three terminals, or background them.
npm run dev:api      # http://127.0.0.1:4000
npm run dev:worker
npm run dev:web      # http://localhost:5173
```

Open <http://localhost:5173>, create an account, then read the confirmation
email in Mailpit at <http://127.0.0.1:58125>. Nothing is monitored until the
address is confirmed.

### Development ports

Chosen off the defaults so this stack cannot collide with another local
Postgres, Redis or SMTP server:

| Service | Host port | Container port |
|---|---|---|
| Postgres | 55433 | 5432 |
| Redis | 56379 | 6379 |
| Mailpit SMTP | 58025 | 1025 |
| Mailpit UI + API | 58125 | 8025 |
| API | 4000 | — |
| Web dev server | 5173 | — |

The Vite dev server proxies `/api` to the API, so the browser sees a single
origin locally. In production the SPA and the API may be on different origins;
that is what `TRUSTED_ORIGINS` and the CORS layer are for.

---

## 4. Commands

| Command | What it does |
|---|---|
| `npm install` | Installs everything and generates the Prisma client. |
| `npm run migrate:deploy` | Applies committed migrations. Use this in every environment. |
| `npm run migrate:dev` | Creates a new migration after editing `schema.prisma`. Development only. |
| `npm run seed` | Demo data, `[DEMO]`-prefixed. Refuses to run with `NODE_ENV=production`. |
| `npm run -w @pingexa/api retention` | Forces one retention cleanup pass. |
| `npm run dev:api` / `dev:worker` / `dev:web` | Development, with reload. |
| `npm run build` | Builds shared, api (`apps/api/dist`) and web (`apps/web/dist`). |
| `npm run start:api` / `start:worker` | Runs the built output. |
| `npm run lint` | ESLint across the whole repo. |
| `npm run typecheck` | `tsc --noEmit` for all three packages. |
| `npm run test:unit` | Pure logic. No Postgres, Redis or network. |
| `npm run test:integration` | Real Postgres + Redis. Creates and migrates a disposable `pingexa_test` database. |
| `npm run test:e2e` | Playwright against the whole running stack, including Mailpit. |
| `./scripts/verify-fresh-setup.sh` | Fresh-setup verification on a disposable database (see below). |
| `npm run dev:up` / `dev:down` / `dev:logs` | The dev Compose stack (`down` stops containers and keeps volumes). |

### Running the tests

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres, Redis, Mailpit

npm run lint
npm run typecheck
npm run test:unit
npm run test:integration     # drops and recreates `pingexa_test` only

# End-to-end needs the app running:
npm run dev:api & npm run dev:worker & npm run dev:web &
npm run test:e2e
```

`npm run test:integration` creates its own database (`pingexa_test`) inside the
same Postgres instance, applies the committed migrations to it, and truncates
between test cases. **Your development database is never dropped or truncated.**
The integration suite needs outbound **DNS** resolution (it validates the real
guard against `example.com`) but never makes outbound HTTP requests. The
end-to-end suite does make real requests to `example.com`.

`npx playwright install chromium` is needed once if Playwright's browser is not
already present.

A full `npm run test:e2e` run creates roughly twenty accounts per browser
project from a single address, which legitimately exceeds the production-sensible
`TOKEN_RATE_LIMIT_MAX=60`. Raise it to about `400` in your local `.env` before
running the suite; leave the shipped default alone in production.

### Fresh-setup verification

```bash
./scripts/verify-fresh-setup.sh
```

Creates a timestamped `pingexa_fresh_*` database, applies **only** the committed
migrations to it, asserts there is no drift between `schema.prisma` and the
result, asserts the four hand-written constraints exist, builds the project,
boots the built API against that database, signs a user up through the real HTTP
endpoints, and then runs the integration suite. It drops only the database it
created and never touches `pingexa_dev`, `pingexa_test`, any Docker volume, or
any container it did not start. It needs port 4100 free and refuses to run
otherwise.

---

## 5. Configuration

Every variable is documented inline in `.env.example`. The ones that matter most
when deploying:

| Variable | Why it matters |
|---|---|
| `NODE_ENV` | `production` switches on extra config validation (below). |
| `SESSION_SECRET` | Keys the HMAC over session and email tokens. **Rotating it invalidates every session and every outstanding verification/reset link.** 32+ random characters. |
| `PUBLIC_APP_URL` | Builds the links inside emails and the status-page URL. No trailing slash. |
| `TRUSTED_ORIGINS` | Comma-separated browser origins allowed to call the API with cookies. Both CORS and the CSRF origin check read it. No wildcards. |
| `COOKIE_SECURE` | Must be `true` in production. The loader refuses `false`. |
| `COOKIE_SAMESITE` | `Lax` when the SPA and API share a site. `None` (plus `COOKIE_SECURE=true`) when they do not. |
| `COOKIE_DOMAIN` | Set only if you need the cookie across subdomains. |
| `TRUST_PROXY_HOPS` | The number of reverse proxies in front of the API. **A wrong value lets a client spoof `X-Forwarded-For` and defeat every IP-keyed rate limit.** `0` means no proxy. |
| `DATABASE_URL` / `DATABASE_POOL_MAX` | The pool size is **per process**. The API and the worker each open their own, so a 20-connection server must not see both set to 20. |
| `REDIS_URL` | Redis must run with `maxmemory-policy noeviction`. Evicting BullMQ keys corrupts queues. |
| `QUEUE_PREFIX` | Namespace for every BullMQ and rate-limit key. Change it to share one Redis between environments. |
| `MONITOR_INTERVAL_SECONDS` | The product interval is 300. It exists so tests can run an accelerated schedule; the loader refuses any other value in production. |
| `SCHEDULER_TICK_MS` | How often the worker looks for due monitors. Checks can fire up to this late. |
| `SMTP_*` | See [Email](#7-email). `SMTP_REJECT_UNAUTHORIZED` must be `true` in production. |
| `CHECK_RETENTION_DAYS` / `INCIDENT_RETENTION_DAYS` | 7 and 90. Enforced by the worker. |
| `AUTH_RATE_LIMIT_*` / `TOKEN_RATE_LIMIT_MAX` / `API_RATE_LIMIT_*` / `PUBLIC_RATE_LIMIT_*` | See the rate-limit table in `docs/API.md`. |

### Refusals when `NODE_ENV=production`

The config loader will not start the process if any of these hold. This is
deliberate: each one is a silent security downgrade in a deployed system.

* `COOKIE_SECURE` is not `true`
* `SMTP_REJECT_UNAUTHORIZED` is not `true`
* `PUBLIC_APP_URL` uses `http://`
* `MONITOR_INTERVAL_SECONDS` is not `300`
* `SESSION_SECRET` is still the example value
* `COOKIE_SAMESITE=None` without `COOKIE_SECURE=true` (checked in every environment)

---

## 6. Operating the services

### Startup dependencies

| Process | Postgres | Redis | SMTP |
|---|---|---|---|
| API | required to serve real traffic; starts without it and reports `/api/ready` as degraded | required for rate limits and to enqueue mail; a failing Redis degrades readiness but does **not** fail requests | not used |
| Worker | **required** — exits if unreachable at startup | required | required to deliver; failures are retried and recorded, and never block monitoring |

Order does not matter beyond that. Both processes reconnect on their own.

### Health checks

| Endpoint | Use for | Behaviour |
|---|---|---|
| `GET /api/health` | liveness | Always 200 while the process is up. Touches no dependency, so a database blip cannot make an orchestrator kill a healthy process. |
| `GET /api/ready` | readiness / load-balancer | 200 when Postgres **and** Redis answer; 503 otherwise, with which one failed. |

The worker exposes no HTTP endpoint. Judge it by its process liveness and by
its logs; a worker that has stopped working shows up in the product as monitors
with `monitoringStale: true`, which the UI surfaces as **Unknown**.

### Shutdown

Both processes handle `SIGTERM` and `SIGINT`:

* **API** — stops accepting connections, lets in-flight requests finish, closes
  idle keep-alive sockets, then releases the queue, Redis and Postgres handles.
  Hard exit after 15s.
* **Worker** — stops the scheduler and retention timers, then calls
  `Worker.close()`, which **waits for in-flight jobs**, so a check in progress
  finishes and records its result rather than being abandoned and retried. Hard
  exit after 30s.

Give the worker at least 35 seconds of termination grace.

### Persistence

* **Postgres — must be durable.** It holds accounts, monitors, the check
  history, incidents and alert delivery state. It is also the scheduling source
  of truth (`monitors.nextCheckAt`).
* **Redis — should be durable, but is recoverable.** It carries queued jobs and
  rate-limit counters. Losing it loses at most the in-flight checks: the next
  scheduler tick re-derives everything from Postgres, and pending alerts are
  re-enqueued by the outbox pass. Enable AOF anyway so a restart does not drop a
  batch of work.
* **Nothing is stored on local disk** by either process. There are no uploads,
  no local cache and no session files.

### Worker behaviour, in detail

* **Scheduler.** Every `SCHEDULER_TICK_MS` (default 15s) one atomic statement
  selects monitors whose `nextCheckAt` is due (`FOR UPDATE SKIP LOCKED`),
  advances `nextCheckAt`, and returns the slot it claimed. Two ticks, or two
  worker processes, can never claim the same slot. Ticks never overlap.
* **Catch-up.** A monitor more than three intervals behind is re-based onto the
  present rather than replayed slot by slot, so a restart after an outage
  produces one fresh check per monitor, not a backlog. A backlog would hammer
  the monitored sites and could look like a burst of failures.
* **Reconciliation.** At startup, and every fourth tick, any monitor that should
  be scheduled but is not (`nextCheckAt IS NULL`, unpaused, verified account) is
  put back on the schedule.
* **Checks.** BullMQ `checks` queue, `WORKER_CHECK_CONCURRENCY` at a time, one
  socket per check, `MONITOR_TIMEOUT_MS` budget. Every reason not to check is
  evaluated before the request goes out: monitor deleted, monitor paused,
  account no longer verified, slot too old, slot already recorded.
* **Email.** BullMQ `email` queue, `WORKER_EMAIL_CONCURRENCY` at a time,
  `MAIL_MAX_ATTEMPTS` attempts with exponential backoff.
* **Outbox.** Every fourth tick, alerts still `PENDING` and older than a minute
  are re-enqueued under a deterministic job id, so an alert that could not be
  queued (Redis down at the moment the incident opened) still goes out.
* **Retention.** Every `RETENTION_INTERVAL_MS` (default 1h), plus once ten
  seconds after startup: deletes checks older than `CHECK_RETENTION_DAYS`,
  resolved incidents older than `INCIDENT_RETENTION_DAYS`, expired/revoked
  sessions, and spent auth tokens. **Open incidents are never deleted**,
  however old.

### Logging

Structured JSON via pino (`LOG_PRETTY=true` for human-readable local output).
Passwords, hashes, tokens, cookies, `Authorization` headers, status-page slugs
and response bodies are redacted by key name. Each request carries an
`x-request-id`, echoed in the response header, accepted from an inbound header
when present. Unexpected errors log a stack; in production the stack is not
included in the log payload sent to the client (the client only ever sees
`internal_error`).

---

## 7. Email

Local development uses **Mailpit**, which accepts anything and delivers nothing.
Its UI and REST API are at <http://127.0.0.1:58125>; the end-to-end tests read
confirmation and reset links out of it exactly as a person would read an inbox.

Six messages exist: email confirmation, password reset, password changed,
"you already have an account", monitor down, monitor recovered.

For a real provider:

```
SMTP_HOST=...
SMTP_PORT=587            # or 465 with SMTP_SECURE=true
SMTP_SECURE=false        # false uses STARTTLS when offered
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_REJECT_UNAUTHORIZED=true   # required in production
MAIL_FROM_ADDRESS=alerts@your-domain
MAIL_FROM_NAME=Pingexa
```

`MAIL_FROM_ADDRESS` must be a domain you control, with SPF and DKIM configured,
or alert mail will land in spam — which for an uptime monitor is the same as not
sending it. Also decide what happens to bounces: Pingexa records a permanent
failure on the notification row and shows it on the monitor detail page, but it
does not process bounce webhooks.

---

## 8. Product rules, precisely

### Check grading

| Response | Outcome | Kind |
|---|---|---|
| HTTP `2xx` | UP | — |
| HTTP `3xx` | DOWN | `REDIRECT` — **redirects are not followed in V1** |
| HTTP `4xx` / `5xx` | DOWN | `HTTP_ERROR` |
| No response in `MONITOR_TIMEOUT_MS` | DOWN | `TIMEOUT` |
| DNS failure | DOWN | `DNS_ERROR` |
| Connect failure / reset | DOWN | `CONNECTION_ERROR` |
| Certificate or handshake failure | DOWN | `TLS_ERROR` |
| Resolves to a non-public address | DOWN | `BLOCKED_ADDRESS` |
| URL no longer passes the shape rules | DOWN | `INVALID_URL` |
| Body over `MONITOR_MAX_RESPONSE_BYTES` | DOWN | `RESPONSE_TOO_LARGE` |

`responseTimeMs` is the time to response **headers**. Because 3xx is a failure,
the monitor detail page shows an explicit hint telling the user to monitor the
final URL when the latest failure was a redirect.

### Alert delivery semantics

| Property | Guarantee |
|---|---|
| Alert rows per incident | **Exactly one** DOWN, and **exactly one** RECOVERY once it closes. Enforced by a unique index. |
| SMTP transactions per alert row | **At most `MAIL_MAX_ATTEMPTS` (5)**. Enforced from the row's persisted `attempts`, so a re-created queue job cannot restart the budget. |
| Delivery to the mailbox | **At least once.** A duplicate is possible if the worker dies between the SMTP accept and the `SENT` write, or if a send fails ambiguously (timeout after `DATA`) having actually been accepted. |
| Simultaneous workers | Cannot both send: the claim is a compare-and-set on the exact `attempts` value read. |
| Missed alerts | An alert that could not be enqueued stays `PENDING` and is re-enqueued by the outbox pass, so a Redis outage delays an alert rather than losing it. |
| Permanent failure | After the budget is spent the row becomes `FAILED` with `lastError`, and is shown on the monitor detail page. Monitoring is unaffected. |

The one thing not to claim: the unique index does **not** make delivery
exactly-once. It bounds alert intents, not SMTP messages.

### Down and recovery

* A new monitor is `PENDING` until its first completed check.
* `DOWN` is declared on the **third consecutive failed scheduled check**, and
  only then is the first email sent.
* Recovery is the **first successful check** after a declared outage. One email.
* Any success resets the streak.
* Consecutive failures count **distinct scheduled slots**. Queue retries and
  redeliveries cannot advance the streak, because the check row is unique per
  `(monitorId, scheduledFor)`.

### Incident timestamps

| Field | Meaning |
|---|---|
| `startedAt` | `checkedAt` of the **first** failed check in the streak — when the outage began. |
| `detectedAt` | `checkedAt` of the **third** failure — when Pingexa confirmed it and alerted. |
| `resolvedAt` | `checkedAt` of the **first success** afterwards. `null` while open. |
| `durationSeconds` | `resolvedAt - startedAt`, or `now - startedAt` while open. |
| `closeReason` | `RECOVERED`, `MONITOR_RECONFIGURED`, or `MONITOR_PAUSED`. Only `RECOVERED` produced a recovery email. |

Pausing a monitor or changing its URL mid-outage closes the incident with the
corresponding reason and **no** recovery email — nothing recovered, we simply
stopped counting.

### Uptime

```
uptimePercent   = up / (up + down)          over checks actually recorded in the window
coveragePercent = recorded / expected       expected = window ÷ interval, from max(createdAt, windowStart)
partialData     = coveragePercent < 90
```

A check that never ran counts as neither up nor down; `coveragePercent` is how
that gap is made visible. `uptimePercent` is `null` — displayed as `—`, never
`0%` or `100%` — when nothing was recorded. Coverage treats paused time as
expected-but-missing, because Pingexa keeps no pause history; for that time the
state genuinely is unknown.

A monitor whose newest check is older than **three intervals** is reported with
`monitoringStale: true` and displayed as **Unknown**, with the last known state
shown separately. That is how a worker outage surfaces instead of silently
freezing a green tick.

### Limits

Three monitors per user, enforced by a unique `(userId, slot)` index plus a
`CHECK (slot BETWEEN 0 AND 2)`. A fourth row is physically impossible regardless
of request concurrency; changing the limit is a migration.

---

## 9. Security posture

**Outbound requests to user-supplied URLs** — the reason this application needs
care at all:

* `http:`/`https:` only; port must be the scheme default (80/443); URL
  credentials refused; internal-only hostname suffixes refused
  (`.local`, `.internal`, `.lan`, `.home.arpa`, `metadata.google.internal`, …).
* Every A/AAAA record is resolved and classified against the full IPv4 and IPv6
  special-purpose registries — loopback, private, CGNAT, link-local (including
  `169.254.169.254`), documentation, benchmarking, multicast, reserved, unique
  local, Teredo, discard, ORCHID — with IPv4-mapped, NAT64 and 6to4 addresses
  unwrapped so a blocked IPv4 destination cannot be smuggled inside an IPv6 one.
* If **any** resolved address is non-public, the whole hostname is refused. A
  host that answers with both a public and a private address is not monitorable.
* The connection is then **pinned** to the approved addresses: the HTTP client's
  DNS lookup can only return them, and refuses any other hostname on that
  connection. This closes DNS rebinding between validation and connect. TLS
  still verifies against the original hostname.
* Redirects are not followed. TLS verification is always on and has no
  configuration path to disable it.
* Bounded: total request time, response bytes read, one connection per check,
  and per-worker concurrency.
* Fixed request headers only. No cookies, no `Authorization`, nothing
  user-supplied is ever forwarded to a monitored site.
* Response bodies are read only to enforce the size cap, then discarded. No body
  is ever stored or logged.

**There is no environment variable or config key that weakens any of this.**
`createUrlGuard()` takes an explicit policy object and the production factory
always passes the strict one; tests that need a loopback fixture construct their
own guard. An ESLint rule fails the build if the guard is ever wired to `env`.

**Accounts and sessions:** Argon2id password hashing (19 MiB, 2 iterations);
opaque 32-byte session tokens stored only as an HMAC; single-use, expiring
verification (24h) and reset (1h) tokens, also stored only as an HMAC, with a
new token invalidating the previous one; a completed reset revokes every
session; a password change revokes every other session. Login answers
identically for a wrong password and an unknown address, and costs a password
verification either way so timing does not reveal existence. Signup answers
identically for a new and an existing address.

**Requests:** helmet headers; a 32 kB JSON body limit; CSRF as a double-submit
token plus an origin allowlist on every non-GET; CORS restricted to
`TRUSTED_ORIGINS` with no wildcard path; Redis-backed rate limits (see
`docs/API.md`); another user's resource returns 404, never 403.

**Data exposure:** the public status page projection is a single function that
never receives or emits URLs, emails, HTTP status codes, failure reasons or
slugs. Unpublishing removes access immediately — the response is `no-store`
precisely so no cache can outlive a revocation.

---

## 10. Production-facing notes for you

These are the application's requirements. Building the deployment is yours.

**Cookies and sessions.** `COOKIE_SECURE=true` (enforced). Choose
`COOKIE_SAMESITE` from your topology: `Lax` if the SPA and API are on the same
site, `None` if not — and `None` requires HTTPS. Set `COOKIE_DOMAIN` only if you
need the session across subdomains. `SESSION_SECRET` must be a real secret,
injected, not baked into an image; rotating it signs everyone out and kills
outstanding email links.

**CORS and proxying.** Put every browser origin that will call the API into
`TRUSTED_ORIGINS`. Set `TRUST_PROXY_HOPS` to the actual number of proxies in
front of the API — too low and rate limits key on your proxy's address, too high
and a client can spoof `X-Forwarded-For` to bypass them entirely. The SPA is a
static bundle (`apps/web/dist`) and needs SPA-style fallback: any unknown path
serves `index.html`, because `/app/monitors/:id` and `/status/:slug` are
client-side routes. If you serve the SPA and the API from one origin, front them
with one reverse proxy and route `/api` to the API.

**Migrations.** Run `npm run migrate:deploy` as a separate step before starting
the new API and worker, never automatically at process start — two processes
racing on migrations is a bad afternoon. Never edit an already-applied
migration. `migrate:dev` and `migrate:reset` are development-only.

**SMTP.** See [Email](#7-email). Use a domain you control with SPF and DKIM.

**Persistent storage.** Postgres must be durable and backed up; it is the only
place anything of value lives. Redis should have AOF enabled and **must** run
with `maxmemory-policy noeviction`. Neither process writes to local disk, so the
application containers can be entirely ephemeral.

**Process supervision.** Run the API and the worker as separate units. The API
scales horizontally without coordination. The worker also scales horizontally —
the atomic claim makes multiple workers safe — but one is enough for three
monitors per user, and running several multiplies the rate at which checks are
dispatched, not the schedule.

**Termination grace.** ≥ 20s for the API, ≥ 35s for the worker.

**What to watch.** `/api/ready` for the API. For the worker, alert on the
absence of `dispatched due checks` log lines and on monitors reporting
`monitoringStale`. Also watch for `Notification.status = 'FAILED'` rows, which
mean alert mail is not being delivered.

---

## 11. Acceptance checklist

Legend: **PASS** verified by an executed test or an observed run ·
**UNVERIFIED** not executed here · **N/A** out of scope

### Authentication

| Item | Status | Evidence |
|---|---|---|
| Signup, verification, login, logout | PASS | `tests/integration/auth.test.ts`; `e2e/auth.spec.ts` full flow through Mailpit |
| Password reset | PASS | integration + e2e, including old password rejected afterwards |
| Password change keeps current session, drops others | PASS | integration + e2e |
| Argon2id hashing; hash never returned | PASS | integration asserts `$argon2id$` prefix and absence in responses |
| Tokens single-use, expiring, hashed at rest; reissue kills the old one | PASS | integration |
| Verified email required before monitoring and alerts | PASS | integration (403 on write, unscheduled monitor) + e2e banner |
| Cross-user access rejected | PASS | integration: every monitor endpoint returns 404 for a stranger |
| CSRF enforced; untrusted origin rejected | PASS | integration |
| Session forgery / expiry rejected | PASS | integration |
| No email enumeration on signup or reset | PASS | integration + e2e |

### Monitors and monitoring

| Item | Status | Evidence |
|---|---|---|
| Create, list, view, edit, pause, resume, delete | PASS | integration + e2e |
| 3-monitor limit, server-side | PASS | integration (4th → 409) + e2e (UI hides the control) |
| 3-monitor limit under concurrency | PASS | integration: 8 simultaneous creates → exactly 3 succeed, slots `[0,1,2]` |
| Limit unbeatable by direct DB insert | PASS | integration: `CHECK` constraint rejects slot 3 |
| New monitor starts PENDING | PASS | integration + e2e |
| Fixed 5-minute interval | PASS | config refuses any other value in production; asserted in responses |
| Success/timeout/failure rules | PASS | `tests/unit/httpCheck.test.ts` against a fixture server, all classes |
| Check records time, response time, status, safe reason | PASS | integration + unit |
| DOWN after 3 consecutive failures | PASS | integration lifecycle test, step by step |
| Recovery on first success; streak resets | PASS | integration |
| Paused/deleted monitors produce no checks or alerts | PASS | integration: no outbound request, no rows |
| Real check runs end to end in a browser | PASS | `e2e/monitors.spec.ts` — real request to `example.com`, card turns Up, HTTP 200 on the detail page |
| A 404 is a failed check but does not declare DOWN | PASS | e2e |

### Reliability

| Item | Status | Evidence |
|---|---|---|
| Success → 3 failures → 1 incident + 1 DOWN alert → success → recovery alert | PASS | integration, asserting exactly one of each |
| Queue redelivery creates no duplicate incident or extra failure | PASS | integration, and over the real BullMQ queue |
| Repeated retries of one slot cannot reach DOWN | PASS | integration: 6 retries → streak stays 1 |
| Concurrent workers → one incident, one alert | PASS | integration with two live BullMQ workers |
| Second open incident impossible | PASS | integration: partial unique index rejects it |
| Second alert of a kind impossible | PASS | integration: unique index rejects it |
| Scheduler claims a slot exactly once under concurrency | PASS | integration: 3 parallel claims → 1 |
| API/worker restart recovery | PASS | integration: worker closed and replaced, monitoring continues |
| Scheduler reconciliation | PASS | integration: `nextCheckAt` nulled, repaired, check runs |
| Redis data loss does not stop monitoring permanently | PASS | integration: queue obliterated, schedule survives in Postgres |
| Stale monitoring exposed, not counted | PASS | unit + integration: `displayState: STALE`, uptime unaffected |
| Missing checks never counted as up or down | PASS | unit uptime tests + integration coverage test |
| Edit/pause/delete while a job is queued | PASS | integration, four separate cases |
| Graceful shutdown | PASS | SIGTERM to each process produced a clean, logged stop (`api shutting down` → `api stopped`; `worker shutting down` → `worker stopped`), with the queue, Redis and Postgres handles released. The worker's wait-for-in-flight-jobs behaviour comes from BullMQ's `Worker.close()`; that specific case was not separately forced in a test. |
| Retention cleanup | PASS | integration: checks, incidents, sessions, tokens; open incidents preserved |

### Email

| Item | Status | Evidence |
|---|---|---|
| Local delivery through Mailpit | PASS | observed for confirmation, reset and password-changed; read back by e2e |
| Alert content and escaping | PASS | `tests/unit/templates.test.ts` |
| Background delivery, bounded retries, persisted state | PASS | integration: attempts, `lastError`, `SENT`/`FAILED` transitions, plus the budget being read from the row so a re-created job cannot restart it |
| One sender when workers race | PASS | integration: 10 concurrent handlers → exactly 1 send, `attempts` = 1. This is where the fresh-setup run caught a real bug (see `docs/DECISIONS.md` D19): the original claim left the row `PENDING` during the send, so it excluded nobody. Fixed and re-verified over four consecutive runs. |
| Outbox reconciliation re-enqueues stuck alerts | PASS | integration |
| Email failure never breaks monitoring or loses an incident | PASS | integration |
| Alerts only to a verified address | PASS | integration |
| **Real SMTP delivery to a real mailbox** | **UNVERIFIED** | no credentials or authorised recipient — see §12 |

### Security

| Item | Status | Evidence |
|---|---|---|
| Scheme, credential, port, hostname validation | PASS | `tests/unit/urlGuard.test.ts`, ~35 cases |
| IPv4 + IPv6 blocking incl. metadata, IPv4-mapped, NAT64, 6to4 | PASS | `tests/unit/ipRanges.test.ts`, ~45 cases |
| DNS validated; mixed public/private hostname refused | PASS | unit |
| Connection pinned; rebinding refused | PASS | unit: the pinned lookup returns only approved addresses and refuses another hostname. Proved end-to-end too: a check against a hostname that **does not exist in DNS** succeeds when the guard maps it to the fixture server's address, which can only happen if the socket used the guard's answer; and a request whose only approved address is the wrong family reaches the network not at all. |
| Redirects not followed; 3xx classified and documented | PASS | unit: one request only, target not leaked |
| TLS verification enforced | PASS | not configurable; asserted by code review and the absence of any flag |
| Bounded time, size, concurrency | PASS | unit: timeout inside budget, oversized body refused |
| No cookies/credentials/arbitrary headers forwarded | PASS | unit: asserts the exact header set the target receives |
| No response bodies or secrets in logs | PASS | redaction by key name; unit asserts reasons contain no body |
| Production protections not weakened for tests | PASS | unit: strict guard refuses what the test guard allows; ESLint rule |
| Input validation on every write | PASS | integration, field-level messages |
| Auth and abuse rate limits | PASS | `e2e/rateLimit.spec.ts` against the live API: repeated failed logins for one address end in a JSON 429 (`rate_limited`), while a different address from the same client still gets a normal 401 |
| Secure cookies, CSRF, trusted origins, proxy config | PASS | integration + production config refusals |
| DB constraints and transactions for incidents and limits | PASS | integration |
| Public page privacy | PASS | integration asserts 9 forbidden strings absent; e2e asserts against the rendered HTML |
| Unpublish/rotate removes access immediately | PASS | e2e (this is what found the caching bug, now `no-store`) |

### Interface

| Item | Status | Evidence |
|---|---|---|
| Landing, auth, dashboard, detail, settings, status page | PASS | e2e visits all of them |
| Loading, empty, validation, success, error states | PASS | e2e: empty state, field errors, toasts, load-error retry |
| Real API-backed cards and detail pages | PASS | e2e |
| Response-time chart with an accessible summary | PASS | e2e asserts the chart's generated text summary |
| Uptime and its meaning displayed | PASS | uptime + coverage rendered together by one component |
| Incident history with documented semantics | PASS | the three timestamps are labelled in the UI |
| No fake metrics, testimonials or dead controls | PASS | e2e asserts no social-proof copy; every control is wired |
| Seed/demo data clearly separate | PASS | `[DEMO]` prefix, dedicated account, refuses production |
| Responsive | PASS | e2e runs a mobile project (Pixel 7) and asserts no horizontal overflow; every page was also screenshotted at 1280px and at phone width, in light and dark, and reviewed |
| Accessible forms | PASS | every input is label+hint+error wired via ids; switches use `role="switch"` |

### Build and fresh setup

| Item | Status | Evidence |
|---|---|---|
| Lint clean | PASS | `npm run lint` |
| Typecheck clean | PASS | `npm run typecheck` |
| Build clean | PASS | `npm run build` |
| Fresh setup from committed migrations on an isolated database | PASS | `./scripts/verify-fresh-setup.sh` — creates a timestamped database, applies only the committed migrations, boots the **built** API on it, signs a user up, then runs the integration suite. Drops only its own database. |
| Committed migrations match the schema | PASS | `prisma migrate diff` in the fresh-setup script reports "No difference detected" between `schema.prisma` and the migrated database |
| Hand-written constraints present in a fresh database | PASS | fresh-setup script asserts all four exist and fails if any is missing |

---

## 12. What is not verified

**Real SMTP delivery.** Every email path is exercised locally against Mailpit
and every template is unit-tested, but no message has been delivered through a
real SMTP provider to a real mailbox. To close this, set `SMTP_HOST`,
`SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and
`SMTP_REJECT_UNAUTHORIZED=true` in your local `.env`, and name a recipient
address you are happy to receive test mail at. Until then: **local application
complete; real SMTP delivery unverified.**

**Everything about production.** No production Dockerfile, Compose file, cloud
infrastructure, CI/CD pipeline, domain, TLS termination or deployment has been
built or attempted — that is your side of the handover, by design. Nothing was
deployed, provisioned, published, or pointed at DNS.

**Behaviour at scale.** Verified with a handful of monitors on one machine. The
design scales (stateless API, atomically-claimed schedule, horizontally safe
worker), but no load test was run.

**Real-world check accuracy.** Checks were made against `example.com` and a
local fixture server. Behaviour against sites with unusual TLS, HTTP/2-only
endpoints, aggressive bot protection or very slow responses has not been
surveyed.

---

## 13. Known limitations

1. **Redirects are not followed.** Monitoring `http://example.com` when it 301s
   to HTTPS reports DOWN. This is deliberate (see `docs/DECISIONS.md` D7) and the
   UI tells the user to monitor the final URL, but it will surprise people.
2. **Alert delivery is at-least-once, not exactly-once.** The
   `(incidentId, kind)` unique index bounds how many alert *rows* exist — one
   DOWN and one RECOVERY per incident — and nothing more. It says nothing about
   how many SMTP messages leave the process for a row, because the send happens
   outside the transaction. What bounds the sends is: a `SENT` row is skipped, a
   compare-and-set claim stops simultaneous handlers, and the attempt budget is
   read from the row's persisted `attempts`, so a single alert causes at most
   `MAIL_MAX_ATTEMPTS` (5) SMTP transactions however often the queue job is
   recreated. Two windows can still put a second copy in the mailbox: the worker
   dying between the SMTP server accepting the message and the `SENT` write, and
   an ambiguous failure where a socket timeout after `DATA` means the message was
   accepted but the `250` never arrived. Both are retried on purpose — a
   duplicate "your site is down" is less harmful than a missed one. Closing them
   needs a provider-honoured idempotency key or a two-phase outbox recording the
   provider's message id before committing `SENT`; V1 implements neither, and
   adding one is a feature rather than a fix. See `docs/DECISIONS.md` D17.
3. **A Redis flush loses at most one check per monitor.** `nextCheckAt` has
   already advanced for the in-flight slot, so that slot is skipped rather than
   retried. It shows up as reduced coverage, never as downtime.
4. **Coverage counts paused time as missing.** Pingexa keeps no pause history,
   so a monitor paused for most of a window reports low coverage. That is the
   honest answer, but it is not the same as "we were watching and it was fine".
5. **Checks come from one place.** A network problem between the worker and a
   site is indistinguishable from the site being down. Multi-region checking is
   out of scope.
6. **Check dispatch is granular to `SCHEDULER_TICK_MS`.** A check can fire up to
   15 seconds late by default.
7. **No bounce handling.** A hard SMTP failure is recorded and shown, but
   Pingexa does not consume bounce webhooks or suppress future sends.
8. **No account deletion in the UI.** Deleting a user row cascades everything
   correctly, but there is no self-service path to it.
9. **`prisma` (the CLI, a devDependency) pulls transitive advisories** in
   `@prisma/config`/`deepmerge-ts` and `mysql2`. Neither is loaded at runtime —
   Pingexa uses Postgres and the CLI does not ship to production. Downgrading to
   `prisma@6` to clear them would break `@prisma/client@7`. Re-check on the next
   Prisma release.
10. **One status page per account, no custom domain, no branding controls.** Out
    of scope for V1.

---

## 14. Where to start

1. `npm install && cp .env.example .env`, set `SESSION_SECRET`,
   `docker compose -f docker-compose.dev.yml up -d`, `npm run migrate:deploy`,
   `npm run seed`, then the three `dev:*` commands. Sign in as
   `demo@pingexa.local` to see a populated dashboard immediately.
2. Read `docs/API.md` §"Outbound check semantics" and §"Uptime" — those two
   sections are where the product's real behaviour lives.
3. When you build the deployment, work through §10 as a checklist. The two
   things most likely to bite are `TRUST_PROXY_HOPS` and the SPA fallback route.
