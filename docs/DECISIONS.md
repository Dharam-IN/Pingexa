# Pingexa — Implementation Decisions

Each entry records what was chosen, why, and the tradeoff accepted.

## D1 — npm workspaces monorepo, no build tooling beyond tsc/vite
`apps/api`, `apps/web`, `packages/shared`, one root `package-lock.json`.
Rationale: a single lockfile and one `npm install` for the whole project; the frontend
imports request/response types from `packages/shared` so the contract cannot silently
drift. Tradeoff: workspace-aware commands are slightly more verbose (`npm run -w`).

## D2 — API and worker share one codebase, run as two processes
`apps/api/src/server.ts` (`npm run -w @pingexa/api dev:api`) and
`apps/api/src/worker.ts` (`npm run -w @pingexa/api dev:worker`) are separate
entrypoints with separate start commands and can be scaled/restarted independently.
Rationale: they share Prisma models, config, logging and mail code; splitting them into
separate packages would duplicate all of it for no operational gain at this size.
Tradeoff: they deploy from the same image/artifact, so an API-only change also
redeploys the worker.

## D3 — TypeScript 5.9 rather than 7.x
`typescript-eslint@8` declares `typescript >=4.8.4 <6.1.0`. Pinning TS 5.9.3 keeps
lint, typecheck, Vite and Prisma on a combination all four vendors support today.
Tradeoff: not the newest compiler.

## D4 — Postgres is the scheduling source of truth; Redis/BullMQ only transports jobs
Every monitor row carries `nextCheckAt`. The worker ticks on a plain `setInterval`
(`SCHEDULER_TICK_MS`, default 15s) and claims due monitors with a single atomic
`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`, advancing
`nextCheckAt` in the same statement, then enqueues one BullMQ job per claimed slot.
Rationale: this is the "durable scheduling / reconciliation" requirement. A full Redis
flush loses at most the in-flight jobs; the next tick re-derives everything from
Postgres. It is also safe with several workers running, because the claim is atomic and
`FOR UPDATE SKIP LOCKED` means two ticks never claim the same row.
Tradeoff: check dispatch is granular to the tick interval, so a check can fire up to
`SCHEDULER_TICK_MS` late. Acceptable for a 5-minute monitor.

## D5 — Idempotency by database constraint, not by queue semantics
- `Check` has `@@unique([monitorId, scheduledFor])`.
- `Notification` has `@@unique([incidentId, kind])`.
- A partial unique index allows at most one open incident per monitor:
  `CREATE UNIQUE INDEX incident_one_open_per_monitor ON "Incident"("monitorId") WHERE "resolvedAt" IS NULL`.
BullMQ job ids are also deterministic (`check:<monitorId>:<scheduledFor>`).
Rationale: at-least-once delivery is a property of every queue, so correctness must not
depend on exactly-once. A redelivered job re-runs the HTTP check but the result insert
conflicts and the whole result transaction is skipped, so no extra check row, no extra
failure-streak increment and therefore no phantom downtime.
Tradeoff: a redelivered job can cost one wasted outbound HTTP request.

## D6 — Failure streak counts distinct scheduled slots
`Monitor.consecutiveFailures` is only advanced inside the transaction that
successfully inserts a *new* `(monitorId, scheduledFor)` check row. Queue retries and
redeliveries of the same slot therefore cannot push a monitor to DOWN.

## D7 — Redirects are not followed in V1; 3xx is a failure
`maxRedirections: 0`. A 3xx response is recorded as a failure with kind `REDIRECT`
and reason "Redirected (HTTP <code>); Pingexa does not follow redirects".
Rationale: safely following redirects requires re-running the full SSRF guard and
address pinning at every hop; disabling redirects is the option the scope explicitly
allows and it is far easier to reason about and to audit. To avoid this being a trap
for users, the monitor detail page shows an explicit hint telling the user to monitor
the final URL when the latest failure kind is `REDIRECT`.
Tradeoff: monitoring `http://example.com` when the site 301s to HTTPS reports DOWN.
That is surfaced clearly rather than hidden.

## D8 — SSRF: resolve, filter, then pin the connection to the approved address
`checkUrl()` parses and validates the URL (scheme, no credentials, standard port,
no blocked hostname), resolves every A/AAAA record, rejects the request unless at least
one resolved address is publicly routable, and then performs the request through an
`undici.Agent` whose `connect.lookup` can only return the pre-approved addresses.
Rationale: validating DNS and then letting the socket re-resolve is the classic DNS
rebinding hole. Pinning closes it. TLS still verifies against the original hostname
(`servername`), so certificate validation is unaffected.
Tradeoff: hosts that rely on very short TTL DNS-based failover between a request's
validation and its connection may be pinned to an address that just went away; that
surfaces as a normal connection failure.

## D9 — Test isolation for the SSRF guard: injected policy, never an env switch
Production URL protection has **no** loosening flag. `createUrlGuard()` takes an
explicit policy object, and the production factory always passes the strict policy.
Tests that need to talk to a loopback fixture server construct a guard with
`allowPrivateAddresses: true` themselves. There is no environment variable or config
key that can weaken the guard in a running deployment.

## D10 — Opaque server-side sessions, not JWTs
32 random bytes, SHA-256 hashed at rest, delivered in an httpOnly cookie; logout and
password reset revoke rows immediately.
Rationale: instant revocation matters more here than statelessness, and the API already
has a database on every request.
Tradeoff: one extra indexed lookup per authenticated request.

## D11 — CSRF: double-submit token plus origin allowlist
Non-GET requests must present `X-CSRF-Token` matching the non-httpOnly `pingexa_csrf`
cookie, and their `Origin` (when present) must be in `TRUSTED_ORIGINS`.
Rationale: the session cookie is `SameSite=Lax`, which already blocks cross-site POSTs
in current browsers; the double-submit token and origin check are defence in depth that
also work when the API is served from a different origin than the SPA.

## D12 — Uptime is coverage-aware
`uptime% = up / (up + down)` over completed checks in the window; separately
`coverage% = recorded / expected`, where `expected` is derived from the interval and
from `max(monitor.createdAt, windowStart)`. A monitor whose last check is older than
`3 x interval` is reported with `monitoringStale: true`.
Rationale: the scope forbids silently counting missing checks as uptime *or* as
downtime. Coverage makes the gap visible instead of guessing.
Tradeoff: two numbers to explain instead of one; the UI labels both.

## D13 — Hard delete for monitors, retention cleanup for history
Deleting a monitor cascades its checks, incidents and notifications, and the row no
longer exists for the scheduler to claim. Retention removes checks older than
`CHECK_RETENTION_DAYS` (7) and incidents older than `INCIDENT_RETENTION_DAYS` (90).
Rationale: "deleted monitors must not continue generating checks or alerts" is trivially
true when the row is gone, and there is no per-user history to preserve after deletion.

## D14 — 3-monitor limit enforced by a unique slot column, not by a counted read
Each monitor holds `slot` with `@@unique([userId, slot])` and a
`CHECK (slot >= 0 AND slot <= 2)` constraint. Creation picks the lowest free slot inside
a transaction and retries on unique violation.
Rationale: a `count()` + `insert` can be beaten by concurrent requests under any
isolation level short of serializable. The constraint makes 4 monitors physically
impossible regardless of concurrency. Tradeoff: changing the limit is a migration.

## D15 — Interval is a documented test-only override
`MONITOR_INTERVAL_SECONDS` defaults to 300 and is not user-configurable in the product.
Integration tests set it low to exercise multi-check behaviour without waiting.

## D16 — Alert delivery state is persisted; auth mail is queue-retried only
`Notification` rows carry `status`, `attempts`, `lastError`, `sentAt`, so alert delivery
is inspectable and resumable. Verification/reset mail is enqueued with BullMQ retries
but not mirrored into its own table: the user can always request another one, so
persisting per-message state would add a table with no user-visible benefit.

## D17 — Alert delivery is at-least-once, and the unique index does not change that
This entry replaces an earlier, wrong framing. It used to read as though the
`(incidentId, kind)` unique index made alert delivery effectively exactly-once
apart from one crash window. It does not, and the distinction matters.

**What the unique index actually guarantees.** At most one *notification row*
per `(incident, kind)`. That is a statement about how many alert *intents* the
database will hold — it is not a statement about how many SMTP messages leave
the process for that row. Nothing in Postgres can bound that, because the send
happens outside the transaction.

**What bounds SMTP sends per row.** Three things, in order:
1. A row already marked `SENT` is skipped without sending.
2. The claim is a compare-and-set on the exact `attempts` value that was read
   (see D19), so simultaneous handlers cannot both send.
3. The attempt budget is taken from the row's persisted `attempts`, not from the
   queue job's counter, so the total number of SMTP transactions for one alert
   is bounded by `MAIL_MAX_ATTEMPTS` however many times the job is recreated.

**Where a duplicate can still reach the mailbox.** Two windows, both inherent to
SMTP without a provider-honoured idempotency key:
* *Crash after accept.* The row is marked `SENT` after the SMTP transaction
  returns. If the process dies between the server accepting the message and that
  write, the row is still `PENDING` and the next attempt sends another copy.
* *Ambiguous failure.* `send()` rejecting does not prove non-delivery. A socket
  timeout or a dropped connection after `DATA` can mean the server accepted the
  message and we never saw the `250`. The code treats every error as retryable,
  which is the right default for an uptime alert — a duplicate "your site is
  down" is far less harmful than a missed one — but it does mean an accepted-then
  -unacknowledged message is sent again.

So the honest statement is: **at most one alert row per incident and kind, and
at most `MAIL_MAX_ATTEMPTS` SMTP transactions for that row, with at-least-once
delivery semantics.** Closing the remaining windows needs a provider idempotency
key or a two-phase outbox recording the provider's message id before committing
`SENT`; V1 implements neither, and adding one is a feature, not a fix.

Deliberately *not* prevented, because they are correct: a monitor that flaps
produces several incidents, each with its own DOWN and RECOVERY pair.

## D18 — The public status page is `no-store`, not briefly cacheable
The obvious optimisation for an unauthenticated page whose data changes every
five minutes is a short public cache. It is wrong here: the slug is the only
access control, so unpublishing the page or rotating the slug must take effect
immediately. A `max-age=30` response meant a browser that had already loaded the
page kept seeing it for up to 30 seconds after the owner revoked it — found by
the end-to-end test for slug rotation, which is what prompted this entry.
Freshness of revocation beats saving one query.
Tradeoff: every public page view costs a handful of database queries. The
endpoint has its own IP rate limit (`PUBLIC_RATE_LIMIT_MAX`) to bound that.

## D19 — Alert delivery is claimed by optimistic concurrency on `attempts`
The first version of `deliverAlert` "claimed" the notification row with
`UPDATE ... WHERE id = ? AND status = 'PENDING'` and an `attempts` increment.
That excludes nobody: the row stays `PENDING` until the send completes, so two
workers both match the predicate and both send the same alert. The
fresh-setup verification run caught it — the integration test for concurrent
senders had been passing on timing luck.

The claim now matches on the exact `attempts` value that was read
(`WHERE id = ? AND status = 'PENDING' AND attempts = N` → `SET attempts = N+1`).
Postgres serialises the two updates, so exactly one caller sees a row count of 1
and the rest back out.

Considered and rejected: adding a `SENDING` status. It needs a migration and it
introduces a stuck state — a worker that dies mid-send leaves a row nothing will
ever pick up without a reaper. With the `attempts` approach the same crash
leaves the row `PENDING` with the attempt already counted, which the existing
outbox pass retries and the attempt budget still bounds.


## D20 — The retry budget belongs to the notification row, not to the queue job
`deliverAlert` judged exhaustion from `options.attempt`, which the worker derives
from BullMQ's `attemptsMade`. That counter restarts at 1 whenever a *new* job is
created for the same row — precisely what the outbox pass does when the previous
job has been trimmed by `removeOnFail`/`removeOnComplete`, or lost with Redis. So
the budget reset on every re-enqueue: the row never reached `FAILED`, its
persisted `attempts` column grew without being consulted, and one alert could in
principle be re-sent without limit.

Exhaustion is now judged from `max(job attempt, row.attempts + 1)`, and the
outbox skips rows whose `attempts` already reached the budget. Together those
bound the SMTP transactions for a single alert at `MAIL_MAX_ATTEMPTS` no matter
what happens to the queue, which is what let D17 above be stated as a bound
rather than a hope.

Found while auditing the delivery claims for the handover, not by a failure in
the field; two integration tests now pin it (a spent row is closed out without
sending, and a row with one spent attempt resumes at attempt 2 rather than 1).

## D21 — Theming is attribute-driven, and `system` never reaches CSS
This replaces an earlier decision. The first implementation had no theme
selector at all and drove dark mode purely from
`@media (prefers-color-scheme: dark)`, with a comment in `index.css` claiming a
switch was deliberately omitted. A three-option selector was subsequently
required, so that reasoning no longer holds and the media-query approach had to
go with it.

The shape now:

* `<html>` carries a **resolved** `data-theme="light"|"dark"` and, separately,
  the raw `data-theme-preference="light"|"dark"|"system"`.
* `system` is resolved to one of the two *before* CSS sees it. Every token and
  all 50 `dark:` utilities therefore key off one selector
  (`@custom-variant dark (&:where([data-theme='dark'], …))`), and the compiled
  stylesheet contains **zero** `prefers-color-scheme` rules.

Why resolve outside CSS rather than combining a media query with an attribute
override. The combined form needs each `dark:` utility to match two selectors —
"attribute says dark" *or* "no attribute override and the OS says dark" — which
is where these implementations usually go wrong: the two halves drift, and a
toggle silently loses to a media query in some corner. Resolving once, in one
place, means there is only ever one answer. The cost is that dark mode needs
JavaScript; for a React SPA that renders nothing without it, that is not a real
constraint.

Nothing caches the resolved theme. `preference` is state, the OS setting is read
through `useSyncExternalStore`, and `resolved` is derived from the two on every
render. An earlier version stored `resolved` and updated it from an effect-based
listener, which left a genuine gap: the OS can change between the bootstrap
script reading it and the listener being attached — a remount, or React's
development double-invoke of effects — and that change was simply lost, leaving
the app on a stale theme. `useSyncExternalStore` reads its snapshot during
render, so the gap closes by construction rather than by a reconciliation pass.

## D22 — The focus ring lives on the real input, not on a wrapper
The theme selector's segments are native radios made invisible so the label can
carry the visuals. The obvious way to do that — `opacity: 0` on the input, and
`has-[:focus-visible]:outline-…` utilities mirroring the ring onto the label —
produced **no focus ring at all**, verified by sampling the painted pixels: the
utilities compiled into the production bundle but not the dev server's
stylesheet, and even rewritten as literal CSS with a hard-coded colour the
wrapper rule never painted.

The input is instead kept full-size with `appearance-none` and transparent
colours, so it is invisible but has real dimensions and full opacity. The
app-wide `:focus-visible { outline: 2px solid var(--focus-ring) }` rule then
paints its ring at exactly the segment's shape — one mechanism for the whole
app, nothing bespoke. Pixel sampling confirms it: the dark ring measures
`rgb(165,158,255)`, an exact match for `oklch(0.75 0.15 285)`.

Two things learned worth keeping: `getComputedStyle(el).outlineColor` reports
`currentColor` regardless of what is set (it returned the element's text colour
even for `outline-color: red`), so it cannot be used to verify a ring; and
Tailwind's dev-server output lagged file edits repeatedly during this work, so
CSS must be verified against the production build.

---

## D23 — The SPA bootstraps its own CSRF token before a cold write

`apps/web/src/lib/api.ts` attached `X-CSRF-Token` only when the readable
`pingexa_csrf` cookie already existed, and silently omitted it otherwise. The
API issues that cookie on any safe-method response, so the SPA normally holds
one long before it writes anything — every path that walks through the
application does a `GET /api/meta` or `GET /api/auth/me` first.

An emailed link is the exception, and it is not a rare one. Opening a
confirmation or reset link on a device that has never loaded Pingexa makes
`POST /api/auth/verify-email` the browser's *first ever* request. There is no
cookie, so no header, so `csrfProtection` rejects it with `csrf_failed` and a
perfectly valid link looks broken. `VerifyEmailPage` fires that POST from a
mount effect, which in the observed logs beat the page's own `GET /api/meta` by
two milliseconds — so even the page's other traffic could not rescue it.

The client now makes one safe `GET /api/meta` when the cookie is missing, then
reads the token and proceeds. Nothing about the defence changes: the token is
still server-issued, still random, still compared against the cookie. The
alternative — exempting the token-redemption endpoints server-side — would have
removed CSRF protection from the two endpoints that change a password and
confirm an address, which is precisely backwards.

Found by real delivery, not by a test. The e2e suite navigates the SPA before
clicking a Mailpit link, so its browser context always already holds the cookie;
signing a user up over `curl` and then clicking the emailed link in a fresh
browser is what reproduced it. `apps/web/src/lib/api.csrf.test.ts` now covers
the cold case, the warm case, and a failed bootstrap.

## D24 — `MAIL_RECIPIENT_ALLOWLIST` can only ever narrow delivery

Verifying a real email provider means running the application with live
credentials against a real mailbox, which is exactly the situation in which a
stray seeded account or an old test fixture must not receive anything.

`MAIL_RECIPIENT_ALLOWLIST` is empty by default and has no effect. When set, it
is enforced inside `sendMail` — the single point every message passes through —
immediately before the SMTP transaction, and a recipient that is not on the list
throws rather than being dropped, so a mis-addressed test fails loudly instead
of mailing a stranger. It additionally refuses more than one recipient and pins
the SMTP envelope, so no `cc`, `bcc`, or comma-joined address can widen the set.

This is deliberately *not* the mirror image of the SSRF rule. The guard in
`monitoring/urlGuard.ts` has no off switch because any knob there could relax a
protection. This knob cannot: absent or malformed, mail behaves normally; set,
it can only remove recipients. The failure mode of forgetting it in production
is that email works, and the failure mode of setting it wrongly is that email
stops — never that mail reaches someone it should not.

## D25 — The provider's SMTP reply is logged, and is not proof of delivery

`sendMail` returns the provider's final SMTP reply alongside the `Message-ID`,
and both are logged on every send. Against a real provider this is the only
handle that ties a Pingexa send to a row in the provider's own records when a
recipient later says nothing arrived; without it a delivery dispute has no
evidence at either end.

It must not be read as more than it is. A `250` means the provider *accepted*
the message for delivery. It is not delivery, not inbox placement, and not
proof the recipient can see it. Pingexa has no bounce webhook and no delivery
telemetry, so `Notification.status = SENT` means "the provider accepted it",
and that is the strongest claim the system is entitled to make.
