# Pingexa — Development

Getting the stack running on your machine, and the commands that keep it
honest. Every command here has been executed against this repository.

If you want to *run* Pingexa rather than work on it, read
[`SELF_HOSTING.md`](SELF_HOSTING.md) instead.

---

## 1. Requirements

| | Version | Notes |
|---|---|---|
| Node.js | **≥ 22.12** | Developed and verified on v24.19.0. `engines` enforces the floor. |
| npm | 11+ | The repo uses npm workspaces and one root lockfile. |
| Docker + Compose v2 | any current | For Postgres, Redis and Mailpit. |
| PostgreSQL | 16+ | Only if you are not using the Docker stack. Verified on 17. |
| Redis | 7+ | Only if you are not using the Docker stack. Must run `maxmemory-policy noeviction`. |

You do **not** need a mail provider account. Local mail goes to Mailpit.

---

## 2. Clone and install

```bash
git clone https://github.com/Dharam-IN/Pingexa.git
cd Pingexa
npm install
```

`npm install` runs the root `postinstall`, which produces the two generated
artifacts that nothing in git carries:

* **the Prisma client**, from the committed schema, into
  `apps/api/src/generated/prisma`;
* **`packages/shared/dist`**, which is what `@pingexa/shared` actually resolves
  to — its `package.json` points `exports.types` at `dist/index.d.ts`.

Without the second one, every import of that package in `apps/api` and
`apps/web` fails to resolve. If you ever see a wall of `TS2307`, run
`npm run build -w @pingexa/shared` and try again. (A machine that has built
before hides this; a fresh clone and a CI runner do not.)

---

## 3. Configuration

```bash
cp .env.example .env
```

Then set a real session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# paste the output into SESSION_SECRET in .env
```

The shipped `.env.example` already matches `docker-compose.dev.yml`: Postgres on
`55433`, Redis on `56379`, and **SMTP pointed at Mailpit on `58025`**. Every
variable is documented inline in that file.

One thing worth knowing before you edit it: **define `PUBLIC_APP_URL` exactly
once.** dotenv keeps the *last* occurrence in a file, so a second definition
further down silently wins and every emailed link points somewhere unintended.
That happened during this project and cost an afternoon.

### Keeping development mail local

Pingexa sends real email — confirmation links, password resets, and "your site
is down" alerts. A development run must never be able to reach a real person's
mailbox.

`npm run dev:api` and `npm run dev:worker` therefore run a preflight first
(`scripts/dev-env-guard.mjs`). It reads exactly one key, `SMTP_HOST`, from the
environment file the process is about to load, and refuses to start if that host
is not a local mail catcher:

```
  ✖ Pingexa development mail guard

    .env points SMTP at "smtp.example-provider.com", which is not a local mail
    catcher.
    ...
```

It never reads or prints a password, an API key or a session secret, and it has
no effect on production: `npm run start:api`, `start:worker`, the Docker images
and every Compose stack bypass it entirely, and it exits immediately when
`NODE_ENV=production`.

You can ask it directly without starting anything:

```bash
npm run dev:check
```

**If you keep a provider's credentials in `.env`** — for instance after a
delivery test — do not delete them and do not disable the guard. Keep a second
file and point the run at it:

```bash
cp .env .env.mailpit
# in .env.mailpit:
#   SMTP_HOST=127.0.0.1
#   SMTP_PORT=58025
#   SMTP_REJECT_UNAUTHORIZED=false

PINGEXA_ENV_FILE=.env.mailpit npm run dev:api
PINGEXA_ENV_FILE=.env.mailpit npm run dev:worker
```

`PINGEXA_ENV_FILE` is read by `apps/api/src/config/env.ts` and by
`apps/api/prisma7.config.ts`, so migrations and the Prisma CLI follow it too.
Any `.env*` file is gitignored except the committed examples.

If you genuinely are testing delivery against a live provider, say so
explicitly — and set `MAIL_RECIPIENT_ALLOWLIST` to the single address you own
*first* ([`DECISIONS.md`](DECISIONS.md) D24):

```bash
PINGEXA_ALLOW_EXTERNAL_SMTP=1 npm run dev:worker
```

---

## 4. Backing services

```bash
npm run dev:up          # docker compose -f docker-compose.dev.yml up -d
```

That starts Postgres, Redis and Mailpit. **It is development-only** — it binds
every port to `127.0.0.1`, uses throwaway credentials, and runs a fake SMTP
server that captures mail instead of delivering it. It is not a deployment
artifact and is never used on a server.

Ports are deliberately off the defaults so this stack cannot collide with
another local Postgres, Redis or SMTP server:

| Service | Host port | Container port |
|---|---|---|
| Postgres | 55433 | 5432 |
| Redis | 56379 | 6379 |
| Mailpit SMTP | 58025 | 1025 |
| **Mailpit UI + REST API** | **58125** | 8025 |
| API | 4000 | — |
| Web dev server | 5173 | — |

---

## 5. Schema and demo data

```bash
npm run migrate:deploy      # apply the committed migrations
npm run seed                # optional; every name is prefixed [DEMO]
```

`npm run seed` creates the account in `SEED_USER_EMAIL` / `SEED_USER_PASSWORD`
(`demo@pingexa.local` / `demo-password-123` by default) with three monitors and
enough history that the dashboard is worth looking at. It refuses to run when
`NODE_ENV=production`.

Use `npm run migrate:dev` only when you have edited `prisma/schema.prisma` and
need a new migration. **Never edit an already-applied migration**, and keep
migrations additive and forward-compatible — Prisma has no down-migrations.

---

## 6. Run it

Three processes, three terminals:

```bash
npm run dev:api         # http://127.0.0.1:4000
npm run dev:worker      # scheduler + queue consumers, a separate process on purpose
npm run dev:web         # http://localhost:5173
```

Open <http://localhost:5173>, create an account, then read the confirmation
email in **Mailpit** at <http://127.0.0.1:58125>. **Nothing is monitored until
the address is confirmed.**

The Vite dev server proxies `/api` to the API, so the browser sees a single
origin locally — the same shape the production reverse proxy produces.

The API and the worker are independent: restarting one does not require
restarting the other, and neither needs the other to start.

---

## 7. Commands

| Command | What it does |
|---|---|
| `npm install` | Installs everything, generates the Prisma client, builds `@pingexa/shared`. |
| `npm run dev:check` | Runs the development mail guard on its own. |
| `npm run dev:api` / `dev:worker` / `dev:web` | Development, with reload. |
| `npm run dev:up` / `dev:down` / `dev:logs` | The dev Compose stack. `down` **stops containers and keeps volumes**. |
| `npm run migrate:deploy` | Applies committed migrations. Use this in every environment. |
| `npm run migrate:dev` | Creates a new migration after editing the schema. Development only. |
| `npm run seed` | Demo data, `[DEMO]`-prefixed. |
| `npm run -w @pingexa/api retention` | Forces one retention cleanup pass. |
| `npm run lint` / `lint:fix` | ESLint across the whole repo. |
| `npm run typecheck` | Rebuilds `@pingexa/shared`, then `tsc --noEmit` for api and web. |
| `npm run test:unit` | Pure logic. No Postgres, no Redis, no network. |
| `npm run test:integration` | Real Postgres + Redis against a disposable `pingexa_test` database. |
| `npm run test:e2e` | Playwright against the whole running stack, including Mailpit. |
| `npm run build` | Builds shared, api (`apps/api/dist`) and web (`apps/web/dist`). |
| `npm run start:api` / `start:worker` | Runs the built output. |
| `./scripts/verify-fresh-setup.sh` | Fresh-setup verification on a disposable database (§9). |

---

## 8. Tests

```bash
npm run dev:up          # Postgres, Redis, Mailpit

npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

That is exactly what CI runs (`.github/workflows/ci.yml`), so a green run here
is a green run there.

**`npm run test:integration` creates its own database** (`pingexa_test`) inside
the same Postgres instance, applies the committed migrations to it, and
truncates between test cases. **Your development database is never dropped or
truncated.** The suite needs outbound **DNS** resolution — it validates the real
SSRF guard against a public hostname — but makes no outbound HTTP requests.

### End to end

Not in CI: it needs the whole stack including Mailpit and runs serially across
two viewports, which trades a lot of wall-clock for little extra signal over the
integration suite. Run it locally when you touch the SPA.

```bash
npx playwright install chromium      # once

npm run dev:api & npm run dev:worker & npm run dev:web &
npm run test:e2e
```

Two things that will otherwise waste your time:

1. **A full run creates roughly twenty accounts per browser project from one
   address**, which legitimately exceeds the shipped `TOKEN_RATE_LIMIT_MAX=60`.
   Raise it to about `400` in your local `.env` before running the suite, and
   leave the shipped default alone.
2. **The end-to-end suite does make real requests to a public site.** If you are
   offline, expect monitoring assertions to fail.

### Anything CSS-dependent: use the production build

Tailwind's dev-server output was repeatedly observed lagging file edits during
this project, which made correct rules look broken. Verify CSS against the real
artifact:

```bash
npm run build -w @pingexa/web
VITE_PREVIEW_PORT=5173 npm run preview -w @pingexa/web
npm run test:e2e
```

**The preview port must be 5173.** `TRUSTED_ORIGINS` lists that origin, and the
API correctly refuses cookie-bearing writes from anywhere else.

One more trap, recorded because it cost real time:
`getComputedStyle(el).outlineColor` reports `currentColor` whatever is set, so
it **cannot** be used to verify a focus ring. Sample the painted pixels
instead.

---

## 9. Fresh-setup verification

```bash
./scripts/verify-fresh-setup.sh
```

Proves a brand-new environment can be built from what is committed. It:

1. creates a timestamped `pingexa_fresh_*` database;
2. applies **only** the committed migrations to it;
3. asserts there is no drift between `schema.prisma` and the result;
4. asserts the four hand-written constraints exist;
5. builds the project and boots the built API against that database;
6. signs a user up through the real HTTP endpoints;
7. runs the integration suite.

It drops only the database it created and never touches `pingexa_dev`,
`pingexa_test`, any Docker volume, or any container it did not start. It needs
port 4100 free and refuses to run otherwise.

---

## 10. Where things are

```
apps/api/           Express API and the worker. Two entrypoints, one codebase.
  src/config/       Environment parsing and cross-field production safety rules.
  src/domain/       auth · sessions · authTokens · monitors · uptime · activity
                    · statusPage · serializers
  src/monitoring/   urlGuard · ipRanges · httpCheck · scheduler · resultProcessor
                    · retention
  src/http/         app.ts, middleware/, routes/ (auth · monitors · statusPage
                    · overview · health)
  src/worker/       checkJob.ts, emailJob.ts, and the alert outbox pass
  src/server.ts     API process entrypoint
  src/worker.ts     Worker process entrypoint
  prisma/           schema.prisma + committed migrations
  tests/unit/       Pure logic
  tests/integration/ Real Postgres + Redis
apps/web/
  src/lib/          API client, formatters, the polling hook, the clock hook
  src/state/        Auth, theme and toast contexts
  src/components/   UI kit (ui.tsx), chart, check strip, app shell
  src/pages/        One file per route
  e2e/              Playwright
packages/shared/    Types, zod schemas and product constants used by both sides
deploy/             Dockerfiles, proxy config, maintainer deploy scripts
deploy/selfhost/    The community self-hosting stack
scripts/            dev-env-guard.mjs, verify-fresh-setup.sh
```

[`ARCHITECTURE.md`](ARCHITECTURE.md) explains how those fit together and why.

---

## 11. Rules to know before your first change

The full list, with the reasoning, is in [`CLAUDE.md`](../CLAUDE.md) and
[`CONTRIBUTING.md`](../CONTRIBUTING.md). The ones that bite first:

* **The SSRF guard has no off switch.** Never add an environment variable,
  config key or conditional that relaxes URL validation, address policy,
  redirect handling or TLS verification. An ESLint rule fails the build if the
  guard is wired to `env`.
* **Correctness lives in database constraints.** If you are writing `count()`
  then `insert`, stop.
* **Never count a missing check as uptime or as downtime.** `uptimePercent` is
  `null`, not `0` or `100`. A gap in a chart is a third colour, never green and
  never a zero.
* **Never log or store a response body, a token, a password or a session
  value.** The logger redacts by key name; renaming a field to get around it is
  a bug.
* **Say "accepted", not "delivered".** Alert delivery is at-least-once.
* **Build from the UI kit** in `apps/web/src/components/ui.tsx`, and use
  semantic colour tokens. A token added to `:root` must also be added to
  `:root[data-theme='dark']` — a test enforces this both ways.
* **One element per datum.** No hidden desktop-table-plus-mobile-list
  duplicates; every query would find the invisible copy first.

---

## 12. Shutting down without losing your data

```bash
npm run dev:down        # stops the containers, KEEPS the volumes
```

Your database and Redis data survive. To start again, `npm run dev:up`.

Only if you actually want to throw the data away:

```bash
docker compose -f docker-compose.dev.yml down -v   # DELETES pingexa_dev_pgdata
```

---

## 13. Troubleshooting

| Symptom | Cause |
|---|---|
| Wall of `TS2307: Cannot find module '@pingexa/shared'` | `packages/shared/dist` is missing. `npm install`, or `npm run build -w @pingexa/shared`. |
| `dev:api` exits with the mail guard message | `.env` points SMTP at a real provider. See §3. |
| Monitors never leave **Pending** | The account email is not confirmed, or the worker is not running. Check Mailpit. |
| A site that loads fine reports **Down** with `REDIRECT` | Redirects are not followed by design. Monitor the final URL ([D7](DECISIONS.md)). |
| Uptime shows `—` | Nothing recorded in that window yet. `null` is the honest answer. |
| `429` during `npm run test:e2e` | Raise `TOKEN_RATE_LIMIT_MAX` locally (§8). |
| A CSS change does not appear | Tailwind dev output lagging. Verify against `npm run build -w @pingexa/web` + preview. |
| The API refuses to start with a config error | `NODE_ENV=production` turns on cross-field refusals. See [`HANDOVER.md`](HANDOVER.md) §5. |
| Port 4100 busy when running `verify-fresh-setup.sh` | It needs that port and refuses to run otherwise. |
