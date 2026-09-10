# Pingexa — V1 Project Plan

Pingexa is a website uptime monitoring application for developers, freelancers and
small website owners. A user signs up, verifies their email, adds up to three public
HTTP/HTTPS URLs, and Pingexa checks each one every 5 minutes, records the result,
opens/closes incidents, emails alerts, and can publish a shareable status page.

## Fixed V1 scope

### Authentication
- Email + password signup and login, logout.
- Email verification (required before monitoring/alerts are active).
- Password reset.
- Argon2id password hashing; opaque, hashed, expiring, single-use tokens.
- Server-side sessions in an httpOnly cookie; CSRF protection on state-changing calls.
- Ownership check on every private resource.

### Monitors
- Create / list / view / edit / pause / resume / delete.
- Hard server-side maximum of **3 monitors per user** (DB-enforced).
- Public `http:`/`https:` URLs only, standard ports only (80/443), no credentials in URL.
- Fixed **5-minute** check interval.
- New monitors start `PENDING` until the first completed check.
- `DOWN` is declared after **3 consecutive failed scheduled checks**.
- Recovery on the **first** successful check after a declared outage; streak resets on success.
- Paused/deleted monitors produce no further checks or alerts.

### Checks
- Recorded per scheduled slot: `scheduledFor`, `startedAt`, `checkedAt`, outcome,
  HTTP status, response time (ms), failure kind + safe failure reason.
- Success = HTTP `2xx`. Everything else (3xx, 4xx, 5xx, DNS, TLS, connect, timeout,
  blocked address, oversized response) = failure. See `docs/HANDOVER.md` for the table.
- 7-day retention for checks, 90-day retention for incidents, both by automated cleanup.

### Dashboard
- Real API-backed monitor cards + detail pages.
- Current state, last check, response-time chart, uptime %, incident history.
- Coverage-aware uptime: missing checks are never counted as up **or** down; low
  coverage and stale monitoring are surfaced explicitly.

### Alerts
- At most one DOWN alert row per incident and one RECOVERY row when it closes
  (DB unique constraint `(incidentId, kind)`). That constraint bounds alert
  *intents*, not SMTP messages — delivery is at-least-once. See
  `docs/DECISIONS.md` D17.
- Sent to the verified account email, delivered by the worker via a queue with
  bounded retries (`MAIL_MAX_ATTEMPTS` SMTP transactions per alert, enforced from
  the persisted row) and persisted delivery state.

### Public status page
- One optional status page per user, unguessable 32-hex slug, explicit per-monitor opt-in.
- Publishes only: monitor display name, state, uptime, incident timestamps/durations.
- Never publishes URLs, email, tokens, internal errors, or other users' data.
- Unpublishing (or un-selecting a monitor) removes public access immediately.

### Interface
React + Vite SPA: landing, signup, login, verify-email, forgot/reset password,
dashboard, monitor detail, settings, public status page. Loading / empty / validation /
success / error states throughout. No fake metrics or non-functional controls.

### Out of scope
Billing, plans, orgs/teams, custom status-page domains, SMS, AI features, mobile apps,
multi-region checks, non-HTTP protocols, production deployment artifacts.

## Milestones and acceptance criteria

| # | Milestone | Acceptance criteria |
|---|-----------|---------------------|
| 1 | Foundation, DB, config, auth | Workspace builds; lint + typecheck clean; Prisma migrations committed and applied to a real Postgres; signup/verify/login/logout/reset pass integration tests; cross-user access rejected. |
| 2 | Scheduler, worker, check execution, incidents | Worker runs as its own process; durable DB-backed scheduler claims due monitors atomically; SSRF guard unit tests pass; success → 3 failures → incident → success → recovery verified against a real Postgres/Redis; duplicate/redelivered jobs create no duplicate checks or incidents. |
| 3 | Dashboard, charts, monitor management, status page | Web app builds; monitor CRUD + pause/resume from UI; response-time chart, uptime, incident history render from the API; status page publish/select/disable verified, privacy assertions pass. |
| 4 | Email, reliability, security, integration coverage | Mailpit captures verification, reset, down and recovery mail; notification retries bounded and persisted; rate limits, CSRF, trusted origins, graceful shutdown, health/readiness in place and tested. |
| 5 | Fresh-setup verification, docs, shutdown | Fresh isolated database + Redis provisioned from committed migrations; full lint / typecheck / unit / integration / e2e / build run recorded; docs finished; project containers stopped, volumes preserved. |
