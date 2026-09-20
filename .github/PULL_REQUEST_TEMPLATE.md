<!--
Thanks for contributing to Pingexa.

Please read CONTRIBUTING.md first if you have not already — it lists the rules
this codebase holds itself to, and most rejected pull requests hit one of them.

Keep a pull request to one concern. A refactor bundled with a behaviour change
is much harder to review and much harder to revert.
-->

## Why is this needed?

<!-- The problem, not the patch. Link the issue if there is one: Fixes #123 -->

## What changed?

<!-- A short tour of the diff. Call out anything a reviewer would otherwise
     have to reverse-engineer, and anything you deliberately did NOT do. -->

## How was it verified?

<!-- Paste the commands you ran and their outcome. "It builds" is not
     verification; a test that fails without the fix is. -->

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:unit`
- [ ] `npm run test:integration` <!-- needs Postgres + Redis -->
- [ ] `npm run build`
- [ ] `npm run test:e2e` <!-- if the SPA changed; needs the whole stack + Mailpit -->
- [ ] A new or changed test fails without this change

<!-- Anything you could not run, and why: -->

## Screenshots

<!-- Required for any visual change. Light AND dark theme, and a phone width if
     the layout reflows. Use demo data only — no real email addresses, private
     URLs, tokens or another person's data. Delete this section if the change
     is not visual. -->

| | Light | Dark |
|---|---|---|
| Before | | |
| After | | |

## Security and privacy impact

<!-- Tick what applies and explain below. "None" is a fine answer when true. -->

- [ ] No security-relevant change
- [ ] Touches outbound requests to user-supplied URLs (SSRF guard, address
      policy, redirects, TLS verification)
- [ ] Touches authentication, sessions, CSRF, rate limiting or ownership checks
- [ ] Changes what is exposed on the public status page or in an API response
- [ ] Changes what is logged or persisted

**Confirmations:**

- [ ] This adds **no** environment variable, config key or conditional that can
      relax URL validation, address policy, redirect handling or TLS
      verification
- [ ] No response body, token, password, session value or slug is newly logged
      or stored
- [ ] Any new user-facing wording about email says "accepted", not "delivered"

## Database and configuration impact

- [ ] No schema change and no new configuration
- [ ] Adds a migration <!-- forward-only and additive; never edit an applied one -->
- [ ] Adds or changes an environment variable <!-- documented in `.env.example`,
      `deploy/.env.production.example` and `deploy/selfhost/.env.example` -->
- [ ] Changes a default that an existing deployment would notice

<!-- If a migration is included: what happens to a running deployment between
     the migration applying and the new code starting? -->

## Documentation

- [ ] No documentation change needed
- [ ] `docs/API.md` updated (the HTTP contract changed)
- [ ] `docs/ARCHITECTURE.md` / `docs/DEVELOPMENT.md` / `docs/SELF_HOSTING.md` updated
- [ ] `docs/DECISIONS.md` entry added for a non-obvious choice
- [ ] `README.md` updated
- [ ] `CHANGELOG.md` updated under `Unreleased`

## Final checks

- [ ] **No secrets or production data in this diff** — no `.env`, API key,
      certificate, private key, session cookie, database dump, log file
      containing user data, or another person's email address or URL
- [ ] Commit messages follow the conventional-commit style used in the history,
      and carry **no AI or tool attribution trailers**
- [ ] I have read [CONTRIBUTING.md](../CONTRIBUTING.md) and agree that this
      contribution is licensed under the [MIT License](../LICENSE)
