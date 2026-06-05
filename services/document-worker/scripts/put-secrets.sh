#!/usr/bin/env bash
#
# put-secrets.sh — set the document-worker container's runtime secrets on
# Cloudflare (and the shared drain token on both Cloudflare and Vercel) from a
# PRODUCTION env source (e.g. a `vercel env pull` file). Values are piped
# straight into the CLIs and are NEVER printed to the console.
#
#   ⚠️  The source MUST be PRODUCTION — the same values the Vercel queue
#       function runs with today (prod Neon DATABASE_URL, prod R2 keys, prod
#       SIGNING/INTEGRATIONS master keys, the real GOTENBERG_URL + GOTENBERG_TOKEN).
#       The repo's local .env is the DEV config and is missing GOTENBERG_* — using
#       it would point the production container at the dev database.
#
#   Recommended:
#       cd apps/api && vercel env pull ../../.secrets.prod --environment=production && cd ../..
#       bash services/document-worker/scripts/put-secrets.sh .secrets.prod
#       rm -f .secrets.prod
#
# IMPORTANT: the file is parsed LITERALLY — it is never `source`d. A
# `vercel env pull` file contains values such as VERCEL_GIT_COMMIT_MESSAGE with
# backticks / $(...) / quotes / newlines that would execute (and break the
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
# Handles `KEY="value"` (double-quoted, with \" \\ \n escapes — the vercel
# format) and `KEY=value` (unquoted). Single physical line; the container's
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

echo "Container secrets → Cloudflare (calibrafacil-document-worker):"
for n in DATABASE_URL R2_ACCOUNT_ID R2_BUCKET_NAME R2_MEDIA_BUCKET_NAME \
  R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY GOTENBERG_URL GOTENBERG_TOKEN \
  SIGNING_MASTER_KEY INTEGRATIONS_MASTER_KEY RESEND_API_KEY \
  RESEND_FROM_EMAIL EMAIL_FROM EMAIL_LOGO_URL WEB_URL APP_URL; do
  wput "$n"
done

# Shared drain token: (re)generate, set on the container AND the API (prod),
# stash a copy in the gitignored .dev.vars. rm-then-add keeps re-runs idempotent
# and the two sides in lock-step.
echo "Shared drain token (DOCUMENT_WORKER_TOKEN):"
TOKEN="$(openssl rand -hex 32)"
printf 'DOCUMENT_WORKER_TOKEN=%s\n' "$TOKEN" >"$DW/.dev.vars"
if printf '%s' "$TOKEN" | (cd "$DW" && pnpm exec wrangler secret put DOCUMENT_WORKER_TOKEN) >/dev/null 2>&1; then
  echo "  container: set"
else
  echo "  container: FAILED"
fi
(cd "$ROOT/apps/api" && vercel env rm DOCUMENT_WORKER_TOKEN production --yes) >/dev/null 2>&1 || true
if printf '%s' "$TOKEN" | (cd "$ROOT/apps/api" && vercel env add DOCUMENT_WORKER_TOKEN production) >/dev/null 2>&1; then
  echo "  API (Vercel prod): set"
else
  echo "  API (Vercel prod): FAILED — token is in services/document-worker/.dev.vars"
fi
unset TOKEN

echo
echo "Done. Next: 'wrangler deploy' (or let Claude), then set the non-secret"
echo "DOCUMENT_WORKER_URL + DOCUMENT_WORKER_JOB_TYPES on the API."
