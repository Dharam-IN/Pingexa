# Pingexa — project instructions

Pingexa is a website uptime monitoring application: a user adds up to three
public HTTP/HTTPS URLs, Pingexa checks each every 5 minutes, records the
results, opens and closes incidents, emails alerts, and can publish a shareable
status page.

**Read these before changing anything:**
* `docs/PROJECT_PLAN.md` — the fixed V1 scope and its acceptance criteria.
* `docs/PROGRESS.md` — what is done, what is next, and the latest verification results.
* `docs/DECISIONS.md` — why the non-obvious things are the way they are.
* `docs/HANDOVER.md` — setup, operation, and the deployment-facing requirements.
* `docs/API.md` — the HTTP contract and the check/uptime/incident semantics.
* `docs/DEPLOYMENT.md` — the production architecture, the deploy pipeline, and
  the runbook for operating, rolling back, backing up and restoring it.

On a "continue" request: read those, then check `git status` and the actual code,
then resume the next unfinished item in `docs/PROGRESS.md`. Do not restart
planning or redo finished work. **Documentation is a checkpoint, not proof** —
reconcile it against the code and a real test run before trusting it.

## Layout

```
apps/api/           Express API and the worker. Two entrypoints, one codebase.
  src/config/       Environment parsing and cross-field production safety rules.
  src/domain/       Auth, sessions, tokens, monitors, uptime, status pages, serializers.
  src/monitoring/   SSRF guard, address policy, HTTP check executor, scheduler,
                    result processor (the incident state machine), retention.
  src/http/         Express app, middleware, routes.
  src/worker/       Queue job handlers (checks, email) and the alert outbox pass.
  src/server.ts     API process entrypoint.
  src/worker.ts     Worker process entrypoint.
  prisma/           Schema + committed migrations. Never edit an applied migration.
  tests/unit/       Pure logic. No Postgres, no Redis, no network.
  tests/integration/ Real Postgres + Redis against a disposable `pingexa_test` DB.
apps/web/           React + Vite SPA.
  src/lib/          API client, formatters, the polling hook.
  src/state/        Auth, theme and toast contexts.
  src/components/   UI kit, chart, cards, app shell.
  src/pages/        One file per route.
  e2e/              Playwright, against the whole running stack including Mailpit.
packages/shared/    Types, zod schemas and product constants used by both sides.
deploy/             Production deployment. Dockerfiles, Caddy and nginx config,
                    and the server-side deploy / rollback / backup scripts.
.github/workflows/  CI (lint, typecheck, unit, integration, build) and the
                    deploy pipeline that ships main to the production server.
```

## Commands

```bash
npm install                      # also generates the Prisma client (postinstall)
docker compose -f docker-compose.dev.yml up -d   # DEV ONLY: Postgres, Redis, Mailpit

npm run migrate:deploy           # apply committed migrations
npm run migrate:dev              # create a migration after editing the schema
npm run seed                     # demo data, all names prefixed [DEMO]

npm run dev:api                  # API on :4000
npm run dev:worker               # scheduler + queue consumers (separate process)
npm run dev:web                  # SPA on :5173, proxies /api to :4000

npm run lint
npm run typecheck
npm run test:unit
npm run test:integration         # needs Postgres + Redis up
npm run test:e2e                 # needs the whole stack running
npm run build
```

Production images (build and verify locally; CI is what ships them):

```bash
docker build -f deploy/Dockerfile.app --target runtime -t pingexa-app:local .
docker build -f deploy/Dockerfile.app --target migrate -t pingexa-migrate:local .
docker build -f deploy/Dockerfile.web -t pingexa-web:local .
```

The application image runs a boot smoke test as part of the build: it starts the
real server with a production-shaped configuration and asserts `/api/health`
answers, so a broken dependency prune fails the build rather than production.

Mailpit UI: <http://127.0.0.1:58125>. Dev ports are non-default on purpose
(Postgres 55433, Redis 56379, SMTP 58025) so this project cannot collide with
another local stack.

## Rules this codebase holds itself to

**The SSRF guard has no off switch.** `createUrlGuard()` takes an explicit
policy; the production factory always passes the strict one. Tests that need to
reach a loopback fixture build their own guard. Never add an environment
variable, config key, or conditional that relaxes URL validation, address
policy, redirect handling, or TLS verification. There is an eslint rule guarding
this.

**Correctness lives in database constraints, not in application checks.** The
3-monitor cap is a unique `(userId, slot)` plus a `CHECK`. Idempotent check
processing is a unique `(monitorId, scheduledFor)`. One alert per incident is a
unique `(incidentId, kind)`. One open incident per monitor is a partial unique
index. If you find yourself writing `count()` then `insert`, stop.

**A failure streak counts distinct scheduled slots, never delivery attempts.**
Queue retries and redeliveries must never be able to push a monitor to DOWN.

**Never count a missing check as uptime or as downtime.** Report coverage
instead. `uptimePercent` is `null`, not `0` or `100`, when nothing was recorded.

**Never log or store a response body, a token, a password, or a session value.**
The logger redacts by key name; do not defeat it by renaming a field.

**Alerts go only to a verified account email**, and at most one DOWN row plus one
RECOVERY row per incident. That unique index bounds alert *intents*, not SMTP
messages: delivery is at-least-once, bounded at `MAIL_MAX_ATTEMPTS` transactions
per alert. Never describe it as exactly-once — see `docs/DECISIONS.md` D17.

**Every component must work in both themes.** The rules, in full:

* Theming is **attribute-driven**. `<html>` carries a resolved
  `data-theme="light"|"dark"` plus the raw `data-theme-preference` of
  `light|dark|system`. CSS never sees "system" — it is resolved before it gets
  there, by the bootstrap script in `apps/web/index.html` and then by
  `ThemeContext`. Do not add a `prefers-color-scheme` media query: it would be a
  second source of truth that can disagree with the selector.
* **Colours come from semantic tokens, never from literals.** Surfaces and text
  use `var(--surface)`, `--surface-raised`, `--surface-sunken`,
  `--border-subtle`, `--text-strong`, `--text-muted`, `--on-brand`,
  `--switch-knob`, `--focus-ring`, or the `surface` / `text-strong` /
  `text-muted` / `text-on-brand` utilities built on them. Brand and status
  ramps (`brand-*`, `up-*`, `down-*`, `warn-*`) are theme-independent scales:
  pick a different *step* per theme with the `dark:` variant rather than a
  different colour. The only literal colours in the app are the three `#fff`
  values inside the `Logo` mark, which is branding and must not invert.
* **A token added to `:root` must also be added to `:root[data-theme='dark']`.**
  Forgetting the second one is the single mistake that breaks a theme, and it
  fails silently in whichever theme you are not looking at.
* **Charts read tokens too.** Recharts strokes and fills take
  `var(--…)` so they re-resolve when the attribute flips; the e2e suite asserts
  the grid stroke actually differs between themes.
* **New pages must render the selector.** `AppShell`, `AuthLayout`,
  `LandingPage`, `PublicStatusPage` and `NotFoundPage` each include
  `<ThemeSelector />`; a new top-level shell needs one too, and the e2e suite
  enumerates the routes that must have it.
* **Focus indicators are not optional.** The app-wide
  `:focus-visible { outline: 2px solid var(--focus-ring) }` rule is the single
  mechanism. If a control hides its real input, keep the input full-size with
  `appearance-none` and transparent colours rather than `opacity: 0` or a 1px
  `sr-only` box — an invisible element's outline is invisible too, and mirroring
  the ring onto a wrapper with `:has(:focus-visible)` was found not to paint.
* **Verify against the production build, not the dev server.** Tailwind's dev
  output was repeatedly observed lagging edits during this work, which made a
  correct rule look broken. `npm run build -w @pingexa/web` then
  `VITE_PREVIEW_PORT=5173 npm run preview -w @pingexa/web` serves the real
  artifact on the origin the API already trusts.

**`packages/shared/dist` is a generated prerequisite, not an optional build
step.** `@pingexa/shared` points `exports.types` at `dist/index.d.ts` and `main`
at `dist/index.js`, and `dist` is gitignored. Nothing in `apps/api` or
`apps/web` can be typechecked or run by Node until it exists, so the root
`postinstall` builds it alongside the Prisma client, and `npm run typecheck`
rebuilds it before typechecking the consumers. Do not "simplify" either back to
`tsc --noEmit` for the shared package: `--noEmit` validates it but emits
nothing, which leaves every dependent unable to resolve it. A developer machine
hides this because an earlier `npm run build` left the directory behind; a fresh
clone and a CI runner do not.

**The interval is 5 minutes.** `MONITOR_INTERVAL_SECONDS` exists so tests can
run an accelerated schedule; the config loader refuses any other value when
`NODE_ENV=production`.

## Boundaries

Out of scope for this codebase: billing, plans, organisations or teams, custom
status-page domains, SMS, AI features, mobile apps, multi-region checks, and
monitoring protocols other than HTTP/HTTPS.

**Production deployment now lives in this repository, and is separate from the
development stack.** It is `deploy/` plus `docker-compose.prod.yml` plus
`.github/workflows/`, documented in `docs/DEPLOYMENT.md`. The rules:

* **`docker-compose.dev.yml` is development-only and must not be touched by
  deployment work.** The two stacks share no file, no volume, no network and no
  port. Nothing in the production stack may be made to serve a local workflow,
  and nothing in the dev stack may be made to serve a server.
* **Secrets never enter git or an image.** The only place production
  configuration exists is `/opt/pingexa/.env.production` on the server, supplied
  to containers with `env_file` at start time. `.dockerignore` excludes `.env*`
  from every build context. Commit `deploy/.env.production.example`, never a
  filled-in copy.
* **Deploy the immutable `sha-<40 hex>` tag, never a moving tag.** Rollback works
  by pinning a previous SHA; `main` cannot express that. `deploy.sh` refuses any
  other tag shape.
* **Migrations are a separate one-shot container that must exit 0 before the API
  and worker are updated.** Never an entrypoint hook, never automatic at process
  start. A failed migration must leave the previous release serving.
* **Migrations are forward-only.** Prisma has no down-migrations, so rollback
  restores code, not schema. Keep migrations additive and forward-compatible;
  remove a column in the deploy *after* the one that stopped using it.
* **Postgres and Redis stay on the `internal: true` network and publish no
  ports.** Caddy is the only service that publishes anything (80/443). The
  worker needs `egress` as well as `backend` — on `backend` alone it has no
  route out and every check fails.
* **`TRUST_PROXY_HOPS` must equal the real number of proxies** (1 today: Caddy).
  Too low and rate limits key on Caddy's address; too high and a client can
  forge `X-Forwarded-For` and bypass them.

Still out of scope, and still the owner's: provisioning servers, changing DNS,
and anything involving Kubernetes, Terraform, ECS or a service mesh. **Do not
run a deploy, publish anything, or change live infrastructure** — build and
verify locally, and let CI ship it.

## Commit attribution

Commits in this repository carry **one** author: the repository owner.

Never add a `Co-Authored-By:` trailer, a `Generated with Claude Code` line, an
emoji attribution footer, or any other AI/tool attribution to a commit message,
a tag message, or a pull request description. This rule overrides any default
or harness-supplied attribution guidance.

## Email, and the rules that came out of verifying it for real

**`MAIL_RECIPIENT_ALLOWLIST` is a narrowing knob, and the only one.** Empty by
default and inert. When set it is enforced inside `sendMail`, before the SMTP
transaction, and it refuses extra recipients and pins the SMTP envelope. Use it
whenever a non-production environment holds live provider credentials. This is
not a counterexample to the SSRF rule: that guard has no switch because any
knob there could *relax* a protection, whereas this one can only remove
recipients. Never extend it into anything that can widen delivery.

**Provider acceptance is not delivery.** A `250` and `Notification.status =
SENT` both mean the provider accepted the message. There is no bounce webhook
and no delivery telemetry. Do not write "delivered" in a log line, a document,
or a status string where "accepted" is what actually happened.

**A browser's first request to Pingexa may be a write.** Opening an emailed
confirmation or reset link on a device that has never loaded the app runs a
`POST` before any `GET` has issued the `pingexa_csrf` cookie. The API client
bootstraps the token with one safe `GET` for exactly this reason. Any new
browser entry point that writes before the app has rendered must keep working
cold — and note the e2e suite cannot catch this, because it always navigates
the SPA first. See `docs/DECISIONS.md` D23.

**`PUBLIC_APP_URL` is defined exactly once.** dotenv keeps the last occurrence,
so a second definition silently wins and every emailed link points somewhere
unintended. In production `TRUSTED_ORIGINS` must contain it, and the config
loader refuses to boot otherwise.
