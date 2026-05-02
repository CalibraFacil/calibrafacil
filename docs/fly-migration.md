# Fly.io migration runbook

## Apps

Create the Fly apps in `gru` before the first deploy:

```bash
flyctl apps create calibra-facil-api --org calibrafacil
flyctl apps create calibra-facil-worker --org calibrafacil
flyctl apps create calibra-facil-web --org calibrafacil
flyctl apps create calibra-facil-portal --org calibrafacil
```

The dashboard currently shows the Fly organization slug as `calibrafacil`.
Docs stay on Cloudflare Pages.

## Secrets

Set shared production secrets on `calibra-facil-api` and `calibra-facil-worker`:

```bash
flyctl secrets set -a calibra-facil-api \
  DATABASE_URL="..." \
  BETTER_AUTH_SECRET="..." \
  RESEND_API_KEY="..." \
  R2_ACCOUNT_ID="..." \
  R2_ACCESS_KEY_ID="..." \
  R2_SECRET_ACCESS_KEY="..." \
  ASAAS_API_KEY="..." \
  ASAAS_ENVIRONMENT="..." \
  ASAAS_WEBHOOK_TOKEN="..." \
  BACKOFFICE_BOOTSTRAP_TOKEN="..." \
  INTERNAL_OPERATOR_EMAILS="..." \
  PUBLIC_API_MASTER_KEY="..." \
  INTEGRATIONS_MASTER_KEY="..." \
  SIGNING_MASTER_KEY="..." \
  PORTAL_SERVICE_USER_ID="..."

flyctl secrets set -a calibra-facil-worker \
  DATABASE_URL="..." \
  R2_ACCOUNT_ID="..." \
  R2_ACCESS_KEY_ID="..." \
  R2_SECRET_ACCESS_KEY="..." \
  SIGNING_MASTER_KEY="..." \
  INTEGRATIONS_MASTER_KEY="..."
```

All listed API secrets are required in production. The API entrypoint fails fast
when any required value is missing. The worker also requires
`SIGNING_MASTER_KEY` and `INTEGRATIONS_MASTER_KEY`.

GitHub Actions deploys require a repository secret named `FLY_API_TOKEN`.
Create it with `flyctl auth token` from an account that can deploy to the
`calibrafacil` organization.

## Initial sizing and cost

For the first production client, start small in `gru`:

- `calibra-facil-api`: `shared-cpu-1x`, `512MB`, one always-running Machine.
- `calibra-facil-worker`: `shared-cpu-1x`, `1GB`, one always-running Machine
  because Chromium/Puppeteer is memory-sensitive.
- `calibra-facil-web`: `shared-cpu-1x`, `256MB`, one always-running Machine.
- `calibra-facil-portal`: `shared-cpu-1x`, `256MB`, one always-running Machine.

At current Fly `gru` rates, the always-running baseline is roughly
`$20.64/month` before bandwidth and optional dedicated IPv4 charges. Avoid
dedicated IPv4 unless needed; shared IPv4 and Anycast IPv6 are enough for
normal HTTP apps.

## Database

Apply the queue migration before deploying the API cutover:

```bash
cd packages/db
pnpm db:migrate
```

The migration creates `app_queue_job`, the Postgres-backed replacement for
Cloudflare Queues.

## First deploy

```bash
flyctl deploy -c fly.api.toml --remote-only --ha=false
flyctl deploy -c fly.worker.toml --remote-only --ha=false
flyctl deploy -c fly.web.toml --remote-only --ha=false
flyctl deploy -c fly.portal.toml --remote-only --ha=false
```

## Domains

Fly certificate records have been created, but they will stay `Not verified`
until DNS points at Fly. Shared IPv4 addresses have also been allocated for the
public HTTP apps:

| Hostname                  | Fly app                | Shared IPv4      |
| ------------------------- | ---------------------- | ---------------- |
| `api.calibrafacil.com`    | `calibra-facil-api`    | `66.241.125.38`  |
| `calibrafacil.com`        | `calibra-facil-web`    | `66.241.124.145` |
| `portal.calibrafacil.com` | `calibra-facil-portal` | `66.241.124.235` |

Use DNS-only Cloudflare records during cutover. For subdomains, a CNAME to
`<app>.fly.dev` is also acceptable after the app is deployed; for the apex
domain, use the shared IPv4 A record above.

Certificate setup commands, already run once:

```bash
flyctl certs add api.calibrafacil.com -a calibra-facil-api
flyctl certs add calibrafacil.com -a calibra-facil-web
flyctl certs add portal.calibrafacil.com -a calibra-facil-portal
```

## Smoke tests

- API: `GET /hello`, login, dashboard load, jobs list.
- Worker: approve a job and confirm PDF generation reaches R2.
- Portal: authenticated portal route and public service order access.
- R2: avatar/signature upload, certificate presigned download, public verify.
