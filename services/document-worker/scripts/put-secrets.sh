#!/usr/bin/env bash
#
# put-secrets.sh — set the document-worker container's runtime secrets on
# Cloudflare (and the shared drain token on both Cloudflare and Vercel) from a
# PRODUCTION env source. Values are piped straight into the CLIs and are NEVER
# printed to the console.
#
#   ⚠️  The source MUST be PRODUCTION — the same values the Vercel queue
#       function runs with today (prod Neon DATABASE_URL, prod R2 keys, prod
#       SIGNING/INTEGRATIONS master keys, the real GOTENBERG_URL + GOTENBERG_TOKEN).
#       The repo's local .env is the DEV config and is missing GOTENBERG_* — using
#       it would point the production container at the dev database.
#
#   Recommended: pull the API project's production env from Vercel, run this,
#   then delete the file:
#       cd apps/api && vercel env pull ../../.secrets.prod --environment=production && cd ../..
#       bash services/document-worker/scripts/put-secrets.sh .secrets.prod
#       rm -f .secrets.prod
#
set -euo pipefail

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "Usage: bash services/document-worker/scripts/put-secrets.sh <production-env-file>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DW="$ROOT/services/document-worker"

# Load the source into this script's env WITHOUT echoing anything.
set -a
# shellcheck disable=SC1090
. "$SRC"
set +a

wput() { # wput NAME : pipe $NAME into `wrangler secret put NAME`, never echoed
  local name="$1" val="${!1:-}"
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

# Shared drain token: generate once, set on the container AND the API (prod),
# and stash a copy in the gitignored .dev.vars so it is recoverable without
# ever hitting the console.
echo "Shared drain token (DOCUMENT_WORKER_TOKEN):"
TOKEN="$(openssl rand -hex 32)"
printf 'DOCUMENT_WORKER_TOKEN=%s\n' "$TOKEN" >"$DW/.dev.vars"
if printf '%s' "$TOKEN" | (cd "$DW" && pnpm exec wrangler secret put DOCUMENT_WORKER_TOKEN) >/dev/null 2>&1; then
  echo "  container: set"
else
  echo "  container: FAILED"
fi
if printf '%s' "$TOKEN" | (cd "$ROOT/apps/api" && vercel env add DOCUMENT_WORKER_TOKEN production) >/dev/null 2>&1; then
  echo "  API (Vercel prod): set"
else
  echo "  API (Vercel prod): FAILED — apps/api may not be linked. The token is in"
  echo "    services/document-worker/.dev.vars; set it on the API with:"
  echo "    cd apps/api && vercel link && printf '%s' \"\$(grep -oP '(?<==).*' ../services/document-worker/.dev.vars)\" | vercel env add DOCUMENT_WORKER_TOKEN production"
fi
unset TOKEN

echo
echo "Done. Next: 'wrangler deploy' (or let Claude), then set the non-secret"
echo "DOCUMENT_WORKER_URL + DOCUMENT_WORKER_JOB_TYPES on the API."
