# Security Policy

Pingexa makes outbound HTTP requests to URLs that its users supply, stores
account credentials and email addresses, and can publish a page to the open
internet. Security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through **GitHub Private Vulnerability Reporting**:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Fill in the advisory form.

> **Note for the repository owner:** private vulnerability reporting is a
> per-repository setting and is **not** assumed to be enabled yet. Until it is
> turned on (*Settings → Advanced Security → Private vulnerability reporting →
> Enable*), the **Report a vulnerability** button will not appear. See
> [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) for self-hosting and the
> repository checklist in [`README.md`](README.md) for the remaining owner
> actions.

If private reporting is not available to you, contact the repository owner
[@Dharam-IN](https://github.com/Dharam-IN) through GitHub and ask for a private
channel. Do not include exploit details in a public message.

There is no published security contact email address for this project, and
none should be inferred.

### What to include

* What the issue is, and which component is affected (API, worker, web SPA,
  deployment configuration).
* How to reproduce it, ideally against a local development stack.
* What an attacker gains — read another account's data, bypass the SSRF guard,
  escalate to the host, and so on.
* The commit SHA or branch you tested.

**Do not include** real credentials, production `.env` contents, session
cookies, live tokens, or another person's data in a report. A redacted
reproduction against a local stack is more useful and safer for everyone.

### What to expect

Pingexa is maintained by one person as a side project. There is no on-call
rotation, no SLA, and no bug bounty. Reports are acknowledged and triaged as
soon as the maintainer is able to. Please allow reasonable time for a fix
before disclosing publicly, and expect to be credited in the advisory unless
you ask not to be.

## Supported versions

Pingexa has no tagged releases yet. Only the current `main` branch is
supported; fixes land there. Anyone self-hosting should track `main` and
redeploy — see [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

## Scope

**In scope**

* The API (`apps/api`), the worker, and the React SPA (`apps/web`).
* The SSRF guard, address policy, redirect handling and TLS verification in
  `apps/api/src/monitoring/`.
* Authentication, sessions, CSRF, rate limiting, and the public/private data
  boundary of the status page.
* The shipped deployment configuration in `deploy/` and the Compose files.

**Out of scope**

* The hosted instance at `https://pingexa.parthavix.com` as infrastructure
  (DNS, certificates, the server itself). Report application bugs you observe
  there, not findings about the host.
* Denial of service and volumetric testing. Do not run load or stress tests
  against the hosted instance or against any third-party site through Pingexa.
* Findings that require a compromised host, a malicious dependency you
  introduced, or physical access.
* Missing hardening headers with no demonstrated impact, and reports produced
  solely by an automated scanner with no reproduction.
* Advisories in the `prisma` CLI dependency chain, which is a devDependency and
  is pruned from the production image — see "Known non-issues" below.

## What the project already guarantees

These are enforced in code and covered by tests. A break in any of them is a
security bug worth reporting.

**Outbound requests to user-supplied URLs**

* `http:` and `https:` only, on the scheme's default port (80/443), no
  credentials in the URL, and internal-only hostname suffixes refused.
* Every A/AAAA record is resolved and classified against the IPv4 and IPv6
  special-purpose registries, with IPv4-mapped, NAT64 and 6to4 addresses
  unwrapped. If **any** resolved address is not globally routable, the whole
  hostname is refused.
* The connection is then **pinned** to the approved addresses, closing DNS
  rebinding between validation and connect. TLS still verifies against the
  original hostname.
* Redirects are not followed. TLS verification is always on.
* **There is no environment variable, config key or flag that weakens any of
  this.** `createUrlGuard()` takes an explicit policy object and the production
  factory always passes the strict one; an ESLint rule fails the build if the
  guard is ever wired to configuration. A pull request that adds such a switch
  will be rejected.

**Accounts and sessions**

* Argon2id password hashing; opaque 32-byte session tokens stored only as an
  HMAC; single-use, expiring verification (24h) and reset (1h) tokens, also
  stored only as an HMAC.
* A completed reset revokes every session; a password change revokes every
  other session.
* Login and signup answer identically for a known and an unknown address.

**Data exposure**

* The public status page projection is a single function that never receives or
  emits monitored URLs, email addresses, HTTP status codes, failure reasons or
  the slug itself.
* Response bodies from monitored sites are read only to enforce a size cap and
  are then discarded. No body is ever stored or logged.
* The logger redacts passwords, hashes, tokens, cookies, `Authorization`
  headers and status-page slugs by key name.

Details are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/HANDOVER.md`](docs/HANDOVER.md) §9.

## Known non-issues

* **`prisma` CLI transitive advisories.** The Prisma CLI is a devDependency and
  pulls advisories through `@prisma/config` and `mysql2`. Neither is loaded at
  runtime — Pingexa uses PostgreSQL — and the production image installs with
  `--omit=dev --omit=optional`, which removes that whole chain. Verified by
  inspecting the built image.
* **Alert email is at-least-once, not exactly-once.** A duplicate "your site is
  down" email is possible by design. This is documented in
  [`docs/DECISIONS.md`](docs/DECISIONS.md) D17 and is not a vulnerability.

## For self-hosters

If you run your own Pingexa, the settings that matter most are in
[`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md). Three in particular:

* `TRUST_PROXY_HOPS` **must** equal the real number of reverse proxies in front
  of the API. Too low and rate limits key on your proxy's address; too high and
  a client can forge `X-Forwarded-For` and bypass them entirely.
* `SESSION_SECRET` must be a real random secret, supplied at runtime and never
  baked into an image.
* `COOKIE_SECURE=true` and `SMTP_REJECT_UNAUTHORIZED=true` are enforced when
  `NODE_ENV=production`; the API refuses to boot otherwise. Do not work around
  that check.

Pingexa is provided under the MIT License, without warranty. Running an
instance exposed to the internet is your responsibility.
