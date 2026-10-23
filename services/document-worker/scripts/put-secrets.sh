#!/usr/bin/env bash
#
# put-secrets.sh — set the document-worker container's runtime secrets on
# Cloudflare from a PRODUCTION env file (the API's production environment).
# Values are piped straight into the CLIs and are NEVER printed to the console.
#
#   ⚠️  The source MUST be PRODUCTION — the same values the API's worker runs
#       with (prod DATABASE_URL, prod R2 keys, prod SIGNING/INTEGRATIONS master
#       keys, the real GOTENBERG_URL + GOTENBERG_TOKEN). The repo's local .env is
#       the DEV config and is missing GOTENBERG_* — using it would point the
#       production container at the dev database.
#
#   Usage:
#       bash services/document-worker/scripts/put-secrets.sh <production-env-file>
#
# IMPORTANT: the file is parsed LITERALLY — it is never `source`d, because a
# value with backticks / $(...) / quotes / newlines would execute (and break the
# parse of every later line) if the file were sourced. Re-running is safe.
set -euo pipefail

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "Usage: bash services/document-worker/scripts/put-secrets.sh <production-env-file>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DW="$ROOT/services/document-worker"

# Read one KEY's value from a dotenv file literally (no shell evaluation).
# Handles `KEY="value"` (double-quoted, with \" \\ \n escapes) and
# `KEY=value` (unquoted). Single physical line; the container's
# secrets are all single-line.
read_env() {
  local key="$1" line
  line="$(grep -m1 -E "^${key}=" "$SRC" || true)"
  [ -z "$line" ] && return 0
  line="${line#"${key}="}"
  if [ "${line#\"}" != "$line" ]; then
    line="${line%\"}"
    line="${line#\"}"
    line="${line//\\\"/\"}"
    line="${line//\\n/$'\n'}"
    line="${line//\\\\/\\}"
  fi
  printf '%s' "$line"
}

wput() { # wput NAME : pipe its value from $SRC into `wrangler secret put NAME`
  local name="$1" val
  val="$(read_env "$name")"
  if [ -z "$val" ]; then
    printf '  %-26s MISSING in source — skipped\n' "$name"
    return
  fi
  if printf '%s' "$val" | (cd "$DW" && pnpm exec wrangler secret put "$name") >/dev/null 2>&1; then
    printf '  %-26s set\n' "$name"
  else
    printf '  %-26s FAILED\n' "$name"
  fi
}

# R2_BUCKET_NAME / R2_MEDIA_BUCKET_NAME are NOT secrets — they live in
# wrangler.jsonc `vars` (a plaintext binding and a secret of the same name
# collide), so they are intentionally absent from this list.
echo "Container secrets → Cloudflare (calibrafacil-document-worker):"
for n in DATABASE_URL R2_ACCOUNT_ID \
  R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY GOTENBERG_URL GOTENBERG_TOKEN \
  SIGNING_MASTER_KEY INTEGRATIONS_MASTER_KEY RESEND_API_KEY \
  SIGNING_TSA_URL SIGNING_TSA_AUTH SIGNING_TSA_ICP_CONFORMANT SIGNING_TSA_TIMEOUT_MS \
  RESEND_FROM_EMAIL EMAIL_FROM EMAIL_LOGO_URL WEB_URL APP_URL; do
  wput "$n"
done

# Shared drain token: (re)generate, set on the container and stash a copy in the
# gitignored .dev.vars. Set the same value as DOCUMENT_WORKER_TOKEN on the API.
echo "Shared drain token (DOCUMENT_WORKER_TOKEN):"
TOKEN="$(openssl rand -hex 32)"
printf 'DOCUMENT_WORKER_TOKEN=%s\n' "$TOKEN" >"$DW/.dev.vars"
if printf '%s' "$TOKEN" | (cd "$DW" && pnpm exec wrangler secret put DOCUMENT_WORKER_TOKEN) >/dev/null 2>&1; then
  echo "  container: set (copy for the API is in services/document-worker/.dev.vars)"
else
  echo "  container: FAILED"
fi
unset TOKEN

echo
echo "Done. Next: 'wrangler deploy', then set DOCUMENT_WORKER_URL + DOCUMENT_WORKER_TOKEN"
echo "on the API (BACKGROUND_JOBS_MODE=queue)."
