#!/bin/sh
# Restore drill: prove that a backup taken by the `backup` service can be restored.
# Run by .github/workflows/restore-drill.yml, and by hand against any disposable
# PostgreSQL:
#
#   deploy/backup/drill.sh postgres://calibra:calibra@localhost:5432/calibra
#
# The argument is the owner's URL of a database that already has the schema and
# some data (pnpm --dir packages/db db:bootstrap, then create-lab). The script
#
#   1. records the exact row count of every table of the source,
#   2. takes a backup with the real backup image (deploy/backup/Dockerfile) and again
#      encrypted with age (when the age binary is installed),
#   3. restores each dump with deploy/restore.sh into a NEW database on the same
#      server, which also runs the migrations and verify-audit-chain, and requires
#      the row counts to be identical to step 1,
#   4. checks the refusals: no overwrite of a non-empty database without --force,
#      a damaged dump leaves the target untouched, --force overwrites.
#
# Needs on PATH: docker, psql and pg_restore (the server's major version or newer),
# pnpm and bun (for the migration and audit-chain checks of restore.sh), and age for
# the encrypted leg. The temporary databases are dropped at the end.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
deploy=$(cd "$here/.." && pwd)

source_url=${1:?usage: drill.sh SOURCE_DATABASE_URL}
base_url=${source_url%/*}
admin_url="$base_url/postgres"
work=$(mktemp -d)
image=${BACKUP_IMAGE:-calibrafacil-backup:drill}
# The container writes as this user so the runner can read the dump (rootless
# Docker maps root to the invoking user: set DRILL_DOCKER_USER=0:0 there).
docker_user=${DRILL_DOCKER_USER:-$(id -u):$(id -g)}

step() { printf '\n##### %s\n' "$*"; }
fail() {
  printf 'DRILL FAILED: %s\n' "$*" >&2
  exit 1
}

drop_databases() {
  for name in calibra_drill calibra_drill_enc calibra_drill_bad; do
    psql "$admin_url" -X -q -c "drop database if exists $name" > /dev/null 2>&1 || true
  done
}
cleanup() {
  drop_databases
  rm -rf "$work"
}
trap cleanup EXIT
drop_databases

step "1. Counting the rows of the source"
psql "$source_url" -X -qAt -f "$here/row-counts.sql" > "$work/source.counts"
tables=$(wc -l < "$work/source.counts" | tr -d ' ')
rows=$(awk -F'|' '{ total += $2 } END { print total + 0 }' "$work/source.counts")
echo "source: $tables tables, $rows rows"
[ "$rows" -gt 0 ] || fail "the source database is empty: seed it first"

step "2. Taking the backups with the backup image"
if [ -z "${BACKUP_IMAGE:-}" ]; then docker build -q -t "$image" "$here" > /dev/null; fi
mkdir -p "$work/backups"
chmod 777 "$work/backups"

backup() { # backup [ENV=VALUE...]
  docker run --rm --network host --user "$docker_user" \
    -v "$work/backups:/backups" \
    -e DATABASE_OWNER_URL="$source_url" -e BACKUP_FILES=false -e BACKUP_KEEP_MIN=1 \
    "$@" "$image" once
}
backup
plain=$(ls "$work"/backups/dumps/calibra-*.dump)
[ -s "$plain" ] || fail "no plain dump was written"
[ -s "$plain.sha256" ] || fail "the dump has no checksum file"

encrypted=
if command -v age > /dev/null && command -v age-keygen > /dev/null; then
  age-keygen -o "$work/identity.txt" 2> /dev/null
  recipient=$(age-keygen -y "$work/identity.txt")
  sleep 1 # the dump name carries the time to the second
  backup -e BACKUP_AGE_RECIPIENT="$recipient"
  encrypted=$(ls "$work"/backups/dumps/calibra-*.dump.age)
  [ -s "$encrypted" ] || fail "no encrypted dump was written"
  if grep -q PGDMP "$encrypted"; then fail "the encrypted dump contains plaintext"; fi
else
  echo "age is not installed: skipping the encrypted leg"
fi

restore() { # restore DATABASE [restore.sh arguments...]
  database=$1
  shift
  "$deploy/restore.sh" --target-url "$base_url/$database" "$@"
}

step "3. Restoring the plain dump into a new database (migrations, audit chains, row counts)"
psql "$admin_url" -X -q -c "create database calibra_drill"
restore calibra_drill --expect-counts "$work/source.counts" "$plain"

if [ -n "$encrypted" ]; then
  step "3b. Restoring the encrypted dump"
  psql "$admin_url" -X -q -c "create database calibra_drill_enc"
  restore calibra_drill_enc --identity "$work/identity.txt" \
    --expect-counts "$work/source.counts" "$encrypted"
fi

step "4a. A non-empty database is refused without --force"
status=0
restore calibra_drill --no-migrate --no-audit "$plain" > "$work/refusal.log" 2>&1 || status=$?
cat "$work/refusal.log"
[ "$status" -eq 2 ] || fail "restoring over a non-empty database exited $status, expected 2"
grep -q "Refusing to overwrite" "$work/refusal.log" || fail "the refusal does not say so"

step "4b. A damaged dump is refused and leaves the target empty"
psql "$admin_url" -X -q -c "create database calibra_drill_bad"
size=$(wc -c < "$plain" | tr -d ' ')
# Cut inside the table of contents (not even listable) and half-way through the data
# (listable, so the restore starts and must roll back as one transaction).
for cut in 20000 $((size / 2)); do
  head -c "$cut" "$plain" > "$work/damaged.dump"
  status=0
  restore calibra_drill_bad --no-migrate --no-audit "$work/damaged.dump" > "$work/damaged.log" 2>&1 || status=$?
  cat "$work/damaged.log"
  [ "$status" -ne 0 ] || fail "a dump cut at $cut bytes was restored"
  left=$(psql "$base_url/calibra_drill_bad" -X -qAt -c "select count(*) from pg_tables where schemaname in ('public', 'drizzle')")
  [ "$left" -eq 0 ] || fail "the failed restore (cut at $cut bytes) left $left tables behind"
done

step "4c. A dump whose checksum does not match is refused"
cp "$plain" "$work/tampered.dump"
cp "$plain.sha256" "$work/tampered.dump.sha256"
sed -i "s/calibra-[0-9TZ]*\.dump/tampered.dump/" "$work/tampered.dump.sha256"
printf 'x' >> "$work/tampered.dump"
status=0
restore calibra_drill_bad --no-migrate --no-audit "$work/tampered.dump" > "$work/tampered.log" 2>&1 || status=$?
cat "$work/tampered.log"
[ "$status" -ne 0 ] || fail "a dump with a wrong checksum was restored"

step "4d. --force overwrites a non-empty database"
restore calibra_drill --force --no-migrate --no-audit --expect-counts "$work/source.counts" "$plain"

printf '\nRESTORE DRILL PASSED: %s tables, %s rows restored and verified.\n' "$tables" "$rows"
