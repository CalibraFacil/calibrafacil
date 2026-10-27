#!/bin/sh
# Restore a database dump made by the `backup` profile (or by pg_dump -Fc) into a
# FRESH database, then check the result. See docs/operations/backup-restore.md.
#
#   ./restore.sh [options] DUMP
#
#   DUMP                    a dump file: calibra-<time>.dump, or the .dump.age that
#                           BACKUP_AGE_RECIPIENT produces, or `backups/dumps/latest`.
#
#   --force                 overwrite a database that already has tables (its public
#                           and drizzle schemas are dropped first). Without it the
#                           script refuses and touches nothing.
#   --identity FILE         the age identity (private key) for a .age dump
#                           (default: $BACKUP_AGE_IDENTITY_FILE).
#   --target-url URL        restore into the database at URL, with the psql and
#                           pg_restore on PATH (the owner's connection URL; the
#                           client major must be at least the server's). Default
#                           ($RESTORE_DATABASE_URL, else the compose mode below).
#   --migrate-cmd CMD       run after the restore to prove the schema is current
#                           (default: `pnpm db:migrate` of this checkout).
#   --no-migrate            skip it.
#   --audit-cmd CMD         run to verify the audit-trail hash chains (default:
#                           `pnpm --dir apps/api verify-audit-chain`).
#   --no-audit              skip it.
#   --expect-counts FILE    compare the restored row counts with FILE (lines of
#                           `schema.table|count`, as backup/row-counts.sql prints them).
#   --counts-out FILE       also write the restored row counts to FILE.
#
# Two ways to reach the database:
#
#   Compose mode (no --target-url, run from deploy/ next to compose.yaml): the work
#   is done in the `postgres` service, the API and worker must be stopped, and the
#   follow-up checks run as `docker compose run --rm init` (applies pending
#   migrations, like `pnpm db:migrate`) and the API image's verify-audit-chain.
#
#   Direct mode (--target-url): for a managed PostgreSQL, another host, or the CI
#   drill. CMD runs with DATABASE_URL and DATABASE_OWNER_URL set to the target.
#
# Exit status: 0 restored and every check passed; 1 a step or check failed;
# 2 usage error, or a refusal (non-empty database without --force).
set -eu
umask 077

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)

usage() { sed -n '2,/^set -eu/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }
say() { printf '==> %s\n' "$*"; }
fail() {
  printf 'restore: %s\n' "$*" >&2
  exit 1
}
refuse() {
  printf 'restore: %s\n' "$*" >&2
  exit 2
}

force=false
identity=${BACKUP_AGE_IDENTITY_FILE:-}
target_url=${RESTORE_DATABASE_URL:-}
migrate=true
migrate_cmd=
audit=true
audit_cmd=
expect_counts=
counts_out=
dump=

while [ $# -gt 0 ]; do
  case "$1" in
    --force) force=true ;;
    --identity) identity=${2:?--identity needs a file}; shift ;;
    --target-url) target_url=${2:?--target-url needs a URL}; shift ;;
    --migrate-cmd) migrate_cmd=${2:?--migrate-cmd needs a command}; shift ;;
    --no-migrate) migrate=false ;;
    --audit-cmd) audit_cmd=${2:?--audit-cmd needs a command}; shift ;;
    --no-audit) audit=false ;;
    --expect-counts) expect_counts=${2:?--expect-counts needs a file}; shift ;;
    --counts-out) counts_out=${2:?--counts-out needs a file}; shift ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) refuse "unknown option $1 (see --help)" ;;
    *)
      [ -z "$dump" ] || refuse "only one dump file can be restored"
      dump=$1
      ;;
  esac
  shift
done

[ -n "$dump" ] || refuse "name the dump file to restore (see --help)"
[ -f "$dump" ] || refuse "$dump does not exist"
dump=$(readlink -f "$dump")

mode=direct
if [ -z "$target_url" ]; then
  mode=compose
  [ -f "$here/compose.yaml" ] || refuse "no --target-url given and no compose.yaml next to this script"
  command -v docker > /dev/null || refuse "docker is not installed (or use --target-url)"
fi

# ── Reaching the database ───────────────────────────────────────────────────────

if [ "$mode" = compose ]; then
  cd "$here"
  psql_run() { docker compose exec -T postgres psql -U calibra -d calibra -X -q -v ON_ERROR_STOP=1 "$@"; }
  restore_run() { docker compose exec -T postgres pg_restore -U calibra -d calibra "$@"; }
  list_run() { docker compose exec -T postgres pg_restore --list; }
else
  command -v psql > /dev/null || refuse "psql is not on PATH"
  command -v pg_restore > /dev/null || refuse "pg_restore is not on PATH"
  psql_run() { psql "$target_url" -X -q -v ON_ERROR_STOP=1 "$@"; }
  restore_run() { pg_restore --dbname="$target_url" "$@"; }
  list_run() { pg_restore --list; }
fi

dump_stream() {
  case "$dump" in
    *.age)
      [ -n "$identity" ] || refuse "$dump is encrypted: pass --identity FILE (the age private key)"
      [ -f "$identity" ] || refuse "identity file $identity does not exist"
      command -v age > /dev/null || refuse "age is not installed (needed for an encrypted dump)"
      age -d -i "$identity" "$dump"
      ;;
    *) cat "$dump" ;;
  esac
}

scalar() { psql_run -At -c "$1"; }

# ── 1. The dump ─────────────────────────────────────────────────────────────────

say "checking the dump: $dump"
if [ -f "$dump.sha256" ]; then
  if command -v sha256sum > /dev/null; then
    (cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256" > /dev/null) \
      || fail "the checksum of $dump does not match its .sha256 file: the file is damaged"
  else
    (cd "$(dirname "$dump")" && shasum -a 256 -c "$(basename "$dump").sha256" > /dev/null) \
      || fail "the checksum of $dump does not match its .sha256 file: the file is damaged"
  fi
  echo "    sha256 matches"
else
  echo "    no .sha256 file next to it; skipping the checksum"
fi

if [ "$mode" = compose ]; then
  say "starting the postgres service"
  docker compose up -d --wait postgres > /dev/null
  running=$(docker compose ps --status running --services 2> /dev/null || true)
  for service in api worker; do
    case "
$running
" in
      *"
$service
"*) refuse "the $service service is running: stop it first (docker compose stop api worker)" ;;
    esac
  done
fi

entries=$(dump_stream | list_run | grep -c ' TABLE DATA ' || true)
[ "${entries:-0}" -gt 0 ] || fail "$dump is not a readable pg_dump archive with table data (wrong file, or wrong identity?)"
echo "    readable archive: $entries tables with data"

# ── 2. The target must be fresh ─────────────────────────────────────────────────

say "checking the target database"
existing=$(scalar "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'drizzle') and c.relkind in ('r', 'p')")
if [ "$existing" -gt 0 ]; then
  if [ "$force" != true ]; then
    refuse "the target database already has $existing tables. Refusing to overwrite it. Restore into an empty database, or pass --force to drop its public and drizzle schemas first."
  fi
  say "--force: dropping the public and drizzle schemas ($existing tables)"
  psql_run -c "set client_min_messages = warning; drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public; grant usage on schema public to public;"
else
  echo "    empty: nothing to overwrite"
fi

# ── 3. Restore ──────────────────────────────────────────────────────────────────

# The dump's grants name this role (global objects are not in a pg_dump).
psql_run -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'calibra_app') then create role calibra_app nologin; end if; end \$\$"

say "restoring (one transaction: all or nothing)"
dump_stream | restore_run --no-owner --exit-on-error --single-transaction \
  || fail "pg_restore failed; the database was left as it was (single transaction)"

# ── 4. Verify ───────────────────────────────────────────────────────────────────

say "verifying the restored database"
counts=$(mktemp)
trap 'rm -f "$counts"' EXIT
psql_run -At -f - < "$here/backup/row-counts.sql" > "$counts" || fail "could not count the restored rows"

tables=$(wc -l < "$counts" | tr -d ' ')
rows=$(awk -F'|' '{ total += $2 } END { print total + 0 }' "$counts")
[ "$tables" -gt 0 ] || fail "the restored database has no tables"
[ "$rows" -gt 0 ] || fail "the restored database has tables but no rows"
echo "    $tables tables, $rows rows"
[ -z "$counts_out" ] || cp "$counts" "$counts_out"

applied=$(scalar "select count(*) from drizzle.__drizzle_migrations" 2> /dev/null || echo 0)
[ "$applied" -gt 0 ] || fail "drizzle.__drizzle_migrations is empty or missing: the dump is not a Calibra Fácil database"
echo "    $applied migrations recorded"

policies=$(scalar "select count(*) from pg_policies where schemaname = 'public'")
grants=$(scalar "select count(*) from information_schema.role_table_grants where grantee = 'calibra_app'")
[ "$policies" -gt 0 ] || fail "no row-level-security policies were restored"
[ "$grants" -gt 0 ] || fail "calibra_app has no table privileges after the restore (the grants were lost)"
echo "    $policies row-level-security policies, $grants table privileges for calibra_app"

if [ -n "$expect_counts" ]; then
  [ -f "$expect_counts" ] || refuse "$expect_counts does not exist"
  if diff "$expect_counts" "$counts" > /dev/null; then
    echo "    row counts equal the expected ones ($expect_counts)"
  else
    diff "$expect_counts" "$counts" || true
    fail "the restored row counts differ from $expect_counts"
  fi
fi

# ── 5. Is it current? Is the audit trail intact? ────────────────────────────────

# Runs CMD with the target as DATABASE_URL and DATABASE_OWNER_URL (direct mode).
run_with_target() {
  DATABASE_URL=$target_url DATABASE_OWNER_URL=$target_url sh -c "$1"
}

if [ "$migrate" = true ]; then
  say "applying pending migrations (proves the schema is current)"
  if [ -n "$migrate_cmd" ]; then
    run_with_target "$migrate_cmd" || fail "the migrate command failed"
  elif [ "$mode" = compose ]; then
    docker compose run --rm init || fail "init (migrations) failed"
  elif [ -f "$root/packages/db/package.json" ] && command -v pnpm > /dev/null; then
    run_with_target "pnpm --dir '$root/packages/db' db:migrate" || fail "pnpm db:migrate failed"
  else
    fail "no way to run the migrations here: pass --migrate-cmd, or --no-migrate to skip"
  fi
fi

if [ "$audit" = true ]; then
  say "verifying the audit-trail hash chains"
  if [ -n "$audit_cmd" ]; then
    run_with_target "$audit_cmd" || fail "the audit-chain verification failed or found a break"
  elif [ "$mode" = compose ]; then
    docker compose run --rm --no-deps api bun src/cli/verify-audit-chain.ts \
      || fail "verify-audit-chain failed or found a break"
  elif [ -f "$root/apps/api/package.json" ] && command -v pnpm > /dev/null && command -v bun > /dev/null; then
    run_with_target "pnpm --dir '$root/apps/api' verify-audit-chain" \
      || fail "verify-audit-chain failed or found a break"
  else
    fail "no way to run verify-audit-chain here: pass --audit-cmd, or --no-audit to skip"
  fi
fi

say "restored and verified"
if [ "$mode" = compose ]; then
  cat << 'NEXT'

Next:
  1. docker compose --profile backup run --rm backup restore-files   # the stored files (certificate PDFs)
  2. docker compose up -d
  3. Open the app and check a recent certificate downloads.
NEXT
fi
