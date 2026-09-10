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
  src/state/        Auth and toast contexts.
  src/components/   UI kit, chart, cards, app shell.
  src/pages/        One file per route.
  e2e/              Playwright, against the whole running stack including Mailpit.
packages/shared/    Types, zod schemas and product constants used by both sides.
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

**Alerts go only to a verified account email**, and only one DOWN plus one
RECOVERY per incident.

**The interval is 5 minutes.** `MONITOR_INTERVAL_SECONDS` exists so tests can
run an accelerated schedule; the config loader refuses any other value when
`NODE_ENV=production`.

## Boundaries

Out of scope for this codebase: billing, plans, organisations or teams, custom
status-page domains, SMS, AI features, mobile apps, multi-region checks, and
monitoring protocols other than HTTP/HTTPS.

**Production deployment is explicitly out of scope and belongs to the owner.**
Do not add production Dockerfiles, production Compose files, cloud
infrastructure, CI/CD pipelines, or deployment scripts. `docker-compose.dev.yml`
is development-only and is labelled as such in the file itself.
Do not deploy, provision, change DNS, or publish anything.
