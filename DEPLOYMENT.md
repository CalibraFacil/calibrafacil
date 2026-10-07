# Deploying Calibra Fácil

This guide covers running your own production instance. For local development, see the
[Quick start](./README.md#quick-start) instead.

> Whoever operates an instance is responsible for it: infrastructure, backups, updates,
> data protection (LGPD) and the legal pages shown to its users. The software comes without
> warranty (see [`LICENSE`](./LICENSE)).

## One server with Docker

The [`deploy/`](./deploy) directory runs everything on a single machine: the lab app, the client
portal, the API, the background worker, PostgreSQL, file storage, PDF rendering, and Caddy for
HTTPS.

You need:

- a Linux server with Docker and the Compose plugin (2 vCPUs and 4 GB of RAM are plenty for a
  lab; x86-64 or ARM64);
- three DNS names pointing at it, e.g. `calibra.example.com` (lab app),
  `portal.example.com` (client portal) and `files.example.com` (file downloads), with ports 80
  and 443 open;
- an SMTP account to send e-mail from (your mail provider, Amazon SES, Brevo, Mailgun…).
  Sign-in is passwordless, so the app cannot work without e-mail.

```bash
git clone --depth 1 https://github.com/CalibraFacil/calibrafacil.git
cd calibrafacil/deploy
./setup.sh                 # writes .env with fresh secrets
nano .env                  # APP_URL, PORTAL_URL, FILES_URL, EMAIL_FROM, SMTP_*
docker compose up -d
docker compose exec api bun src/cli/create-lab.ts \
  --name "Laboratório Exemplo" --email voce@laboratorio.com.br --owner "Seu Nome"
```

`create-lab` prints a link (and e-mails it): open it, create a passkey, and you are in as the
laboratory's administrator. Invite the rest of the team from the app. Run `create-lab` again
for each further laboratory.

Caddy obtains the HTTPS certificates on its own. On every start, the `init` service brings the
database schema up to date, loads the reference catalogs and creates the storage buckets and the
portal service account, and only then do the API and the worker start. The API runs the scheduled
jobs itself (`CRON_SCHEDULER=internal`).

| Service     | What it does                                                            |
| ----------- | ----------------------------------------------------------------------- |
| `caddy`     | HTTPS for the three names; `/api` on the app and portal goes to the API |
| `api`       | REST API and authentication; runs the scheduled jobs                    |
| `worker`    | certificate and document PDFs, signing, queued e-mails, syncs           |
| `web`       | the lab app                                                             |
| `portal`    | the client portal (also the public certificate-verification page)       |
| `postgres`  | the database (volume `postgres-data`)                                   |
| `s3`        | file storage, S3-compatible (volume `s3-data`)                          |
| `gotenberg` | HTML → PDF                                                              |

### Trying it on your own computer

```bash
cd deploy
./setup.sh --local
docker compose up -d
docker compose exec api bun src/cli/create-lab.ts --name "Laboratório Teste" --email voce@example.com
```

The addresses become `http://app.localhost`, `http://portal.localhost` and
`http://files.localhost`, and every e-mail lands in a test inbox at <http://localhost:8025>
instead of being delivered.

### Images

Each release publishes the images to the GitHub Container Registry
(`ghcr.io/calibrafacil/calibrafacil-{api,worker,web,portal}`), for x86-64 and ARM64.
`CALIBRA_VERSION` in `.env` picks the version. To build them from your checkout instead (to
run unreleased code, or a fork):

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

### Updating

Read the [changelog](./CHANGELOG.md), back up (below), set the new `CALIBRA_VERSION` in `.env`,
then:

```bash
docker compose pull
docker compose up -d
```

`init` applies the new migrations before the new API starts.

### Backups

Three things hold all the state: the database, the stored files, and `.env`, whose master keys
encrypt the signing certificates and integration tokens. **Without `.env`, a database backup
cannot be fully restored.**

```bash
docker compose exec -T postgres pg_dump -U calibra -Fc calibra > calibra-$(date +%F).dump
docker run --rm -v calibrafacil_s3-data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/files-$(date +%F).tgz -C /data .
cp .env env-$(date +%F).backup
```

Keep copies off the server. To restore into a fresh install with the same `.env`: start
`postgres` and `s3` only, `pg_restore -U calibra -d calibra --clean` the dump inside the
`postgres` container, untar the files into the `s3-data` volume, then `docker compose up -d`.

### Using hosted services instead

Each dependency can move out of the compose file: delete its service and point the variables
in the `x-app-env` block of `compose.yaml` elsewhere (`DATABASE_URL` for a managed PostgreSQL,
`R2_*` for Cloudflare R2 or S3, `GOTENBERG_URL`). With a hosted object store, remove
`R2_PUBLIC_ENDPOINT` and the `FILES_URL` site in the `Caddyfile`. Resend works instead of
SMTP: set `RESEND_API_KEY` and leave `SMTP_HOST` empty.

## Other ways to host

### What the pieces need

| Component      | Requirement                                                                  |
| -------------- | ---------------------------------------------------------------------------- |
| API + worker   | [Bun](https://bun.sh) 1.x (or Vercel Functions)                              |
| Web apps       | Static hosting for `apps/web` and `apps/portal` (SPA fallback to index.html) |
| Database       | PostgreSQL 15+ with the `pg_trgm` and `unaccent` extensions available        |
| Object storage | Any S3-compatible store (Cloudflare R2, AWS S3, MinIO, …) — two buckets      |
| PDF rendering  | [Gotenberg](https://gotenberg.dev) 8 reachable from the API/worker           |
| E-mail         | An SMTP server, or a [Resend](https://resend.com) account                    |
| Optional       | Sentry (errors), Conta Azul (ERP)                                            |

The simplest layout serves the API under `/api` on the app's and the portal's own hosts (what
the Docker setup does). The API can also live on a host of its own, e.g. `api.example.com`:
then set `AUTH_COOKIE_DOMAIN` and build the frontends with `VITE_API_URL`.

| Host                 | Serves                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `app.example.com`    | lab app (`apps/web`)                                                                     |
| `portal.example.com` | client portal (`apps/portal`), including the `/v/:token` page that verifies certificates |
| `api.example.com`    | API (`apps/api`), when not served under `/api`                                           |

### API (`apps/api`) and worker (`apps/worker`)

`apps/api/.env.example` documents every variable. The essentials for production:

| Variable                                                                                            | Notes                                                                                |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `NODE_ENV=production`                                                                               |                                                                                      |
| `DATABASE_URL`                                                                                      | PostgreSQL connection string                                                         |
| `API_URL`, `APP_URL`, `PORTAL_APP_URL`                                                              | Public URLs (`API_URL` = `APP_URL` when the API is served under `/api`)              |
| `VERIFY_URL`                                                                                        | Optional; host of the verification page (defaults to `PORTAL_APP_URL`)               |
| `BETTER_AUTH_SECRET`                                                                                | ≥ 32 random characters                                                               |
| `AUTH_COOKIE_DOMAIN`                                                                                | e.g. `.example.com` when the API and the apps are on different subdomains            |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`                               | Outgoing e-mail; or `RESEND_API_KEY` for Resend (`EMAIL_TRANSPORT` picks when both)  |
| `EMAIL_FROM`                                                                                        | Sender, e.g. `"Laboratório <calibra@example.com>"`                                   |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                                                          | Object-storage credentials                                                           |
| `R2_BUCKET_NAME`, `R2_MEDIA_BUCKET_NAME`                                                            | Documents bucket (regulated records) and media bucket (logos, etc.)                  |
| `R2_ACCOUNT_ID` **or** `R2_ENDPOINT` (+ `R2_REGION`)                                                | Cloudflare R2 account, or the endpoint of any S3-compatible store                    |
| `R2_PUBLIC_ENDPOINT`                                                                                | Optional; the store's public address when `R2_ENDPOINT` is internal (download links) |
| `GOTENBERG_URL` (+ `GOTENBERG_TOKEN`)                                                               | PDF rendering                                                                        |
| `SIGNING_MASTER_KEY`, `INTEGRATIONS_MASTER_KEY`, `PUBLIC_API_MASTER_KEY`, `EMAIL_DOMAIN_MASTER_KEY` | 32 random bytes each, base64 (`openssl rand -base64 32`); never reuse one key twice  |
| `QUOTE_APPROVAL_CODE_PEPPER`, `CRON_SECRET`                                                         | Random strings                                                                       |
| `PORTAL_SERVICE_USER_ID`                                                                            | Id of the account that owns client-portal organizations (`init` creates it)          |
| `BACKGROUND_JOBS_MODE`                                                                              | `local` (inside the API process), `queue` (a separate worker) or `vercel`            |
| `CRON_SCHEDULER=internal`                                                                           | Run the scheduled jobs inside the API (see below)                                    |

Extra origins for CORS and auth can be listed in `CORS_ALLOWED_ORIGINS` and
`AUTH_TRUSTED_ORIGINS`. The Conta Azul ERP integration needs no server setup: each laboratory
registers its own application on Conta Azul's developer portal and pastes the Client ID and
Secret in **Configurações → Integrações**, which shows the redirect URL to register
(`API_URL` + `/api/integrations/conta-azul/oauth/callback`). To supply one application to every
laboratory instead, set `CONTA_AZUL_CLIENT_ID` and `CONTA_AZUL_CLIENT_SECRET`
(`CONTA_AZUL_OAUTH_REDIRECT_URI` overrides the redirect URL).

### Frontends

| App            | Variables                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`     | `VITE_API_URL`, `VITE_PORTAL_APP_URL`, `VITE_OPERATOR_*` (identity shown on the legal pages: `LEGAL_NAME`, `CNPJ`, `ADDRESS`, `EMAIL`, `DPO_NAME`, `DPO_EMAIL`), optional `VITE_SENTRY_DSN` |
| `apps/portal`  | `VITE_API_URL`, `VITE_WEB_URL`                                                                                                                                                              |
| `apps/desktop` | `VITE_DESKTOP_AUTH_API_URL`, `VITE_DESKTOP_AUTH_ORIGIN` (see [`docs/desktop-auto-update.md`](./docs/desktop-auto-update.md))                                                                |

Vite bakes these in at build time. The Docker images also read them when the container starts
(the static server answers `/runtime-env.js` with the container's `VITE_*` variables), so one
image serves any domain; `VITE_API_URL` is the exception and stays a build argument.

Review the legal pages (`/termos-de-uso`, `/privacidade`) and the content-security policy in
`apps/web/public/_headers` before going live.

### Database and first laboratory

```bash
pnpm --dir apps/api init        # schema, catalogs, buckets, portal service account
pnpm --dir apps/api create-lab --name "Laboratório Exemplo" --email voce@laboratorio.com.br
```

Both read the API's environment (Bun loads `apps/api/.env`). `init` is idempotent: run it
before every deploy. Self-service sign-up (`PUBLIC_SIGNUP_ENABLED=true`) is another way to open
laboratories, restricted to corporate e-mail domains. Every laboratory gets every feature: there
are no plans or limits to configure.

### Scheduled jobs

The API serves its scheduled jobs at `/api/cron/<job>`, protected by
`Authorization: Bearer $CRON_SECRET`. On Vercel they are declared in `apps/api/vercel.json`.
Anywhere else, the simplest option is `CRON_SCHEDULER=internal` on the API: it runs the same
schedule in-process (the Docker setup turns it on), and a lease keeps two replicas from running
a job twice. Or trigger them with your scheduler of choice:

| Job                    | Schedule (UTC) |
| ---------------------- | -------------- |
| `integrations`         | `*/30 * * * *` |
| `service-order-emails` | `*/30 * * * *` |
| `oot-emails`           | `*/30 * * * *` |
| `queue-backstop`       | `*/30 * * * *` |
| `spc-recompute`        | `0 3 * * *`    |
| `email-domain-health`  | `30 3 * * *`   |
| `certificate-drift`    | `0 6 * * *`    |
| `notifications`        | `0 8 * * *`    |
| `portal-digest`        | `0 9 * * *`    |
| `auth-maintenance`     | `30 4 * * 1`   |

Example crontab line:

```cron
*/30 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://api.example.com/api/cron/queue-backstop
```

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

### Individual Docker images

The repository root has one Dockerfile per process, which `deploy/compose.build.yaml` also
uses. Build each from the root, e.g. `docker build -f Dockerfile.api -t calibrafacil-api .`,
and pass the environment above with `--env-file`.

- `Dockerfile.api`: the API, on port 3000. `bun src/cli/init.ts` and
  `bun src/cli/create-lab.ts` run from the same image.
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

`apps/api`, `apps/web` and `apps/portal` each ship a `vercel.json`. Create one Vercel project
per app with the app directory as its root, set the environment variables above
(`BACKGROUND_JOBS_MODE=vercel` for the API), and Vercel runs the crons and the background-job
queue declared in `apps/api/vercel.json`.

### Updating

Pull the new version, run `pnpm --dir apps/api init` **before** deploying the new code (new
columns are read as soon as the code ships), then deploy the API, worker and frontends
together.
