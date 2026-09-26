# Deployment

Pingexa's production deployment is deliberately basic: one EC2 server running
Docker Compose, and a **shared Caddy container** (one Caddy for every site on
the server) in front. `.github/workflows/deploy.yml` builds the images on the
GitHub runner, streams them to the server, and (re)starts the stack whenever CI
passes on `main` — including the very first time. The server holds only
`docker-compose.prod.yml` and `.env.production`; it needs no git, no source
tree, no registry and no GitHub access.

**Never build the images on the server.** On a small instance the three
parallel `npm ci` runs exhaust RAM and disk and make the machine unreachable,
SSH included. That happened once; it is why the build moved to the runner. There is no image registry, no rollback script and no backup
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
* ~5 GB free disk for the images (about 1.9 GB) plus Postgres data; a 20 GB
  volume is comfortable. 1 GB RAM runs the stack, but add 2 GB of swap.

## First deploy

### 1. Server setup (once)

As a sudo user:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo mkdir -p /opt/pingexa && sudo chown deploy:deploy /opt/pingexa
```

As `deploy`: put the CD public key in `~/.ssh/authorized_keys`
(`chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`), and create
`/opt/pingexa/.env.production` from `deploy/.env.production.example`
(`chmod 600`), filling in every CHANGE ME.

Generate secrets with `openssl rand -hex 32` (Postgres and Redis passwords; hex
because `/`, `+` and `=` break the URLs — use the same value inside
`DATABASE_URL` / `REDIS_URL`) and `openssl rand -hex 48` for `SESSION_SECRET`.
Set `PUBLIC_APP_URL` and `TRUSTED_ORIGINS` to `https://<your-domain>`; the API
refuses to boot if `TRUSTED_ORIGINS` does not contain `PUBLIC_APP_URL`.

### 2. GitHub secrets, then push

Add the repository secrets listed under *Automatic deploys* below, then push to
`main` (or run Actions → Deploy → Run workflow). The workflow copies the code
into `/opt/pingexa`, creates the `caddy` network if missing, and starts the
stack.

To run it by hand, build and ship from your machine (not on the server):

```bash
docker build -f deploy/Dockerfile.app --target runtime -t pingexa-app:local .
docker build -f deploy/Dockerfile.app --target migrate -t pingexa-migrate:local .
docker build -f deploy/Dockerfile.web -t pingexa-web:local .
docker save pingexa-app:local pingexa-migrate:local pingexa-web:local \
  | gzip -1 | ssh deploy@<host> 'gunzip | docker load'
scp docker-compose.prod.yml deploy@<host>:/opt/pingexa/
# then, on the server, in /opt/pingexa:
docker network create caddy   # once
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-build
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

Push to `main`. Once CI passes, the Deploy workflow ships that commit.
Migrations run automatically before the API and worker restart; if one fails,
`api` and `worker` are not started on the new code — check
`docker compose ... logs migrate`.

To go back to an older version, revert the commit and push (or run the Deploy
workflow by hand on an older commit). That restores code only: Prisma has no
down-migrations, so keep migrations additive (add columns; drop them only in a
later release).

## Automatic deploys (GitHub Actions)

`.github/workflows/deploy.yml` runs when the **CI** workflow succeeds on a push
to `main`, or when started by hand (Actions → Deploy → Run workflow). It:

1. Checks out the exact commit CI tested.
2. Builds `pingexa-app`, `pingexa-migrate` and `pingexa-web` **on the runner**.
3. Streams them to the server: `docker save | gzip | ssh … docker load`
   (~300 MB), and copies `docker-compose.prod.yml` to `/opt/pingexa`.
   `.env.production` is never touched.
4. Creates the `caddy` network if it does not exist.
5. `docker compose ... up -d --no-build --remove-orphans` — runs migrations,
   then restarts `api`, `worker` and `web` on the new images.
6. Polls `/api/ready` from inside the `api` container for up to 2 minutes.
   Ready → prunes dangling images and passes. Not ready → prints container
   status and logs and fails the run (there is no automatic rollback).

Only one deploy runs at a time.

### One-time setup

The server side is *First deploy → 1* above. For GitHub to log in, create a key
pair (on your machine: `ssh-keygen -t ed25519 -f pingexa_deploy`), put the
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
