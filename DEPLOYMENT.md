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

#### Records retention (purge of soft-deleted laboratories)

Regulated records (technical records, certificates, audit and event logs, reference standards, NC/CAPA,
service orders, finance documents) are kept at least 10 years: `organization.retention_years` defaults
to 10 and the database refuses anything below 5. A laboratory that holds records is never deleted for
real: `pnpm --dir apps/api soft-delete-lab --slug <slug> --reason "<why>"` soft-deletes and suspends it
(`organization.deleted_at`), and Postgres refuses a `DELETE` of a laboratory organization.
`docs/architecture/records-retention.md` is the inventory of what counts as evidence and of every
foreign key into it.

The `records-purge` cron (weekly) is the only thing that can remove such a
laboratory, and it is **off by default**:

- `RECORDS_PURGE_ENABLED` unset or anything but `true`: the cron answers immediately and touches nothing.
- `RECORDS_PURGE_ENABLED=true`: it selects the soft-deleted laboratories that are not under
  `organization.legal_hold` and whose newest record (their own deletion included) is older than their
  `retention_years`, and **only logs** what it would purge (`[records-purge] dry run: would purge ...`).
- `RECORDS_PURGE_MODE=execute` as well: for each of those it writes `records.purge.started` to
  `platform_event_log`, deletes the laboratory and everything it owns in one transaction, then writes
  `records.purge.completed` (or `failed`). The platform event log is append-only and survives the purge.

Run it in dry-run for a while and review the log before switching to `execute`. The purge removes
database rows only: certificate PDFs and attachments in object storage are not deleted by it. Set
`legal_hold = true` on an organization (with `legal_hold_reason`) to exclude it, whatever its age.

The laboratory's owner can also soft-delete it from **Configurações → Organização → Excluir organização**
(`POST /api/organization/soft-delete`, owner only, typed name plus a reason). That locks the laboratory, signs
the owner out and revokes its API keys; the keys of a suspended or soft-deleted laboratory are refused with
`organization_suspended` / `organization_deleted`, and its issued certificates keep verifying at `/verify`.

**Applying migration 0117.** It drops and re-adds 42 foreign keys (the ones that cascaded a delete into
evidence, now `RESTRICT`) in a single transaction. Each `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock on the
referencing table and a `SHARE ROW EXCLUSIVE` lock on the referenced one (`organization`, `customer`, `asset`,
`reference_standard`, ...), and every re-added key is re-validated against the existing rows. On a database
with a lot of evidence this holds those locks for as long as the validation scans take, and anything that
writes to those tables waits. Run it in a low-traffic window (the app can stay up; writes queue behind it).
It is idempotent, so a failed run rolls back whole and can simply be repeated.

#### Applying migration 0118 (organization on every tenant table)

Migration `0118_organization_id_everywhere` adds `organization_id` to 37 tables (16 audit logs, the finance
and service-order children, `job_standard`, ...), backfills it from the parent row, adds the foreign key to
`organization`, an index per table, 14 `UNIQUE (id, organization_id)` constraints on the parents and 29
composite foreign keys (see `docs/architecture/tenancy.md`). It is one transaction and idempotent, so a
failed run rolls back whole and can be repeated. What to know before running it:

- **Ship it together with the app.** The 16 audit logs get `CHECK (organization_id IS NOT NULL) NOT VALID`:
  every new audit row must name its laboratory. An old API or worker instance still running after the
  migration inserts audit rows without one and fails. Drain the old API and worker (stop them, or let the
  deploy swap all instances), apply the migration, start the new version; do not run old and new side by
  side.
- **Run it off-peak, with a lock timeout.** The `ALTER TABLE`s take `ACCESS EXCLUSIVE` locks (the backfill
  `UPDATE`s also lock the rows they touch) and hold them to the end of the transaction. Fail fast instead of
  queueing behind a long query:

  ```bash
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -c "SET lock_timeout = '5s'" \
    -f packages/db/drizzle/0118_organization_id_everywhere.sql
  ```

  (Or `ALTER ROLE <app role> SET lock_timeout = '5s'` for the run and `ALTER ROLE <app role> RESET lock_timeout`
  after, if you apply it through `init`.) On `lock_timeout` the whole migration rolls back; retry in a quieter
  moment. Applying it by `psql` leaves the drizzle bookkeeping behind; the next `init` re-applies it, which is a
  no-op because every step checks first.

- **Check the sizes first.** The backfill rewrites every row of the 37 tables once, and the parents build a
  unique index:

  ```sql
  SELECT c.relname, c.reltuples::bigint AS rows, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('calibration_job', 'service_order', 'asset', 'billing_document', 'receivable_installment',
                       'service_order_quote', 'service_order_execution', 'job_audit_log', 'asset_audit_log',
                       'customer_audit_log', 'payment_receipt', 'billing_document_item')
   ORDER BY c.reltuples DESC;
  ```

  If `calibration_job`, `service_order` or `asset` hold hundreds of thousands of rows (or any table holds
  millions), **pre-build the `UNIQUE (id, organization_id)` indexes `CONCURRENTLY`** the day before. They do
  not block writes, and the migration adopts an index that already carries the constraint's name
  (`ADD CONSTRAINT ... UNIQUE USING INDEX`), so nothing is built under lock. Run each statement on its own
  (`CREATE INDEX CONCURRENTLY` cannot run inside a transaction); if one is interrupted it leaves an `INVALID`
  index, `DROP INDEX CONCURRENTLY` it and repeat:

  ```sql
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS calibration_job_id_org_uidx ON calibration_job (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS service_order_id_org_uidx ON service_order (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS asset_id_org_uidx ON asset (id, lab_organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS billing_document_id_org_uidx ON billing_document (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS billing_group_id_org_uidx ON billing_group (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS commercial_agreement_id_org_uidx ON commercial_agreement (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS service_id_org_uidx ON service (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS organization_unit_id_org_uidx ON organization_unit (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS reference_standard_id_org_uidx ON reference_standard (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS asset_oot_event_id_org_uidx ON asset_oot_event (id, lab_organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS calibration_request_id_org_uidx ON calibration_request (id, organization_id);
  ```

  **Before running the migration, check that every pre-built index is valid.** An interrupted
  `CREATE INDEX CONCURRENTLY` leaves an `INVALID` index under the constraint's name; it enforces nothing, and
  its name would clash with the one the constraint creates. The migration drops such a leftover itself, but
  look first (and `indisready` must be true too):

  ```sql
  SELECT c.relname AS index_name, i.indrelid::regclass AS table_name, i.indisvalid, i.indisready
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE '%\_id\_org\_uidx'
   ORDER BY i.indisvalid, c.relname;
  ```

  Every row must show `indisvalid = t`. Drop each `f` row concurrently (it never blocks writes) and build it
  again with the statement above:

  ```sql
  SELECT format('DROP INDEX CONCURRENTLY IF EXISTS public.%I;', c.relname)
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE '%\_id\_org\_uidx' AND NOT i.indisvalid
  \gexec
  ```

  The other three parents (`receivable_installment`, `service_order_execution`, `service_order_quote`) gain
  their `organization_id` in this very migration, so their index is built by it.

- **The composite foreign keys are added `NOT VALID`.** Postgres enforces them for every new row at once, and
  the migration has already checked the existing rows (it raises, naming the table and the count, if any child
  points at another laboratory's row), so no second scan runs under the lock. After the deploy, mark them
  validated. Each `VALIDATE CONSTRAINT` runs as **its own statement in autocommit**, so every one takes only a
  `SHARE UPDATE EXCLUSIVE` lock (reads and writes continue) and releases it before the next starts; locks
  never accumulate. `\gexec` sends each generated statement separately, and re-running it is harmless (it
  lists only what is still not validated):

  ```sql
  SELECT format('ALTER TABLE %s VALIDATE CONSTRAINT %I;', conrelid::regclass, conname)
    FROM pg_constraint
   WHERE contype = 'f' AND NOT convalidated AND conname LIKE '%\_tenant\_fk'
   ORDER BY conrelid::regclass::text, conname
  \gexec
  ```

  Run it with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1` (without `-1`/`--single-transaction`, which would put
  them all back in one transaction).

- **Orphans.** A row of a non-audit child table with no parent (real corruption) makes the migration raise
  and apply nothing: fix the rows it names and run it again. An audit-log row whose entity was hard-deleted is
  expected: it is attributed from the deleted row's own snapshot when it carries one, otherwise it keeps
  `organization_id` NULL and the migration only prints a `NOTICE` with the count per table. Those rows are
  invisible to tenant-scoped reads; once they are attributed or archived,
  `ALTER TABLE <log> VALIDATE CONSTRAINT <log>_organization_id_required` makes the guarantee complete.

#### Job status guard (migration 0119) and audited status repair

Migration `0119_job_status_transition_guard` makes Postgres enforce the calibration job state machine
(`packages/schemas/src/job-transitions.ts`) with a trigger on `calibration_job`:

- an `UPDATE` that changes `status` must be a move the table allows; anything else (for example an
  `APPROVED` job back to `DRAFT`) fails with `calibra: illegal job transition APPROVED -> DRAFT`,
  SQLSTATE `CF001`. Writing the same status again is always accepted;
- an `INSERT` is accepted only in `DRAFT`.

**Existing data is not re-validated.** Rows already in a status the table would not produce do not block the
migration; only future status changes and inserts are checked. The migration is idempotent and takes a short
lock on `calibration_job`.

**Audited data repair.** A repair that must break the rule (a job stuck in a wrong status after an incident)
runs in one transaction that sets the hatch with `SET LOCAL`, so it reverts at `COMMIT`/`ROLLBACK`:

```sql
BEGIN;
SET LOCAL calibra.allow_status_repair = 'on';
-- an APPROVED or SUPERSEDED job is also frozen by the immutability trigger (migration 0115);
-- repairing one needs the second hatch as well:
-- SET LOCAL calibra.allow_audit_rewrite = 'on';
UPDATE calibration_job SET status = 'REVIEW' WHERE id = 123;
-- record the reason in job_audit_log, then:
COMMIT;
```

Run it on the **owner connection** (`DATABASE_OWNER_URL`, the role that owns the tables): since migration
0130 the hatches work for a session of the table owner only, so `calibra_app` (the application) that sets
`calibra.allow_status_repair` or `calibra.allow_audit_rewrite` lifts nothing. `calibra.allow_audit_rewrite`
(the demo seed, the records purge) lifts the guard too. Do not set either with plain `SET` or in a
connection default. When the state machine itself changes, regenerate the function with
`pnpm --filter @calibra-facil/db gen:job-transitions-sql` and ship it in a new migration; a unit test fails
while the migration and `sql/schema-extras.sql` differ from the table.

#### Evidence immutability: privileges and the owner-only hatch (migration 0130)

ISO/IEC 17025 7.5.2 and 8.4: the history of a record must not be rewritable by the application.
Migration `0130_evidence_privileges_owner_hatch` (roadmap 2, B1) makes that a property of the database:

- **Privileges.** `calibra_app` has no `UPDATE`, `DELETE` or `TRUNCATE` on the append-only evidence tables
  (the `*_audit_log` tables, `organization_event_log`, `integration_event_log`, `service_order_event_log`,
  `issued_certificate_snapshot`) and no `UPDATE` / `TRUNCATE` on `certificate_input`; it keeps `INSERT` and
  `SELECT`. The list is `packages/db/src/evidence-tables.ts`; the `REVOKE` block is generated from it
  (`pnpm --filter @calibra-facil/db gen:rls-sql evidence`) and repeated in `sql/schema-extras.sql`. A drift test
  fails when an audit or event log is added without being classified. Left to the triggers alone, each with
  the reason in that file: `calibration_job` (UPDATEd until approval), `certificate_input` `DELETE` (the revert
  of an approval), `platform_event_log` (the public-signup reservation row) and `organization`.
  The `ON DELETE SET NULL` actions of foreign keys keep working: Postgres runs them as the table owner.
- **The hatches are the owner's.** `calibra.allow_audit_rewrite`, `calibra.allow_status_repair` and
  `calibra.allow_org_purge` only take effect when the session user and the current user are the owner of the
  tables or members of that role (`calibra_session_is_owner()`). The runners are therefore the owner
  connection only: the records purge (`records-purge.ts`, `removeLabOrganization`), the demo seed, an
  operator's audited repair in `psql` as the owner, and the test harness. A deployment whose `DATABASE_URL` is
  the owner (`DATABASE_RLS_MODE=shadow`) has no protection: use the role split.

- **Hash chain (migration 0131).** `job_audit_log` carries a per-organization hash chain: `chain_seq`,
  `prev_hash` and `row_hash = sha256(prev_hash || canonical row)`, assigned by a `BEFORE INSERT` trigger that
  takes `pg_advisory_xact_lock(hashtextextended('job_audit_log:<organization>', 7041))` to the end of the
  transaction, so concurrent writers of one laboratory are serialised and cannot fork it (a unique index on
  `(organization_id, chain_seq)` refuses a fork even under REPEATABLE READ). Cost: transactions that write an
  audit row for the same laboratory run one after the other from that insert on; write the audit row last in a
  transaction (a row lock taken after it, against another transaction that takes it before, is a deadlock that
  Postgres detects and aborts). The migration chains the existing rows per organization in id order. The
  **`audit-chain-verify` cron** (daily, 04:45 UTC) recomputes every laboratory's chain, records a checkpoint of
  each intact head in `platform_event_log` (`audit.chain.verified`; this is the hook for an external timestamp,
  roadmap 2 B4) and, on a break (`row_hash_mismatch`, `prev_hash_mismatch`, `sequence_gap`, `unchained_row`,
  or `checkpoint_missing` / `checkpoint_mismatch` for a deleted or replaced tail), writes `audit.chain.broken`
  to `platform_event_log`, `audit.chain_broken` to the laboratory's event log and notifies its admins, once per
  distinct break; the run itself fails until a human resolves it. On demand:
  `pnpm --dir apps/api verify-audit-chain [--org <organization id> | --slug <slug>] [--record]` (read-only
  unless `--record`; exit code 1 on a break). Nothing is repaired automatically. The demo seed re-seals the
  chain after back-dating (`calibra_audit_chain_backfill(..., p_rebuild => true)`, owner only); do not use it on
  real data except as a deliberate, documented repair.

**Applying it.** The migration is idempotent and sets a 5 s lock timeout. Existing rows are untouched. After
it, a statement that the application should never issue (an `UPDATE` of an audit row) fails with
`permission denied for table ...`; the integration tier runs as `calibra_app`, so a legitimate path that lost
its privilege fails a test.

#### Row-level security (migration 0123) and the role split

Postgres enforces tenant isolation itself, as a second wall behind the `organization_id` predicate the
application writes (decision Q15). Migration `0123_rls_shadow_mode` (the name is historical) prepares it, and
since the cutover (P2-18k) **enforcement is the normal setup**:

- the migration creates the role `calibra_app` (`NOLOGIN`) with `CONNECT` on the database, `USAGE` on schema
  `public`, `SELECT/INSERT/UPDATE/DELETE` on every table and `USAGE` on every sequence, and the same default
  privileges for tables the migration owner creates later. `CREATE ROLE` needs the `CREATEROLE` attribute,
  which the owner of a self-hosted Postgres, Neon, RDS and Supabase has; where it is missing the migration
  stops with the fix and never skips the role (see "Hosts without `CREATEROLE`");
- it runs `ENABLE ROW LEVEL SECURITY` on every tenant table (each table of `packages/db/src/tenancy.ts` that
  carries `organization_id` / `lab_organization_id`) and adds the policy `tenant_isolation FOR ALL TO calibra_app`
  with `USING` and `WITH CHECK`
  `<org column> = NULLIF(current_setting('calibra.organization_id', true), '')::text`. Global tables
  (identity, queues, global catalogs) get no RLS;
- the application names the laboratory of every org-scoped transaction
  (`select set_config('calibra.organization_id', <org>, true)` at its start, `packages/db/src/for-org.ts`), so
  a `calibra_app` session sees and writes that laboratory's rows only. A statement that names none sees nothing
  (fail closed), a write for another laboratory is refused.

**The two connections.** The API, the worker and the CLI use two Postgres logins:

| Variable                                 | Role                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                           | `calibra_app`: the application. The policies bind it.                                                                                                    |
| `DATABASE_OWNER_URL`                     | the table owner: the **system path** (below), and the connection `db:bootstrap` / `db:migrate` / `init` use to change the schema. It is exempt from RLS. |
| `DATABASE_RLS_MODE` (default `enforced`) | `enforced`: the application must be a role RLS binds. `shadow`: diagnosis only, the application connects as the owner.                                   |

- **Docker Compose does all of it.** `deploy/compose.yaml` sets both URLs; `init` runs `db:bootstrap` as the
  owner, which creates the `calibra_app` login with the password `CALIBRA_APP_PASSWORD` of `deploy/.env`
  (`./setup.sh` generates it) on every start, so rotating the password is editing `.env` and
  `docker compose up -d`.
- **Your own Postgres.** Run `db:bootstrap` (or `init`) once as the owner with both URLs set,
  `DATABASE_URL=postgres://calibra_app:<password>@host/db` and `DATABASE_OWNER_URL=<the owner's URL>`: it applies the
  migrations (migration 0123 creates the role `calibra_app`) and then, because the application URL names
  `calibra_app`, gives that role `LOGIN` and the password of the URL, on every run (a password change is an edit and a
  rerun). Nothing else about the role is touched, so it works for a non-superuser owner with `CREATEROLE` (Neon, RDS,
  Supabase). By hand, once the role exists (the migration created it), as the owner or an admin role:

  ```sql
  ALTER ROLE calibra_app LOGIN PASSWORD '<strong password>';
  ```

  (`CREATE ROLE`'s defaults are the right ones: not a superuser, no `BYPASSRLS`, no `CREATEDB`, no `CREATEROLE`; start-up
  refuses an application role that has any of the first two.) A separate login that is a member of the role works as
  well: `CREATE ROLE calibra_api LOGIN PASSWORD '...' IN ROLE calibra_app;` (keep `INHERIT`, the default).

- **Development.** `pnpm setup:dev` does the same against the compose Postgres: `apps/api/.env` and
  `apps/worker/.env` carry `DATABASE_URL=postgres://calibra_app:calibra_app@localhost:55432/calibra` and
  `DATABASE_OWNER_URL=postgres://calibra:calibra@localhost:55432/calibra`; `packages/db/.env` stays the owner
  (drizzle-kit, the seeds). An `.env` from before the cutover is rewritten that way by `pnpm setup:dev`.

**Start-up refuses a connection that would hide data or skip the wall.** The API and the worker run one catalog
query (two with `enforced`) before they serve, and stop with a message naming the variable:

- `enforced` and `DATABASE_OWNER_URL` unset: refused (Q40), because the system path would run as the
  application role and silently see nothing;
- `enforced` and `DATABASE_URL` is the table owner, a superuser or a `BYPASSRLS` role, owns even ONE tenant
  table, or is a member of such an owner (with or without `INHERIT`: it could `SET ROLE` to it): refused (RLS would
  not apply to the application, at least on some table; nobody would notice). To run as the owner knowingly, set
  `DATABASE_RLS_MODE=shadow`, which logs a loud warning when `NODE_ENV=production`;
- `enforced` and `DATABASE_OWNER_URL` is a role RLS binds: refused (the system path would match no row);
- `shadow` and `DATABASE_URL` is a role RLS binds: refused (statements without an organization would
  silently match no row);
- before migration 0123, when no table has RLS enabled yet, the role checks pass.

The migration itself stops (`calibra: migration 0123 is run as <role>, which is neither the owner ...`) before
changing anything when run by a role RLS would bind, so run migrations as the owner.

**Upgrading an existing installation.** Before this release the API and worker connected as the table owner
with `DATABASE_RLS_MODE` unset (`shadow`). The default is now `enforced`, so an upgrade that changes nothing
fails at start-up with the messages above, on purpose. Do, once:

1. Docker Compose: add `CALIBRA_APP_PASSWORD=<random>` to `deploy/.env` (for example
   `echo "CALIBRA_APP_PASSWORD=$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')" >> .env`), then
   `docker compose pull && docker compose up -d`: `init` creates the login and the new compose file wires the
   URLs. Nothing else changes.
2. Your own Postgres and processes, in this order (the role does not exist before migration 0123, so the login
   cannot be created first): (a) with the OLD application still running, run `init` / `db:bootstrap` as the owner
   with `DATABASE_OWNER_URL=<what DATABASE_URL is today>` and
   `DATABASE_URL=postgres://calibra_app:<new password>@host/db`: it migrates, which creates `calibra_app`, and gives it
   the login; (b) then switch the API and the worker to `DATABASE_URL=postgres://calibra_app:<password>@host/db` and
   `DATABASE_OWNER_URL=<the old URL>`, leave `DATABASE_RLS_MODE` unset (or `enforced`), run `pnpm config:check`, and
   restart.
3. To go back, set `DATABASE_RLS_MODE=shadow` and `DATABASE_URL` to the owner (the policies stay, the owner
   bypasses them); nothing else changes.

**Verify** as `calibra_app`: `select count(*) from calibration_job;` returns `0`; inside
`begin; select set_config('calibra.organization_id', '<org id>', true); select count(*) from calibration_job; commit;`
it returns that laboratory's jobs only.

**Hosts without `CREATEROLE`.** If the migration owner cannot create roles, the migration stops with
`the role calibra_app does not exist and <role> may not create it`. An administrator (a role with
`CREATEROLE`, or a superuser) runs this once, and the migration is run again; it skips creation when the role
exists:

```sql
CREATE ROLE calibra_app NOLOGIN;
```

**Locks and retry.** The migration starts with `SET LOCAL lock_timeout = '5s'` and `ALTER TABLE ... ENABLE ROW
LEVEL SECURITY` takes a short exclusive lock on each tenant table. If a long query holds one, the migration
fails fast with `canceling statement due to lock timeout` (SQLSTATE `55P03`) instead of queueing every request
behind it. It runs in one transaction and is idempotent, so a failed attempt changes nothing: wait for the
query to finish, or pick a quiet moment, and run `db:migrate` again. `db:migrate` connects as the owner
(`DATABASE_OWNER_URL` when set, else `DATABASE_URL`, see `packages/db/drizzle.config.ts`), never as `calibra_app`.

**Why the tables are not `FORCE`d.** A table owner is exempt from RLS unless the table is `FORCE`d. Forcing
would also bind the owner, and the owner legitimately runs statements that no single organization can name:
Better Auth (sessions, the organization plugin), the lookups that learn a laboratory, the cross-laboratory
sweeps, the global `asset_type` write fan-out, the migrations and the CLI. The policies are addressed to
`calibra_app` only, so under `FORCE` the owner would match no policy and see nothing; giving it a second,
all-allowing policy would add nothing. The protection against an accidental owner connection is the start-up
check above (the application refuses to run as a role RLS does not bind), not `FORCE`.

- **The system path (`DATABASE_OWNER_URL`).** A few statements are cross-laboratory on purpose and cannot name
  one organization first: the lookup that learns which laboratory a request belongs to (the portal's host
  name, the portal customer scope, a public certificate token), reads over a bounded set of laboratories
  (a portal customer user of several), notification fan-out, the identity layer (Better Auth's own statements, the
  sign-in gate by e-mail, a person's memberships at sign-in, an invitation by its id, a setup token by its id:
  all before an organization is chosen), the cross-laboratory sweeps (records purge, change-log and
  certificate-drift lists) and writes to the global `asset_type` catalog
  (its change-log trigger writes to every laboratory's log, which `calibra_app` may not do; only the seed writes it).
  The operator CLI (`apps/api/src/cli`) runs as the owner on the same path. They use the named
  `systemDb` of `@calibra-facil/db`, which connects with `DATABASE_OWNER_URL`. Better Auth (sessions, the
  organization plugin) runs on this owner connection too, guarded by its own membership and role checks
  (pinned by `identity-org-plugin-deny.int.spec.ts`), not by RLS. Every use is a reviewed entry
  of `apps/api/test/integration/tenant-sql-allowlist.ts`, and routes may not import it.
- **The worker.** It connects like the API (`calibra_app` plus `DATABASE_OWNER_URL`). A queue message names a
  job, not its laboratory: the worker learns the laboratory with one lookup on the system path, and every
  other statement of the job (the frozen input or the legacy live read, the signing certificate, the issuance
  transaction, the audit rows, the failure rejection) runs in a transaction that names it
  (`set_config(..., true)`). The other handlers do the same: the scheduled compliance sweep, the audit packs,
  the service-order and out-of-tolerance documents, the sender-domain health cron and the generic-HTTP
  integration sync list or look up the laboratory on the system path and then work per laboratory. The queue
  claim, the stale-lease recovery and the stuck-render sweep list across laboratories and stay on the owner
  (`systemDb`); the queue table itself has no RLS.
- **Pooler mode.** Transaction pooling (PgBouncer `pool_mode = transaction`, Neon's pooled endpoint,
  Supavisor) is fine: `set_config(..., true)` is transaction-local, so the organization lives and dies with
  the transaction and never reaches the next client on the same server connection. A statement outside
  a transaction sets nothing and sees nothing as `calibra_app`; that is deliberate (fail closed).
  Session pooling is fine too. Do not set `calibra.organization_id` with a plain `SET` or in a role or
  connection default.
- **Rollback.** `DATABASE_RLS_MODE=shadow` plus `DATABASE_URL` pointing at the owner, then restart. Nothing else
  changes: the policies stay in place and the owner bypasses them. To remove the login for good:
  `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM calibra_app; ALTER ROLE calibra_app NOLOGIN;` (the policies
  and the role can stay).
- **Diagnosis.** `pnpm --filter @calibra-facil/api rls:shadow-report` (it needs Docker, like the integration
  tier) replays every API integration spec with the requests' database access as `calibra_app` and lists, by
  spec file, what breaks and every statement that reached a tenant table with no organization set. The
  integration tier itself runs the requests as `calibra_app` (see `docs/architecture/org-bound-db.md`).
- **New tenant tables.** A migration that adds a table with an organization column must also carry the
  regenerated block (`pnpm --filter @calibra-facil/db gen:rls-sql`) in a new migration and in
  `sql/schema-extras.sql`; `packages/db/src/rls-sql.test.ts` fails until it does, so a table never reaches
  `calibra_app` without its policy.

#### Queue idempotency and lease fencing

Queue delivery is at-least-once: a `PROCESSING` row whose lease expired (`QUEUE_STALE_AFTER_MS`) is
handed to another worker. Two guards keep a duplicate or a slow worker from doing harm:

- **Lease fencing.** A worker may complete or fail a queue row only while it still holds the lease
  (`locked_by` is its `WORKER_ID` and the row is `PROCESSING`). A worker whose lease expired and
  whose row was reclaimed can no longer overwrite the new owner's state: its late completion or
  failure is ignored and logged as `[Queue] fenced out ...`, never retried. Nothing to configure.
- **Idempotency receipts** (`QUEUE_RECEIPTS_MODE`). Each delivery unit claims a receipt before it runs.
  - `enforce` (default, also for an unset or unrecognised value): a duplicate of a unit that already
    completed is skipped, and a unit whose lease another worker holds is retried later instead of
    running twice.
  - `shadow`: duplicates are only logged (`[QueueReceipt] duplicate delivery`) and still run. Use it
    to observe duplicates without trusting the ledger.
  - `off`: no receipts at all.

Existing deployments that did not set `QUEUE_RECEIPTS_MODE` ran in `shadow` and now enforce. Set
`QUEUE_RECEIPTS_MODE=shadow` to keep the old behaviour. If the ledger table is unreachable the unit
runs anyway (fail open), so enforcement never blocks a job on bookkeeping.

#### Minimum desktop version

The desktop app pushes its offline work to `POST /api/sync/push` with the protocol it speaks
(`protocolVersion`) and its own version (`desktopVersion`). `SYNC_MIN_DESKTOP_VERSION`
(`MAJOR.MINOR.PATCH`, for example `1.4.0`) is the oldest desktop build the cloud still takes pushes
from. Unset (the default) there is no minimum: every build, including those that predate
versioning, is accepted exactly as before.

Setting it does two things:

- **A desktop below the minimum, or one that reports no version (a build from before versioning), is
  answered `426` with `{ "code": "DESKTOP_UPDATE_REQUIRED", "minimumVersion", "desktopVersion",
"message" }`.** Nothing in the request is applied, claimed or refused for good: the desktop
  leaves every queued event exactly as it is (not failed, not backing off, not dead-lettered),
  shows an "update required" notice in Portuguese and keeps the changes until the person
  updates the app, after which they are sent normally.
- **The legacy exemption of the calibration record rule ends.** A job submit from a build that
  predates the rule (its event carries no `executionPayloadVersion` stamp) used to be applied
  without requiring the calibration location and the reasons for phase blocks not performed,
  so that upgrading did not dead-letter the outbox; its audit row says
  `calibrationRecordCheck: "legacy_exempt"`. With a minimum configured every desktop that gets
  through is new enough to stamp its events, so an unstamped submit is held to the rule like
  any other and refused with `CALIBRATION_RECORD_INCOMPLETE` (a permanent refusal: it
  waits in the desktop's refused list for a person).

Roll it out in this order: ship the desktop build that carries the version and the stamp,
wait until the laboratories have updated and drained their queues (the audit rows of
`submit` with `legacy_exempt` stop appearing), then set the minimum to that build's version. The
value is checked when the API starts: anything that is not a version stops it with a message
naming `SYNC_MIN_DESKTOP_VERSION`, because a minimum that cannot be read would silently keep
the exemption open.

#### Desktop push permissions and offline attachments (sync protocol 4)

Design and tables: `docs/architecture/sync-push-rbac-attachments.md`.

- **Per-operation permissions.** `POST /api/sync/push` no longer gates the whole request on
  `calibration:create`: each event is checked against the permission of the online route that does
  the same thing, with the pushing member's effective role. The unit role counts for the event's own
  unit (`event.unitId`, then `payload.unitId`, then the active unit), not for the active unit alone:
  the desktop sends no `x-active-unit-id` header, so a member who is a technician in one unit and a
  plain member in another is judged in the unit the event is applied to. A denied event is answered
  `SYNC_PERMISSION_DENIED`, a permanent refusal: a desktop of this version moves it to its refused
  list, where a person discards it or re-queues it after a role change. A desktop that predates the
  code (protocol 3 or earlier) does not know it and treats an unknown code as transient, so it
  retries the event with backoff (noise, not loss) until a person discards it. Nothing is applied or
  claimed for a denied event, and a retry of an event that was already applied is acknowledged even
  after a role downgrade. There is nothing to configure; a member who only holds service-order rights
  (for example the `member` role) can now push the service orders they may create online.
- **Attachment files.** A desktop of protocol 4 uploads an attachment's file before pushing its
  `create_local_attachment` event: `init-upload` returns a presigned PUT bound to the declared size and
  content type (the store must honour the signed `content-length` and `content-type` headers; the
  self-hosted S3 gateway does, and `complete-upload` re-verifies size, type and SHA-256 whatever the
  store does), `complete-upload` reads the object back and records it in the organization event log
  (`sync_attachment.upload_completed`), and the event is refused (`SYNC_ATTACHMENT_NOT_UPLOADED`) unless
  that record exists and the object is unchanged. Accepted types: JPEG, PNG, WebP, HEIC/HEIF, PDF,
  plain text; at most 25 MiB. The objects live under `org/<id>/sync-attachments/` in
  `R2_BUCKET_NAME` (the documents bucket): include that prefix in its backup and retention policy.
- **Compatibility.** The push wire format is unchanged. A desktop of protocol 3 or earlier cannot upload
  files, so its attachment events are refused for good with `SYNC_ATTACHMENT_UPLOAD_UNSUPPORTED` (before
  this change they were acknowledged without any file, which is how field evidence stayed on the
  laptop). That code is permanent only for a desktop that knows it; an older desktop treats it as an
  unknown code and retries with backoff until the app is updated, after which its attachments upload
  and are sent normally. On its first start the updated desktop also queues again every attachment an
  older build had marked synced without a remote key.
- **Rolling the cloud.** A protocol 4 desktop against a cloud that predates protocol 4 is answered
  `SYNC_PROTOCOL_UNSUPPORTED` and pushes again with protocol 3, as for protocol 3 above, **without its
  attachment events**: such a cloud acknowledges an attachment event without verifying any file
  (the audit-only behaviour this change removes), so the desktop keeps them pending instead. It
  remembers the downgrade for ten minutes, then asks with protocol 4 again, so attachments flow once the
  cloud is upgraded; the same holds for the pull and bootstrap, which keep stating protocol 3.
  Against a protocol 3 cloud the upload endpoints exist but verify nothing server-side. Upgrade the
  cloud before relying on offline attachments. `SYNC_MIN_DESKTOP_VERSION` need not be raised for this
  change.

#### Desktop change log (sync protocol 3)

Protocol 3 replaces the `updatedAt` pull cursor and the one-shot bootstrap of protocols 1 and 2
(design and correctness argument: `docs/architecture/sync-change-seq.md`).

- **Migration `0122_sync_change_log`** creates `sync_change_log` (one row per change of a table the
  desktop mirrors, written by triggers in the writer's own transaction) and
  `sync_change_log_purge`. It backfills nothing: a desktop on protocol 3 starts from a bootstrap, whose
  cursor is the current position. Apply it before deploying the API that serves protocol 3 (a
  desktop that asks for protocol 3 before the table exists gets a 500 on pull).
- **What a desktop of protocol 3 does.** It states `protocolVersion: 3` on the bootstrap request and
  as `?protocolVersion=3` on the pull. The cloud then bootstraps in pages (`page.nextToken`; the
  desktop resumes an interrupted bootstrap from the last page it applied) and pulls the change log by
  position. A desktop that upgrades from protocol 2 holds an `updatedAt` cursor the log cannot serve:
  the cloud answers its first protocol 3 pull `409 { "code": "SYNC_RESYNC_REQUIRED" }` and the
  desktop bootstraps again (its queued local changes are untouched: a bootstrap never overwrites a
  row with queued changes).
- **Desktops of protocol 1 and 2 keep working.** A bootstrap or pull that does not state protocol 3
  gets the old behaviour, unchanged, with a `Deprecation: true` header. A desktop of protocol 3 against
  a cloud that predates it gets the old answers too (the cloud ignores the field on the bootstrap and
  the pull) and reads them as before. Its push states protocol 3, which the older cloud refuses with
  `400 SYNC_PROTOCOL_UNSUPPORTED { supportedProtocolVersion }`; the push format did not change, so the
  desktop sends the same push again, once, with the protocol the cloud names, and remembers it for
  that cloud (queued events are neither failed nor delayed). The order of the rolling deploy
  therefore does not matter. The legacy path is deleted once
  `SYNC_MIN_DESKTOP_VERSION` is set to the first build that speaks protocol 3 (see _Minimum desktop
  version_ above: those desktops are refused at push, so they only pull, and a pull without changes
  to push is harmless): remove `loadCloudSyncEventsSince`, the legacy branch of `GET /api/sync/pull`
  and of `POST /api/sync/bootstrap`, and `modules/sync/pull-cursor.ts`.
- **Retention.** The `sync-change-log-purge` cron (daily, 04:15 UTC) deletes entries older than
  `SYNC_CHANGE_LOG_RETENTION_DAYS` (default `90`, minimum `7`; an unusable value means the default)
  and records, per laboratory, the newest position it removed. A desktop that was offline longer than
  that finds its cursor below the recorded position and is told `SYNC_RESYNC_REQUIRED` with reason
  `cursor_purged`: it bootstraps again, which also removes the mirror rows the cloud deleted in the
  meantime. Nothing to configure on the desktop.
- **Latency, never loss.** The pull serves only entries of transactions older than the oldest
  transaction still in flight (`pg_snapshot_xmin`), which is what makes it impossible to skip a row. A
  write transaction that stays open for a long time anywhere in the database cluster (another
  database included) holds the horizon back: desktops keep pulling, they just see nothing new
  until it ends. Keep write transactions short, and set `idle_in_transaction_session_timeout`
  on the database so that a stuck client cannot hold the horizon forever.

#### Certificates stuck in generation

A certificate is `GENERATING_PDF` from approval until the worker issues it. The worker rejects it
itself when a render fails for good, but it cannot when the process dies mid-render (out of
memory, a crash) or when its queue row is gone after the retries. The `queue-backstop`
job covers both, so such a certificate ends up `REJECTED` (reason `Erro ao gerar certificado: ...`,
plus a `job_audit_log` entry) and can be sent for approval again, instead of staying
`GENERATING_PDF` forever:

- A queue row whose lease expired (`QUEUE_STALE_AFTER_MS`, default 10 minutes) on its final
  attempt (`attempts >= max_attempts`) is dead-lettered to `FAILED` instead of being re-queued, so a
  job that crashes the worker is not retried forever. Rows with attempts left are re-queued as
  before. The certificate that row was rendering is rejected.
- A certificate that has been `GENERATING_PDF` for longer than `STUCK_RENDER_AFTER_MS` (default
  `3600000`, 60 minutes, counted from its last update) and has no `PENDING` or `PROCESSING` queue
  row is rejected the same way. Keep it well above the longest render plus the retry
  window, so a certificate that is still being retried is not rejected.

Only a job still in `GENERATING_PDF` is rejected. An `APPROVED` or `SUPERSEDED` certificate, its
issued snapshot and its number are never touched. Every automatic rejection is recorded in
`job_audit_log` with `changes.source = "queue-backstop"` and `changes.reason` set to
`dead-lettered` or `stuck-render`. `rejected_by` and the audit `performed_by` name the user who
released the certificate (there is no system user), so that marker is how an automatic rejection
is told apart from the approver's own action.

The backstop runs on the `queue-backstop` cron, every 30 minutes, so
recovery is not immediate: a crashed job is dead-lettered after its lease expires (default 10
minutes) plus up to 30 minutes until the next run, and a certificate with no queue row is rejected at
`STUCK_RENDER_AFTER_MS` plus up to 30 minutes. The drain on the always-on worker also
dead-letters expired leases each time it wakes, so it can be faster there.

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
