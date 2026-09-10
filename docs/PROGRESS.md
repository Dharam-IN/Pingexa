# Pingexa — Progress

_Updated: 2026-09-10_

## State: V1 scope complete and verified locally

| Milestone | Status |
|-----------|--------|
| 1. Foundation, database, configuration, authentication | **Complete, verified** |
| 2. Scheduler, worker, check execution, incidents | **Complete, verified** |
| 3. Dashboard, charts, monitor management, status page | **Complete, verified** |
| 4. Email, reliability, security, integration coverage | **Complete, verified** (real SMTP delivery unverified — see Blockers) |
| 5. Fresh-setup verification, final fixes, documentation | **Complete** |

`docs/HANDOVER.md` §11 holds the full acceptance checklist with per-item
evidence. This file is the short version plus the next action.

## Latest verification run

All executed on 2026-09-10 against the dev stack (Postgres 17, Redis 7, Mailpit)
in `docker-compose.dev.yml`.

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean (shared, api, web) |
| `npm run test:unit` | **139 passed** (api) + **35 passed** (web) |
| `npm run test:integration` | **105 passed** against real Postgres + Redis |
| `npm run test:e2e` | **42 passed** — 21 desktop-chromium + 21 mobile-chromium |
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

## Blockers

**Real SMTP delivery is unverified** — the only outstanding item, and it needs
something I cannot supply myself. Every email path works against Mailpit and
every template is unit-tested, but no message has gone through a real provider
to a real mailbox.

To close it: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASSWORD` and `SMTP_REJECT_UNAUTHORIZED=true` in your local `.env`, and
name a recipient address you are happy to receive test mail at. Do not paste
credentials into a chat message — put them in `.env`, which is gitignored.

Nothing else is blocked.

## Exact next action

Nothing in the agreed application scope remains. The next action belongs to the
repository owner, in this order:

1. Optionally supply SMTP credentials and an authorised test recipient so real
   delivery can be verified (above).
2. Build the production deployment — Dockerfiles, production Compose, server,
   domain, HTTPS, CI/CD. Deliberately **not** in this repository; work through
   `docs/HANDOVER.md` §10 as the requirements list. The two things most likely
   to bite are `TRUST_PROXY_HOPS` and the SPA fallback route.

If a future session is asked to continue: read `CLAUDE.md`, then this file, then
`git status`, and re-run the verification table above before trusting any of it.
