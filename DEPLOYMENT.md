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
`environment` and `release` come from `VERCEL_ENV`/`NODE_ENV` and `VERCEL_GIT_COMMIT_SHA` when set.

With Docker, read them with `docker compose logs`:

```bash
docker compose logs -f api worker                                          # follow
docker compose logs --no-log-prefix api worker | grep '"level":"error"'    # errors only
```

To keep or alert on them, point the Docker logging driver at your collector (journald, Loki,
Fluent Bit, CloudWatch, ...) or ship `docker compose logs` to it, and match on `"level":"error"`.
Set `max-size`/`max-file` on the `json-file` driver (or use the `local` driver) so container logs
cannot fill the disk. The browser apps send nothing off the device: a route error is written to
the browser console only.

### Using hosted services instead

Each dependency can move out of the compose file: delete its service and point the variables
in the `x-app-env` block of `compose.yaml` elsewhere (`DATABASE_URL` for a managed PostgreSQL,
`R2_*` for Cloudflare R2 or S3, `GOTENBERG_URL`). With a hosted object store, remove
`R2_PUBLIC_ENDPOINT` and the `FILES_URL` site in the `Caddyfile`. Resend works instead of
SMTP: set `RESEND_API_KEY` and leave `SMTP_HOST` empty.

## Upgrading to this release

Configuration is now validated when each process starts (see [Configuration](#configuration)):
**the API, the worker and the local server refuse to start, with one message listing every
problem, when production is missing a required variable or one has the wrong shape.** Before,
most of these only failed at first use, deep inside a request, or never. Check your environment
**before** you deploy.

**Newly required in production** (`NODE_ENV=production`, or any Vercel deployment):

| Variable                     | Who is affected                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRON_SECRET`                | Bun and hand-built images. Without it the API used to start and every `/api/cron/*` job answered 503. (Docker Compose and Vercel already require it.) |
| `QUOTE_APPROVAL_CODE_PEPPER` | Bun and hand-built images. Only Vercel enforced it; elsewhere a built-in development pepper was used silently. (Docker Compose already requires it.)  |
| `API_URL` and `APP_URL`      | Everyone who left one out. The auth layer used to throw on first use.                                                                                 |
| `R2_MEDIA_BUCKET_NAME`       | The worker, which used to fall back to a development bucket name.                                                                                     |

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
`RECORDS_PURGE_MODE`, `CRON_SCHEDULER`, `BACKGROUND_JOBS_MAX_DELIVERIES`,
`STUCK_RENDER_AFTER_MS`, `QUEUE_STALE_AFTER_MS`, `DATABASE_POOL_MAX`) keep it: an unusable value still means the default.

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
ones you do not have yet).

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

- Each process validates its configuration when it starts (the API's Bun entry and Vercel
  functions, the worker, the local server). A bad deploy fails immediately with one error that
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

| Variable                                                                                            | Notes                                                                                 |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `NODE_ENV=production`                                                                               |                                                                                       |
| `DATABASE_URL`                                                                                      | PostgreSQL connection string                                                          |
| `API_URL`, `APP_URL`, `PORTAL_APP_URL`                                                              | Public URLs (`API_URL` = `APP_URL` when the API is served under `/api`)               |
| `VERIFY_URL`                                                                                        | Optional; host of the verification page (defaults to `PORTAL_APP_URL`)                |
| `BETTER_AUTH_SECRET`                                                                                | ≥ 32 random characters                                                                |
| `AUTH_COOKIE_DOMAIN`                                                                                | e.g. `.example.com` when the API and the apps are on different subdomains             |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`                               | Outgoing e-mail; or `RESEND_API_KEY` for Resend (`EMAIL_TRANSPORT` picks when both)   |
| `EMAIL_FROM`                                                                                        | Sender, e.g. `"Laboratório <calibra@example.com>"`                                    |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                                                          | Object-storage credentials                                                            |
| `R2_BUCKET_NAME`, `R2_MEDIA_BUCKET_NAME`                                                            | Documents bucket (regulated records) and media bucket (logos, etc.)                   |
| `R2_ACCOUNT_ID` **or** `R2_ENDPOINT` (+ `R2_REGION`)                                                | Cloudflare R2 account, or the endpoint of any S3-compatible store                     |
| `R2_PUBLIC_ENDPOINT`                                                                                | Optional; the store's public address when `R2_ENDPOINT` is internal (download links)  |
| `GOTENBERG_URL` (+ `GOTENBERG_TOKEN`)                                                               | PDF rendering                                                                         |
| `SIGNING_MASTER_KEY`, `INTEGRATIONS_MASTER_KEY`, `PUBLIC_API_MASTER_KEY`, `EMAIL_DOMAIN_MASTER_KEY` | 32 random bytes each, base64 (`openssl rand -base64 32`); never reuse one key twice   |
| `SIGNING_TSA_URL` (+ `SIGNING_TSA_AUTH`, `SIGNING_TSA_ICP_CONFORMANT`, `SIGNING_TSA_TIMEOUT_MS`)    | Optional RFC 3161 time-stamping of certificates: see _Certificate time-stamping_      |
| `QUOTE_APPROVAL_CODE_PEPPER`, `CRON_SECRET`                                                         | Random strings                                                                        |
| `PORTAL_SERVICE_USER_ID`                                                                            | Id of the account that owns client-portal organizations (`init` creates it)           |
| `BACKGROUND_JOBS_MODE`                                                                              | `local` (inside the API process), `queue` (a separate worker) or `vercel`             |
| `BACKGROUND_JOBS_MAX_DELIVERIES`                                                                    | Optional, default `3`: Vercel deliveries before a certificate is rejected             |
| `STUCK_RENDER_AFTER_MS`                                                                             | Optional, default `3600000` (60 min): see _Certificates stuck in generation_ below    |
| `QUEUE_RECEIPTS_MODE`                                                                               | Optional, default `enforce`; `shadow`/`off` opt out: see _Queue idempotency_ below    |
| `CRON_SCHEDULER=internal`                                                                           | Run the scheduled jobs inside the API (see below)                                     |
| `RECORDS_PURGE_ENABLED`                                                                             | Optional, default `false`: enables the `records-purge` cron (see _Records retention_) |
| `RECORDS_PURGE_MODE`                                                                                | Optional, default `dry-run`; only `execute` deletes (see _Records retention_)         |

Extra origins for CORS and auth can be listed in `CORS_ALLOWED_ORIGINS` and
`AUTH_TRUSTED_ORIGINS`. The Conta Azul ERP integration needs no server setup: each laboratory
registers its own application on Conta Azul's developer portal and pastes the Client ID and
Secret in **Configurações → Integrações**, which shows the redirect URL to register
(`API_URL` + `/api/integrations/conta-azul/oauth/callback`). To supply one application to every
laboratory instead, set `CONTA_AZUL_CLIENT_ID` and `CONTA_AZUL_CLIENT_SECRET`
(`CONTA_AZUL_OAUTH_REDIRECT_URI` overrides the redirect URL).

#### Certificate time-stamping (RFC 3161)

Set `SIGNING_TSA_URL` to the endpoint of a time-stamp authority and every signed certificate gets
a carimbo do tempo (PAdES-T). The other variables are optional: `SIGNING_TSA_AUTH` is the full
`Authorization` header value of a contracted authority (`Basic ...` or `Bearer ...`),
`SIGNING_TSA_TIMEOUT_MS` the request timeout (1000 to 120000, default 30000), and
`SIGNING_TSA_ICP_CONFORMANT=true` is to be set **only** for a credentialed ICP-Brasil authority:
otherwise the signature records `icpBrasilConformant: false`, so a generic authority is never
presented as legally conformant. The settings are validated at start-up (the address must be an
`http://` or `https://` URL).

They take effect on **every worker path**: the Vercel Queue consumer and cron handlers, the
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
- Keep the worst case inside the function's time limit. An unreachable authority that hangs costs
  up to `4 × SIGNING_TSA_TIMEOUT_MS + 7 seconds` per delivery (127 seconds at the default 30000),
  on top of the render itself. The Vercel Queue function (`api/queues/background.js`) has a
  `maxDuration` of 300 seconds, so keep `SIGNING_TSA_TIMEOUT_MS × 4` well under it: a timeout above
  about 60000 can exhaust the function before the delivery fails cleanly. A value that large is
  accepted by the validation (the maximum is 120000) but is not recommended.
- While the queue still has deliveries left (Vercel: `BACKGROUND_JOBS_MAX_DELIVERIES`, default 3;
  database queue: the row's `max_attempts`), the job stays `GENERATING_PDF` and the message is
  redelivered, so a short outage of the authority heals itself.
- On the final delivery the job is `REJECTED`, with the reason `Falha na assinatura digital do
certificado: Falha ao obter carimbo do tempo RFC 3161 ...`, and can be sent for approval again
  once the authority is back. Runners that never redeliver (the inline and local ones) treat the
  first failure as final.

Laboratories that sign certificates therefore depend on the authority being available: monitor
it, or leave `SIGNING_TSA_URL` empty until you have a contracted one.

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
| `records-purge`        | `0 5 * * 0`    |

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

The `records-purge` cron (weekly, `apps/api/vercel.json`) is the only thing that can remove such a
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

#### Queue idempotency and lease fencing

Queue delivery is at-least-once: Vercel Queue redelivers a message until it is acknowledged, and a
`PROCESSING` row whose lease expired (`QUEUE_STALE_AFTER_MS`) is handed to another worker. Two
guards keep a duplicate or a slow worker from doing harm:

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

#### Certificates stuck in generation

A certificate is `GENERATING_PDF` from approval until the worker issues it. The worker rejects it
itself when a render fails for good, but it cannot when the process dies mid-render (out of
memory, a crash) or when a Vercel Queue message is dropped after its retries. The `queue-backstop`
job covers both, so such a certificate ends up `REJECTED` (reason `Erro ao gerar certificado: ...`,
plus a `job_audit_log` entry) and can be sent for approval again, instead of staying
`GENERATING_PDF` forever:

- A queue row whose lease expired (`QUEUE_STALE_AFTER_MS`, default 10 minutes) on its final
  attempt (`attempts >= max_attempts`) is dead-lettered to `FAILED` instead of being re-queued, so a
  job that crashes the worker is not retried forever. Rows with attempts left are re-queued as
  before. The certificate that row was rendering is rejected.
- A certificate that has been `GENERATING_PDF` for longer than `STUCK_RENDER_AFTER_MS` (default
  `3600000`, 60 minutes, counted from its last update) and has no `PENDING` or `PROCESSING` queue
  row is rejected the same way. Keep it well above the longest render plus the Vercel Queue retry
  window: a Vercel delivery is not tracked by a queue row, so the threshold is the only thing
  protecting a certificate that is still being retried.

Only a job still in `GENERATING_PDF` is rejected. An `APPROVED` or `SUPERSEDED` certificate, its
issued snapshot and its number are never touched. Every automatic rejection is recorded in
`job_audit_log` with `changes.source = "queue-backstop"` and `changes.reason` set to
`dead-lettered` or `stuck-render`. `rejected_by` and the audit `performed_by` name the user who
released the certificate (there is no system user), so that marker is how an automatic rejection
is told apart from the approver's own action.

The backstop runs on the `queue-backstop` cron, every 30 minutes (`apps/api/vercel.json`), so
recovery is not immediate: a crashed job is dead-lettered after its lease expires (default 10
minutes) plus up to 30 minutes until the next run, and a dropped Vercel message is rejected at
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

### Vercel

`apps/api`, `apps/web` and `apps/portal` each ship a `vercel.json`. Create one Vercel project
per app with the app directory as its root, set the environment variables above
(`BACKGROUND_JOBS_MODE=vercel` for the API), and Vercel runs the crons and the background-job
queue declared in `apps/api/vercel.json`.

### Updating

Pull the new version, run `pnpm --dir apps/api init` **before** deploying the new code (new
columns are read as soon as the code ships), then deploy the API, worker and frontends
together.
