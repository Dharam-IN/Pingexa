# Getting help with Pingexa

Pingexa is maintained by one person as a side project. There is no support
desk, no SLA and no paid tier. What follows is the fastest route to an answer.

## Start with the documentation

| I want to… | Read |
|---|---|
| Understand what Pingexa does and does not do | [README](README.md) |
| Run it locally and make a change | [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) |
| Run my own instance | [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) |
| Understand how the pieces fit together | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Call the HTTP API | [`docs/API.md`](docs/API.md) |
| Know why something is built the way it is | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| Operate the maintainer production stack | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| See what is known not to work | [`docs/HANDOVER.md`](docs/HANDOVER.md) §13 |

## Then check the usual suspects

A few things account for most of the questions:

* **"My site shows as DOWN but it loads fine."** Pingexa does not follow
  redirects — a `3xx` is a failed check. If you are monitoring
  `http://example.com` and it redirects to HTTPS, monitor the final URL
  instead. This is deliberate ([D7](docs/DECISIONS.md)).
* **"Nothing is being checked."** Monitoring does not start until the account
  email is confirmed. Locally, the confirmation email is in Mailpit at
  <http://127.0.0.1:58125>.
* **"Uptime shows `—` instead of a percentage."** Nothing has been recorded in
  that window yet. Pingexa reports `null` rather than guessing `0%` or `100%`
  ([D12](docs/DECISIONS.md)).
* **"I get two DOWN emails for one outage."** Alert delivery is at-least-once.
  One alert *row* per incident is guaranteed; the number of SMTP messages for
  that row is not ([D17](docs/DECISIONS.md)).
* **"`@pingexa/shared` cannot be resolved."** `packages/shared/dist` is
  generated and gitignored. Run `npm install` (its `postinstall` builds it) or
  `npm run build -w @pingexa/shared`.
* **"Rate limited during `npm run test:e2e`."** The suite creates many accounts
  from one address. Raise `TOKEN_RATE_LIMIT_MAX` to about `400` in your local
  `.env` only.

## Where to ask

| Kind of thing | Where |
|---|---|
| A bug, with a reproduction | [Bug report](https://github.com/Dharam-IN/Pingexa/issues/new?template=bug_report.yml) |
| An idea or a missing capability | [Feature request](https://github.com/Dharam-IN/Pingexa/issues/new?template=feature_request.yml) |
| A question about using or self-hosting it | [Open an issue](https://github.com/Dharam-IN/Pingexa/issues/new/choose) |
| A security vulnerability | **Not an issue** — follow [SECURITY.md](SECURITY.md) |
| Wanting to contribute a change | [CONTRIBUTING.md](CONTRIBUTING.md) |

When you open an issue, include the commit SHA you are on, whether you are
running the development stack or a self-hosted deployment, and the relevant log
lines. **Redact anything sensitive** — do not paste a `.env` file, a session
cookie, a token, a private URL or another person's email address into a public
issue.

## Response expectations

Issues are read and triaged when the maintainer has time. There is no
guaranteed response time, and an issue going quiet is not a judgement on it. A
pull request with a test attached is the fastest way to get something fixed.

## The hosted instance

`https://pingexa.parthavix.com` is run by the maintainer. It is the same code
as this repository, but it is a personal deployment rather than a commercial
service: no uptime guarantee, no support commitment, and no compensation for
missed alerts. If you need a monitor you can depend on, self-host it — that is
what the MIT licence is for.
