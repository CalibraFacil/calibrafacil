#!/bin/sh
# The scheduled backup of the `backup` compose profile (see compose.yaml and
# docs/operations/backup-restore.md). One run:
#
#   1. pg_dump of the database, custom format, taken as the table owner so row-level
#      security does not hide rows. It is checked with `pg_restore --list` before it
#      counts, optionally encrypted with age, and given a sha256 sidecar.
#   2. A mirror of the object-store buckets (certificate PDFs and uploads) into
#      $BACKUP_DIR/files. The mirror only ever adds: an object deleted from the
#      store stays in the mirror. It runs AFTER the dump, so every object a row of
#      the dump points to is in the mirror (objects are never overwritten).
#   3. Optionally, a copy of both to an off-site S3-compatible bucket.
#   4. Retention: dumps older than BACKUP_RETENTION_DAYS go, but the newest
#      BACKUP_KEEP_MIN always stay.
#
# Usage (the container's command):
#   backup.sh loop            run daily at BACKUP_SCHEDULE (UTC), and once at start
#   backup.sh once            one run now, exit non-zero on failure
#   backup.sh list            the dumps on disk
#   backup.sh restore-files   copy the mirror back into the (empty) buckets
#
# Settings (environment; deploy/.env, mapped by compose.yaml):
#   DATABASE_OWNER_URL                        required
#   BACKUP_DIR                                default /backups
#   BACKUP_SCHEDULE                           HH:MM, UTC; default 02:30
#   BACKUP_ON_START                           default true
#   BACKUP_RETENTION_DAYS, BACKUP_KEEP_MIN    default 14 and 3
#   BACKUP_AGE_RECIPIENT                      age public key(s), comma-separated; empty = no encryption
#   BACKUP_FILES                              default true: mirror the buckets
#   R2_ENDPOINT or R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_REGION,
#   R2_BUCKET_NAME, R2_MEDIA_BUCKET_NAME      the object store (the same variables as the API)
#   BACKUP_OFFSITE_URI                        s3://bucket/prefix of an off-site copy; empty = none
#   BACKUP_OFFSITE_ENDPOINT, BACKUP_OFFSITE_ACCESS_KEY_ID,
#   BACKUP_OFFSITE_SECRET_ACCESS_KEY, BACKUP_OFFSITE_REGION
set -eu
umask 077

BACKUP_DIR=${BACKUP_DIR:-/backups}
DUMPS="$BACKUP_DIR/dumps"
FILES="$BACKUP_DIR/files"
SCHEDULE=${BACKUP_SCHEDULE:-02:30}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
KEEP_MIN=${BACKUP_KEEP_MIN:-3}

log() { printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

is_number() { case "$1" in '' | *[!0-9]*) return 1 ;; *) return 0 ;; esac; }

# ── Object store ────────────────────────────────────────────────────────────────

store_endpoint() {
  if [ -n "${R2_ENDPOINT:-}" ]; then
    printf '%s' "$R2_ENDPOINT"
  elif [ -n "${R2_ACCOUNT_ID:-}" ]; then
    printf 'https://%s.r2.cloudflarestorage.com' "$R2_ACCOUNT_ID"
  fi
}

# The object store of the application, with its credentials.
store_aws() {
  endpoint=$(store_endpoint)
  if [ -n "$endpoint" ]; then set -- --endpoint-url "$endpoint" "$@"; fi
  AWS_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID:-} \
    AWS_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY:-} \
    AWS_DEFAULT_REGION=${R2_REGION:-us-east-1} \
    AWS_EC2_METADATA_DISABLED=true \
    AWS_CONFIG_FILE=/tmp/aws-config \
    aws "$@"
}

# The off-site bucket, with its own credentials.
offsite_aws() {
  if [ -n "${BACKUP_OFFSITE_ENDPOINT:-}" ]; then
    set -- --endpoint-url "$BACKUP_OFFSITE_ENDPOINT" "$@"
  fi
  AWS_ACCESS_KEY_ID=${BACKUP_OFFSITE_ACCESS_KEY_ID:-} \
    AWS_SECRET_ACCESS_KEY=${BACKUP_OFFSITE_SECRET_ACCESS_KEY:-} \
    AWS_DEFAULT_REGION=${BACKUP_OFFSITE_REGION:-us-east-1} \
    AWS_EC2_METADATA_DISABLED=true \
    AWS_CONFIG_FILE=/tmp/aws-config \
    aws "$@"
}

buckets() {
  for name in "${R2_BUCKET_NAME:-}" "${R2_MEDIA_BUCKET_NAME:-}"; do
    [ -n "$name" ] && printf '%s\n' "$name"
  done
  return 0
}

# Path-style addressing: the bundled gateway, MinIO and R2 all accept it.
printf '[default]\ns3 =\n    addressing_style = path\n' > /tmp/aws-config

# ── One run ─────────────────────────────────────────────────────────────────────

dump_database() {
  [ -n "${DATABASE_OWNER_URL:-}" ] || {
    log "ERROR: DATABASE_OWNER_URL is not set"
    return 1
  }
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  partial="$DUMPS/.partial-$stamp"
  name="calibra-$stamp.dump"

  log "dumping the database"
  if ! pg_dump --format=custom --compress=6 --file="$partial" \
    --dbname="$DATABASE_OWNER_URL"; then
    rm -f "$partial"
    log "ERROR: pg_dump failed"
    return 1
  fi
  # A dump that cannot be listed cannot be restored: do not keep it.
  if ! pg_restore --list "$partial" > /dev/null || [ ! -s "$partial" ]; then
    rm -f "$partial"
    log "ERROR: the dump is not a readable archive"
    return 1
  fi

  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    name="$name.age"
    set --
    old_ifs=$IFS
    IFS=','
    for recipient in $BACKUP_AGE_RECIPIENT; do
      set -- "$@" -r "$(printf '%s' "$recipient" | tr -d ' ')"
    done
    IFS=$old_ifs
    if ! age "$@" -o "$DUMPS/$name" "$partial"; then
      rm -f "$partial" "$DUMPS/$name"
      log "ERROR: age could not encrypt the dump (check BACKUP_AGE_RECIPIENT)"
      return 1
    fi
    rm -f "$partial"
  else
    mv "$partial" "$DUMPS/$name"
  fi

  (cd "$DUMPS" && sha256sum "$name" > "$name.sha256")
  ln -sf "$name" "$DUMPS/latest"
  size=$(wc -c < "$DUMPS/$name" | tr -d ' ')
  log "dump written: dumps/$name ($size bytes)"
  touch "$BACKUP_DIR/.last-dump"
}

mirror_files() {
  [ "${BACKUP_FILES:-true}" = true ] || {
    log "object-store mirror is off (BACKUP_FILES)"
    return 0
  }
  if [ -z "$(store_endpoint)" ] || [ -z "$(buckets)" ]; then
    log "ERROR: BACKUP_FILES is on but R2_ENDPOINT (or R2_ACCOUNT_ID) and the bucket names are not set"
    return 1
  fi
  for bucket in $(buckets); do
    log "mirroring bucket $bucket"
    mkdir -p "$FILES/$bucket"
    store_aws s3 sync "s3://$bucket" "$FILES/$bucket" --only-show-errors || {
      log "ERROR: could not mirror bucket $bucket"
      return 1
    }
  done
}

offsite_copy() {
  [ -n "${BACKUP_OFFSITE_URI:-}" ] || return 0
  base=${BACKUP_OFFSITE_URI%/}
  log "copying to $base"
  offsite_aws s3 sync "$DUMPS" "$base/dumps" --only-show-errors \
    --exclude '.partial-*' --exclude latest || {
    log "ERROR: off-site copy of the dumps failed"
    return 1
  }
  if [ -d "$FILES" ]; then
    offsite_aws s3 sync "$FILES" "$base/files" --only-show-errors || {
      log "ERROR: off-site copy of the files failed"
      return 1
    }
  fi
}

prune() {
  index=0
  for entry in $(ls -1 "$DUMPS" | grep -E '^calibra-[0-9]{8}T[0-9]{6}Z\.dump(\.age)?$' | sort -r); do
    index=$((index + 1))
    [ "$index" -le "$KEEP_MIN" ] && continue
    if [ -n "$(find "$DUMPS/$entry" -mmin "+$((RETENTION_DAYS * 1440))" 2> /dev/null)" ]; then
      rm -f "$DUMPS/$entry" "$DUMPS/$entry.sha256"
      log "retention: removed dumps/$entry"
    fi
  done
  # A partial file left by a killed run.
  find "$DUMPS" -name '.partial-*' -mmin +1440 -exec rm -f {} + 2> /dev/null || true
}

run_once() {
  is_number "$RETENTION_DAYS" && is_number "$KEEP_MIN" || {
    log "ERROR: BACKUP_RETENTION_DAYS and BACKUP_KEEP_MIN must be whole numbers"
    return 1
  }
  mkdir -p "$DUMPS" "$FILES"
  dump_database || return 1
  # Order matters: the mirror comes after the dump (see the header).
  mirror_files || return 1
  offsite_copy || return 1
  prune
  touch "$BACKUP_DIR/.last-success"
  log "backup finished"
}

# ── Schedule ────────────────────────────────────────────────────────────────────

seconds_until() {
  hour=$(expr "${1%%:*}" + 0)
  minute=$(expr "${1#*:}" + 0)
  target=$((hour * 3600 + minute * 60))
  second_of_day=$(($(date -u +%s) % 86400))
  wait_for=$((target - second_of_day))
  [ "$wait_for" -le 0 ] && wait_for=$((wait_for + 86400))
  printf '%s' "$wait_for"
}

# sleep in the background and wait on it, so SIGTERM ends the container at once.
pause() {
  sleep "$1" &
  wait $!
}

loop() {
  case "$SCHEDULE" in
    [0-2][0-9]:[0-5][0-9]) ;;
    *)
      log "ERROR: BACKUP_SCHEDULE must be HH:MM (UTC), got '$SCHEDULE'"
      exit 1
      ;;
  esac
  trap 'log "stopping"; exit 0' TERM INT
  log "scheduled daily at $SCHEDULE UTC; keeping $RETENTION_DAYS days (at least $KEEP_MIN dumps)"
  if [ "${BACKUP_ON_START:-true}" = true ]; then
    pause 30
    run_once || log "the backup failed; the next attempt is at $SCHEDULE"
  fi
  while :; do
    seconds=$(seconds_until "$SCHEDULE")
    log "next backup in ${seconds}s"
    pause "$seconds"
    run_once || log "the backup failed; the next attempt is at $SCHEDULE"
  done
}

# ── Commands ────────────────────────────────────────────────────────────────────

case "${1:-loop}" in
  loop) loop ;;
  once) run_once ;;
  list)
    ls -l "$DUMPS" 2> /dev/null || echo "no dumps yet in $DUMPS"
    ;;
  restore-files)
    [ -d "$FILES" ] || {
      log "ERROR: no mirror in $FILES"
      exit 1
    }
    for bucket in $(buckets); do
      [ -d "$FILES/$bucket" ] || {
        log "skipping $bucket: no mirror"
        continue
      }
      log "restoring bucket $bucket"
      store_aws s3 sync "$FILES/$bucket" "s3://$bucket" --only-show-errors
    done
    log "files restored"
    ;;
  *)
    echo "Usage: backup.sh [loop|once|list|restore-files]" >&2
    exit 2
    ;;
esac
