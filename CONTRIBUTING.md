# Contributing to Pingexa

Thanks for wanting to help. Pingexa is a small, deliberately narrow uptime
monitor, and it holds itself to a few rules that are stricter than usual. This
page explains those rules up front so your first pull request does not run into
them by surprise.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
Contributions are accepted under the [MIT License](LICENSE); there is no CLA
and no DCO sign-off requirement.

---

## Before you write code

### 1. Check the scope

Pingexa V1 has a fixed scope, recorded in
[`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md). These are **out of scope** and
a pull request implementing one will be declined however good the code is:

billing · plans · organisations or teams · custom status-page domains · SMS ·
AI features · mobile apps · multi-region checks · monitoring protocols other
than HTTP/HTTPS.

Everything else is fair game. The [Roadmap](README.md#roadmap) lists the ideas
that fit the product. If you want to build something from it, open an issue
first and say so — it avoids two people building the same thing.

### 2. Open an issue first for anything non-trivial

* **Bug fix with a clear reproduction:** open a PR directly, and link the bug
  report if there is one.
* **New behaviour, new endpoint, new dependency, schema change, or anything
  touching security:** open an issue first. A design disagreement is much
  cheaper before the code exists.

### 3. Read the two files that explain *why*

* [`CLAUDE.md`](CLAUDE.md) — the layout, the commands, and the rules the
  codebase holds itself to.
* [`docs/DECISIONS.md`](docs/DECISIONS.md) — why the non-obvious things are the
  way they are. If you are about to "simplify" something, the reason it is not
  already simple is probably in there.

---

## Getting set up

Full instructions, with verified commands, are in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). The short version:

```bash
git clone https://github.com/Dharam-IN/Pingexa.git && cd Pingexa
npm install
cp .env.example .env          # points at Mailpit; set a real SESSION_SECRET
npm run dev:up                # Postgres, Redis and Mailpit in Docker
npm run migrate:deploy
npm run seed                  # optional demo data, every name prefixed [DEMO]

npm run dev:api               # http://127.0.0.1:4000
npm run dev:worker            # separate process on purpose
npm run dev:web               # http://localhost:5173
```

Mail is captured by **Mailpit** at <http://127.0.0.1:58125>. Nothing is
monitored until you confirm your address, and the confirmation email is in
Mailpit.

`npm run dev:api` and `npm run dev:worker` run a preflight check that refuses to
start if the environment file they are about to load points SMTP at anything
other than a local mail catcher. That is deliberate: a development run must
never be able to send real email to a real person. See
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#keeping-development-mail-local).

---

## The rules this codebase holds itself to

These are not style preferences. Each one exists because breaking it caused a
real bug, and most of them are enforced by a test, a lint rule or a database
constraint.

### The SSRF guard has no off switch

`createUrlGuard()` takes an explicit policy object, and the production factory
always passes the strict one. Tests that need to reach a loopback fixture build
their own guard.

**Never add an environment variable, config key, or conditional that relaxes URL
validation, address policy, redirect handling, or TLS verification.** There is
an ESLint rule (`no-restricted-syntax` in `eslint.config.mjs`) that fails the
build if the guard is ever wired to `env`.

### Correctness lives in database constraints

If you find yourself writing `count()` and then `insert`, stop.

| Rule | Enforced by |
|---|---|
| 3 monitors per account | unique `(userId, slot)` + `CHECK (slot BETWEEN 0 AND 2)` |
| Idempotent check processing | unique `(monitorId, scheduledFor)` |
| One DOWN and one RECOVERY alert per incident | unique `(incidentId, kind)` |
| One open incident per monitor | partial unique index where `resolvedAt IS NULL` |

### A failure streak counts distinct scheduled slots, never delivery attempts

Queue retries and redeliveries must never be able to push a monitor to DOWN.

### Never count a missing check as uptime or as downtime

Report coverage instead. `uptimePercent` is `null` — not `0`, not `100` — when
nothing was recorded. This applies to pictures too: a time bucket with no check
is drawn in a third colour, never green and never as a zero response time. See
[`docs/DECISIONS.md`](docs/DECISIONS.md) D12 and D28.

### Never log or store a response body, a token, a password, or a session value

The logger redacts by key name. Do not defeat it by renaming a field.

### Say "accepted", not "delivered"

A `250` from an SMTP provider and `Notification.status = SENT` both mean the
provider *accepted* the message. There is no bounce webhook and no delivery
telemetry. Do not write "delivered" in a log line, a document, or a status
string where "accepted" is what actually happened
([D25](docs/DECISIONS.md)). Alert delivery is **at-least-once**, never
exactly-once ([D17](docs/DECISIONS.md)).

### Migrations are forward-only and additive

Prisma has no down-migrations. Never edit an already-applied migration. Remove
a column in the change *after* the one that stopped using it.

### The interval is 5 minutes

`MONITOR_INTERVAL_SECONDS` exists so tests can run an accelerated schedule. The
config loader refuses any other value when `NODE_ENV=production`.

---

## Front-end conventions

* **Build from the kit in `apps/web/src/components/ui.tsx`**, not from raw
  markup. If a page needs a variant, add it to the kit rather than hand-rolling
  one.
* **One element per datum.** Do not render a desktop table *and* a mobile list;
  whichever is hidden stays in the DOM and every query finds the invisible copy
  first. Reflow one grid instead — `MonitorsPage` is the worked example.
* **Colours come from semantic tokens**, never from literals. A token added to
  `:root` **must** also be added to `:root[data-theme='dark']`;
  `apps/web/src/__tests__/designTokens.test.ts` enforces this both ways.
* **Do not add a `prefers-color-scheme` media query.** Theming is
  attribute-driven and `system` is resolved before CSS sees it
  ([D21](docs/DECISIONS.md)).
* **Focus indicators are not optional.** The app-wide
  `:focus-visible { outline: 2px solid var(--focus-ring) }` rule is the single
  mechanism. Never put `outline-none` on a real control so a wrapper can show
  focus instead ([D22](docs/DECISIONS.md)).
* **Verify CSS against the production build, not the dev server.** Tailwind's
  dev output was repeatedly observed lagging edits:

  ```bash
  npm run build -w @pingexa/web
  VITE_PREVIEW_PORT=5173 npm run preview -w @pingexa/web
  ```

  Port 5173 specifically — it is the origin `TRUSTED_ORIGINS` lists.

---

## Before you open a pull request

Run what CI runs:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration     # needs Postgres and Redis up
npm run build
```

End-to-end is not in CI, because it needs the whole stack including Mailpit and
runs serially across two viewports. Run it locally if you touched the SPA:

```bash
npx playwright install chromium   # once
npm run test:e2e
```

A full `npm run test:e2e` run creates roughly twenty accounts per browser
project from one address, which legitimately exceeds the shipped
`TOKEN_RATE_LIMIT_MAX=60`. Raise it to about `400` in your local `.env` before
running the suite and leave the shipped default alone.

### What a good change includes

* **A test that fails without the fix.** Unit tests for pure logic, integration
  tests for anything touching Postgres or Redis, end-to-end for user-visible
  flows.
* **A documentation update** when behaviour, configuration or the HTTP contract
  changes — `docs/API.md` is the contract, and `packages/shared` is what keeps
  it from drifting.
* **A `docs/DECISIONS.md` entry** when you make a non-obvious choice, especially
  one you rejected an obvious alternative for.
* **Screenshots** for any visual change, in both light and dark themes.

### Commit messages

Conventional-commit style, matching the existing history:

```
feat(web): rebuild the signed-in app as overview, monitors and detail
fix(worker): enforce the alert retry budget from the row, not the queue job
docs: record the product-experience upgrade
test(e2e): cover the redesigned flows at both viewports
```

Scopes in use: `api`, `web`, `worker`, `shared`, `deploy`, `mail`, `e2e`.
Write the body to explain *why*, not *what* — the diff already says what.

**Do not add AI or tool attribution trailers** (`Co-Authored-By: <assistant>`,
"Generated with …", emoji footers) to commit messages or pull request
descriptions.

### Pull requests

Fill in [the template](.github/PULL_REQUEST_TEMPLATE.md). It asks for why, what,
how you verified it, and the security, database and documentation impact —
answering those honestly is most of the review.

Keep a pull request to one concern. A refactor bundled with a behaviour change
is much harder to review and much harder to revert.

---

## Things that will get a change sent back

* A configuration knob that can weaken the SSRF guard, TLS verification or
  redirect handling.
* Replacing a database constraint with an application-level check.
* A missing check counted as `0%` or `100%` uptime, or drawn as a green bar.
* Logging or persisting a response body, a token, a password or a session value.
* The word "delivered" where "accepted" is the truth.
* A secret, a real `.env`, a production dump, a cookie jar or another person's
  data in the diff — see the checklist in the PR template.
* A hidden duplicate of a datum in the DOM for responsive layout.
* A new colour literal where a semantic token exists.

---

## Where things live

```
apps/api/           Express API and the worker. Two entrypoints, one codebase.
  src/config/       Environment parsing and production safety rules.
  src/domain/       Auth, sessions, tokens, monitors, uptime, status pages.
  src/monitoring/   SSRF guard, check executor, scheduler, incident state machine.
  src/http/         Express app, middleware, routes.
  src/worker/       Queue job handlers and the alert outbox pass.
  prisma/           Schema + committed migrations. Never edit an applied one.
  tests/unit/       Pure logic. No Postgres, no Redis, no network.
  tests/integration/ Real Postgres + Redis against a disposable database.
apps/web/           React + Vite SPA.
  src/components/   UI kit (ui.tsx), chart, check strip, app shell.
  src/pages/        One file per route.
  e2e/              Playwright, against the whole running stack.
packages/shared/    Types, zod schemas and constants used by both sides.
deploy/             Dockerfiles, proxy config, and the maintainer deploy scripts.
docs/               Architecture, development, self-hosting, API, decisions.
```

A fuller map, and the reasoning behind it, is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Questions

Open a [question issue](https://github.com/Dharam-IN/Pingexa/issues/new/choose)
or see [SUPPORT.md](SUPPORT.md). For anything security-sensitive, follow
[SECURITY.md](SECURITY.md) instead — do not open a public issue.
