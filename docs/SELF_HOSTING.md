# Pingexa — Self-hosting

Run your own Pingexa. Everything here is built from this source tree, so you
need no container registry account, no credentials belonging to anyone else,
and no DNS you do not control.

Every command below was executed against this repository before it was written
down. Where something was **not** verified, it says so.

> **This is not the maintainer's production deployment.** That one
> ([`DEPLOYMENT.md`](DEPLOYMENT.md)) pulls pre-built images from a private
> registry by commit SHA and is driven over SSH by GitHub Actions. You do not
> need it, cannot use it, and should not read it as the self-hosting path. The
> two stacks share no file, no volume, no network and no port.

---

## 1. What you are signing up for

Pingexa is three long-running processes and two data stores. On one small
server that is about **1.5 GB of RAM and 10 GB of disk** for a handful of
accounts, plus whatever your host charges for a static IP.

| | Minimum | Comfortable |
|---|---|---|
| CPU | 1 core | 2 cores |
| RAM | 1 GB | 2 GB |
| Disk | 10 GB | 20 GB |
| OS | anything running Docker Engine 24+ and Compose v2 | — |

Disk is dominated by the images (about **690 MB** for the three the stack
builds, plus Postgres, Redis and Caddy) and by check history. Check rows are
kept for 7 days by default: three monitors at a 5-minute interval produce about
2,600 rows a day, which is negligible.

**The build is heavier than the run.** `docker compose build` runs two full
`npm ci` installs, `prisma generate`, `tsc` and a Vite build. Give it 2 GB of
RAM and several minutes. On a 1 GB server, build the images on a bigger machine
and transfer them, or add swap.

### What you also need

* **A domain name** you control, with an `A` record pointing at the server,
  if you want HTTPS. Caddy obtains a certificate automatically.
* **An SMTP account.** Pingexa sends confirmation links, password resets and
  the alerts themselves. Without working mail, nobody can even finish signing
  up.
* **Ports 80 and 443** reachable from the internet, for the certificate and for
  users. Port 80 is not optional — that is where the ACME HTTP-01 challenge
  lands.

### What this is not

There is no multi-tenant admin, no plan management, and no account deletion in
the UI. Every account is capped at **three monitors** by a database constraint;
raising that is a migration, not a setting. Checks come from wherever your
server is — Pingexa cannot tell "the site is down" apart from "my server cannot
reach the site". See [`HANDOVER.md`](HANDOVER.md) §13.

---

## 2. Prerequisites

```bash
docker --version          # Docker Engine 24+
docker compose version    # Compose v2 (the plugin, not docker-compose 1.x)
```

If you do not have Docker, follow the official install for your distribution
(<https://docs.docker.com/engine/install/>). You do **not** need Node.js,
PostgreSQL, Redis or a build toolchain on the host — everything is built inside
containers.

---

## 3. Clone and configure

```bash
git clone https://github.com/Dharam-IN/Pingexa.git
cd Pingexa/deploy/selfhost
cp .env.example .env
chmod 600 .env
```

Everything you run from here on is run from `deploy/selfhost/`.

`.env` is gitignored, and `.dockerignore` excludes `.env*` from every build
context, so it is never sent to the Docker daemon and never ends up in an image
layer. Keep it that way: it is the only place your secrets exist.

### Generate the three secrets

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)"
echo "REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)"
echo "SESSION_SECRET=$(openssl rand -base64 48 | tr -d '=+/' | cut -c1-48)"
```

(The `tr`/`cut` keeps them to URL-safe characters, so you can paste the database
and Redis passwords straight into `DATABASE_URL` and `REDIS_URL` without
URL-encoding. If you generate them another way and they contain `@ : / ? # %`,
encode those inside the URLs.)

Put each value in **both** places it appears:

| Variable | Also appears in |
|---|---|
| `POSTGRES_PASSWORD` | `DATABASE_URL` |
| `REDIS_PASSWORD` | `REDIS_URL` |
| `SESSION_SECRET` | — (once) |

**Rotating `SESSION_SECRET` signs everyone out and invalidates every
outstanding email confirmation and password-reset link.** It keys the HMAC over
both.

### Set the domain and the URLs

```ini
PINGEXA_SITE_ADDRESS=uptime.example.com
ACME_EMAIL=you@example.com
PINGEXA_HTTP_BIND=0.0.0.0:80
PINGEXA_HTTPS_BIND=0.0.0.0:443

PUBLIC_APP_URL=https://uptime.example.com
TRUSTED_ORIGINS=https://uptime.example.com
```

Four things that are easy to get wrong:

1. **`PUBLIC_APP_URL` has no trailing slash**, and must be exactly the origin a
   browser sees. It builds every link inside every email, and the shareable
   status-page URL.
2. **Define `PUBLIC_APP_URL` exactly once.** dotenv keeps the *last* occurrence
   in a file, so a second definition further down silently wins and every
   emailed link points somewhere unintended. This has happened for real.
3. **`TRUSTED_ORIGINS` must contain `PUBLIC_APP_URL`.** Both CORS and the CSRF
   origin check read it, and with `NODE_ENV=production` the API refuses to boot
   otherwise. No wildcards are accepted.
4. **`TRUST_PROXY_HOPS` must equal the real number of proxies.** It is `1` for
   this stack — Caddy and nothing else. Put your own nginx, Traefik or a CDN in
   front and it becomes `2`. Too low and every rate limit keys on Caddy's
   address, so one user can exhaust the allowance for everyone. Too high and a
   client can forge `X-Forwarded-For` and bypass the limits entirely.

### Set up mail

Pingexa speaks **plain SMTP**. There is no provider SDK and no HTTP API client
in the codebase, so any standards-compliant provider works — it is host, port,
user and password.

```ini
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_SECURE=false          # false = STARTTLS on 587; true = implicit TLS on 465
SMTP_USER=your-username
SMTP_PASSWORD=your-password-or-api-key
SMTP_REJECT_UNAUTHORIZED=true
MAIL_FROM_NAME=Pingexa
MAIL_FROM_ADDRESS=alerts@example.com
```

Providers, with their documented settings. **Resend is the one that has been
verified end to end** against a real mailbox (six messages across all five
product flows, 2026-09-16 — see [`PROGRESS.md`](PROGRESS.md)); the rest are the
providers' published settings and are listed because nothing in Pingexa is
specific to any of them. Check them against your provider's current docs.

| Provider | Host | Port | `SMTP_SECURE` | Username |
|---|---|---|---|---|
| **Resend** (verified) | `smtp.resend.com` | 465 | `true` | the literal `resend`; password is the API key |
| Postmark | `smtp.postmarkapp.com` | 587 | `false` | the Server API token, as both user and password |
| Mailgun | `smtp.mailgun.org` | 587 | `false` | your SMTP username |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | 587 | `false` | your SES SMTP credentials |
| SendGrid | `smtp.sendgrid.net` | 587 | `false` | the literal `apikey`; password is the API key |
| Your own Postfix | your host | 587 | `false` | whatever it wants |

Three traps, each of which costs an afternoon:

* **`SMTP_USER` gates authentication entirely.** The transport only builds an
  auth block when `SMTP_USER` is non-empty, so setting only `SMTP_PASSWORD`
  configures *no* auth and the provider refuses the session.
* **`MAIL_FROM_ADDRESS` must be on a domain you control, with SPF and DKIM
  configured.** Otherwise alert mail lands in spam — which, for an uptime
  monitor, is the same as not sending it.
* **Never set `SMTP_REJECT_UNAUTHORIZED=false` against a real provider.** Any
  certificate would then be accepted. With `NODE_ENV=production` the API
  refuses to start with it false.

`MAIL_RECIPIENT_ALLOWLIST` is empty by default and inert. It can only ever
*remove* recipients, never add one; set it if you run a staging copy that holds
live provider credentials, and leave it empty in the real deployment or your
users get no alerts.

### Refusals you should not work around

With `NODE_ENV=production`, the API will not start if any of these hold. Each
one is a silent security downgrade in a deployed system:

* `COOKIE_SECURE` is not `true`
* `SMTP_REJECT_UNAUTHORIZED` is not `true`
* `PUBLIC_APP_URL` uses `http://`
* `TRUSTED_ORIGINS` does not contain `PUBLIC_APP_URL`
* `MONITOR_INTERVAL_SECONDS` is not `300`
* `SESSION_SECRET` is still the example value

---

## 4. DNS, and then start it

Point your domain at the server **before** the first start, or Let's Encrypt
cannot issue a certificate:

```
A     uptime.example.com     <your server's IPv4>
AAAA  uptime.example.com     <your server's IPv6, if you have one>
```

Confirm it resolves, and that 80 and 443 are open in your firewall:

```bash
dig +short uptime.example.com
```

Then, in order:

```bash
# 1. Build the three images from this source tree. Several minutes.
docker compose build

# 2. Migrations. A one-shot container that MUST exit 0 before anything starts.
docker compose --profile migrate run --rm migrate

# 3. Start the stack.
docker compose up -d
```

**Step 2 is separate on purpose and must not be automated into step 3.** Two
processes racing on migrations is a bad afternoon, and a failed migration must
leave the previous release serving rather than cause an outage. `prisma migrate
deploy` applies committed migrations only — it never generates one, never
resets, and is safe to re-run; a second run reports "No pending migrations".

Watch it come up:

```bash
docker compose ps
```

All six services should reach `healthy`:

```
SERVICE    STATUS
api        Up (healthy)
caddy      Up (healthy)
postgres   Up (healthy)
redis      Up (healthy)
web        Up (healthy)
worker     Up (healthy)
```

`caddy` takes a little longer on the first start while it obtains a
certificate. `docker compose logs caddy` shows the ACME exchange.

### Check it

```bash
curl https://uptime.example.com/api/health
# {"status":"ok","service":"pingexa-api","version":"selfhost","uptimeSeconds":30}

curl https://uptime.example.com/api/ready
# {"status":"ready","checks":{"database":true,"redis":true}}
```

| Endpoint | Use it for |
|---|---|
| `/api/health` | **Liveness.** Always 200 while the process is up; touches no dependency, so a database blip cannot make an orchestrator kill a healthy API. Reports `PINGEXA_RELEASE` as `version`. |
| `/api/ready` | **Readiness.** 200 when Postgres **and** Redis answer; 503 otherwise, naming which failed. This is the one to point a load balancer or an external check at. |

The **worker exposes no HTTP endpoint**, by design. Judge it by its process
liveness and by its logs. A worker that has stopped working shows up *in the
product* as monitors reporting **Unknown**, which is the signal that actually
matters.

Now open `https://uptime.example.com`, create your account, and confirm the
address from the email. **Nothing is monitored until the address is confirmed.**

---

## 5. Try it locally first (optional, recommended)

You can rehearse the whole thing on a laptop with no domain and no mail
provider, using Caddy's own local CA for the certificate and **Mailpit** — a
fake SMTP server that accepts every message and delivers none of them.

This exact configuration was used to verify the guide.

```ini
# deploy/selfhost/.env
PINGEXA_SITE_ADDRESS=https://localhost
PINGEXA_TLS_DIRECTIVE=tls internal
PINGEXA_HTTP_BIND=127.0.0.1:8080
PINGEXA_HTTPS_BIND=127.0.0.1:8443

PUBLIC_APP_URL=https://localhost:8443
TRUSTED_ORIGINS=https://localhost:8443

NODE_ENV=production        # yes — this exercises the real production refusals
COOKIE_SECURE=true

SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_REJECT_UNAUTHORIZED=true
MAIL_FROM_ADDRESS=alerts@example.com
```

```bash
docker compose build
docker compose --profile migrate run --rm migrate
docker compose --profile mailpit up -d
```

* App: <https://localhost:8443> — your browser will warn about the certificate,
  because it comes from Caddy's local CA and nothing else trusts it. That is
  expected here and only here.
* Mail: <http://127.0.0.1:8125> — every confirmation link, reset and alert lands
  in Mailpit instead of a mailbox.

**Never leave `--profile mailpit` on a real deployment.** Alerts would be
captured there instead of reaching you, which for an uptime monitor is the same
as not sending them.

Tear it down completely, including the data:

```bash
docker compose --profile mailpit --profile migrate down -v
```

---

## 6. Putting your own reverse proxy in front

If you already run nginx, Traefik or a CDN and want it to terminate TLS:

```ini
PINGEXA_SITE_ADDRESS=http://          # plain HTTP inside the stack, any hostname
PINGEXA_TLS_DIRECTIVE=
PINGEXA_HTTP_BIND=127.0.0.1:8080      # only your proxy can reach it
PINGEXA_HTTPS_BIND=127.0.0.1:8443     # unused, kept bound to loopback

PUBLIC_APP_URL=https://uptime.example.com
TRUSTED_ORIGINS=https://uptime.example.com
TRUST_PROXY_HOPS=2                    # yours + this stack's Caddy
```

Then proxy your host's `uptime.example.com` to `127.0.0.1:8080`, forwarding
`Host`, `X-Forwarded-For` and `X-Forwarded-Proto`.

**Do not skip the `TRUST_PROXY_HOPS=2`.** It is the whole difference between
rate limits that work and rate limits that key on a single internal address.

**Do not try to point your proxy straight at the `web` container.** It serves
only static files and knows nothing about `/api`; the single-origin routing is
what Caddy is there for.

---

## 7. Day-to-day operation

```bash
docker compose ps                       # what is running, and is it healthy
docker compose logs -f api              # follow one service
docker compose logs -f worker
docker compose logs --since 1h worker   # recent history
docker compose restart api              # restart one service
docker compose stop                     # graceful stop, volumes kept
docker compose up -d                    # start again
```

Logs are structured JSON. Passwords, hashes, tokens, cookies, `Authorization`
headers, status-page slugs and response bodies are redacted by key name, so
`docker compose logs` is safe to read and reasonably safe to share — check
before you paste it into a public issue anyway.

Pipe them through `jq` if you want them readable:

```bash
docker compose logs --no-log-prefix api | jq -r '"\(.time) \(.level) \(.msg)"'
```

### What to watch

| Signal | Meaning |
|---|---|
| `/api/ready` returning 503 | Postgres or Redis is unreachable. The body says which. |
| No `dispatched due checks` lines from the worker | The scheduler has stopped. Nothing is being monitored. |
| Monitors showing **Unknown** in the UI | `monitoringStale` — the worker is not keeping up, or is dead. |
| `Notification.status = 'FAILED'` rows | Alert mail is not being delivered. Check SMTP credentials and the `lastError` column. |
| Disk filling | Check history and Docker logs. Retention handles the first; `max-size`/`max-file` in the compose file bound the second. |

**Set up an external check on `https://uptime.example.com/api/ready` from
somewhere other than this server.** A monitor that cannot tell you it is down
is the one thing Pingexa cannot do for itself.

### Graceful shutdown

Both processes handle `SIGTERM`. The API drains in-flight requests and
hard-exits at 15s; the worker waits for in-flight checks — so a check in
progress records its result rather than being abandoned — and hard-exits at 30s.
The compose file allows 30s and 45s respectively. `docker compose stop` is
enough; do not `kill -9`.

---

## 8. Backups

**Postgres is the only place anything of value lives.** Redis carries queued
jobs and rate-limit counters; losing it loses at most the in-flight checks,
because the next scheduler tick re-derives everything from Postgres and pending
alerts are re-enqueued by the outbox pass.

The named volume is **not** a backup. It survives container recreation and
`docker compose down`; it does not survive `docker volume rm`, a failed disk, or
a mistake.

```bash
# Take one. Custom format, so pg_restore can be selective.
docker compose exec -T postgres pg_dump -U pingexa -d pingexa -Fc \
  > "pingexa-$(date +%Y%m%d-%H%M%S).dump"
```

Verified: a 26 KB archive from a live stack, listing all eight application
tables plus `_prisma_migrations`.

A nightly cron, keeping 14 days:

```cron
15 3 * * * cd /opt/pingexa/Pingexa/deploy/selfhost && \
  docker compose exec -T postgres pg_dump -U pingexa -d pingexa -Fc \
  > /var/backups/pingexa/pingexa-$(date +\%Y\%m\%d).dump && \
  find /var/backups/pingexa -name 'pingexa-*.dump' -mtime +14 -delete
```

Copy them off the machine. A backup on the same disk as the database is not a
backup.

### Restore

**Rehearse this before you need it.** A backup you have never restored is a
hypothesis.

```bash
# Rehearsal: restore into a throwaway database on the same server.
docker compose exec -T postgres psql -U pingexa -d postgres \
  -c 'CREATE DATABASE restore_probe'
docker compose exec -T postgres pg_restore -U pingexa -d restore_probe --no-owner \
  < pingexa-20260920-035900.dump
docker compose exec -T postgres psql -U pingexa -d restore_probe \
  -tAc 'select count(*) from users'
docker compose exec -T postgres psql -U pingexa -d postgres \
  -c 'DROP DATABASE restore_probe'
```

Verified: `pg_restore` exits 0 and the rows read back.

For a real restore, stop the application first so nothing writes while you work:

```bash
docker compose stop api worker
docker compose exec -T postgres psql -U pingexa -d postgres \
  -c 'DROP DATABASE pingexa' -c 'CREATE DATABASE pingexa'
docker compose exec -T postgres pg_restore -U pingexa -d pingexa --no-owner \
  < your-backup.dump
docker compose --profile migrate run --rm migrate   # apply anything newer
docker compose up -d api worker
```

After a restore, monitors resume from the `nextCheckAt` values in the backup.
Expect one catch-up check per monitor rather than a replayed backlog — a
monitor more than three intervals behind is re-based onto the present, so a
restore does not produce a burst of requests at the sites you monitor.

---

## 9. Upgrading

```bash
cd Pingexa
git pull

cd deploy/selfhost
docker compose build                                  # rebuild from the new source
docker compose --profile migrate run --rm migrate     # MUST exit 0
docker compose up -d                                  # recreate api, worker, web
docker compose ps
curl https://uptime.example.com/api/ready
```

Take a backup first. Always.

**Migrations are forward-only.** Prisma has no down-migrations, so "rolling
back" means restoring the previous code, not the previous schema:

```bash
git checkout <the previous commit>
cd deploy/selfhost && docker compose build && docker compose up -d
```

That works when the newer migration was additive — which is the rule this
project holds itself to. It does **not** work across a destructive migration; in
that case you restore from the backup you took before upgrading. Read the
release notes for anything marked as such.

Tell your users, or at least yourself, that the upgrade window is a monitoring
gap. Pingexa reports gaps honestly: the time the worker was down is counted as
**reduced coverage**, never as uptime and never as downtime.

### Upgrading Postgres or Redis

**Do not just change the image tag.** A Postgres 17 data directory will not
start under 18. That upgrade is: back up, stop, remove the volume, change the
tag, start, restore. Redis is more forgiving but still deserves a backup first.

---

## 10. Troubleshooting

| Symptom | What is happening |
|---|---|
| Caddy cannot get a certificate | DNS does not resolve to this server yet, or port 80 is blocked. Port 80 is where the ACME HTTP-01 challenge lands, so it cannot be skipped. `docker compose logs caddy`. |
| `api` restarts in a loop right after `up` | A config refusal. `docker compose logs api` names the variable. The usual suspects are `TRUSTED_ORIGINS` not containing `PUBLIC_APP_URL`, `COOKIE_SECURE` not `true`, and `SESSION_SECRET` left as the example. |
| `migrate` fails | Read the output; nothing was started, so the previous release is untouched. A password mismatch between `POSTGRES_PASSWORD` and `DATABASE_URL` is the common cause. |
| Confirmation emails never arrive | Only the **worker** sends mail. `docker compose logs worker` and look for `email sent` or the SMTP error. Check `SMTP_USER` is set (see §3). |
| Emailed links point at the wrong host | `PUBLIC_APP_URL` is wrong, or defined twice in `.env` — the last one wins. |
| Every monitor fails immediately | The worker has no route out. It must be on **both** `backend` and `egress`; on `backend` alone there is no gateway. Check with `docker inspect $(docker compose ps -q worker)`. |
| A site that loads in a browser reports **Down** with `REDIRECT` | Redirects are not followed, by design. Monitor the final URL ([D7](DECISIONS.md)). |
| Adding a monitor is rejected with `invalid_monitor_url` | The SSRF guard refused it: not `http`/`https`, a non-standard port, credentials in the URL, an internal-only hostname suffix, or a hostname that resolves to a non-public address. **There is no setting that relaxes this**, and there must never be one. You cannot monitor something on your own private network with Pingexa. |
| Monitors sit on **Pending** forever | The account email is not confirmed, or the worker is not running. |
| Uptime shows `—` | Nothing has been recorded in that window. `null` is the honest answer, not `0%` or `100%`. |
| Users report duplicate "your site is down" emails | Alert delivery is at-least-once by design ([D17](DECISIONS.md)). One alert *row* per incident is guaranteed; the number of SMTP messages for that row is not. |
| `docker compose build` is killed | Out of memory. The Vite and TypeScript builds need about 2 GB. Add swap, or build elsewhere. |

### Getting the state out of it

```bash
docker compose exec postgres psql -U pingexa -d pingexa

\dt                                                   -- the eight tables
select email, "emailVerifiedAt" from users;
select name, state, paused, "nextCheckAt" from monitors;
select kind, status, attempts from notifications order by "createdAt" desc limit 20;
```

There is no published port for Postgres or Redis — `docker compose exec` is how
you reach them, and that is deliberate.

---

## 11. Security notes for an instance on the internet

* **The stack publishes exactly two ports**, both Caddy's. Postgres and Redis
  sit on a network marked `internal: true`, which removes the gateway: nothing
  on it can reach the internet and nothing on the internet can reach it. That,
  not the absence of a `ports:` entry, is what keeps them private. Verified: a
  DNS lookup from inside the Postgres container fails, and neither service is
  reachable from the host.
* **`TRUST_PROXY_HOPS` is the setting most worth getting right.** See §3.
* **Your instance makes outbound requests to URLs strangers supply.** The SSRF
  guard is what stands between that and your private network: public
  `http`/`https` only, on standard ports, with every resolved A/AAAA record
  checked against the IPv4 and IPv6 special-purpose registries, and the
  connection then *pinned* to the approved address so DNS cannot rebind under
  it. Redirects are not followed and TLS is always verified. **There is no
  environment variable, config key or flag that weakens any of this**, and a
  patch that adds one will be rejected.
* **Set a contact in `MONITOR_USER_AGENT`** if other people will use your
  instance, so a site owner who sees your traffic can reach you.
* **Keep `.env` at mode 600**, owned by the user that runs Docker.
* **Put the server behind a firewall** that allows only 22, 80 and 443.
* Report a vulnerability privately — see [`SECURITY.md`](../SECURITY.md), never
  a public issue.

### What is stored about your users

Account email address, an Argon2id password hash, the monitored URLs, check
history for 7 days, incident history for 90 days, and alert delivery state. If
you run an instance other people use, that makes you the data controller for
it. [`DATA_AND_PRIVACY.md`](DATA_AND_PRIVACY.md) is a factual inventory of every
field, where it goes and how long it lives — it is not legal advice, and you
should get your own privacy policy and terms reviewed before taking sign-ups.

---

## 12. Reference: the stack

| Service | Image | Networks | Publishes |
|---|---|---|---|
| `caddy` | `caddy:2.10-alpine` | `edge` | 80, 443 |
| `web` | built from `deploy/Dockerfile.web` | `edge` | — |
| `api` | built from `deploy/Dockerfile.app` (`runtime`) | `edge`, `backend` | — |
| `worker` | same image, different `command` | `backend`, `egress` | — |
| `migrate` | built from `deploy/Dockerfile.app` (`migrate`), profile `migrate` | `backend` | — |
| `postgres` | `postgres:17-alpine` | `backend` | — |
| `redis` | `redis:7-alpine`, `noeviction` + AOF | `backend` | — |
| `mailpit` | `axllent/mailpit:v1.28`, profile `mailpit` | `egress` | UI only, loopback |

Volumes: `pingexa_selfhost_pgdata`, `pingexa_selfhost_redisdata`,
`pingexa_selfhost_caddy_data`, `pingexa_selfhost_caddy_config` — named so they
can never collide with the development or maintainer-production stacks.

Every configuration variable is documented inline in
[`deploy/selfhost/.env.example`](../deploy/selfhost/.env.example).

---

## 13. Getting help

* [`ARCHITECTURE.md`](ARCHITECTURE.md) — how it all fits together
* [`API.md`](API.md) — the HTTP contract and the check/uptime/incident semantics
* [`HANDOVER.md`](HANDOVER.md) §13 — known limitations, in full
* [`DECISIONS.md`](DECISIONS.md) — why something is the way it is
* [`SUPPORT.md`](../SUPPORT.md) — where to ask
* [`SECURITY.md`](../SECURITY.md) — reporting a vulnerability

Pingexa is MIT-licensed and provided without warranty. An instance exposed to
the internet is yours to look after.
