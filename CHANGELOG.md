# Changelog

All notable changes to Pingexa are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project intends to follow [Semantic
Versioning](https://semver.org/spec/v2.0.0.html) once it starts tagging.

**There are no releases yet.** Nothing has been tagged, and no version has been
published. Everything below is therefore under `Unreleased`, reconstructed from
the commit history rather than from release notes — the dates are the dates work
landed on the default branch, not release dates.

---

## [Unreleased]

### Changed — basic production deployment *(2026-09-26)*

- Production is now deployed by copying the code to one server (rsync, from the
  Deploy workflow) and running
  `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`.
  Images are built on the server. A separate, shared Caddy container fronts
  `web` and `api` over the external `caddy` network (as `pingexa-web` /
  `pingexa-api`); the stack publishes no ports. `migrate` runs on every `up` and
  `api`/`worker` wait for it to exit 0.

### Removed

- The GHCR image pipeline. `.github/workflows/deploy.yml` now rsyncs the code to
  the server as `deploy` after CI passes on main and runs the same `up -d --build`.
- The `deploy/deploy.sh`, `deploy/rollback.sh` and
  `deploy/backup.sh` scripts.
- The Caddy container and `deploy/Caddyfile` from the production stack.

### Added — open-source foundation

Preparing the repository to be published and self-hosted by other people.

- **MIT licence** (`LICENSE`), © 2026 Dharamraj Yadav. `license` is now declared
  in the root manifest and in all three workspace manifests; the root manifest
  also gained `repository`, `homepage`, `bugs`, `author` and `keywords`. Every
  package stays `private: true` — nothing is published to npm.
- **An independent self-hosting stack** at `deploy/selfhost/`: a Compose file
  that **builds every image from this source tree**, its own Caddyfile, and a
  fully-commented `.env.example`. It requires no container registry account, no
  SSH access, no DNS belonging to anyone else, and no particular mail provider.
  An optional `mailpit` profile lets the whole thing be rehearsed on a laptop
  with no domain and no SMTP account.
- **`docs/SELF_HOSTING.md`** — requirements, secret generation, SMTP for any
  standards-compliant provider, DNS and HTTPS, migrations as a separate step,
  health and readiness, backup and restore, upgrades and forward-only
  migrations, logs, troubleshooting, and safe shutdown.
- **`docs/ARCHITECTURE.md`** — the runtime topology, the check and incident
  flow, incident state transitions, the email outbox, and the public/private
  data boundary, with Mermaid diagrams drawn from the actual behaviour.
- **`docs/DEVELOPMENT.md`** — verified setup, the test suites, and how
  development mail is kept inside Mailpit.
- **`docs/DATA_AND_PRIVACY.md`** — a field-by-field inventory of what a running
  instance stores, where it goes and how long it lives, plus an explicit record
  that the hosted service publishes no Privacy Policy or Terms of Service yet.
  That is a hosted-service gap, not a source-licence one.
- **Community files** — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor
  Covenant 2.1), `SECURITY.md`, `SUPPORT.md`, `.github/CODEOWNERS`, a pull
  request template, and issue forms for bugs and feature requests. The feature
  form asks for the problem before the proposed solution; neither form asks
  anyone to paste a secret.
- **`.github/dependabot.yml`** — weekly, grouped and capped, for the three
  ecosystems that actually exist here: npm (one root lockfile), GitHub Actions,
  and the Docker base images in `deploy/`.
- **A README that works as a repository front page**, with a feature table, an
  honest list of what Pingexa does *not* do, five screenshots from the seeded
  demo account, a roadmap with no dates, and the known limitations.
- **`scripts/dev-env-guard.mjs`** — a preflight on `npm run dev:api` and
  `dev:worker` that refuses to start when the environment file they are about to
  load points SMTP at anything other than a local mail catcher. It reads one key
  (`SMTP_HOST`), never a secret, and has no effect on production. Overridable
  with `PINGEXA_ENV_FILE` or `PINGEXA_ALLOW_EXTERNAL_SMTP=1`. Also available on
  its own as `npm run dev:check`.

### Added — product

- **Overview, Monitors and Monitor detail** as three routes instead of one
  dashboard. `/app` is an operational overview ordered by urgency, `/app/monitors`
  is management with search, filters and sort, and `/app/monitors/:id` is
  substantially deeper. The signed-in shell is a sidebar from `lg` up and a
  drawer below it. *(2026-09-20)*
- **`GET /api/overview` and `GET /api/alerts`** — read-only aggregates. No schema
  change, no new stored field: every number is counted from rows the worker
  already writes. Both are scoped by the session user *in the query*;
  `/api/alerts` is bounded at 50 and rejects a limit outside 1–50 rather than
  clamping it. `Notification.lastError` is never projected. *(2026-09-20)*
- **A 24-hour bucketed check timeline per monitor**, on a fixed 48-bucket
  server-side grid so two monitors are comparable. A bucket in which no check ran
  is drawn in a third colour with `avgResponseTimeMs: null` — never green, never
  a zero. *(2026-09-20)*
- **An expanded UI kit and consolidated design tokens** — `PageHeader`, `Metric`,
  `Badge`, `Skeleton`, `Dialog`, `ConfirmDialog`, `SegmentedControl`,
  `SelectField`, table primitives and `IconButton`. Semantic status and chart
  tokens replaced six hand-rolled light/dark pairs, one of which was wrong.
  *(2026-09-20)*
- **Light / Dark / System theme selector**, persisted, with no flash on reload.
  Attribute-driven: `system` is resolved before CSS sees it, so the compiled
  stylesheet contains zero `prefers-color-scheme` rules and a toggle can never
  lose to a media query. *(2026-09-10)*
- **A production deployment stack** — `docker-compose.prod.yml`, `deploy/` and
  the GitHub Actions pipeline. Verified by an executed rehearsal against a local
  registry with two releases and a real database, including a deliberately
  failed migration and a rollback. *(2026-09-17)*
- **Pingexa V1** — accounts with email confirmation and password reset, up to
  three SSRF-guarded HTTP/HTTPS monitors on a five-minute schedule, a durable
  Postgres-backed scheduler, the three-failure incident rule, DOWN and RECOVERY
  email alerts with persisted delivery state, coverage-aware uptime, response
  time and incident history, and opt-in public status pages. *(2026-09-10)*

### Changed

- **The public status page** gained `noindex, nofollow` while open, a staleness
  banner past two check intervals, and separate wording for paused and unknown
  services so neither is reported as an outage. *(2026-09-20)*
- **The overview reports a median response time, not a mean**, and deliberately
  reports **no aggregate uptime percentage** — a mean across monitors, weighted
  by nothing in particular, would look authoritative and answer no question.
  *(2026-09-20)*
- **`dotenv` moved from `devDependencies` to `dependencies`.** It is imported at
  runtime by the config loader, so a production image installed with `--omit=dev`
  crashed at boot. The only application change the deployment work required.
  *(2026-09-17)*
- **The production image prunes with `--omit=optional` as well as `--omit=dev`.**
  The entire Prisma CLI and Studio chain — 113 packages — is `devOptional` in the
  lockfile because it is an optional peer of `@prisma/client`, so `--omit=dev`
  kept all of it. 808 MB → 545 MB. *(2026-09-17)*

### Fixed

- **Every text input had lost its focus ring.** A refactor put `outline-none` on
  the control so a wrapper could tint its border on focus. Found by sampling
  computed outlines, not by looking — the border change made it *look* focused.
  *(2026-09-20)*
- **Unknown `/api/...` paths answered `401` instead of `404`**, because a router
  mounted at `/api` with a router-level auth guard runs the guard before the
  request can reach the not-found handler. *(2026-09-20)*
- **A closed `<dialog>` kept its contents in the DOM**, duplicating the
  add-monitor form's labels and hints on the page behind it. *(2026-09-20)*
- **The monitors list rendered a desktop table *and* a mobile list**, leaving
  whichever was hidden in the document — two state badges per monitor, with every
  query finding the invisible one. Collapsed to one reflowing grid. *(2026-09-20)*
- **Emailed links failed on first click in a cold browser.** The SPA attached
  `X-CSRF-Token` only when the cookie already existed, so a browser whose first
  ever request was `POST /api/auth/verify-email` — which is what opening a
  confirmation link on a second device *is* — got `403` and a valid link looked
  broken. The client now bootstraps the token with one safe `GET`. *(2026-09-16)*
- **`.env` defined `PUBLIC_APP_URL` twice**, and dotenv keeps the last
  occurrence, so every emailed link pointed at an origin absent from
  `TRUSTED_ORIGINS`. The config loader now refuses to boot in production unless
  `TRUSTED_ORIGINS` contains `PUBLIC_APP_URL`. *(2026-09-16)*
- **The alert retry budget restarted on every re-enqueue.** Exhaustion was judged
  from BullMQ's attempt counter, which resets whenever a new job is created for
  the same row — so one alert could in principle be re-sent without limit. It is
  now judged from the row's persisted `attempts`. *(2026-09-10)*
- **Alert delivery did not actually exclude concurrent senders.** The claim left
  the row `PENDING` for the duration of the send, so two workers both matched and
  both sent. It is now a compare-and-set on the exact `attempts` value read.
  *(2026-09-10)*
- **The public status page was briefly cacheable**, so a browser kept seeing it
  for up to 30 seconds after the owner unpublished it or rotated the slug. Now
  `no-store`. *(2026-09-10)*
- **Token-redemption endpoints shared the login rate-limit bucket.** Those
  requests carry no email address, so the key collapsed and redemptions for
  different accounts shared one small allowance. *(2026-09-10)*
- **BullMQ 6 rejects `:` in a custom job id**, so every scheduled check silently
  failed to enqueue. *(2026-09-10)*
- **Deployment fixes** — the worker had no route out on the `internal` network;
  Compose does not interpolate from `env_file`; Prisma tried to download its
  schema engine at deploy time from a container with no internet;
  `PREVIOUS_IMAGE_TAG` could equal the tag just deployed, making rollback a
  no-op; the GHCR image namespace needed lowercasing; CI fresh installs were
  non-deterministic. *(2026-09-17 – 2026-09-19)*

### Security

- **The SSRF guard has no off switch, by construction.** `createUrlGuard()` takes
  an explicit policy object and the production factory always passes the strict
  one; tests that need a loopback fixture build their own. An ESLint rule fails
  the build if the guard is ever wired to configuration.
- **Connections are pinned to the resolved, approved address**, closing DNS
  rebinding between validation and connect. TLS still verifies against the
  original hostname.
- **`MAIL_RECIPIENT_ALLOWLIST`** — a narrowing-only recipient allowlist, enforced
  inside `sendMail` before the SMTP transaction. It refuses extra recipients and
  pins the SMTP envelope, and can only ever *remove* recipients. *(2026-09-16)*
- **Alert delivery is documented as at-least-once**, not exactly-once. The
  `(incidentId, kind)` unique index bounds alert *intents*, not SMTP messages.
  An earlier, wrong framing was corrected. *(2026-09-10)*

### Removed

- The initial Next.js scaffold, replaced by the React + Vite SPA. *(2026-09-10)*

---

## Notes on versioning

The manifests carry `1.0.0`, but that is a placeholder from the initial scaffold
rather than a released version — no tag exists for it. The first tagged release
will start the numbered sections above this one; until then, `Unreleased` is the
whole changelog and `main` is the only supported branch
([`SECURITY.md`](SECURITY.md)).

[Unreleased]: https://github.com/Dharam-IN/Pingexa/commits/main
