#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pingexa PostgreSQL backup.
#
#     /opt/pingexa/backup.sh
#
# Intended for cron:
#     15 3 * * *  /opt/pingexa/backup.sh >> /var/log/pingexa-backup.log 2>&1
#
# A named Docker volume survives container recreation, image updates and
# `compose down`. It does NOT survive `docker volume rm`, a disk failure, or a
# migration that deleted the wrong thing. This script is what covers those.
#
# ---------------------------------------------------------------------------
# RESTORING. Read this before you need it.
#
#   1. Stop the application so nothing writes during the restore. Leave Postgres
#      running.
#        cd /opt/pingexa
#        docker compose -f docker-compose.prod.yml stop api worker
#
#   2. Restore into a NEW database first and look at it, rather than over the
#      top of the live one:
#        gunzip -c /var/backups/pingexa/pingexa-YYYYmmdd-HHMMSS.dump.gz \
#          | docker compose -f docker-compose.prod.yml exec -T postgres \
#              pg_restore -U "$POSTGRES_USER" -d postgres --create --clean \
#              --no-owner --no-privileges
#
#   3. When you are satisfied, point DATABASE_URL at it, or repeat step 2 with
#      `-d "$POSTGRES_DB"` to restore in place.
#
#   4. Restart:
#        docker compose -f docker-compose.prod.yml up -d api worker
#
# A backup you have never restored is not a backup. Do step 2 once, deliberately,
# before you are relying on it.
# ---------------------------------------------------------------------------
set -Eeuo pipefail

STACK_DIR="${STACK_DIR:-/opt/pingexa}"
ENV_FILE="$STACK_DIR/.env.production"
COMPOSE_FILE="$STACK_DIR/docker-compose.prod.yml"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { printf '[%s] ERROR: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; exit 1; }

# --env-file is not optional here. Compose interpolates ${VAR} in the compose
# file from --env-file (or a file literally named `.env`), NOT from a service's
# `env_file:` — that one only supplies variables to the container. Without this
# flag every ${IMAGE_TAG}, ${POSTGRES_USER} and ${PINGEXA_DOMAIN} resolves empty
# and the required-variable guards abort the command.
compose() {
  docker compose --project-directory "$STACK_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

[ -f "$ENV_FILE" ] || die "missing $ENV_FILE"
env_get() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true; }

POSTGRES_USER="$(env_get POSTGRES_USER)"
POSTGRES_DB="$(env_get POSTGRES_DB)"
BACKUP_DIR="${BACKUP_DIR:-$(env_get BACKUP_DIR)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pingexa}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-$(env_get BACKUP_RETENTION_DAYS)}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

[ -n "$POSTGRES_USER" ] || die "POSTGRES_USER is not set in $ENV_FILE"
[ -n "$POSTGRES_DB" ]   || die "POSTGRES_DB is not set in $ENV_FILE"

mkdir -p "$BACKUP_DIR"
# Backups contain every account record in the system. Not world-readable.
chmod 700 "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/pingexa-$STAMP.dump.gz"
TMP="$TARGET.partial"

if [ "$(compose ps -q postgres | wc -l)" -eq 0 ]; then
  die "the postgres container is not running"
fi

log "dumping $POSTGRES_DB -> $TARGET"

# -Fc is the custom format: compressed, and pg_restore can read it selectively
# (a single table, or schema without data), which a plain SQL dump cannot.
# Writing to .partial first means an interrupted run never leaves a file that
# looks like a usable backup.
if ! compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges \
     | gzip -9 > "$TMP"; then
  rm -f "$TMP"
  die "pg_dump failed; no backup was written"
fi

# A dump of a database that could not be read can still exit 0 and produce a
# tiny file, so check that the archive is real and that pg_restore can parse it.
SIZE="$(stat -c %s "$TMP")"
[ "$SIZE" -gt 1024 ] || { rm -f "$TMP"; die "dump is only ${SIZE} bytes; refusing to keep it"; }

if ! gunzip -c "$TMP" | compose exec -T postgres pg_restore --list > /dev/null 2>&1; then
  rm -f "$TMP"
  die "the dump is not a readable pg_restore archive; refusing to keep it"
fi

mv "$TMP" "$TARGET"
chmod 600 "$TARGET"
log "wrote $TARGET ($(numfmt --to=iec "$SIZE" 2>/dev/null || echo "${SIZE}B"))"

# Prune old backups. Runs only after a successful new one, so a broken backup
# job can never delete the last good copy.
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'pingexa-*.dump.gz' -type f -mtime "+$RETENTION_DAYS" -print -delete | wc -l)"
log "retention: kept ${RETENTION_DAYS} days, removed $DELETED older archive(s)"

REMAINING="$(find "$BACKUP_DIR" -maxdepth 1 -name 'pingexa-*.dump.gz' -type f | wc -l)"
log "done: $REMAINING archive(s) in $BACKUP_DIR"
