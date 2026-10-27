# Compose hardening

What `deploy/compose.yaml`, the Dockerfiles and `deploy/Caddyfile` do to keep the one-server
deployment from failing in the ways a default Docker setup does. Backups have their own runbook:
[`backup-restore.md`](./backup-restore.md).

## Logs

Every service uses Docker's `json-file` driver with rotation: `LOG_MAX_SIZE` (default `10m`) times
`LOG_MAX_FILE` (default `5`), so a container keeps at most 50 MB of logs and the disk cannot fill
with them. `docker compose logs` reads what is kept. To keep logs longer, ship them (journald, Loki,
Fluent Bit...) with your own logging driver; the application's errors are one JSON line each
(DEPLOYMENT.md, "Logs and errors").

## Restart policy and health

| Service     | Restart          | Healthcheck                                                                                    |
| ----------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `caddy`     | `unless-stopped` | Caddy's admin endpoint answers (`:2019/config/`)                                               |
| `init`      | `no` (one-shot)  | none: it runs to completion on every `up`; the API and worker wait for it                      |
| `api`       | `unless-stopped` | `GET /api` on port 3000                                                                        |
| `worker`    | `unless-stopped` | the poll loop's heartbeat file (`/tmp/calibra-worker-heartbeat`) was touched in the last 5 min |
| `web`       | `unless-stopped` | `GET /` on port 8080                                                                           |
| `portal`    | `unless-stopped` | `GET /` on port 8080                                                                           |
| `postgres`  | `unless-stopped` | `pg_isready` over TCP                                                                          |
| `s3`        | `unless-stopped` | the gateway's port accepts connections (it answers every unsigned request with 403)            |
| `gotenberg` | `unless-stopped` | `GET /health`                                                                                  |
| `mailpit`   | `unless-stopped` | none (optional test inbox)                                                                     |
| `backup`    | `unless-stopped` | a backup finished in the last 36 hours                                                         |

`docker compose ps` shows the state. Docker does not restart a container only because it is
`unhealthy`: the status is for you and for `depends_on: condition: service_healthy`. Watch it with
your monitoring (`docker events --filter event=health_status`). The worker has no port, so its
heartbeat file is the liveness signal: each poll tick (every two seconds, and around every job)
rewrites it, and a worker whose loop is stuck turns `unhealthy` after five minutes. A very long
render (more than five minutes in one job) shows as unhealthy too.

## Memory limits

Every service has a `mem_limit` that an environment variable overrides (`.env.example`, "Logs and
memory limits"). The defaults suit a laboratory on a 4 GB server; they are ceilings, not
reservations, so the sum may exceed the RAM:

| Service     | Variable              | Default | Idle use, measured                           |
| ----------- | --------------------- | ------- | -------------------------------------------- |
| `api`       | `MEM_LIMIT_API`       | `1g`    | about 170 MB                                 |
| `worker`    | `MEM_LIMIT_WORKER`    | `1g`    | about 120 MB                                 |
| `init`      | `MEM_LIMIT_INIT`      | `1g`    | one-shot                                     |
| `web`       | `MEM_LIMIT_WEB`       | `192m`  | a few MB                                     |
| `portal`    | `MEM_LIMIT_PORTAL`    | `192m`  | about 75 MB                                  |
| `postgres`  | `MEM_LIMIT_POSTGRES`  | `1g`    | about 125 MB                                 |
| `s3`        | `MEM_LIMIT_S3`        | `512m`  | about 40 MB                                  |
| `gotenberg` | `MEM_LIMIT_GOTENBERG` | `1536m` | about 30 MB, Chromium spikes while rendering |
| `caddy`     | `MEM_LIMIT_CADDY`     | `256m`  | about 15 MB                                  |
| `mailpit`   | `MEM_LIMIT_MAILPIT`   | `128m`  |                                              |
| `backup`    | `MEM_LIMIT_BACKUP`    | `256m`  |                                              |

A service that restarts with exit code 137 (`docker inspect -f '{{.State.OOMKilled}}'`) was killed
for memory: raise its limit. On a host with more RAM, raise PostgreSQL's first (and its
`shared_buffers`, which the image leaves at 128 MB).

## Unprivileged containers

The four application images (`Dockerfile.api`, `.worker`, `.document-worker`, `.static`) end with
`USER bun` (uid 1000, built into the Bun base image). The code is owned by root and read-only to
that user, the ports are above 1024, and nothing writes to disk except `/tmp` (the worker's
heartbeat file): files live in the database and the object store. Compose also drops every Linux
capability and sets `no-new-privileges` on `init`, `api`, `worker`, `web` and `portal`.

The other images are third-party and keep their own users: `gotenberg` already runs as its own user;
`postgres` starts as root to fix the data directory permissions and then drops to `postgres`;
`caddy` and the Versity gateway (`s3`) run as root inside their container (Caddy binds ports 80/443).
Only Caddy publishes ports.

If you build the images yourself and mount a volume into one of them, make it writable by uid 1000.

## Database timeouts

The application connects as `calibra_app`. `init` (which runs on every start, through
`pnpm db:bootstrap`) sets two session limits on **that role only**, with `ALTER ROLE ... SET`:

| Setting                               | Default             | Variable                                |
| ------------------------------------- | ------------------- | --------------------------------------- |
| `statement_timeout`                   | `120000` ms (2 min) | `DB_APP_STATEMENT_TIMEOUT_MS`           |
| `idle_in_transaction_session_timeout` | `60000` ms (1 min)  | `DB_APP_IDLE_IN_TRANSACTION_TIMEOUT_MS` |

A statement that runs longer is cancelled (a runaway query cannot hold the database for hours) and a
session that opened a transaction and went quiet is closed (it cannot hold locks and a connection
forever). `0` turns a limit off. The owner role (migrations, the system sweeps, `pg_dump`, the
backup) is **not** affected, and nothing is set globally. The values apply to new connections:
restart the API and worker after changing them.

On a managed PostgreSQL, or when `init` does not run against it, set them once as an administrator:

```sql
ALTER ROLE calibra_app SET statement_timeout = '120s';
ALTER ROLE calibra_app SET idle_in_transaction_session_timeout = '60s';
-- check: SELECT rolconfig FROM pg_roles WHERE rolname = 'calibra_app';
```

If a legitimate job is cancelled with `canceling statement due to statement timeout`, find the
statement in the log first: raise the limit only for a query that has to be that long.

## HTTPS proxy (Caddy)

All three addresses send `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` and a `Permissions-Policy` that turns off
camera, microphone, geolocation, payment and USB. The two app addresses add `X-Frame-Options: DENY`
and a `Content-Security-Policy` on the pages (the API sets its own on `/api`).

**Content-Security-Policy.** Same rules as `apps/web/public/_headers` (the Cloudflare/Netlify
version of the policy): same-origin scripts only (no `unsafe-inline`, no `unsafe-eval`), no plugins,
no framing, `base-uri` and `form-action` locked to the page. What the self-hosted install adds:

- the **file-storage address** (`FILES_URL`) in `img-src`, `connect-src` (browser uploads and signed
  downloads) and, for the lab app, `frame-src` (the certificate preview is a frame served from
  there);
- for the lab app, `connect-src` also allows `https://viacep.com.br` (the CEP lookup of the customer
  forms) and `localhost:9100`/`9101` (Zebra Browser Print, the label-printing agent);
- the portal pins the hash of its one inline script (the theme, applied before first paint).

`packages/config/src/deploy-hardening.spec.ts` keeps the Caddyfile in step with `_headers`, with the
portal's inline script and with the rest of this section. It cannot know about a new external
service the browser calls: when you add one (a map, an analytics script, an embedded video), add its
origin to the right directive in `deploy/Caddyfile` and the test, or the browser blocks it and logs
`Refused to ... because it violates the following Content Security Policy directive` in the console.

`Strict-Transport-Security` is `max-age=31536000` without `includeSubDomains` or `preload` on
purpose: those would bind the rest of your domain. Add them yourself once every subdomain is HTTPS.

**`/api/cron/*` is blocked at the proxy** (404 on the app and portal addresses). The scheduled jobs
run inside the API (`CRON_SCHEDULER=internal`, `apps/api/src/lib/cron-scheduler.ts`): the scheduler
hands each job to the API's own dispatcher in-process, with the `CRON_SECRET` header, never over the
network, so nothing breaks. The endpoints stay behind `CRON_SECRET` as well, so this is a second
lock, not the only one. To trigger a job from outside on purpose (an external scheduler, a manual
run), call the API from the compose network instead of through Caddy:

```bash
docker compose exec api bun -e "fetch('http://localhost:3000/api/cron/queue-backstop', {headers: {authorization: 'Bearer ' + process.env.CRON_SECRET}}).then(r => console.log(r.status))"
```

or remove the two `import block_cron` lines of the `Caddyfile` to publish them again (DEPLOYMENT.md,
"Scheduled jobs").

### Check the headers

```bash
curl -sI https://calibra.example.com/ | grep -iE 'content-security|strict-transport|x-content|referrer|permissions|x-frame'
curl -s -o /dev/null -w '%{http_code}\n' https://calibra.example.com/api/cron/queue-backstop   # 404
```
