#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Roll the Pingexa application back to a previous image tag.
#
#     /opt/pingexa/rollback.sh                    # to PREVIOUS_IMAGE_TAG
#     /opt/pingexa/rollback.sh sha-<40-hex>       # to a specific release
#
# This rolls back CODE ONLY. Prisma has no down-migrations, so the schema stays
# where the last migration left it. That is safe as long as migrations are
# additive and forward-compatible — which is the rule this project operates
# under, precisely so that rollback stays a one-command operation. Rolling back
# past a destructive migration (a dropped column, a narrowed type) needs a
# restore from backup instead; see docs/DEPLOYMENT.md.
#
# It deliberately does not run migrations and does not touch Postgres or Redis.
# ---------------------------------------------------------------------------
set -Eeuo pipefail

STACK_DIR="${STACK_DIR:-/opt/pingexa}"
ENV_FILE="$STACK_DIR/.env.production"
COMPOSE_FILE="$STACK_DIR/docker-compose.prod.yml"
READY_TIMEOUT="${READY_TIMEOUT:-120}"

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

[ -f "$COMPOSE_FILE" ] || die "missing $COMPOSE_FILE"
[ -f "$ENV_FILE" ]     || die "missing $ENV_FILE"

env_get() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true; }
env_set() {
  local key="$1" value="$2"
  if grep -qE "^$key=" "$ENV_FILE"; then
    sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

CURRENT_TAG="$(env_get IMAGE_TAG)"
TARGET_TAG="${1:-$(env_get PREVIOUS_IMAGE_TAG)}"

[ -n "$TARGET_TAG" ] || die "no target tag: pass one, or set PREVIOUS_IMAGE_TAG in $ENV_FILE"
[[ "$TARGET_TAG" =~ ^sha-[0-9a-f]{40}$ ]] \
  || die "refusing to roll back to '$TARGET_TAG': expected an immutable sha-<40 hex> tag"
[ "$TARGET_TAG" != "$CURRENT_TAG" ] || die "already running $TARGET_TAG"

log "Rolling back: $CURRENT_TAG -> $TARGET_TAG"
info "code only; the database schema is not changed"

IMAGE_TAG="$TARGET_TAG" compose pull api worker web \
  || die "could not pull $TARGET_TAG — nothing was changed"

env_set IMAGE_TAG "$TARGET_TAG"
IMAGE_TAG="$TARGET_TAG" compose up -d --no-deps api worker web

log "Verifying"
deadline=$((SECONDS + READY_TIMEOUT))
while [ $SECONDS -lt $deadline ]; do
  if body="$(compose exec -T api node -e "
    fetch('http://127.0.0.1:4000/api/ready')
      .then(async (r) => { process.stdout.write(await r.text()); process.exit(r.ok ? 0 : 1); })
      .catch(() => process.exit(1));
  " 2>/dev/null)"; then
    info "ready: $body"
    # The tag that was broken becomes the "previous" one, so a second rollback
    # does not bounce back to it.
    env_set PREVIOUS_IMAGE_TAG "$CURRENT_TAG"
    log "Rolled back to $TARGET_TAG"
    exit 0
  fi
  sleep 3
done

die "$TARGET_TAG did not become ready within ${READY_TIMEOUT}s — investigate with 'docker compose -f $COMPOSE_FILE logs api'"
