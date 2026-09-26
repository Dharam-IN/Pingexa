# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Pingexa application image — API, worker and migrations.
#
# Two published targets, built from the same source:
#
#   --target runtime   the image the API and the worker both run. Production
#                      dependencies only, no Prisma CLI, no TypeScript, no
#                      tests. The two processes differ only by `command`.
#   --target migrate   a one-shot image that runs `prisma migrate deploy`. It
#                      keeps devDependencies because the Prisma CLI, its schema
#                      engine and `prisma7.config.ts` (which imports `dotenv`
#                      and `prisma/config`) are all development-time packages.
#
# Notes that are easy to get wrong here:
#  * Prisma 7 uses the `prisma-client` generator with the `pg` driver adapter.
#    The generated client is TypeScript compiled by `tsc`, and the query
#    compiler is WASM shipped inside `@prisma/client`. There is no Rust query
#    engine to copy and no `binaryTargets` to declare.
#  * `@node-rs/argon2` is a native addon resolved through per-platform optional
#    dependencies. This image is glibc (bookworm) and must be built for the
#    target server's architecture.
#  * npm workspaces link `node_modules/@pingexa/shared` to `packages/shared`.
#    The runtime layer keeps the repository layout so that symlink resolves.
#  * The root `postinstall` runs `prisma generate`, which needs the Prisma CLI.
#    Every install here passes `--ignore-scripts` and generation is explicit.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=24-bookworm-slim

# ---- base -----------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
WORKDIR /app

# ---- manifests ------------------------------------------------------------
# Isolated so a source-only change does not invalidate the install layers.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# ---- deps: full install, used to build ------------------------------------
FROM manifests AS deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev --ignore-scripts

# ---- prod-deps: exactly what the runtime layer carries ---------------------
# `--omit=dev` alone is not enough here. The Prisma CLI, its schema engine and
# the whole Studio chain (@prisma/dev, @electric-sql/pglite, effect, ...) are
# reachable as *optional peers* of @prisma/client, so npm records them as
# `devOptional` in the lockfile and keeps all 113 of them under `--omit=dev`.
# That is 200 MB of build-time tooling in a runtime image. `--omit=optional`
# removes them.
#
# The cost of `--omit=optional` is that it also drops the genuinely-needed
# per-platform native packages, because those are real optionalDependencies:
# `@node-rs/argon2-<platform>` (password hashing — the API cannot log anyone in
# without it) and `msgpackr-extract` (bullmq's native codec, which otherwise
# falls back to slower pure JS). Both are copied back from the full install
# below, so they still come from the lockfile and are not re-resolved.
FROM manifests AS prod-deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --omit=optional --ignore-scripts
COPY --from=deps /app/node_modules/@node-rs ./node_modules/@node-rs
COPY --from=deps /app/node_modules/@msgpackr-extract ./node_modules/@msgpackr-extract
COPY --from=deps /app/node_modules/msgpackr-extract ./node_modules/msgpackr-extract
COPY --from=deps /app/node_modules/node-gyp-build-optional-packages ./node_modules/node-gyp-build-optional-packages

# ---- build: generate the Prisma client, compile shared + api ---------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run prisma:generate \
 && npm run build -w @pingexa/shared \
 && npm run build -w @pingexa/api

# ---- runtime: the image the API and the worker run -------------------------
FROM base AS runtime

# Bind inside the container; compose publishes it on the host loopback for
# Caddy. The default of 127.0.0.1 would be unreachable from outside.
ENV API_HOST=0.0.0.0 \
    API_PORT=4000 \
    LOG_PRETTY=false

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --from=prod-deps --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=prod-deps --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist

USER node
EXPOSE 4000

# Boot smoke test, baked into the build so an over-aggressive prune fails here
# instead of in production. It starts the real server with a production-shaped
# configuration, which exercises the config loader's production rules, the
# native argon2 binding loaded by the auth module, and every bare import in
# dist, then asserts /api/health answers. Postgres and Redis are deliberately
# unreachable: the API is designed to start anyway and report /api/ready as
# degraded, so this needs no services.
RUN NODE_ENV=production \
    API_HOST=127.0.0.1 API_PORT=4111 \
    PUBLIC_APP_URL=https://smoke.invalid \
    TRUSTED_ORIGINS=https://smoke.invalid \
    DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:1/smoke \
    REDIS_URL=redis://127.0.0.1:1 \
    SESSION_SECRET=smoke-test-session-secret-value-that-is-long-enough-0123456789 \
    COOKIE_SECURE=true \
    SMTP_HOST=127.0.0.1 SMTP_REJECT_UNAUTHORIZED=true \
    MAIL_FROM_ADDRESS=smoke@smoke.invalid \
    MONITOR_INTERVAL_SECONDS=300 \
    LOG_LEVEL=silent \
    node -e "\
      const { spawn } = require('node:child_process'); \
      const p = spawn(process.execPath, ['apps/api/dist/server.js'], { stdio: 'inherit' }); \
      const done = (code, msg) => { try { p.kill('SIGKILL'); } catch {} ; if (msg) console.error(msg); process.exit(code); }; \
      p.on('exit', (c) => done(1, 'smoke: server exited early with code ' + c)); \
      const deadline = Date.now() + 30000; \
      (async function poll() { \
        while (Date.now() < deadline) { \
          try { \
            const r = await fetch('http://127.0.0.1:4111/api/health'); \
            const b = await r.json(); \
            if (r.ok && b.status === 'ok' && b.service === 'pingexa-api') return done(0); \
          } catch {} \
          await new Promise((r) => setTimeout(r, 500)); \
        } \
        done(1, 'smoke: /api/health did not answer within 30s'); \
      })(); \
    "

# Liveness only. /api/health deliberately touches no dependency, so a Postgres
# or Redis blip cannot make the orchestrator kill a healthy process; readiness
# (/api/ready) is what to check after a deploy instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Overridden per service in docker-compose.prod.yml; this is the API.
CMD ["node", "apps/api/dist/server.js"]

# ---- migrate: one-shot, runs before the application is updated -------------
FROM build AS migrate
# Prisma's schema engine is a native binary that links against OpenSSL. The slim
# Node images do not ship it, so without this the CLI prints "failed to detect
# the libssl/openssl version to use" and falls back to guessing openssl-1.1.x.
# It happened to work, but a migration is the last place to rely on a guess.
# Only the migrate target needs it; the runtime image talks to Postgres through
# the pg driver adapter and has no native engine at all.
# Prisma's schema engine is a native binary that links against OpenSSL, and the
# slim Node images do not ship it. Without OpenSSL the CLI cannot detect the
# platform, warns, and falls back to guessing `debian-openssl-1.1.x` — which is
# the only binary the npm tarball carries, so it appears to work. A migration is
# the last place to rely on a guess.
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Having installed OpenSSL, the CLI now correctly resolves `debian-openssl-3.0.x`
# — for which no binary is present, because every npm install in this Dockerfile
# passes `--ignore-scripts` and @prisma/engines fetches its binary from a
# postinstall script. Left alone, the CLI would try to download it AT DEPLOY
# TIME, from a container that sits on an `internal: true` network with no route
# to the internet, and the migration would fail with `EAI_AGAIN
# binaries.prisma.sh`. Fetching it here moves that network dependency into the
# image build, where it belongs.
RUN node node_modules/@prisma/engines/scripts/postinstall.js \
 && ls node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x

# The engines directory is root-owned from the install above, and the CLI
# asserts it can write there before running. Only the directory itself needs to
# change hands; a recursive chown would copy ~190 MB into a new layer.
RUN chown node:node node_modules/@prisma/engines

WORKDIR /app/apps/api

# Pin the binary explicitly so the CLI neither probes nor downloads at deploy
# time. With this set, the migration container needs no network beyond Postgres.
ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x
# The Prisma CLI writes nothing outside its own cache; HOME keeps that in a
# writable location for the unprivileged user.
ENV HOME=/tmp
USER node
# `prisma migrate deploy` applies committed migrations only. It never generates
# a migration, never resets, and is safe to re-run: already-applied migrations
# are skipped. It must exit 0 before the API and worker are updated.
#
# Invoked by absolute path rather than through npx so nothing can reach the
# registry at deploy time. `prisma7.config.ts` next to this working directory is
# auto-discovered and supplies datasource.url from DATABASE_URL.
CMD ["/app/node_modules/.bin/prisma", "migrate", "deploy"]
