# Pingexa — Progress

_Updated: 2026-09-10_

## Where things stand

| Milestone | Status |
|-----------|--------|
| 1. Foundation, DB, config, auth | **Complete and verified** |
| 2. Scheduler, worker, checks, incidents | In progress — code complete, integration tests being written |
| 3. Dashboard, charts, monitor management, status page | Not started |
| 4. Email, reliability, security, integration coverage | Partly done (email flow works end to end via Mailpit) |
| 5. Fresh-setup verification, docs, shutdown | Not started |

## Completed

* npm workspaces monorepo: `apps/api`, `apps/web` (scaffold pending), `packages/shared`.
  One root `package-lock.json`; pinned exact versions.
* `docker-compose.dev.yml` (**development only**) with Postgres 17, Redis 7 and Mailpit
  on non-default loopback ports (55433 / 56379 / 58025 + 58125).
* `.env.example` with every variable documented; local `.env` is gitignored.
* Prisma schema + **three committed migrations**, including the constraints Prisma's
  schema language cannot express (monitor slot range, one-open-incident-per-monitor
  partial unique index, check field consistency, incident close-reason consistency).
* Config loader with cross-field production safety rules (refuses insecure cookies,
  unverified SMTP TLS, non-300s interval, example session secret in production).
* Structured logging with secret redaction; request ids.
* SSRF guard: scheme/credential/port/hostname policy, full IPv4 + IPv6
  special-purpose range coverage, IPv4-mapped / NAT64 / 6to4 unwrapping, DNS
  resolution with whole-hostname refusal on any non-public answer, and
  connection pinning that forbids re-resolution (DNS rebinding).
* HTTP check executor on undici: GET only, fixed header set, no redirects,
  mandatory TLS verification, time budget, response byte cap, body never stored.
* Result processor / incident state machine with row-locked transactions and
  database-level idempotency.
* Durable scheduler: atomic `FOR UPDATE SKIP LOCKED` claim in Postgres, slot
  re-basing after a long outage, startup + periodic reconciliation.
* Retention cleanup (checks, resolved incidents, dead sessions, spent tokens).
* Auth: signup (non-enumerating), login, logout, verification, resend, password
  reset, password change. Argon2id hashing, HMAC-hashed opaque tokens, opaque
  server-side sessions, CSRF double-submit + origin allowlist, Redis-backed rate
  limits.
* Monitors: create/list/read/update/pause/resume/delete with ownership checks and
  the DB-enforced 3-monitor limit.
* Status page domain + owner settings API + unauthenticated public projection.
* API and worker as separate entrypoints with graceful shutdown; health,
  readiness and product-meta endpoints.
* Email: templates (verification, reset, password changed, account exists, down,
  recovery), pooled SMTP transport, queued delivery with persisted alert state
  and an outbox reconciliation pass.

## Verified so far

* `npm run lint` — clean.
* `npm run typecheck` (shared + api) — clean.
* `npm run test:unit -w @pingexa/api` — **137 passing** (address policy, URL guard
  including rebinding and pinning, HTTP check classification and bounds, uptime
  and staleness maths, email templates and escaping).
* `npm run test:integration -w @pingexa/api` — **28 passing** against real
  Postgres + Redis (full auth surface, CSRF, origin allowlist, session hashing,
  single-use tokens, reset revoking sessions).
* Manual end-to-end smoke against the dev stack: signup -> Mailpit captures the
  verification email -> verify -> login -> create monitor -> scheduler claims it
  -> worker performs the check -> `state = UP`, `lastStatusCode = 200`,
  `lastResponseTimeMs = 143`. SSRF attempts on `127.0.0.1:4000` and
  `169.254.169.254` were both refused with a safe message.

## Outstanding

1. Integration tests for monitors, ownership, the 3-monitor limit under
   concurrency, the incident lifecycle, queue redelivery, restart recovery,
   retention, status-page privacy.
2. React + Vite web app (all pages, charts, states, branding).
3. Playwright end-to-end browser flows including Mailpit.
4. Seed script for clearly-separated demo data.
5. Fresh-setup verification on an isolated disposable database.
6. `docs/HANDOVER.md`, `docs/API.md`, `CLAUDE.md`.

## Blockers

None. Real SMTP delivery is the only externally-dependent item and is not yet
reached; local Mailpit delivery works.

## Exact next action

Write `apps/api/tests/integration/monitors.test.ts` and
`apps/api/tests/integration/monitoring.test.ts` (incident lifecycle, idempotency,
concurrency, restart recovery).
