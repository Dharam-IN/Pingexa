# Deployment

Pingexa's production deployment is deliberately basic: one EC2 server, the
repository checked out on it, images built there with Docker Compose, and a
**shared Caddy container** (one Caddy for every site on the server) in front. After the first manual
deploy, `.github/workflows/deploy.yml` redeploys automatically whenever CI
passes on `main`. There is no image registry, no rollback script and no backup
script.

The files involved:

| File | Purpose |
|---|---|
| `docker-compose.prod.yml` | The stack: `web`, `api`, `worker`, `migrate`, `postgres`, `redis`. |
| `deploy/Dockerfile.app` | API + worker image (`runtime` target) and the migration image (`migrate` target). |
| `deploy/Dockerfile.web` | The SPA, built and served by unprivileged nginx. |
| `deploy/nginx/web.conf` | nginx config for the SPA (caching, SPA fallback). |
| `deploy/.env.production.example` | Template for `.env.production`. |
| `.github/workflows/deploy.yml` | CD: after CI passes on `main`, SSH in as `deploy` and redeploy. |

`docker-compose.dev.yml` is development-only and unrelated. The community
self-hosting stack in `deploy/selfhost/` is also separate (it bundles its own
Caddy); see `docs/SELF_HOSTING.md`.

## How it fits together

```
internet ──443──▶ caddy container ──┬── /api/* ──▶ pingexa-api:4000 ─┐
 (one for all sites)                └── else   ──▶ pingexa-web:8080  │ backend (internal)
          └──── shared `caddy` docker network ────┘      worker ─────┤──▶ postgres, redis
                                                (egress) ─▶ monitored sites, SMTP
```

* Caddy runs in **its own** compose project (e.g. `/opt/caddy`), not in
  Pingexa's. Both join an external Docker network called `caddy`.
* On that network `web` and `api` are reachable as **`pingexa-web`** and
  **`pingexa-api`**. The prefix matters: another site's `web` or `api` service
  on the same network would otherwise collide.
* Nothing in Pingexa's stack publishes a port. Only Caddy publishes 80/443.
  (Docker-published ports bypass `ufw`, which is one more reason not to
  publish any.)
* Postgres and Redis are on an `internal: true` network.
* `migrate` runs on every `up`, applies committed migrations and exits.
  `api` and `worker` only start once it has exited 0.
* The worker is on `egress` so it can reach monitored sites and SMTP.

## Server prerequisites

* Docker Engine with the Compose plugin, and `git`.
* Ports 22, 80 and 443 open in the EC2 security group (and `ufw`, if enabled).
* A DNS A record for the Pingexa domain pointing at the server.
* At least 2 GB RAM and ~6 GB free disk for the image build (add swap on a
  small instance).

## First deploy

### 1. The shared network (once per server)

```bash
docker network create caddy
```

### 2. Pingexa

`git clone` needs an empty directory. If `/opt/pingexa` already holds
`.env.production`, clone in place instead:

```bash
cd /opt/pingexa
git init -b main
git remote add origin <repo-url>
git fetch origin
git checkout -t origin/main
```

Otherwise `git clone <repo-url> /opt/pingexa`, then
`cp deploy/.env.production.example .env.production && chmod 600 .env.production`
and fill in every CHANGE ME.

Generate secrets with `openssl rand -hex 32` (Postgres and Redis passwords; hex
because `/`, `+` and `=` break the URLs — use the same value inside
`DATABASE_URL` / `REDIS_URL`) and `openssl rand -hex 48` for `SESSION_SECRET`.
Set `PUBLIC_APP_URL` and `TRUSTED_ORIGINS` to `https://<your-domain>`; the API
refuses to boot if `TRUSTED_ORIGINS` does not contain `PUBLIC_APP_URL`.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

`--env-file` is required: it is what fills `${POSTGRES_USER}` etc. inside the
compose file. (`env_file:` in the services only passes variables into the
containers.)

### 3. Caddy (once per server, then one block per site)

If the server has no Caddy yet, create `/opt/caddy/docker-compose.yml`:

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
      - '443:443/udp'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data        # certificates — do not lose this volume
      - caddy_config:/config
    networks:
      - caddy

networks:
  caddy:
    external: true

volumes:
  caddy_data:
  caddy_config:
```

And add Pingexa's site to `/opt/caddy/Caddyfile`:

```caddy
pingexa.example.com {
	encode zstd gzip

	header {
		Strict-Transport-Security "max-age=63072000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		X-Frame-Options "DENY"
		-Server
	}

	# `handle`, not `handle_path`: the API expects the /api prefix.
	handle /api/* {
		reverse_proxy pingexa-api:4000 {
			transport http {
				response_header_timeout 35s
			}
		}
	}

	handle {
		reverse_proxy pingexa-web:8080
	}
}
```

Start it with `cd /opt/caddy && docker compose up -d`. After editing the
Caddyfile later, reload without downtime:
`docker compose exec -w /etc/caddy caddy caddy reload`.

Caddy is the **one** proxy in front of the API, so keep `TRUST_PROXY_HOPS=1`.
If you ever add a CDN or load balancer in front of Caddy, raise it to match —
too high and clients can forge `X-Forwarded-For` to bypass rate limits.

### Verify

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps -a
curl -s https://pingexa.example.com/api/health   # liveness
curl -s https://pingexa.example.com/api/ready    # checks Postgres + Redis
```

`migrate` should show `Exited (0)`; everything else `Up`. Then sign up, confirm
the email, and add a monitor.

## Updating

```bash
cd /opt/pingexa
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Migrations run automatically before the API and worker restart. If one fails,
`api` and `worker` are not started on the new code — check
`docker compose ... logs migrate`.

To go back to an older version, `git checkout <commit>` and run the same `up -d
--build`. That restores code only: Prisma has no down-migrations, so keep
migrations additive (add columns; drop them only in a later release).

## Automatic deploys (GitHub Actions)

`.github/workflows/deploy.yml` runs when the **CI** workflow succeeds on a push
to `main`, or when started by hand (Actions → Deploy → Run workflow). It:

1. SSHes to the server as the `deploy` user.
2. `git fetch` + `git reset --hard <sha>` in `/opt/pingexa` — the exact commit
   CI tested. `.env.production` is gitignored, so it is left alone.
3. `docker compose ... up -d --build --remove-orphans` — builds, runs
   migrations, restarts `api`, `worker` and `web`.
4. Polls `/api/ready` from inside the `api` container for up to 2 minutes.
   Ready → prunes dangling images and passes. Not ready → prints container
   status and logs and fails the run (there is no automatic rollback).

Only one deploy runs at a time.

### One-time setup

On the server:

```bash
sudo usermod -aG docker deploy          # run docker without sudo (re-login after)
sudo chown -R deploy:deploy /opt/pingexa
```

The `deploy` user must be able to `git fetch` the repository. For a private
repo, create a key as `deploy` (`ssh-keygen -t ed25519`) and add its public half
to GitHub → repo → Settings → Deploy keys (read-only), and clone with the SSH
URL.

For GitHub to log in, create a second key pair (on your machine), put the
public half in `/home/deploy/.ssh/authorized_keys`, and add these repository
secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | EC2 public IP or hostname |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | the private key, full text |
| `DEPLOY_KNOWN_HOSTS` | optional: output of `ssh-keyscan <host>` |

The job uses the `production` environment, so you can add required reviewers
under Settings → Environments if you ever want a manual approval step.

## Everyday operations

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.production"
$C logs -f api worker          # logs
$C restart worker              # restart one service
$C down                        # stop (data volumes are kept)
$C exec postgres psql -U pingexa pingexa
```

## Backups

There is no backup script. The `pingexa_pgdata` volume survives restarts and
`down`, but not `docker volume rm` or a lost disk. At minimum, take a dump
before risky changes, and copy it off the server:

```bash
$C exec -T postgres pg_dump -U pingexa -Fc pingexa > pingexa-$(date +%F).dump
```

Restore into a stopped app (`$C stop api worker`) with
`$C exec -T postgres pg_restore -U pingexa -d pingexa --clean --no-owner < file.dump`.
EBS snapshots of the instance volume are a simple alternative.
