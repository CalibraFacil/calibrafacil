#!/bin/sh
# Writes deploy/.env for compose.yaml: a copy of .env.example with every secret
# filled in with fresh random values.
#
#   ./setup.sh           for a server: then edit .env (addresses, e-mail)
#   ./setup.sh --local   to try it on this computer: http://*.localhost
#                        addresses and a test inbox at http://localhost:8025
#
# An existing .env is never overwritten.
set -eu
cd "$(dirname "$0")"

if [ -e .env ]; then
  echo "deploy/.env already exists; leaving it alone (delete it to start over)." >&2
  exit 1
fi

random() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }
token() { random "$1" | tr '+/' '-_' | tr -d '='; }

# set KEY VALUE: replace the KEY= line, or append it when missing.
set_value() {
  if grep -q "^$1=" .env.tmp; then
    awk -v key="$1" -v value="$2" '
      index($0, key "=") == 1 && !done { print key "=" value; done = 1; next }
      { print }
    ' .env.tmp > .env.next
    mv .env.next .env.tmp
  else
    printf '%s=%s\n' "$1" "$2" >> .env.tmp
  fi
}

umask 077
cp .env.example .env.tmp

set_value POSTGRES_PASSWORD "$(token 24)"
set_value S3_SECRET_KEY "$(token 24)"
set_value BETTER_AUTH_SECRET "$(token 48)"
set_value CRON_SECRET "$(token 32)"
set_value QUOTE_APPROVAL_CODE_PEPPER "$(token 32)"
set_value SIGNING_MASTER_KEY "$(random 32)"
set_value INTEGRATIONS_MASTER_KEY "$(random 32)"
set_value PUBLIC_API_MASTER_KEY "$(random 32)"
set_value EMAIL_DOMAIN_MASTER_KEY "$(random 32)"

if [ "${1:-}" = "--local" ]; then
  set_value APP_URL http://app.localhost
  set_value PORTAL_URL http://portal.localhost
  set_value FILES_URL http://files.localhost
  set_value EMAIL_FROM '"Calibra Fácil <calibra@example.com>"'
  set_value SMTP_HOST mailpit
  set_value SMTP_PORT 1025
  set_value COMPOSE_PROFILES mailpit
fi

mv .env.tmp .env
echo "Wrote deploy/.env with new secrets. Keep a backup of it somewhere safe."
echo
if [ "${1:-}" = "--local" ]; then
  cat <<'NEXT'
Next:
  docker compose up -d        (or add -f compose.yaml -f compose.build.yaml --build
                               to build the images from this checkout)
  docker compose exec api bun src/cli/create-lab.ts --name "Meu Laboratório" --email voce@example.com

Then open the printed link (http://app.localhost/…). E-mails: http://localhost:8025
NEXT
else
  cat <<'NEXT'
Next:
  1. Edit deploy/.env: APP_URL, PORTAL_URL, FILES_URL, EMAIL_FROM and SMTP_*.
  2. Point those three DNS names at this machine; open ports 80 and 443.
  3. docker compose up -d
  4. docker compose exec api bun src/cli/create-lab.ts --name "Meu Laboratório" --email voce@example.com
NEXT
fi
