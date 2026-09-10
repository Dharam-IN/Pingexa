# Pingexa

Website uptime monitoring for developers, freelancers and small site owners.

Add up to three public HTTP/HTTPS URLs. Pingexa checks each one every five
minutes from the outside, records every result, opens an incident after three
consecutive failures, emails you once when that happens and once when the site
recovers, and can publish a shareable status page showing only what you choose.

## Quick start

```bash
npm install
cp .env.example .env
# set SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

docker compose -f docker-compose.dev.yml up -d   # DEVELOPMENT ONLY
npm run migrate:deploy
npm run seed                                     # optional demo data

npm run dev:api      # http://127.0.0.1:4000
npm run dev:worker
npm run dev:web      # http://localhost:5173
```

Mail is captured by Mailpit at <http://127.0.0.1:58125>; nothing is monitored
until you confirm your address.

## Documentation

| Document | What it covers |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Layout, commands, and the rules this codebase holds itself to. |
| [`docs/HANDOVER.md`](docs/HANDOVER.md) | Setup, operation, verification results, and the deployment-facing requirements. |
| [`docs/API.md`](docs/API.md) | The HTTP contract, plus the check, uptime and incident semantics. |
| [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) | The fixed V1 scope and its acceptance criteria. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why the non-obvious things are the way they are. |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Current state and the next action. |

## Stack

React + Vite · Node + Express 5 · PostgreSQL + Prisma (committed migrations) ·
Redis + BullMQ · a separate worker process · SMTP, with Mailpit locally.

`docker-compose.dev.yml` provides the backing services for **local development
and integration testing only** — it is not a production deployment artifact.
Production deployment is intentionally not part of this repository.
