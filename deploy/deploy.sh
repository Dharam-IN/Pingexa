#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pingexa production deploy. Runs ON THE SERVER, invoked over SSH by
# .github/workflows/deploy.yml, or by hand:
#
#     /opt/pingexa/deploy.sh sha-<40-char-commit>
#
# The order below is the whole point of this script:
#
#   pull  ->  migrate (must exit 0)  ->  update api/worker/web  ->  verify
#
# If the migration fails, nothing is restarted and the previous release keeps
# serving: a failed deploy is not an outage. If verification fails after the
# update, the previous image tag is restored automatically.
#
# Migrations are NOT rolled back. Prisma has no down-migrations, so a rollback
# past a destructive migration needs a restore from backup — which is why the
# rule is that migrations stay additive and forward-compatible. See
# docs/DEPLOYMENT.md.
# ---------------------------------------------------------------------------
set -Eeuo pipefail

STACK_DIR="${STACK_DIR:-/opt/pingexa}"
ENV_FILE="$STACK_DIR/.env.production"
COMPOSE_FILE="$STACK_DIR/docker-compose.prod.yml"
LOCK_FILE="${LOCK_FILE:-$STACK_DIR/.deploy.lock}"

READY_TIMEOUT="${READY_TIMEOUT:-120}"
PUBLIC_TIMEOUT="${PUBLIC_TIMEOUT:-120}"
# Set to 1 for the very first deploy, before DNS has propagated and Let's
# Encrypt has issued a certificate.
SKIP_PUBLIC_CHECK="${SKIP_PUBLIC_CHECK:-0}"

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# --env-file is not optional here. Compose interpolates ${VAR} in the compose
# file from --env-file (or a file literally named `.env`), NOT from a service's
# `env_file:` — that one only supplies variables to the container. Without this
# flag every ${IMAGE_TAG}, ${POSTGRES_USER} and ${PINGEXA_DOMAIN} resolves empty
# and the required-variable guards abort the command.
compose() {
  docker compose --project-directory "$STACK_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# --- arguments -------------------------------------------------------------
NEW_TAG="${1:-}"
[ -n "$NEW_TAG" ] || die "usage: $0 sha-<40-char-commit>"
# Deploying a moving tag such as `main` would make rollback meaningless and
# make "which code is running" unanswerable.
[[ "$NEW_TAG" =~ ^sha-[0-9a-f]{40}$ ]] \
  || die "refusing to deploy '$NEW_TAG': expected an immutable sha-<40 hex> tag"

[ -f "$COMPOSE_FILE" ] || die "missing $COMPOSE_FILE"
[ -f "$ENV_FILE" ]     || die "missing $ENV_FILE (copy .env.production.example and fill it in)"

# --- one deploy at a time --------------------------------------------------
exec 9>"$LOCK_FILE"
flock -n 9 || die "another deploy is already running (lock: $LOCK_FILE)"

# --- read current state ----------------------------------------------------
# Read with grep rather than sourcing: the file holds passwords with characters
# that a shell would happily interpret.
env_get() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true; }

env_set() {
  local key="$1" value="$2"
  if grep -qE "^$key=" "$ENV_FILE"; then
    # `|` as the delimiter: tags and URLs contain `/`.
    sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

CURRENT_TAG="$(env_get IMAGE_TAG)"
DOMAIN="$(env_get PINGEXA_DOMAIN)"
[ -n "$DOMAIN" ] || die "PINGEXA_DOMAIN is not set in $ENV_FILE"

log "Deploying $NEW_TAG"
info "stack:    $STACK_DIR"
info "current:  ${CURRENT_TAG:-<none>}"
info "domain:   $DOMAIN"

if [ "$CURRENT_TAG" = "$NEW_TAG" ]; then
  info "already at $NEW_TAG; continuing anyway so a half-finished deploy is repaired"
fi

# --- pull ------------------------------------------------------------------
# Pull before changing anything. A tag that does not exist in the registry must
# fail here, while the previous release is still the one running.
log "Pulling images"
IMAGE_TAG="$NEW_TAG" compose --profile migrate pull api worker web migrate \
  || die "could not pull images for $NEW_TAG — nothing was changed"

# --- from here on, a failure triggers rollback -----------------------------
ROLLBACK_ARMED=0

wait_for_api_ready() {
  # Declared separately on purpose: bash's `local` brings every name on the
  # line into scope as unset before it performs any assignment, so referring to
  # `timeout` in the arithmetic on the same line trips `set -u`.
  local timeout="${1:-$READY_TIMEOUT}"
  local deadline=$((SECONDS + timeout))
  local body=''
  while [ $SECONDS -lt $deadline ]; do
    # Asked inside the api container: /api/ready is not routed publicly in a way
    # that distinguishes "app degraded" from "proxy broken", and this must test
    # the application specifically. It returns 503 unless BOTH Postgres and
    # Redis answer.
    if body="$(compose exec -T api node -e "
      fetch('http://127.0.0.1:4000/api/ready')
        .then(async (r) => { process.stdout.write(await r.text()); process.exit(r.ok ? 0 : 1); })
        .catch(() => process.exit(1));
    " 2>/dev/null)"; then
      info "ready: $body"
      return 0
    fi
    sleep 3
  done
  [ -n "$body" ] && info "last response: $body"
  return 1
}


rollback() {
  [ "$ROLLBACK_ARMED" = "1" ] || return 0
  ROLLBACK_ARMED=0
  if [ -z "$CURRENT_TAG" ]; then
    printf '\n\033[1;31mNo previous tag to roll back to. The stack may be down.\033[0m\n' >&2
    return 0
  fi
  log "Rolling back to $CURRENT_TAG"
  info "the schema is NOT rolled back; migrations are forward-only"
  env_set IMAGE_TAG "$CURRENT_TAG"
  if IMAGE_TAG="$CURRENT_TAG" compose up -d --no-deps api worker web; then
    if wait_for_api_ready 90; then
      info "rollback verified: $CURRENT_TAG is serving"
    else
      printf '\n\033[1;31mRollback did not become ready. Manual intervention required.\033[0m\n' >&2
    fi
  else
    printf '\n\033[1;31mRollback failed to start. Manual intervention required.\033[0m\n' >&2
  fi
}
trap 'rollback' ERR

# --- data services ---------------------------------------------------------
# Brought up first and independently of the application: the migration needs
# Postgres, and neither Postgres nor Redis is versioned by IMAGE_TAG, so this is
# a no-op on every deploy after the first.
log "Ensuring Postgres and Redis are up"
IMAGE_TAG="$NEW_TAG" compose up -d postgres redis
IMAGE_TAG="$NEW_TAG" compose up -d --wait --wait-timeout 120 postgres redis \
  || die "Postgres or Redis did not become healthy — nothing was changed"

# --- migrate ---------------------------------------------------------------
# A separate, one-shot container that must exit 0. The application is still
# running the OLD image at this point, so a failure here leaves the previous
# release serving untouched.
log "Running database migrations"
ROLLBACK_ARMED=1
if ! IMAGE_TAG="$NEW_TAG" compose --profile migrate run --rm --no-deps migrate; then
  ROLLBACK_ARMED=0
  trap - ERR
  die "migration failed — api and worker were NOT updated and are still serving ${CURRENT_TAG:-the previous release}"
fi
info "migrations applied"

# --- update the application ------------------------------------------------
log "Updating api, worker and web to $NEW_TAG"
env_set IMAGE_TAG "$NEW_TAG"
IMAGE_TAG="$NEW_TAG" compose up -d --no-deps api worker web
# Caddy is not versioned by IMAGE_TAG, but bring it up in case this is a first
# deploy or its config changed.
IMAGE_TAG="$NEW_TAG" compose up -d caddy

# --- verify ----------------------------------------------------------------
log "Verifying the deployment"

wait_for_api_ready "$READY_TIMEOUT" \
  || { info "api never reported ready"; false; }

# Prove the NEW code is the code that is running, rather than a container that
# silently kept the old image. The API reports npm_package_version, which
# docker-compose.prod.yml sets to IMAGE_TAG.
RUNNING_VERSION="$(compose exec -T api node -e "
  fetch('http://127.0.0.1:4000/api/health')
    .then((r) => r.json())
    .then((b) => { process.stdout.write(String(b.version)); })
    .catch(() => process.exit(1));
" 2>/dev/null || true)"
if [ "$RUNNING_VERSION" != "$NEW_TAG" ]; then
  info "api reports version '$RUNNING_VERSION', expected '$NEW_TAG'"
  false
fi
info "api is running $RUNNING_VERSION"

# The worker serves no HTTP, so liveness is the only thing checkable from here.
if [ "$(compose ps -q worker | wc -l)" -eq 0 ] \
   || [ "$(docker inspect -f '{{.State.Running}}' "$(compose ps -q worker)")" != "true" ]; then
  info "worker container is not running"
  false
fi
info "worker is running"

if [ "$SKIP_PUBLIC_CHECK" = "1" ]; then
  info "skipping the public HTTPS check (SKIP_PUBLIC_CHECK=1)"
else
  info "checking https://$DOMAIN through Caddy"
  deadline=$((SECONDS + PUBLIC_TIMEOUT))
  ok=0
  while [ $SECONDS -lt $deadline ]; do
    spa="$(curl -fsS -o /dev/null -w '%{http_code}' "https://$DOMAIN/" || true)"
    api="$(curl -fsS -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/health" || true)"
    if [ "$spa" = "200" ] && [ "$api" = "200" ]; then ok=1; break; fi
    sleep 5
  done
  if [ "$ok" != "1" ]; then
    info "public check failed (SPA: ${spa:-none}, API: ${api:-none})"
    info "on a first deploy this is usually DNS or a certificate that has not been issued yet;"
    info "re-run with SKIP_PUBLIC_CHECK=1 once you have confirmed that separately"
    false
  fi
  info "https://$DOMAIN is serving the SPA and the API"
fi

# --- commit ----------------------------------------------------------------
trap - ERR
ROLLBACK_ARMED=0
# Only when it is genuinely a different release. Recording the tag we just
# deployed as the rollback target would make `rollback.sh` a no-op against the
# very release you are trying to escape (this happens when a deploy is re-run
# for the same commit).
if [ -n "$CURRENT_TAG" ] && [ "$CURRENT_TAG" != "$NEW_TAG" ]; then
  env_set PREVIOUS_IMAGE_TAG "$CURRENT_TAG"
  PREVIOUS_KNOWN_GOOD="$CURRENT_TAG"
else
  PREVIOUS_KNOWN_GOOD="$(env_get PREVIOUS_IMAGE_TAG)"
fi

log "Deployed $NEW_TAG successfully"
if [ -n "$PREVIOUS_KNOWN_GOOD" ]; then
  info "previous known-good: $PREVIOUS_KNOWN_GOOD (roll back with ./rollback.sh)"
else
  info "no previous release recorded; this is the first deploy"
fi

# Reclaim space from superseded images. Keeps anything still referenced, so the
# previous release stays pullable locally for an instant rollback.
docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true

exit 0
