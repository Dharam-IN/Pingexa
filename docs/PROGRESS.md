# Pingexa — Progress

_Updated: 2026-09-20_

## State: V1 scope complete and verified locally; product experience upgraded

| Milestone | Status |
|-----------|--------|
| 1. Foundation, database, configuration, authentication | **Complete, verified** |
| 2. Scheduler, worker, check execution, incidents | **Complete, verified** |
| 3. Dashboard, charts, monitor management, status page | **Complete, verified** |
| 4. Email, reliability, security, integration coverage | **Complete, verified** — real SMTP delivery now verified against Resend |
| 5. Fresh-setup verification, final fixes, documentation | **Complete** |
| 6. Light/dark theme support across the application | **Complete, verified** |
| 7. Product experience upgrade | **Complete, verified locally** — branch `feat/product-experience`, not merged |

`docs/HANDOVER.md` §11 holds the full acceptance checklist with per-item
evidence. This file is the short version plus the next action.

## Product experience upgrade (2026-09-20)

On branch **`feat/product-experience`**, local only — **not pushed, not
deployed.** The V1 feature scope is unchanged: no new monitoring engine, no new
product capability, no migration, and no change to authentication, CSRF, rate
limits, scheduling, incident transitions, alert behaviour, the SSRF guard or the
public/private data split.

### What changed

**Routes.** `/app` became an operational **Overview**; monitor management moved
to a new `/app/monitors`; `/app/monitors/:id` and `/app/settings` were rebuilt in
place. The signed-in shell is a sidebar from `lg` up and a drawer below it, with
Overview / Monitors / Settings, the account address, sign-out and the theme
selector. See `docs/DECISIONS.md` D26.

**Backend — two read-only endpoints, no schema change.**
`GET /api/overview` (account-wide counts, 24-hour activity, open and recent
incidents, a 24-hour bucketed timeline per monitor) and `GET /api/alerts`
(bounded recent alert-delivery list). Both are scoped by the session user in the
query; `/api/alerts` is capped at 50 and rejects a limit outside 1–50. Neither
serves `Notification.lastError`. Rationale and the things deliberately *not*
added are in D27; the bucketing rule is D28.

**Honesty carried into the visuals.** A time bucket with no recorded check is
drawn in a third colour and reports `avgResponseTimeMs: null` — never green,
never a zero (D28). The overview reports a **median** response time, not a mean.
There is no aggregate uptime percentage, because one would have no defensible
meaning across monitors (D27). Alert delivery still reads "Accepted", never
"Delivered" (D25).

**Public status page** gained `noindex, nofollow` while open, a staleness banner
past two check intervals, and separate wording for paused and unknown services
so neither is reported as an outage (D29).

**Design system.** Semantic status/chart tokens replaced six hand-rolled
light/dark pairs; the kit gained `PageHeader`, `Metric`, `Badge`, `Skeleton`,
`Dialog`, `ConfirmDialog`, `SegmentedControl`, `SelectField`, table primitives
and `IconButton`. Conventions are in `CLAUDE.md`.

### Defects found and fixed during this work

1. **Every text input lost its focus ring.** The refactored `Field` put
   `outline-none` on the control so the wrapper could tint its border on focus.
   Found by sampling computed outlines, not by looking — the border change made
   it *look* focused. The app-wide `:focus-visible` rule is back on the real
   control. Same lesson as D22, now written into `CLAUDE.md`.
2. **Unknown `/api/...` paths answered 401 instead of 404.** A router mounted at
   `/api` with a router-level `requireAuth` runs the guard before the request can
   reach the not-found handler. Caught by the existing integration test for JSON
   404s. The two new routers are mounted on their own paths (D27).
3. **A closed `<dialog>` kept its contents in the DOM,** so the add-monitor form's
   labels and hints were duplicated on the page behind it. `Dialog` now renders
   children only while open.
4. **The monitors list rendered a desktop table *and* a mobile list,** leaving
   whichever was hidden in the document — two state badges per monitor, and every
   query finding the invisible one. Collapsed to one reflowing grid.
5. **Table columns collided** (`ATTEMPTS`/`ACCEPTED AT` ran together) because the
   `Th`/`Td` primitives carried no column gutter.

### Verification (2026-09-20)

Run against a disposable `pingexa_review` database, a `pingexa_review` queue
prefix and **Mailpit** — never Resend. The repository `.env` still holds live
Resend credentials from the 2026-09-16 delivery verification, so every process
in this work was started with `PINGEXA_ENV_FILE=.env.review`, which points SMTP
at `127.0.0.1:58025`.

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run test:unit` | **249 passed** (API 152, web 97) |
| `npm run test:integration` | **120 passed**, real Postgres + Redis |
| `npm run build` | clean |
| `npm run test:e2e` | **98 passed** (49 desktop + 49 mobile), against the **production build** |
| Visual/a11y verification | **77 checks passed** — see below |

The 77 automated visual checks (`.review/verify.mjs`) cover: no horizontal
overflow on 7 routes × 4 viewports (1440, 1024, 390, 360) × both themes; chart
labels not clipped; no theme flash on a cold load in either theme; the paused and
pending states explaining themselves; sign-in completing on the keyboard alone;
every form control and all 18 tab stops painting a focus ring; and a destructive
dialog trapping focus, defaulting to the *safe* action, and closing on Escape.

Before/after screenshots: `.review/shots/before` and `.review/shots/after`,
160 images each — 4 viewports × 2 themes × 20 screens, plus `.review/shots/states`
for paused, pending, degraded-status-page and the alert table.

**Bundle impact** (gzip, initial route; the Recharts chunk stays lazy and is
unchanged at 103.46 kB):

| | before | after | delta |
|---|---|---|---|
| CSS | 5.98 kB | 7.43 kB | +1.45 kB |
| JS | 122.50 kB | 134.84 kB | +12.34 kB |
| **initial total** | **129.63 kB** | **143.42 kB** | **+13.79 kB (+10.6%)** |

### Not done, deliberately

Manual "check now", SSL/domain-expiry or keyword monitoring, any new monitoring
engine, billing, teams, and arbitrary intervals — all out of scope and all
untouched. No database migration was needed or added.

## Real email delivery verification (2026-09-16)

Ran the application against **Resend** with live credentials and a single real
recipient. This is the item that had been outstanding since milestone 4.

**Isolation.** A disposable Postgres (`pingexa_mailverify`) and a *separate*
Redis instance on their own ports and their own `mailverify` queue prefix. The
development stack was never started — its ports did not listen once during the
run — so no existing queue was read, drained, or consumed, and no development
data was touched. Retries were disabled (`MAIL_MAX_ATTEMPTS=1`) and a
fail-closed `MAIL_RECIPIENT_ALLOWLIST` pinned delivery to one address, proven
before the first send to reject the demo account, an arbitrary address, a
comma-appended second recipient, and an empty string.

**Six messages, all accepted by Resend and all confirmed by the recipient in the
Gmail Inbox — none in spam.**

| Flow | Provider acceptance | Inbox |
|---|---|---|
| Signup → confirmation | `250` | confirmed |
| Password reset | `250` | confirmed |
| Password reset (replacement, after the first token expired) | `250` | confirmed |
| Password changed | `250` | confirmed |
| Monitor DOWN | `250` | confirmed |
| Monitor RECOVERY | `250` | confirmed |

**Configuration confirmed against Resend's published SMTP documentation:**
`smtp.resend.com:465`, implicit TLS with `SMTP_SECURE=true`, username the
literal `resend`, password the API key, `SMTP_REJECT_UNAUTHORIZED=true`, and a
`MAIL_FROM_ADDRESS` on the owner's verified sending domain. The existing
nodemailer transport needed no change to work with Resend.

**The incident path was exercised with synthetic `HttpCheckResult` fixtures fed
to the real `processCheckResult`**, so `runHttpCheck` never ran and the SSRF
guard, address policy, redirect handling and TLS verification were not touched.
The three-failure threshold held (no alert at streak 1 or 2), exactly two
notification rows were created with `attempts=1` each, and the incident closed
`RECOVERED` with the monitor back to `UP`.

### Defects found by this run, and fixed

1. **Emailed links failed on first click in a cold browser.** The SPA attached
   `X-CSRF-Token` only if the cookie already existed, so a browser whose first
   ever request was `POST /api/auth/verify-email` — which is what opening a
   confirmation link on a second device *is* — got `403 csrf_failed` and a valid
   link looked broken. Observed live: the same endpoint returned 403, then 200
   after the fix, on the same emailed token. The client now bootstraps the token
   with one safe GET; the double-submit defence is unchanged
   (`docs/DECISIONS.md` D23). Three regression tests added. The e2e suite had
   missed it because Playwright navigates the SPA before clicking a Mailpit
   link, so its context always already held the cookie.
2. **`.env` defined `PUBLIC_APP_URL` twice.** dotenv keeps the last occurrence,
   so the value actually in use was not the documented one, and every emailed
   link would have pointed at an origin absent from `TRUSTED_ORIGINS`. The
   duplicate is gone, `.env.example` warns about it, and the config loader now
   refuses to boot in production unless `TRUSTED_ORIGINS` contains
   `PUBLIC_APP_URL`.
3. **A send left no provider-side trace.** The provider's SMTP reply and
   `Message-ID` are now logged, which is the only way to correlate a Pingexa
   send with the provider's own records (`docs/DECISIONS.md` D25).

### Honest limitations of this verification

* **Acceptance is not delivery.** Every `250` above means Resend accepted the
  message. Inbox placement was confirmed by the recipient reading the mailbox,
  not by any signal available to the application.
* **No delivery telemetry.** The API key in use is send-only, so
  `GET /emails/{id}` is refused and Resend's own delivered/bounced status could
  not be read back. `Notification.status = SENT` means "accepted by the
  provider" and nothing stronger.
* **Bounces are still not processed.** There is no webhook; a hard bounce after
  acceptance is invisible to Pingexa.
* **One recipient, one provider, one run.** Deliverability to other mailbox
  providers (Outlook, corporate filters) is unmeasured.
* **Long-run reputation is unmeasured.** Six messages say nothing about what a
  sustained alert volume does to domain reputation.

## Latest verification run

All executed on 2026-09-10 against the dev stack (Postgres 17, Redis 7, Mailpit)
in `docker-compose.dev.yml`.

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean (shared, api, web) |
| `npm run test:unit` | **139 passed** (api) + **52 passed** (web) |
| `npm run test:integration` | **108 passed** against real Postgres + Redis |
| `npm run test:e2e` | **66 passed** — 33 desktop-chromium + 33 mobile-chromium (includes 24 theme tests) |
| `npm run build` | clean (shared, api, web) |
| `./scripts/verify-fresh-setup.sh` | passed — disposable database, migrations only, no schema drift, all four hand-written constraints present, built API booted and signed a user up, integration suite green |

Screenshots of every page (light, dark, desktop and mobile) were captured and
reviewed against the seeded demo account, which is how the four interface fixes
below were found.

## Bugs found by verification and fixed

These are worth keeping, because each was found by a test rather than by reading:

1. **Alert delivery did not actually exclude concurrent senders.** The claim was
   `UPDATE ... WHERE id = ? AND status = 'PENDING'` with an `attempts`
   increment, which leaves the row `PENDING` for the duration of the send, so
   two workers both matched and both sent. Now claimed by optimistic concurrency
   on the exact `attempts` value read (`docs/DECISIONS.md` D19). Found by the
   fresh-setup run; the previous test had been passing on timing luck. Test
   strengthened to 10 concurrent handlers and re-verified over four runs.
2. **The public status page was briefly cacheable.** `Cache-Control:
   public, max-age=30` meant a browser that had already loaded a page kept
   seeing it for up to 30 seconds after the owner unpublished it or rotated the
   slug — a violation of "disabling publication must remove public access". Now
   `no-store` (`docs/DECISIONS.md` D18). Found by the slug-rotation e2e test.
3. **Token-redemption endpoints shared the login rate-limit bucket.**
   `verify-email` and `password-reset/confirm` carry no email, so the `ip|email`
   key collapsed to `ip|`, lumping redemptions for *different* accounts into one
   small allowance. Split into its own looser per-IP bucket
   (`TOKEN_RATE_LIMIT_MAX`), since a token is 256 bits of randomness and the
   limit there is about volume, not guessing. Found by a real 429 during e2e.
4. **A failed check on a monitor that was not yet DOWN said nothing.** The
   failure threshold is three, so a card could look healthy while the site was
   already erroring. Both the card and the detail page now show the reason and
   the streak. Found by an e2e assertion.
5. **BullMQ 6 rejects `:` in a custom job id**, so every scheduled check silently
   failed to enqueue. Job ids now encode the slot as epoch milliseconds. Found
   by the first manual end-to-end run.
6. **The demo seed contradicted itself once the worker ran.** Its monitors
   pointed at URLs whose real responses disagreed with the story being
   illustrated, so a monitor seeded as "currently down" flipped to up within
   five minutes. Its URLs and `createdAt` now match the history it writes, so
   live checks confirm the story instead of overwriting it. Found by reviewing a
   screenshot of the seeded dashboard.
7. **Interface polish found by screenshot review:** the sign-out button wrapped
   onto two lines at phone width; dashboard cards stretched to the tallest in
   their row; the DOWN banner conflated the three-failure confirmation threshold
   with the current streak length.

## Theme work (2026-09-10, second pass)

**What already worked.** The token set, the dark palette, and 50 `dark:`
utilities across 9 files all existed and rendered correctly — dark mode looked
right when the OS asked for it. The chart already read its colours from CSS
variables. Contrast in both palettes turned out to be sound: a WCAG check
computed from painted colours over 11 screens × 2 themes × 2 viewports, plus
validation, error, toast, dialog and edit-form states, found **zero** failures
without any palette change.

**What was missing, and is now built.** There was no theme selector at all, no
persistence, and no `data-theme` — theming was driven purely by
`@media (prefers-color-scheme: dark)`, and `index.css` carried a comment
claiming a switch had been deliberately omitted. Added:

* `ThemeSelector` — Light / Dark / System as native radios in a labelled
  fieldset, so arrow-key navigation, the single tab stop and the group
  announcement come from the platform. Present in `AppShell`, `AuthLayout`,
  `LandingPage`, `PublicStatusPage` and `NotFoundPage`; icon-only in the app
  header so a phone still fits it.
* `ThemeContext` — preference state, `localStorage` persistence under
  `pingexa.theme`, and the OS setting read through `useSyncExternalStore`.
* A synchronous bootstrap script in `index.html` that resolves and applies the
  theme in `<head>`, before the stylesheet and long before React, plus an inline
  `<style>` for the moment before the app's CSS loads — so a reload never
  flashes.
* `@custom-variant dark` keyed on `[data-theme='dark']`, so all 50 existing
  `dark:` utilities follow the selector. The compiled stylesheet now contains
  **zero** `prefers-color-scheme` rules.
* New tokens for what had been literals: `--on-brand`, `--switch-knob`,
  `--focus-ring`. The only literal colours left are the three `#fff` values in
  the `Logo` mark, which is branding and must not invert.

**Defects found while doing it.**

1. **A stale-theme window.** The first version stored the resolved theme and
   updated it from an effect-based media listener, so an OS change between the
   bootstrap script and the listener attaching was lost — the app sat on the
   wrong theme until something else re-rendered. Caught by a probe that changed
   the OS immediately after navigation. Fixed by deriving `resolved` and reading
   the OS through `useSyncExternalStore`, which reads during render.
2. **The focus ring did not paint.** The selector's radio was hidden with
   `opacity: 0` and the ring mirrored onto the label with
   `has-[:focus-visible]:outline-…`. Sampling the painted pixels showed **no
   ring at all** in either theme — and rewriting it as literal CSS with a
   hard-coded magenta still painted nothing. Fixed by keeping the input
   full-size with `appearance-none` and transparent colours so the app-wide
   `:focus-visible` rule paints it directly. Verified by pixels: the dark ring
   measures `rgb(165,158,255)`, an exact match for its token.
3. **A 1px click target.** The `sr-only` radio was a 1px box the icon painted
   over, so a pointer click landed on the icon rather than the control. The
   input now covers its whole segment.
4. **A clipped chart axis label.** The `ms` unit was positioned inside the plot
   area and collided with the top tick, rendering as `ns` in both themes. The
   unit is now on each tick.

Two things learned that are recorded in `CLAUDE.md` because they cost real time:
`getComputedStyle(el).outlineColor` reports `currentColor` whatever is set, so
it cannot verify a focus ring; and Tailwind's dev-server output repeatedly
lagged file edits, so CSS must be verified against the production build
(`npm run build -w @pingexa/web` then
`VITE_PREVIEW_PORT=5173 npm run preview -w @pingexa/web`).

## Production deployment (2026-09-17)

The deployment that `docs/HANDOVER.md` §10 described as the owner's remaining
work now exists in this repository: `docker-compose.prod.yml`, `deploy/` and
`.github/workflows/`. It is documented in `docs/DEPLOYMENT.md` and is entirely
separate from `docker-compose.dev.yml`, which is unchanged.

**One application change was required**, and only one: `dotenv` moved from
`devDependencies` to `dependencies` in `apps/api/package.json`. It is imported at
runtime by `src/config/env.ts`, so a production image installed with
`--omit=dev` crashed at boot with `Cannot find module 'dotenv'`. `vite.config.ts`
also gained a `VITE_SOURCEMAP` opt-out, defaulting to the existing behaviour, so
only the production image ships without source maps. No product behaviour
changed.

**Verified by an executed run, not by reading the files.** A complete rehearsal
against a local registry, with two releases and a real database:

| Property | Evidence |
|---|---|
| Runtime image boots and serves | Build-time smoke test starts the real server with a production config and asserts `/api/health`; verified again against real Postgres and Redis (`/api/ready` → `{"database":true,"redis":true}`) |
| API and worker share one image | Both run `pingexa-app:<tag>`, differing only by `command`; the worker started and logged `pingexa worker started` |
| Migrations apply from the committed migrations | All three applied to a disposable database; a second run reported `No pending migrations to apply` |
| A failed migration is not an outage | Observed for real: the migration failed and the script left the API and worker on the previous release |
| Deploy, then rollback | `sha-aaa…` → `sha-bbb…` → `rollback.sh` → `sha-aaa…`, each confirmed by `/api/health` reporting the deployed tag |
| Postgres and Redis are private | Redis refused from the host; `getent hosts` inside the Postgres container fails — the `internal: true` network has no gateway |
| The worker still has egress | `fetch('https://example.com')` from inside the worker returned HTTP 200 |
| Data survives container recreation | Rows and keys written, both containers `rm -sf`'d and recreated, both values read back |
| Redis is configured for BullMQ | `maxmemory-policy noeviction`, `appendonly yes`, auth required |
| Caddy routing | `/` → SPA, `/app/monitors/x` → SPA fallback, `/api/health` → API, HTTP → HTTPS 308, HSTS present |
| Backups are restorable | `backup.sh` produced an archive `pg_restore --list` reads, listing all eight tables |

**Defects found while doing it**, all in the deployment code, all fixed:

1. **`--omit=dev` pruned almost nothing.** 113 packages — the entire Prisma CLI
   and Studio chain — are `devOptional` in the lockfile because they are optional
   peers of `@prisma/client`, so `--omit=dev` keeps them. The image was 808 MB.
   `--omit=optional` removes them, at the cost of the per-platform native
   packages, which are copied back from the full install. Now 545 MB.
2. **The worker had no route out.** It was on the `internal: true` network only,
   which would have failed every outbound check and every email. It now joins a
   separate `egress` network.
3. **Compose does not interpolate from `env_file`.** `${IMAGE_TAG}` and friends
   resolve from `--env-file` or a file literally named `.env`; without the flag
   every deploy command aborted on the required-variable guards.
4. **`local a=… b=$((a+1))`** trips `set -u`: bash brings every name on the line
   into scope before assigning any of them.
5. **Prisma tried to download its schema engine at deploy time.** With OpenSSL
   installed it correctly resolves `debian-openssl-3.0.x`, which the npm tarball
   does not carry, and the migration container has no internet by design. The
   engine is now fetched during the image build and pinned with
   `PRISMA_SCHEMA_ENGINE_BINARY`.
6. **`PREVIOUS_IMAGE_TAG` could equal the tag just deployed**, which would make
   rollback a no-op against the release you are trying to escape.

**Not verified here:** anything requiring the real server — DNS, Let's Encrypt
issuance, the GitHub Actions run itself, and SSH to production. Those are listed
as manual steps in `docs/DEPLOYMENT.md` §2.

## Blockers

**None in the application.** Real SMTP delivery, the last outstanding item, was
verified against Resend on 2026-09-16: six messages across all five product
flows, every one accepted by the provider and confirmed in the recipient's
Inbox. See "Real email delivery verification" above for what that does and does
not prove.

What remains is deployment work, which is deliberately outside this repository
and belongs to the owner. It is listed as requirements, not blockers, in
"Exact next action" below and in `docs/HANDOVER.md` §10.

## Exact next action

The product-experience branch is complete and verified locally. It is **not
pushed and not deployed**, and needs the owner's review before either.

1. Review `feat/product-experience` (see the section above), then merge and let
   CI ship it.

The remaining items need the real server and cannot be done from this
repository:

1. ~~Verify real SMTP delivery.~~ **Done 2026-09-16** against Resend; see above.
   Note the account's API key is send-only, so provider-side delivery status is
   not readable. Issue a key with read access if delivery telemetry is wanted.
2. ~~Build the production deployment.~~ **Done 2026-09-17**; see above and
   `docs/DEPLOYMENT.md`.
3. **Provision the server and run the first deploy.** Work through
   `docs/DEPLOYMENT.md` §2 in order: Docker, the `deploy` user, the SSH key,
   the firewall, DNS for `pingexa.parthavix.com`, `.env.production`, GHCR
   credentials, then §3 for the GitHub secrets. The first deploy needs
   `SKIP_PUBLIC_CHECK=1` because no certificate exists yet.
4. **Restore a backup once, deliberately** (`docs/DEPLOYMENT.md` §6) before
   relying on it, and add the cron entry from §2.10.
5. **Set up an external check** on `https://pingexa.parthavix.com/api/health`
   from somewhere other than the server itself.

If a future session is asked to continue: read `CLAUDE.md`, then this file, then
`git status`, and re-run the verification table above before trusting any of it.
