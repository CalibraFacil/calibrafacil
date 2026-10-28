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
| `backup`    | optional (`COMPOSE_PROFILES=backup`): daily database dump + file mirror |

The compose file is hardened for unattended running: container logs rotate, every service has a
memory limit and a restart policy, the app images run as an unprivileged user, the API, worker, web,
portal, PostgreSQL and Gotenberg have healthchecks, Caddy sends a Content-Security-Policy and the
other browser security headers and does not expose `/api/cron/*`, and the application's database role
has statement and idle-transaction timeouts. The details and the settings are in
[`docs/operations/compose-hardening.md`](./docs/operations/compose-hardening.md).

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

Images are published only after the post-merge Safety net passed on the release commit. Each one
carries an SBOM and a SLSA provenance attestation, is scanned with Trivy (a CRITICAL
vulnerability with a fix stops the release), and is signed keyless with cosign. To check that an
image was built by this repository's release workflow:

```bash
cosign verify ghcr.io/calibrafacil/calibrafacil-api:<version> \
  --certificate-identity-regexp 'https://github.com/CalibraFacil/calibrafacil/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
docker buildx imagetools inspect ghcr.io/calibrafacil/calibrafacil-api:<version> \
  --format '{{ json .SBOM }}'
```

The base images are pinned by digest, and the runtime Bun is the one in `.bun-version`, the same
Bun that CI runs.

### Updating

Read the [changelog](./CHANGELOG.md), back up (below), set the new `CALIBRA_VERSION` in `.env`,
then:

```bash
docker compose pull
docker compose up -d
```

`init` applies the new migrations before the new API starts.

The API and the worker stop gracefully on `SIGTERM` (what `docker compose stop` and an upgrade send): the
API stops taking requests and the worker claims no further job, both wait up to `SHUTDOWN_GRACE_MS`
(default `25000`) for the work under way, such as a certificate render, then close their database
connections and exit. `stop_grace_period` in `deploy/compose.yaml` (40 s) is above it; raise both if
your renders take longer. A job still running at the deadline is not lost: its lease expires and a
worker reclaims it.

After changing the storage settings, check them end to end (health probe, a write/read/delete in both
buckets, and the certificate-drift job) with
`docker compose exec -T api bun src/cli/check-storage.ts`.

### Backups

Three things hold all the state: the database, the stored files, and `.env`, whose master keys
encrypt the signing certificates and integration tokens. **Without `.env`, a database backup
cannot be fully restored.**

Turn on the scheduled backups with `COMPOSE_PROFILES=backup` in `deploy/.env` and
`docker compose up -d`: the `backup` service takes a checked `pg_dump` (custom format, optionally
encrypted with age) every day at 02:30 UTC, mirrors the file buckets right after it, keeps the dumps
for 14 days (never fewer than the newest three) and can copy everything to an off-site bucket. Default
targets: **RPO 24 hours, RTO 4 hours**. Restore with `deploy/restore.sh`, which refuses to
overwrite a database that has data (without `--force`), restores in one transaction, applies the
migrations and verifies the audit-trail hash chains. A restore drill runs in CI every week
([`.github/workflows/restore-drill.yml`](./.github/workflows/restore-drill.yml)).

```bash
docker compose --profile backup run --rm backup once        # a backup now, e.g. before an update
sudo ./restore.sh backups/dumps/latest                      # restore into an empty database
docker compose --profile backup run --rm backup restore-files   # then the files
```

Keep copies off the server, keep `.env` in a password manager, and put the issued-certificate bucket
under object versioning or lock. Everything (what is backed up, why the order matters, encryption,
off-site copies, tighter RPO with WAL archiving, the full restore procedure, the manual drill, and
how to enable versioning or lock on S3, R2 and MinIO) is in
[`docs/operations/backup-restore.md`](./docs/operations/backup-restore.md).

### Logs and errors

There is no error-tracking service to configure and no DSN: nothing leaves your server. The API
and the worker write to stdout/stderr, and every unhandled error (a failed request, a failed job,
a failed cron or queue run) is also reported as one JSON line on stderr:

```json
{
  "level": "error",
  "message": "relation \"x\" does not exist",
  "name": "Error",
  "stack": "...",
  "tags": { "surface": "api" },
  "service": "api",
  "environment": "production",
  "release": "abc123",
  "timestamp": "2026-01-01T12:00:00.000Z"
}
```

The message and stack are scrubbed of credentials, tokens and connection-string passwords; request
bodies, headers, cookies and environment values are never included. `service` is `api` or `worker`.
`environment` comes from `NODE_ENV` and `release` from `APP_RELEASE` (the commit or the image tag) when set.

With Docker, read them with `docker compose logs`:

```bash
docker compose logs -f api worker                                          # follow
docker compose logs --no-log-prefix api worker | grep '"level":"error"'    # errors only
```

To keep or alert on them, point the Docker logging driver at your collector (journald, Loki,
Fluent Bit, CloudWatch, ...) or ship `docker compose logs` to it, and match on `"level":"error"`.
The compose file already rotates container logs (`json-file`, `LOG_MAX_SIZE` and `LOG_MAX_FILE`; see
[`docs/operations/compose-hardening.md`](./docs/operations/compose-hardening.md)); with another
setup, set `max-size`/`max-file` on the `json-file` driver (or use the `local` driver) so they
cannot fill the disk. The browser apps send nothing off the device: a route error is written to
the browser console only.

### Health, alerts and metrics

- **`GET /api/health`** is the readiness probe. It answers 503 when Postgres, the object store
  or the queue can't be reached. When it is ready but something needs an operator, its
  `status` is `degraded` and `alerts` lists the problems:
  - a scheduled job that stopped succeeding (`staleCrons`: last success older than twice its
    interval plus ten minutes);
  - a job that failed three times in a row (`failingCrons`);
  - background jobs that ran out of attempts (`deadLetters`).
- **`GET /api/health/alerts`** answers 503 while any alert is open. Point an uptime monitor at
  it.
- **`GET /api/metrics`** serves Prometheus text to a scraper sending
  `Authorization: Bearer $METRICS_TOKEN`, and answers 404 when `METRICS_TOKEN` is unset. It
  exposes:
  - requests by method and status class;
  - a latency histogram;
  - queue jobs by status;
  - seconds since each scheduled job last succeeded.
- **Access log.** Every API response carries `X-Request-Id`: the caller's own, when it is a
  plain token, otherwise a new one. The API writes one access-log line per request on stdout:
  `{"level":"info","event":"http_request","requestId":...,"method":...,"path":...,"status":...,"durationMs":...}`.
  The path is logged without its query string.

### Using hosted services instead

Each dependency can move out of the compose file: delete its service and point the variables
in the `x-app-env` block of `compose.yaml` elsewhere (`DATABASE_URL` and `DATABASE_OWNER_URL` for a managed
PostgreSQL, see "Row-level security" below,
`R2_*` for Cloudflare R2 or S3, `GOTENBERG_URL`). With a hosted object store, remove
`R2_PUBLIC_ENDPOINT` and the `FILES_URL` site in the `Caddyfile`. Resend works instead of
SMTP: set `RESEND_API_KEY` and leave `SMTP_HOST` empty.

## Upgrading to this release

**API edges (roadmap 2, D1).**

- **Custom portal domains** no longer get credentialed CORS. Serve the portal on its own domain
  with the API under that domain's `/api`, exactly as the Caddy of `deploy/compose.yaml` does for
  `PORTAL_URL`: a `handle /api/*` block that proxies to `api:3000`, and everything else to
  `portal:8080`. The portal then calls its own origin and needs no CORS.
- **Origin check.** A state-changing request that carries the session cookie must come from the
  API's own origin or a configured app or portal origin; otherwise it is answered 403
  `CROSS_SITE_REQUEST_BLOCKED`. Integrations authenticating with an API key or `Authorization`
  are not affected.
- **Client address.** It comes from the connection, and `X-Forwarded-For` is believed only as far
  as `TRUSTED_PROXY_HOPS` proxies wrote it. The Docker setup sets 1 for its Caddy; behind
  another load balancer, set 2. A self-hosted API without a proxy keeps the default 0. The
  address is used by the audit trail's IP, the rate limits and the approval-code throttle.
- **Rate limits.** `API_RATE_LIMIT_PER_MINUTE` (default 600 per signed-in user, API key or
  address) and `API_PUBLIC_RATE_LIMIT_PER_MINUTE` (default 60 per address on verification, magic
  links, sign-up and access codes), answered 429 with `Retry-After`. Each API replica counts on
  its own.
- **Body size.** Request bodies above `API_MAX_BODY_BYTES` (default 25 MiB) are answered 413.

**Docker Compose hardening (roadmap 2, G1 and G3).** Nothing is required: `docker compose pull` and
`docker compose up -d` work with your existing `.env`. What changes: the app containers run as the
unprivileged user `bun` (a volume you mounted into one must be writable by uid 1000); every service
has a log-rotation setting, a memory limit and (where it was missing) a healthcheck, so `docker
compose ps` may show a service `unhealthy` that used to look fine; Caddy now sends a
Content-Security-Policy on the app and portal pages (if a page of yours calls an external service,
add its origin to `deploy/Caddyfile`) and answers 404 for `/api/cron/*`; `init` sets a 2-minute
`statement_timeout` and a 1-minute `idle_in_transaction_session_timeout` on the `calibra_app` role
(`DB_APP_*_TIMEOUT_MS` in `.env` change or disable them). Scheduled backups are opt-in:
[`docs/operations/backup-restore.md`](./docs/operations/backup-restore.md).

Configuration is now validated when each process starts (see [Configuration](#configuration)):
**the API, the worker and the local server refuse to start, with one message listing every
problem, when production is missing a required variable or one has the wrong shape.** Before,
most of these only failed at first use, deep inside a request, or never. Check your environment
**before** you deploy.

**Row-level security is enforced (P2-18k): create the application role and set two connection strings.**
The API and the worker now connect as `calibra_app`, which the tenant policies of migration 0123 bind, and
keep the table owner for the few cross-laboratory statements (`DATABASE_OWNER_URL`).
`DATABASE_RLS_MODE` defaults to `enforced`, and start-up refuses (naming the variable) an application that
connects as the owner or has no `DATABASE_OWNER_URL`. **Docker Compose:** add `CALIBRA_APP_PASSWORD` to
`deploy/.env` (any random URL-safe string; `./setup.sh` generates it for new installs) before
`docker compose up -d`; `init` creates the login. **Other deployments:** first run `init` / `db:bootstrap` as the owner with
`DATABASE_URL=postgres://calibra_app:<password>@host/db` and `DATABASE_OWNER_URL` set to the connection
`DATABASE_URL` is today (it migrates, which creates `calibra_app`, and gives it the login), then point the API and the
worker at those two URLs.
The steps and the rollback (`DATABASE_RLS_MODE=shadow`) are in "Row-level security (migration 0123) and the
role split".

**Newly required in production** (`NODE_ENV=production`):

| Variable                     | Who is affected                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRON_SECRET`                | Bun and hand-built images. Without it the API used to start and every `/api/cron/*` job answered 503. (Docker Compose already requires it.) |
| `QUOTE_APPROVAL_CODE_PEPPER` | Bun and hand-built images, where a built-in development pepper was used silently. (Docker Compose already requires it.)                     |
| `API_URL` and `APP_URL`      | Everyone who left one out. The auth layer used to throw on first use.                                                                       |
| `R2_MEDIA_BUCKET_NAME`       | The worker, which used to fall back to a development bucket name.                                                                           |

**Newly shape-checked in production** (the variable was accepted before and only failed when
first used):

| Variable                                                                                            | Rule                                                                      |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `SIGNING_MASTER_KEY`, `INTEGRATIONS_MASTER_KEY`, `PUBLIC_API_MASTER_KEY`, `EMAIL_DOMAIN_MASTER_KEY` | 32 random bytes, base64 encoded (`EMAIL_DOMAIN_MASTER_KEY` only when set) |
| `BETTER_AUTH_SECRET`                                                                                | at least 32 characters                                                    |

Everywhere (not only in production) a variable that is set must now have the right type: a
number must be a whole number (`SMTP_PORT`, `PORT`), an address must be an `http://` or `https://` URL, and `EMAIL_TRANSPORT` and
`BACKGROUND_JOBS_MODE` must be one of their documented values. The switches
that document a safe fallback (`QUEUE_RECEIPTS_MODE`, `RECORDS_PURGE_ENABLED`,
`RECORDS_PURGE_MODE`, `CRON_SCHEDULER`,
`STUCK_RENDER_AFTER_MS`, `QUEUE_STALE_AFTER_MS`, `DATABASE_POOL_MAX`) keep it: an unusable value still means the default.

**Vercel is no longer a deployment target.** The `vercel.json` files, the generated Vercel
functions (`apps/api/api/`) and the Vercel Queue consumer are gone; the API runs on Bun and the
background jobs wait in the database queue (`app_queue_job`). `BACKGROUND_JOBS_MODE=vercel` is now
refused (use `queue` with the worker); `BACKGROUND_JOBS_MAX_DELIVERIES`, `BACKGROUND_JOBS_TOPIC`,
`VERCEL_QUEUE_REGION` and `DOCUMENT_WORKER_JOB_TYPES` are ignored (the database queue sends every
queue job to the worker, and `app_queue_job.max_attempts` is its delivery ceiling); `VERCEL` and
`VERCEL_ENV` no longer imply production, so set `NODE_ENV=production`; and `VERCEL_GIT_COMMIT_SHA`
became `APP_RELEASE`.

**Before deploying**, validate the environment you are about to run, without starting anything,
from a checkout of this release:

```bash
pnpm config:check --runtime api --env-file <your production env file>
pnpm config:check --runtime worker --env-file <your production env file>
```

The file is read instead of your shell's environment; it must be a `KEY=VALUE` file that includes
`NODE_ENV=production` (add `--production` otherwise, to apply the production requirements). Run
the command from the repository root, and use the pinned pnpm (`corepack enable`): the report
lists variable names and reasons and never prints a value, and the exit code is non-zero when
anything is wrong.

With the Docker setup the API's environment is assembled by `compose.yaml`, so check it inside the
image the same way the containers will see it:

```bash
docker compose run --rm --no-deps api bun ../../packages/config/scripts/check-config.ts --runtime api
docker compose run --rm --no-deps worker bun ../../packages/config/scripts/check-config.ts --runtime worker
```

**Certificate time-stamping now reaches the worker.** `SIGNING_TSA_URL`, `SIGNING_TSA_AUTH` and
`SIGNING_TSA_ICP_CONFORMANT` were documented as settings of the signing path, but the environment
the worker runs with never carried them, so no certificate was ever time-stamped, whatever you had
configured. They now take effect on every worker path (and the new optional
`SIGNING_TSA_TIMEOUT_MS` with them). **If `SIGNING_TSA_URL` is set in your environment, the
certificates issued after this upgrade are time-stamped, and a certificate is not issued while the
authority is unreachable** (the job stays `GENERATING_PDF` while the queue retries, then is
`REJECTED`; see _Certificate time-stamping_). Check that the authority and its credentials work, or
unset `SIGNING_TSA_URL`, **before** you deploy. With it unset nothing changes. Docker Compose now
passes these variables from `deploy/.env` to the API and the worker (all optional).

Generate a missing key or secret with `openssl rand -base64 32` (never reuse one key for two
purposes, and never replace `SIGNING_MASTER_KEY`, `INTEGRATIONS_MASTER_KEY`,
`PUBLIC_API_MASTER_KEY` or `EMAIL_DOMAIN_MASTER_KEY` once data is encrypted with it: add only the
ones you do not have yet. `SIGNING_MASTER_KEY` can be rotated, but only by the procedure in
_Signing certificate custody_ below).

## Other ways to host

### What the pieces need

| Component      | Requirement                                                                  |
| -------------- | ---------------------------------------------------------------------------- |
| API + worker   | [Bun](https://bun.sh) 1.x                                                    |
| Web apps       | Static hosting for `apps/web` and `apps/portal` (SPA fallback to index.html) |
| Database       | PostgreSQL 15+ with the `pg_trgm` and `unaccent` extensions available        |
| Object storage | Any S3-compatible store (Cloudflare R2, AWS S3, MinIO, …) — two buckets      |
| PDF rendering  | [Gotenberg](https://gotenberg.dev) 8 reachable from the API/worker           |
| E-mail         | An SMTP server, or a [Resend](https://resend.com) account                    |
| Optional       | Conta Azul (ERP)                                                             |

The simplest layout serves the API under `/api` on the app's and the portal's own hosts (what
the Docker setup does). The API can also live on a host of its own, e.g. `api.example.com`:
then set `AUTH_COOKIE_DOMAIN` and build the frontends with `VITE_API_URL`.

| Host                 | Serves                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `app.example.com`    | lab app (`apps/web`)                                                                     |
| `portal.example.com` | client portal (`apps/portal`), including the `/v/:token` page that verifies certificates |
| `api.example.com`    | API (`apps/api`), when not served under `/api`                                           |

### Configuration

Every environment variable the API, the worker, the local server and the frontends read is
declared once, with its type, default, whether production requires it and a one-line description,
in [`packages/config`](./packages/config/src). **That schema is the source of truth**; the tables
below are a summary.

- Each process validates its configuration when it starts (the API's Bun entry,
  the worker, the local server). A bad deploy fails immediately with one error that
  lists every problem, by variable name and reason, never with a value:

  ```text
  Invalid api configuration (2 problems):
    - DATABASE_URL: is required in production (PostgreSQL connection string)
    - BETTER_AUTH_SECRET: must be at least 32 characters in production
  ```

- Outside production only the types are checked, so `pnpm dev` and the tests keep working with
  the defaults of `apps/api/.env.example`.
- `apps/api/.env.example` and `deploy/.env.example` are generated from the schema: change a
  variable in `packages/config`, then run `pnpm config:env-example` and commit the result. A test
  fails when a committed example differs from the schema.

### API (`apps/api`) and worker (`apps/worker`)

`apps/api/.env.example` lists every variable with its description. The essentials for production:

| Variable                                                                                            | Notes                                                                                                          |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV=production`                                                                               |                                                                                                                |
| `DATABASE_URL`                                                                                      | PostgreSQL connection string of the `calibra_app` role (row-level security binds it)                           |
| `DATABASE_OWNER_URL`                                                                                | The table owner: the system path and the migrations. Required while `DATABASE_RLS_MODE=enforced` (the default) |
| `API_URL`, `APP_URL`, `PORTAL_APP_URL`                                                              | Public URLs (`API_URL` = `APP_URL` when the API is served under `/api`)                                        |
| `VERIFY_URL`                                                                                        | Optional; host of the verification page (defaults to `PORTAL_APP_URL`)                                         |
| `BETTER_AUTH_SECRET`                                                                                | ≥ 32 random characters                                                                                         |
| `AUTH_COOKIE_DOMAIN`                                                                                | e.g. `.example.com` when the API and the apps are on different subdomains                                      |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`                               | Outgoing e-mail; or `RESEND_API_KEY` for Resend (`EMAIL_TRANSPORT` picks when both)                            |
| `EMAIL_FROM`                                                                                        | Sender, e.g. `"Laboratório <calibra@example.com>"`                                                             |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                                                          | Object-storage credentials                                                                                     |
| `R2_BUCKET_NAME`, `R2_MEDIA_BUCKET_NAME`                                                            | Documents bucket (regulated records) and media bucket (logos, etc.)                                            |
| `R2_ACCOUNT_ID` **or** `R2_ENDPOINT` (+ `R2_REGION`)                                                | Cloudflare R2 account, or the endpoint of any S3-compatible store                                              |
| `R2_PUBLIC_ENDPOINT`                                                                                | Optional; the store's public address when `R2_ENDPOINT` is internal (download links)                           |
| `GOTENBERG_URL` (+ `GOTENBERG_TOKEN`)                                                               | PDF rendering                                                                                                  |
| `SIGNING_MASTER_KEY`, `INTEGRATIONS_MASTER_KEY`, `PUBLIC_API_MASTER_KEY`, `EMAIL_DOMAIN_MASTER_KEY` | 32 random bytes each, base64 (`openssl rand -base64 32`); never reuse one key twice                            |
| `SIGNING_TSA_URL` (+ `SIGNING_TSA_AUTH`, `SIGNING_TSA_ICP_CONFORMANT`, `SIGNING_TSA_TIMEOUT_MS`)    | Optional RFC 3161 time-stamping of certificates: see _Certificate time-stamping_                               |
| `SIGNING_MASTER_KEY_ID`, `SIGNING_MASTER_KEY_PREVIOUS`, `SIGNING_TRUST_STORE_FILE`                  | Optional: key rotation and the upload trust store: see _Signing certificate custody_                           |
| `QUOTE_APPROVAL_CODE_PEPPER`, `CRON_SECRET`                                                         | Random strings                                                                                                 |
| `PORTAL_SERVICE_USER_ID`                                                                            | Id of the account that owns client-portal organizations (`init` creates it)                                    |
| `BACKGROUND_JOBS_MODE`                                                                              | `local` (inside the API process, development) or `queue` (a separate worker)                                   |
| `STUCK_RENDER_AFTER_MS`                                                                             | Optional, default `3600000` (60 min): see _Certificates stuck in generation_ below                             |
| `QUEUE_RECEIPTS_MODE`                                                                               | Optional, default `enforce`; `shadow`/`off` opt out: see _Queue idempotency_ below                             |
| `SHUTDOWN_GRACE_MS`                                                                                 | Optional, default `25000`: how long the API and the worker wait for running work on `SIGTERM`/`SIGINT`         |
| `CRON_SCHEDULER=internal`                                                                           | Run the scheduled jobs inside the API (see below)                                                              |
| `RECORDS_PURGE_ENABLED`                                                                             | Optional, default `false`: enables the `records-purge` cron (see _Records retention_)                          |
| `RECORDS_PURGE_MODE`                                                                                | Optional, default `dry-run`; only `execute` deletes (see _Records retention_)                                  |
| `SYNC_MIN_DESKTOP_VERSION`                                                                          | Optional, default unset (no minimum): see _Minimum desktop version_                                            |
| `SYNC_CHANGE_LOG_RETENTION_DAYS`                                                                    | Optional, default `90` (at least `7`): see _Desktop change log (sync protocol 3)_                              |

Extra origins for CORS and auth can be listed in `CORS_ALLOWED_ORIGINS` and
`AUTH_TRUSTED_ORIGINS`. The Conta Azul ERP integration needs no server setup: each laboratory
registers its own application on Conta Azul's developer portal and pastes the Client ID and
Secret in **Configurações → Integrações**, which shows the redirect URL to register
(`API_URL` + `/api/integrations/conta-azul/oauth/callback`). To supply one application to every
laboratory instead, set `CONTA_AZUL_CLIENT_ID` and `CONTA_AZUL_CLIENT_SECRET`
(`CONTA_AZUL_OAUTH_REDIRECT_URI` overrides the redirect URL).

#### Outbound requests to customer-configured URLs (webhooks, ERP)

Public-API webhooks and the generic HTTP ERP integration call URLs a laboratory types in, so the
server treats them as untrusted (SSRF). Every such call goes through one helper
(`safeOutboundFetch`, `packages/shared/src/net`) that:

- allows `https:` only in production (`NODE_ENV=production`). `OUTBOUND_ALLOW_INSECURE_HTTP=true`
  reopens plain `http:`; outside production it is always allowed;
- resolves the host once and refuses the call when **any** address is private, loopback,
  link-local (the cloud metadata address included), carrier-grade NAT, unique-local, multicast,
  unspecified or reserved, or an IPv6 form wrapping one of those (`::ffff:10.0.0.1`), and then
  connects to the address it checked, so a DNS answer that changes between the check and the
  connection cannot redirect it;
- does not follow redirects (a 3xx counts as a failed delivery); the ERP integration follows up to
  three, checking each hop like the first;
- gives up after 10 seconds and reads at most 64 KiB of a webhook answer (a few MiB for an ERP).

**Reaching a host on your own network.** A self-hosted laboratory whose ERP lives on its LAN has to
say so: list the host in `OUTBOUND_ALLOW_PRIVATE_HOSTS` (comma-separated, **off by default**). An
entry is a host name (`erp.lan`), a `*.suffix` wildcard (`*.corp.example`), an IP address or a
CIDR range (`10.20.0.0/24`).

**An allow-listed host name permits ANY address it resolves to**, including `127.0.0.1`, the
database, the object store and the cloud metadata address: the guard trusts the name, not the
address, and whoever controls that name's DNS controls where the call goes. List a host name only
if you control its DNS; prefer an IP address or a CIDR range, which permits exactly those addresses
and nothing else. A `*.suffix` wildcard permits every name under it, with the same consequence. Every
laboratory of the instance can then point a webhook or an ERP integration at what you listed, so
list what you mean to reach and nothing broader. An entry that cannot be read is ignored and
logged.

Refusals are deliberately vague to the caller ("destino não permitido ou não encontrado", the same
text as an unknown host, so a laboratory cannot use a webhook to probe your network); the address
class that was refused is written to the server log (`[outbound] refused ...`).

Webhook deliveries are queued (`BACKGROUND_JOBS_MODE=queue`: the worker sends them, five attempts
with exponential backoff, and disables a subscription after 10 deliveries in a row fail). The
worker needs the same `PUBLIC_API_MASTER_KEY` as the API (it falls back to
`INTEGRATIONS_MASTER_KEY` when that is unset, as the API does) and the same `OUTBOUND_*`
settings. With `BACKGROUND_JOBS_MODE=local` (development) a delivery runs once, in the API
process, without retries.

#### Certificate time-stamping (RFC 3161)

Set `SIGNING_TSA_URL` to the endpoint of a time-stamp authority and every signed certificate gets
a carimbo do tempo (PAdES-T). The other variables are optional: `SIGNING_TSA_AUTH` is the full
`Authorization` header value of a contracted authority (`Basic ...` or `Bearer ...`),
`SIGNING_TSA_TIMEOUT_MS` the request timeout (1000 to 60000, default 30000; capped at 60000 so the worst case, 4 × 60 s + 7 s = 247 s, stays under the 10-minute queue lease), and
`SIGNING_TSA_ICP_CONFORMANT=true` is to be set **only** for a credentialed ICP-Brasil authority:
otherwise the signature records `icpBrasilConformant: false`, so a generic authority is never
presented as legally conformant. The settings are validated at start-up (the address must be an
`http://` or `https://` URL).

They take effect on **every worker path**: the cron handlers, the
inline and local (`BACKGROUND_JOBS_MODE=local`) runner in the API process, the database-queue
drain (`apps/worker` `serve`, including the document-worker container) and the always-on Bun
worker (`bun src/bun.ts`, the `worker` service of the Docker setup). All of them build the
signing part of the worker environment from one function, `workerSigningEnv` in
`packages/config`. On Cloudflare, the document-worker container receives them from the Worker's
own variables and secrets.

With `SIGNING_TSA_URL` unset nothing changes: no time-stamp is requested and the signed PDF is
byte-identical to what earlier releases produced.

**With a TSA configured, time-stamping fails closed.** A certificate is never issued unstamped:

- Each delivery makes one request to the authority and retries it up to three more times (four in
  all; the retry count is not configurable) when the request fails: connection error, no answer
  within `SIGNING_TSA_TIMEOUT_MS`, or any non-2xx HTTP status. It waits 1, 2 and 4 seconds after
  the first, second and third failure (doubling from 1 second; nothing after the last). The
  timeout covers the wait for the response headers. An answer that arrives but is unusable (not a
  valid time-stamp response, a rejection status, or no token) is not retried: the delivery fails at
  once. When no stamp is obtained the render fails before anything is uploaded: no PDF is stored,
  no certificate snapshot is written and no "certificate ready" e-mail is sent.
- Keep the worst case inside the queue lease. An unreachable authority that hangs costs
  up to `4 × SIGNING_TSA_TIMEOUT_MS + 7 seconds` per delivery (127 seconds at the default 30000),
  on top of the render itself. A worker that holds a row for longer than `QUEUE_STALE_AFTER_MS`
  (default 10 minutes) loses it to another worker; the timeout is therefore capped at 60000
  (247 seconds worst case), and the validation refuses anything larger.
- While the row still has attempts left (`max_attempts`, default 3), the job stays
  `GENERATING_PDF` and the row is re-queued, so a short outage of the authority heals itself.
- On the final delivery the job is `REJECTED`, with the reason `Falha na assinatura digital do
certificado: Falha ao obter carimbo do tempo RFC 3161 ...`, and can be sent for approval again
  once the authority is back. Runners that never redeliver (the inline and local ones) treat the
  first failure as final.

Laboratories that sign certificates therefore depend on the authority being available: monitor
it, or leave `SIGNING_TSA_URL` empty until you have a contracted one.

#### Signing certificate custody (envelope encryption, key rotation)

Each laboratory's A1 certificate (the PKCS#12 and its password) is stored as an **envelope**: a
random AES-256-GCM data key per field, wrapped by the key encryption key (KEK) that is
`SIGNING_MASTER_KEY`. The additional authenticated data of both the wrap and the data binds the
organization, the unit and the certificate serial, so a stored credential copied to another row does
not decrypt. Every record carries the id of its KEK (`kek_id`) and a format version
(`custody_format_version`: 1 = the legacy storage straight under the master key, 2 = the envelope).
Credentials stored before this change are format 1 and **keep working** (they are tried against the
current and the previous keys); `reencrypt-signing-credentials` migrates them.

| Variable                      | Meaning                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SIGNING_MASTER_KEY`          | The **current** KEK, 32 random bytes, base64. Required in production (API and worker).                   |
| `SIGNING_MASTER_KEY_ID`       | Id of the current KEK (letters, digits, `_`, `.`, `-`, up to 64). Unset: `k1`.                           |
| `SIGNING_MASTER_KEY_PREVIOUS` | Previous KEKs as comma-separated `id:base64key`. Needed while any credential is still sealed under them. |
| `SIGNING_TRUST_STORE_FILE`    | Path of a PEM bundle that **replaces** the bundled ICP-Brasil roots for upload validation. Optional.     |

The API **and** the worker must receive the same three key variables (Docker Compose passes them to
both).

**Rotating the KEK.**

1. Generate a new key (`openssl rand -base64 32`). Set `SIGNING_MASTER_KEY` to it and
   `SIGNING_MASTER_KEY_ID` to a new id (e.g. `k2`). Move the old key to
   `SIGNING_MASTER_KEY_PREVIOUS=k1:<old key>`. For a deployment that never set the id, the old key's
   id is `k1`. Restart the API and the worker. Nothing breaks: every credential still opens.
2. Run `docker compose exec api bun src/cli/reencrypt-signing-credentials.ts --dry-run`: it opens
   every credential and lists what it would change, writing nothing.
3. Run it without `--dry-run` (or `pnpm --dir apps/api reencrypt-signing-credentials`). It moves
   every credential (legacy ones included) to the envelope format under the current KEK, with a fresh
   data key, one audit row per credential, on the owner connection (`DATABASE_OWNER_URL`). It is
   idempotent: run it again and nothing changes. It exits non-zero if any credential cannot be
   opened (that credential is left untouched).
4. Once it reports `failed 0` and nothing is left under the old key, remove
   `SIGNING_MASTER_KEY_PREVIOUS` and restart. Keep the old key until then: a credential still sealed
   under a key that is not configured makes certificate issuance fail closed for that unit.

**Upload validation.** A P12 is refused with HTTP 422 and a pt-BR reason when it is expired, not valid
yet, allows neither `digitalSignature` nor `nonRepudiation`, or its chain does not build to the trust
store (the bundled ICP-Brasil roots, or `SIGNING_TRUST_STORE_FILE`). Nothing is stored in that case.

**Audit.** Credential create / default replaced / delete, the "emitir sem assinatura" switch, the
"assinatura obrigatória" policy and accreditation-profile changes (number, body, active toggle,
vigência, scope-guard mode) are written to the append-only `organization_compliance_audit_log` in the
same transaction as the change, with the actor and the before/after values (never a secret). The
application role cannot UPDATE or DELETE it.

### Frontends

| App            | Variables                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`     | `VITE_API_URL`, `VITE_PORTAL_APP_URL`, `VITE_OPERATOR_*` (identity shown on the legal pages: `LEGAL_NAME`, `CNPJ`, `ADDRESS`, `EMAIL`, `DPO_NAME`, `DPO_EMAIL`) |
| `apps/portal`  | `VITE_API_URL`, `VITE_WEB_URL`                                                                                                                                  |
| `apps/desktop` | `VITE_DESKTOP_AUTH_API_URL`, `VITE_DESKTOP_AUTH_ORIGIN` (see [`docs/desktop-auto-update.md`](./docs/desktop-auto-update.md))                                    |

Vite bakes these in at build time. The Docker images also read them when the container starts
(the static server answers `/runtime-env.js` with the container's `VITE_*` variables), so one
image serves any domain; `VITE_API_URL` is the exception and stays a build argument.

Review the legal pages (`/termos-de-uso`, `/privacidade`) and the content-security policy in
`apps/web/public/_headers` before going live. (The Docker setup's Caddy sends the same policy,
widened for the file-storage address: `deploy/Caddyfile`.)

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
`Authorization: Bearer $CRON_SECRET`. The simplest option is `CRON_SCHEDULER=internal` on the API:
it runs the schedule below in-process (the Docker setup turns it on; the list is `CRON_ENTRIES` in
`apps/api/src/lib/cron-scheduler.ts`), and a lease keeps two replicas from running a job twice.
Or trigger them with your scheduler of choice. (In the Docker setup, Caddy answers 404 for
`/api/cron/*` from outside: the in-process scheduler never uses the network. To call them from an
external scheduler, remove the two `import block_cron` lines of `deploy/Caddyfile`, or call the API
from inside the compose network.)

| Job                          | Schedule (UTC) |
| ---------------------------- | -------------- |
| `integrations`               | `*/30 * * * *` |
| `service-order-emails`       | `*/30 * * * *` |
| `oot-emails`                 | `*/30 * * * *` |
| `queue-backstop`             | `*/30 * * * *` |
| `spc-recompute`              | `0 3 * * *`    |
| `approval-effects-reconcile` | `45 3 * * *`   |
| `email-domain-health`        | `30 3 * * *`   |
| `certificate-drift`          | `0 6 * * *`    |
| `notifications`              | `0 8 * * *`    |
| `portal-digest`              | `0 9 * * *`    |
| `auth-maintenance`           | `30 4 * * 1`   |
| `records-purge`              | `0 5 * * 0`    |
| `sync-change-log-purge`      | `15 4 * * *`   |
| `audit-chain-verify`         | `45 4 * * *`   |

`approval-effects-reconcile` (ISO/IEC 17025 7.10) repairs what an approval can still be missing: the
asset out-of-tolerance event, the asset calibration-date advance and the customer alert. New
approvals write the event and the date advance in their own transaction and stage the notifications
as queue jobs, so the sweep mostly finds approvals committed before that change. It only looks at
approvals from the last 30 days (older gaps are counted and logged, never repaired, so the first run
does not notify customers about old calibrations) and is idempotent.

Example crontab line:

```cron
*/30 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://api.example.com/api/cron/queue-backstop
```

### Runbooks

One-off upgrade steps and operational procedures live in `docs/operations/`, one file each:

- [Records retention (purge of soft-deleted laboratories)](./docs/operations/records-purge.md)
- [Applying migration 0118 (organization on every tenant table)](./docs/operations/migration-0118-organization.md)
- [Job status guard (migration 0119) and audited status repair](./docs/operations/migration-0119-job-status-guard.md)
- [Evidence immutability: privileges and the owner-only hatch (migration 0130)](./docs/operations/evidence-immutability.md)
- [Row-level security (migration 0123) and the role split](./docs/operations/row-level-security.md)
- [Queue idempotency and lease fencing](./docs/operations/queue-idempotency.md)
- [Minimum desktop version](./docs/operations/minimum-desktop-version.md)
- [Desktop push permissions and offline attachments (sync protocol 4)](./docs/operations/desktop-push-permissions.md)
- [Desktop change log (sync protocol 3)](./docs/operations/desktop-change-log.md)
- [Certificates stuck in generation](./docs/operations/certificates-stuck-in-generation.md)

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

### Updating

Pull the new version, run `pnpm --dir apps/api init` **before** deploying the new code (new
columns are read as soon as the code ships), then deploy the API, worker and frontends
together.
