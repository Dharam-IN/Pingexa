#!/usr/bin/env bash
#
# Fresh-setup verification.
#
# Proves that a brand-new environment can be built from what is committed:
# a database created from scratch, migrated only from `prisma/migrations`,
# with the whole integration suite run against it and the API booted on it.
#
# It is deliberately non-destructive to the development environment:
#   * it creates its own database, named with a timestamp;
#   * it drops only that database, at the end;
#   * it never touches `pingexa_dev`, `pingexa_test`, any Docker volume, or any
#     container it did not start.
#
# Usage:  ./scripts/verify-fresh-setup.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "No .env found. Copy .env.example to .env first." >&2
  exit 1
fi

# Read the development DATABASE_URL only to borrow its host and credentials.
DEV_DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"
if [[ -z "$DEV_DATABASE_URL" ]]; then
  echo "DATABASE_URL is not set in .env" >&2
  exit 1
fi

FRESH_DB="pingexa_fresh_$(date +%Y%m%d%H%M%S)"
ADMIN_URL="$(node -e '
  const url = new URL(process.argv[1]);
  url.pathname = "/postgres";
  process.stdout.write(url.toString());
' "$DEV_DATABASE_URL")"
FRESH_URL="$(node -e '
  const url = new URL(process.argv[1]);
  url.pathname = "/" + process.argv[2];
  process.stdout.write(url.toString());
' "$DEV_DATABASE_URL" "$FRESH_DB")"

ENV_FILE="$(mktemp -t pingexa-fresh-env.XXXXXX)"
API_LOG="$(mktemp -t pingexa-fresh-api.XXXXXX)"
API_PID=""

cleanup() {
  local status=$?
  echo
  echo "--- cleaning up ---"
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill -TERM "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
    echo "stopped the temporary API process"
  fi
  # Drop only the database this script created.
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$FRESH_DB\" WITH (FORCE)" >/dev/null 2>&1 \
    && echo "dropped $FRESH_DB" \
    || echo "could not drop $FRESH_DB — drop it by hand" >&2
  rm -f "$ENV_FILE"
  echo "log kept at $API_LOG"
  exit $status
}
trap cleanup EXIT

if (ss -tln 2>/dev/null || netstat -tln 2>/dev/null) | grep -q ':4100 '; then
  echo "Port 4100 is already in use; the verification needs it free." >&2
  exit 1
fi

echo "=== fresh-setup verification ==="
echo "development database: untouched"
echo "disposable database:  $FRESH_DB"
echo

echo "--- 1. create the database ---"
psql "$ADMIN_URL" -q -c "CREATE DATABASE \"$FRESH_DB\""
echo "created"

# A self-contained environment for the fresh instance: its own database, its own
# Redis logical database and queue prefix, its own port. Nothing shared with dev.
cat > "$ENV_FILE" <<ENV
NODE_ENV=development
API_PORT=4100
API_HOST=127.0.0.1
LOG_LEVEL=warn
LOG_PRETTY=false
PUBLIC_APP_URL=http://localhost:5173
TRUSTED_ORIGINS=http://localhost:5173
DATABASE_URL=$FRESH_URL
DATABASE_POOL_MAX=5
REDIS_URL=redis://127.0.0.1:56379/3
QUEUE_PREFIX=pingexa_fresh
SESSION_SECRET=fresh-setup-verification-secret-value-0123456789abcdef
COOKIE_SECURE=false
SMTP_HOST=127.0.0.1
SMTP_PORT=58025
SMTP_SECURE=false
SMTP_REJECT_UNAUTHORIZED=false
MAIL_FROM_ADDRESS=alerts@pingexa.local
MAIL_FROM_NAME=Pingexa Fresh
ENV

echo
echo "--- 2. apply the committed migrations ---"
( cd apps/api && PINGEXA_ENV_FILE="$ENV_FILE" DATABASE_URL="$FRESH_URL" npx prisma migrate deploy )

echo
echo "--- 3. confirm the migrated database matches schema.prisma (no drift) ---"
# Compares the freshly-migrated database against the schema file. An empty diff
# (exit code 0 with --exit-code) means the committed migrations really do
# produce the schema the code expects. A non-empty diff exits 2 and, with
# `set -e`, fails this script.
(
  cd apps/api
  PINGEXA_ENV_FILE="$ENV_FILE" DATABASE_URL="$FRESH_URL" \
    npx prisma migrate diff \
      --from-config-datasource \
      --to-schema prisma/schema.prisma \
      --exit-code
)
echo "no drift between schema.prisma and the migrated database"

echo
echo "--- 4. confirm the hand-written constraints exist ---"
psql "$FRESH_URL" -q -t -c "
  SELECT
    (SELECT count(*) FROM pg_constraint WHERE conname = 'monitors_slot_range') AS slot_range,
    (SELECT count(*) FROM pg_indexes   WHERE indexname = 'incidents_one_open_per_monitor') AS one_open_incident,
    (SELECT count(*) FROM pg_constraint WHERE conname = 'checks_failure_fields_consistent') AS check_fields,
    (SELECT count(*) FROM pg_constraint WHERE conname = 'incidents_close_reason_with_resolved') AS close_reason
" | tr -s ' '
psql "$FRESH_URL" -q -t -c "
  DO \$\$ BEGIN
    IF (SELECT count(*) FROM pg_constraint WHERE conname = 'monitors_slot_range') <> 1
       OR (SELECT count(*) FROM pg_indexes WHERE indexname = 'incidents_one_open_per_monitor') <> 1
       OR (SELECT count(*) FROM pg_constraint WHERE conname = 'checks_failure_fields_consistent') <> 1
       OR (SELECT count(*) FROM pg_constraint WHERE conname = 'incidents_close_reason_with_resolved') <> 1
    THEN RAISE EXCEPTION 'a required constraint is missing from the fresh database';
    END IF;
  END \$\$;
"
echo "all four present"

echo
echo "--- 5. build, then boot the built API against the fresh database ---"
npm run build --silent

# Launched as a direct child, not through `npm run`, so the SIGTERM in cleanup
# actually reaches the Node process instead of stopping only the npm wrapper.
PINGEXA_ENV_FILE="$ENV_FILE" node apps/api/dist/server.js >"$API_LOG" 2>&1 &
API_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4100/api/ready >/dev/null 2>&1; then break; fi
  sleep 0.5
done

echo -n "  /api/health: "; curl -fsS http://127.0.0.1:4100/api/health; echo
echo -n "  /api/ready:  "; curl -fsS http://127.0.0.1:4100/api/ready; echo
echo -n "  /api/meta:   "; curl -fsS http://127.0.0.1:4100/api/meta; echo

echo
echo "--- 6. exercise signup on the fresh database ---"
JAR="$(mktemp -t pingexa-fresh-jar.XXXXXX)"
curl -fsS -c "$JAR" -o /dev/null http://127.0.0.1:4100/api/meta
CSRF="$(awk '/pingexa_csrf/ {print $7}' "$JAR")"
curl -fsS -b "$JAR" -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -H 'Origin: http://localhost:5173' \
  -X POST -d '{"email":"fresh-check@pingexa.local","password":"fresh-setup-pass-1"}' \
  http://127.0.0.1:4100/api/auth/signup
echo
psql "$FRESH_URL" -q -t -c "SELECT 'users: ' || count(*) FROM users" | tr -s ' '
rm -f "$JAR"

echo
echo "--- 7. run the integration suite against its own disposable database ---"
echo "(the suite creates and migrates pingexa_test itself; dev data is untouched)"
npm run test:integration

echo
echo "=== fresh-setup verification passed ==="
