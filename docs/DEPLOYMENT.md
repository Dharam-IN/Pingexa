# Deployment

How Pingexa is built, shipped and operated in production. `docs/HANDOVER.md` §10
states what the *application* requires; this document is the deployment that
satisfies those requirements.

Production runs on a single Linux/amd64 server with Docker. There is no
Kubernetes, no Terraform and no cloud-managed database, deliberately: the whole
system is six containers described by one Compose file, which is small enough to
hold in your head at 3am.

---

## 1. Architecture

```
                              Internet
                                 │  :80  :443   (the only published ports)
                        ┌────────▼─────────┐
                        │      caddy       │  automatic Let's Encrypt TLS,
                        │  reverse proxy   │  HTTP→HTTPS, HSTS
                        └───┬──────────┬───┘
               /api/*       │          │       everything else
                            │          │
                  ┌─────────▼──┐   ┌───▼─────────────┐
                  │    api     │   │      web        │  nginx, SPA fallback,
                  │ server.js  │   │  static bundle  │  hashed assets immutable
                  │   :4000    │   │     :8080       │
                  └─────┬──────┘   └─────────────────┘
  ══════════════════════│══════════════════════════════  edge  (bridge)
  ══════════════════════│══════════════════════════════  backend (internal)
        ┌───────────────┼──────────────┬───────────────┐
        │               │              │               │
  ┌─────▼─────┐   ┌─────▼──────┐  ┌────▼─────┐  ┌──────▼─────┐
  │  worker   │   │  migrate   │  │ postgres │  │   redis    │
  │ worker.js │   │ (one-shot) │  │  :5432   │  │   :6379    │
  └─────┬─────┘   └────────────┘  │ pgdata   │  │ redisdata  │
        │                         └──────────┘  └────────────┘
  ══════│═══════════════════════════════════════  egress (bridge)
        └──► outbound HTTPS to monitored sites, SMTP to the mail provider
```

| Container | Image | Role |
|---|---|---|
| `caddy` | `caddy:2.10-alpine` | TLS termination, HTTP→HTTPS, routes `/api/*` to the API and everything else to the SPA |
| `web` | `pingexa-web:sha-…` | The built SPA, served by unprivileged nginx |
| `api` | `pingexa-app:sha-…` | `node apps/api/dist/server.js` |
| `worker` | `pingexa-app:sha-…` | `node apps/api/dist/worker.js` — the same image, a different command |
| `migrate` | `pingexa-migrate:sha-…` | One-shot `prisma migrate deploy`, behind a Compose profile so `up` can never start it |
| `postgres` | `postgres:17-alpine` | Volume `pingexa_pgdata` |
| `redis` | `redis:7-alpine` | Volume `pingexa_redisdata`, AOF on, `maxmemory-policy noeviction` |

### The properties that matter, and why

**Only Caddy publishes a port.** Postgres and Redis are on a network declared
`internal: true`, which removes the gateway entirely. That, not the absence of a
`ports:` entry, is what makes them private: even a misconfigured service on that
network cannot reach the internet, and nothing on the internet can reach them.
Verified: from the host, the Redis port is refused, and `getent hosts` inside the
Postgres container fails to resolve.

**The worker is on `backend` *and* `egress`.** It needs Postgres and Redis, and
it needs to reach the sites it monitors and the SMTP provider. On `backend`
alone it would have no route out and every check would fail. It is deliberately
not on `edge`, because it serves no HTTP. The SSRF guard is what keeps those
outbound requests off private address space — see `docs/HANDOVER.md` §9.

**Single origin.** `apps/web/src/lib/api.ts` falls back to an empty API base, so
the browser calls `/api` on whatever origin served the page. That is why one
Caddy site serves both, and why `COOKIE_SAMESITE=Lax` is sufficient — the
session cookie is first-party. It also means the web image is
environment-independent: the same image works on any hostname, so a rollback
never needs a rebuild.

**`TRUST_PROXY_HOPS=1`.** Exactly one proxy (Caddy) is in front of the API. If
anything else is ever added — a CDN, another load balancer — this must be raised
to match. Too low and every IP-keyed rate limit keys on Caddy's address, so one
user exhausts the allowance for everyone; too high and a client can forge
`X-Forwarded-For` and bypass the limits entirely.

**Migrations are a separate, one-shot container.** Never an entrypoint hook: two
processes racing on `_prisma_migrations` is a bad afternoon, and a schema change
must be complete before any new code depends on it. The migration image carries
its own OpenSSL 3 schema engine so the container needs no network beyond
Postgres.

---

## 2. First-time server setup

Everything in this section is done once, by hand, as root.

### 2.1 Docker

```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version    # needs Compose v2
```

### 2.2 The deploy user

CI connects as an unprivileged user that is in the `docker` group. It never uses
root and never uses a password.

```bash
adduser --disabled-password --gecos '' deploy
usermod -aG docker deploy

mkdir -p /opt/pingexa
chown deploy:deploy /opt/pingexa
chmod 755 /opt/pingexa
```

Membership of the `docker` group is equivalent to root on this host. That is
inherent to deploying with Docker over SSH; keep the key to this account as
carefully as a root key.

### 2.3 The SSH key for CI

Generate the key **on your own machine**, not on the server, and give the server
only the public half.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/pingexa_deploy -C 'github-actions-pingexa' -N ''

ssh-copy-id -i ~/.ssh/pingexa_deploy.pub deploy@<server-ip>

# The value for the DEPLOY_KNOWN_HOSTS secret, so CI pins the host key rather
# than trusting it on first use:
ssh-keyscan -t ed25519 <server-ip>
```

### 2.4 Firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Do not open 5432 or 6379. Nothing outside the server ever needs them; use
`docker compose exec` instead.

> Docker publishes ports by writing its own `DOCKER-USER` iptables rules, which
> bypass UFW. That is harmless here **because only Caddy publishes anything** —
> but it is the reason `ports:` entries in `docker-compose.prod.yml` must stay
> as they are.

### 2.5 DNS

Point `pingexa.parthavix.com` at the server:

```
A    pingexa.parthavix.com    <server-ip>
```

This must resolve **before** the first deploy — Caddy cannot complete the
Let's Encrypt HTTP-01 challenge otherwise.

### 2.6 Mail domain

`MAIL_FROM_ADDRESS` must be on a domain you control, with SPF and DKIM
configured at the provider. Without them, alert mail lands in spam — which for
an uptime monitor is the same as not sending it.

### 2.7 The secret file

This is the only place production secrets exist. It is not in git, not in any
image, and not touched by CI.

```bash
su - deploy
cd /opt/pingexa

# Copy the template out of the repository (or scp it up), then:
cp .env.production.example .env.production
chmod 600 .env.production

# Generate the three secrets:
openssl rand -base64 32          # POSTGRES_PASSWORD
openssl rand -base64 32          # REDIS_PASSWORD
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # SESSION_SECRET
```

Fill in every `CHANGE_ME`. The password inside `DATABASE_URL` must match
`POSTGRES_PASSWORD`, and the one inside `REDIS_URL` must match
`REDIS_PASSWORD` — they are written twice because Postgres and Redis take
credentials as discrete variables while the application takes a URL.

Leave `MAIL_RECIPIENT_ALLOWLIST` **empty**. Setting it would stop alert mail
reaching real users.

### 2.8 GHCR credentials on the server

The server pulls the images, so it needs its own read-only credentials. Create a
GitHub personal access token with **`read:packages`** only.

```bash
echo '<token>' | docker login ghcr.io -u <github-username> --password-stdin
```

The deploy workflow also does this on every run, so the login stays fresh.

### 2.9 First deploy

DNS has propagated but no certificate exists yet, so skip the public HTTPS check
on this one run:

```bash
# Push to main, or run the Deploy workflow by hand. Then, if the public check
# is the only thing that failed:
SKIP_PUBLIC_CHECK=1 /opt/pingexa/deploy.sh sha-<commit>
```

Watch Caddy obtain the certificate:

```bash
cd /opt/pingexa
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f caddy
```

Then confirm by hand, and never use `SKIP_PUBLIC_CHECK` again:

```bash
curl -I https://pingexa.parthavix.com/
curl    https://pingexa.parthavix.com/api/health
```

### 2.10 Backups on a schedule

```bash
sudo crontab -u deploy -e
```

```cron
15 3 * * * /opt/pingexa/backup.sh >> /var/log/pingexa-backup.log 2>&1
```

```bash
sudo install -o deploy -g deploy -m 644 /dev/null /var/log/pingexa-backup.log
sudo install -d -o deploy -g deploy -m 700 /var/backups/pingexa
```

Then do a restore **once, deliberately**, following §6. A backup you have never
restored is not a backup.

---

## 3. GitHub configuration

### Secrets — *Settings → Secrets and variables → Actions → Secrets*

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | Server IP or hostname |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_PORT` | SSH port, if not 22 |
| `DEPLOY_SSH_KEY` | Contents of the **private** key `~/.ssh/pingexa_deploy` |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan -t ed25519 <server-ip>` |
| `GHCR_USERNAME` | Your GitHub username |
| `GHCR_READ_TOKEN` | PAT with `read:packages`, used by the **server** to pull |

### Variables — *…→ Variables*

| Variable | Value |
|---|---|
| `PINGEXA_DOMAIN` | `pingexa.parthavix.com` (used only for the deploy summary link) |

### Environment

Create an environment named `production`. Add required reviewers on it if you
want a human approval gate between a green CI and a deploy.

### Package visibility

The first deploy creates three private packages under your account. Nothing else
is needed — the workflow pushes with `GITHUB_TOKEN`, and the server pulls with
`GHCR_READ_TOKEN`.

---

## 4. How a deploy runs

```
push / merge to main
   │
   └─► CI workflow: install · lint · typecheck · unit · integration · build
          │  (integration runs against real Postgres and Redis, and applies the
          │   committed migrations to a disposable database — a migration that
          │   does not apply fails here, before anything is built)
          │
          ▼ success
       Deploy workflow
          │
          ├─ resolve   the full commit SHA; the image tag is sha-<40 hex>
          │
          ├─ build     three images for linux/amd64, pushed to GHCR:
          │              pingexa-app:sha-…      (API + worker)
          │              pingexa-migrate:sha-…  (one-shot migrations)
          │              pingexa-web:sha-…      (the SPA)
          │
          └─ deploy    ssh deploy@server, then /opt/pingexa/deploy.sh sha-…
                 │
                 ├─ 1. pull all three images        ─ fails here ⇒ nothing changed
                 ├─ 2. bring up postgres + redis, wait for healthy
                 ├─ 3. run the migration container  ─ fails here ⇒ nothing changed,
                 │                                     the previous release is
                 │                                     still serving
                 ├─ 4. record IMAGE_TAG, recreate api, worker, web
                 ├─ 5. verify:
                 │       /api/ready returns 200 (Postgres AND Redis answering)
                 │       /api/health reports the tag just deployed
                 │       the worker container is running
                 │       https://<domain>/ and /api/health both answer 200
                 └─ 6. on any failure in 4–5: restore the previous tag,
                       bring the containers back, re-verify, exit non-zero
```

Two things this ordering buys:

* **A failed migration is not an outage.** The application is still running the
  old image when the migration runs, so a failure leaves the previous release
  serving and the deploy simply fails.
* **"It deployed" is a verified claim.** `docker-compose.prod.yml` sets
  `npm_package_version` to `IMAGE_TAG`, which the API returns from
  `/api/health`. The script compares the two, so a container that silently kept
  the old image fails the deploy instead of passing it.

### Deploying a specific commit by hand

*Actions → Deploy → Run workflow*, with the full 40-character SHA. Useful for
rolling forward to a known-good commit without a revert commit.

---

## 5. Rollback

```bash
ssh deploy@<server>
/opt/pingexa/rollback.sh                 # to PREVIOUS_IMAGE_TAG
/opt/pingexa/rollback.sh sha-<40-hex>    # to a specific release
```

This is fast because the images are immutable and already in the registry —
there is no rebuild.

**It rolls back code, not the schema.** Prisma has no down-migrations. This is
safe as long as migrations are additive and forward-compatible, which is the
rule this project operates under precisely so that rollback stays a one-command
operation:

* Adding a table, a nullable column, or an index is safe to roll back past.
* Dropping or renaming a column, or narrowing a type, is **not**. The old code
  will query something that no longer exists.
* When you need to remove a column, do it in two deploys: stop using it in
  deploy N, drop it in deploy N+1. Then any single rollback is safe.

If you must roll back past a destructive migration, restore from backup (§6)
instead.

---

## 6. Backup and restore

### Backup

`deploy/backup.sh` writes a compressed `pg_dump -Fc` archive to `BACKUP_DIR`,
verifies that `pg_restore --list` can read it before keeping it, and prunes
archives older than `BACKUP_RETENTION_DAYS`. Pruning happens only after a
successful new backup, so a broken job can never delete the last good copy.

```bash
/opt/pingexa/backup.sh          # ad hoc, e.g. before a risky migration
ls -la /var/backups/pingexa/
```

The named volume `pingexa_pgdata` survives container recreation, image updates
and `compose down` — verified. It does **not** survive `docker volume rm`, a
disk failure, or a migration that deleted the wrong rows. That is what these
archives are for.

Backups contain every account record in the system. The directory is `0700` and
each archive is `0600`. They are currently on the same disk as the database,
which means they do not protect against disk loss; copying them off the server
is the obvious next improvement.

### Restore

```bash
cd /opt/pingexa
COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"

# 1. Stop the writers. Leave Postgres running.
$COMPOSE stop api worker

# 2. Restore into a NEW database first and inspect it, rather than over the top
#    of the live one.
gunzip -c /var/backups/pingexa/pingexa-YYYYmmdd-HHMMSS.dump.gz \
  | $COMPOSE exec -T postgres pg_restore -U pingexa -d postgres \
      --create --clean --no-owner --no-privileges

# 3. Look at it.
$COMPOSE exec -T postgres psql -U pingexa -d pingexa -c '\dt'
$COMPOSE exec -T postgres psql -U pingexa -d pingexa -c 'SELECT count(*) FROM monitors;'

# 4. Restart.
$COMPOSE up -d api worker
```

---

## 7. Day-to-day operation

```bash
cd /opt/pingexa
COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"

$COMPOSE ps                       # what is running, and its health
$COMPOSE logs -f api              # structured JSON; pipe through jq
$COMPOSE logs -f worker
$COMPOSE logs --since 1h caddy

# The application's own view of its health:
$COMPOSE exec api node -e "fetch('http://127.0.0.1:4000/api/ready').then(r=>r.text()).then(console.log)"

# A psql shell. There is no published port; this is how you get in.
$COMPOSE exec postgres psql -U pingexa -d pingexa
```

`--env-file .env.production` is not optional. Compose interpolates `${IMAGE_TAG}`
and friends from that file; without the flag every one of them resolves empty
and the command aborts on the required-variable guards.

### What to watch

| Signal | Meaning |
|---|---|
| `/api/ready` returning 503 | Postgres or Redis is unreachable. The body says which. |
| No `dispatched due checks` log lines from the worker | The scheduler has stopped. Monitors will start reporting `monitoringStale`, which the UI shows as **Unknown**. |
| `Notification.status = 'FAILED'` rows | Alert mail is not being accepted by the provider. |
| Caddy logging certificate errors | Renewal is failing. Certificates last 90 days; you have weeks, not hours. |

The worker exposes no HTTP endpoint by design (`docs/HANDOVER.md` §6), so its
container healthcheck only proves the process is alive. A wedged worker is
detected from the two signals above, not from `docker ps`.

An external check on `https://pingexa.parthavix.com/api/health` from somewhere
other than this server is worth setting up. An uptime monitor that is itself
down cannot tell you about it.

---

## 8. Changing configuration

Editing `.env.production` does not affect running containers. Apply it with:

```bash
cd /opt/pingexa
docker compose --env-file .env.production -f docker-compose.prod.yml up -d api worker
```

Rotating `SESSION_SECRET` signs every user out **and** invalidates every
outstanding email-verification and password-reset link.

The API refuses to start in production if any of these hold — each is a silent
security downgrade, so the refusal is deliberate:

* `COOKIE_SECURE` is not `true`
* `SMTP_REJECT_UNAUTHORIZED` is not `true`
* `PUBLIC_APP_URL` uses `http://`
* `TRUSTED_ORIGINS` does not contain `PUBLIC_APP_URL`
* `MONITOR_INTERVAL_SECONDS` is not `300`
* `SESSION_SECRET` still starts with `replace-me`

If the API will not come up after a config change, that list is the first place
to look — the reason is printed in the container's logs.

`PUBLIC_APP_URL` must appear **exactly once** in the file. dotenv keeps the last
occurrence, so a second definition silently wins and every emailed link points
somewhere unintended.

---

## 9. Upgrading Postgres or Redis

Both are pinned to a major version. A `pgdata` directory initialised by
Postgres 17 will not start under 18; the container will exit with a version
mismatch and no data is lost, but the stack is down until you put the pin back.

A major upgrade is a dump and restore, not an image bump:

1. `./backup.sh`, and verify the archive restores (§6).
2. Stop everything, rename the volume rather than deleting it.
3. Change the pin, start Postgres alone so it initialises a fresh volume.
4. Restore the dump, then bring the application back.

---

## 10. What this deployment does not do

Stated so nobody assumes otherwise:

* **One server, no redundancy.** Any single failure is an outage.
* **No off-server backups.** Archives sit on the same disk as the database.
* **No log aggregation.** Logs are JSON in Docker's local driver, capped at
  5 × 10 MB per container. A container that is recreated loses its history.
* **No metrics or alerting.** Watching is manual, per §7.
* **No staging environment.** `main` goes to production. CI is the gate.
* **Accepted, not delivered.** A `250` from the provider and
  `Notification.status = SENT` both mean the provider accepted the message.
  There is no bounce webhook and no delivery telemetry.
