# Deploying Calibra Fácil

This guide covers running your own production instance. For local development, see the
[Quick start](./README.md#quick-start) instead.

> Whoever operates an instance is responsible for it: infrastructure, backups, updates,
> data protection (LGPD) and the legal pages shown to its users. The software comes without
> warranty (see [`LICENSE`](./LICENSE)).

## What you need

| Component      | Requirement                                                                  |
| -------------- | ---------------------------------------------------------------------------- |
| API + worker   | [Bun](https://bun.sh) 1.x (or Vercel Functions)                              |
| Web apps       | Static hosting for `apps/web` and `apps/portal` (SPA fallback to index.html) |
| Database       | PostgreSQL 15+ with the `pg_trgm` and `unaccent` extensions available        |
| Object storage | Any S3-compatible store (Cloudflare R2, AWS S3, MinIO, …) — two buckets      |
| PDF rendering  | [Gotenberg](https://gotenberg.dev) 8 reachable from the API/worker           |
| E-mail         | A [Resend](https://resend.com) account (the code uses the Resend API)        |
| Optional       | Sentry (errors), Asaas (billing), Conta Azul (ERP)                           |

A typical layout uses one domain with three hosts:

| Host                 | Serves                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `app.example.com`    | lab app (`apps/web`)                                                                     |
| `portal.example.com` | client portal (`apps/portal`), including the `/v/:token` page that verifies certificates |
| `api.example.com`    | API (`apps/api`)                                                                         |

## Environment variables

### API (`apps/api`) and worker (`apps/worker`)

`apps/api/.env.example` documents every variable. The essentials for production:

| Variable                                                                                            | Notes                                                                               |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `NODE_ENV=production`                                                                               |                                                                                     |
| `DATABASE_URL`                                                                                      | PostgreSQL connection string                                                        |
| `API_URL`, `APP_URL`, `PORTAL_APP_URL`                                                              | Public URLs of the three hosts                                                      |
| `VERIFY_URL`                                                                                        | Optional; host of the verification page (defaults to `PORTAL_APP_URL`)              |
| `BETTER_AUTH_SECRET`                                                                                | ≥ 32 random characters                                                              |
| `AUTH_COOKIE_DOMAIN`                                                                                | e.g. `.example.com` when API and apps are on different subdomains                   |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`                                                               | Sender must be a domain verified in Resend                                          |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                                                          | Object-storage credentials                                                          |
| `R2_BUCKET_NAME`, `R2_MEDIA_BUCKET_NAME`                                                            | Documents bucket (regulated records) and media bucket (logos, etc.)                 |
| `R2_ACCOUNT_ID` **or** `R2_ENDPOINT` (+ `R2_REGION`)                                                | Cloudflare R2 account, or the endpoint of any S3-compatible store                   |
| `GOTENBERG_URL` (+ `GOTENBERG_TOKEN`)                                                               | PDF rendering                                                                       |
| `SIGNING_MASTER_KEY`, `INTEGRATIONS_MASTER_KEY`, `PUBLIC_API_MASTER_KEY`, `EMAIL_DOMAIN_MASTER_KEY` | 32 random bytes each, base64 (`openssl rand -base64 32`); never reuse one key twice |
| `QUOTE_APPROVAL_CODE_PEPPER`, `CRON_SECRET`                                                         | Random strings                                                                      |
| `PORTAL_SERVICE_USER_ID`                                                                            | Id of a `user` row that owns client-portal organizations (see below)                |
| `BACKGROUND_JOBS_MODE`                                                                              | `local` (inside the API process), `queue` (a separate worker) or `vercel`           |

Extra origins for CORS and auth can be listed in `CORS_ALLOWED_ORIGINS` and
`AUTH_TRUSTED_ORIGINS`. Billing (`ASAAS_*`), the operator bootstrap token
(`BACKOFFICE_BOOTSTRAP_TOKEN`) and the ERP integration (`CONTA_AZUL_*`) are optional: the
features that need them stay unavailable until they are configured.

### Frontends (build time)

| App            | Variables                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`     | `VITE_API_URL`, `VITE_PORTAL_APP_URL`, `VITE_OPERATOR_*` (identity shown on the legal pages: `LEGAL_NAME`, `CNPJ`, `ADDRESS`, `EMAIL`, `DPO_NAME`, `DPO_EMAIL`), optional `VITE_SENTRY_DSN` |
| `apps/portal`  | `VITE_API_URL`, `VITE_WEB_URL`                                                                                                                                                              |
| `apps/desktop` | `VITE_DESKTOP_AUTH_API_URL`, `VITE_DESKTOP_AUTH_ORIGIN` (see [`docs/desktop-auto-update.md`](./docs/desktop-auto-update.md))                                                                |

Review the legal pages (`/termos-de-uso`, `/privacidade`) and the content-security policy in
`apps/web/public/_headers` before going live.

## Database

```bash
DATABASE_URL=… pnpm --dir packages/db db:bootstrap   # schema (new or existing database)
DATABASE_URL=… bun packages/db/src/seed-asset-types.ts  # asset types + legal-metrology catalog
```

Create the portal service account once and put its id in `PORTAL_SERVICE_USER_ID`:

```sql
INSERT INTO "user" (id, name, email, email_verified)
VALUES ('portal-service', 'Portal service account', 'portal-service@example.com', true);
```

The first laboratory can be created through the self-service sign-up (`PUBLIC_SIGNUP_ENABLED=true`
on the API, then turn it off again). Plans and feature limits come from the original commercial
service; to unlock everything for a laboratory:

```sql
INSERT INTO subscription (organization_id, plan_id, status, current_period_end)
VALUES ('<organization id>', 'ENTERPRISE', 'ACTIVE', '2099-12-31')
ON CONFLICT (organization_id)
DO UPDATE SET plan_id = 'ENTERPRISE', status = 'ACTIVE', current_period_end = '2099-12-31';
```

## Scheduled jobs

The API serves its scheduled jobs at `/api/cron/<job>`, protected by
`Authorization: Bearer $CRON_SECRET`. On Vercel they are declared in `apps/api/vercel.json`;
anywhere else, trigger them with your scheduler of choice:

| Job                           | Schedule (UTC) |
| ----------------------------- | -------------- |
| `integrations`                | `*/30 * * * *` |
| `operator-alerts`             | `*/30 * * * *` |
| `service-order-emails`        | `*/30 * * * *` |
| `oot-emails`                  | `*/30 * * * *` |
| `queue-backstop`              | `*/30 * * * *` |
| `subscription-reconciliation` | `0 3 * * *`    |
| `spc-recompute`               | `0 3 * * *`    |
| `email-domain-health`         | `30 3 * * *`   |
| `marketing-contact-sync`      | `0 6 * * *`    |
| `certificate-drift`           | `0 6 * * *`    |
| `notifications`               | `0 8 * * *`    |
| `portal-digest`               | `0 9 * * *`    |
| `auth-maintenance`            | `30 4 * * 1`   |

Example crontab line:

```cron
*/30 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://api.example.com/api/cron/queue-backstop
```

## Hosting options

### A server with Bun

```bash
pnpm install --frozen-lockfile
NODE_ENV=production bun apps/api/src/bun.ts            # API on $PORT (default 3000)
VITE_API_URL=https://api.example.com pnpm turbo build --filter=@calibra-facil/web --filter=@calibra-facil/portal
# serve apps/web/dist and apps/portal/dist as static SPAs
```

With `BACKGROUND_JOBS_MODE=local` the API process also renders PDFs and runs the background
jobs. To move that work to a separate process, set `BACKGROUND_JOBS_MODE=queue` on the API and
run the worker (`bun apps/worker/src/bun.ts`), which polls the database job queue. It needs the
API's database, storage, Gotenberg, e-mail and encryption settings (see
`apps/worker/.env.example`).

### Docker

The repository root has one Dockerfile per process. Build each from the root, e.g.
`docker build -f Dockerfile.api -t calibrafacil-api .`, and pass the environment above with
`--env-file`.

- `Dockerfile.api`: the API, on port 3000.
- `Dockerfile.worker`: the polling worker, for `BACKGROUND_JOBS_MODE=queue`.
- `Dockerfile.document-worker`: the same worker as an HTTP server on port 8080 that sleeps until
  woken. Point the API's `DOCUMENT_WORKER_URL` at it and the API wakes it after each enqueue
  instead of it polling. `services/document-worker` deploys it as a Cloudflare Container.
- `Dockerfile.static`: the lab app (`--build-arg APP_NAME=web`) or the client portal
  (`APP_NAME=portal`) on port 8080. `--build-arg VITE_API_URL=https://api.example.com` bakes in
  the API's address; leave it out when a reverse proxy serves the API under `/api` on the same
  origin. The server sets cache headers only, so add the security headers from
  `apps/web/public/_headers` in the proxy.

### Vercel

`apps/api`, `apps/web`, `apps/portal`, `apps/docs` and `apps/site` each ship a `vercel.json`.
Create one Vercel project per app with the app directory as its root, set the environment
variables above (`BACKGROUND_JOBS_MODE=vercel` for the API), and Vercel runs the crons and
the background-job queue declared in `apps/api/vercel.json`.

## Updating

Pull the new version, run `pnpm --dir packages/db db:bootstrap` **before** deploying the new code
(new columns are read as soon as the code ships), then deploy the API, worker and frontends
together.
