# calibrafacil-document-worker

A Cloudflare Worker + Container that drains the `app_queue_job` table and
assembles documents — calibration certificates, service-order PDFs, and the
PDF-label job — **off** the API process, as an optional alternative to the
always-on polling worker (`apps/worker/src/bun.ts`).

It runs the heavy `processBackgroundJob` graph (react-dom SSR, XLSX templating,
signing) in a container that scales to zero, woken by the API after each
enqueue (`BACKGROUND_JOBS_MODE=queue` with `DOCUMENT_WORKER_URL` set).

## How it works (push-driven, scale-to-zero — no idle DB polling)

```
API enqueueBackgroundJob(msg)      (BACKGROUND_JOBS_MODE=queue)
  1. enqueueQueueJob(msg)  →  INSERT app_queue_job   (one database write)
  2. POST {DOCUMENT_WORKER_URL}/drain  (best-effort wake, X-Worker-Token)
                                              │
                              ┌───────────────┘
                              ▼
   Worker (src/index.ts) ── auth gate ──► DocumentWorkerContainer (DO)
                                              │
                                              ▼
   Container (apps/worker/src/serve.ts):  claimQueueJobs (SKIP LOCKED)
                                          → worker.queue(...) → R2 + DB + audit
                                          → drains to empty → idle → sleepAfter → 0
```

The container **never polls** the database on a timer. It wakes on a request,
drains, and scales back to zero. The job is durable in `app_queue_job` the
instant it is enqueued, so a dropped wake ping is recovered by the next
enqueue's drain or by `releaseStaleQueueJobs` (10 min). This is what keeps a
serverless database free to auto-suspend.

## Prerequisites

- Cloudflare **Workers Paid** plan (Containers require it), same account as
  `services/gotenberg`.
- `services/gotenberg` already deployed (the container calls it via
  `GOTENBERG_URL`).
- Docker available locally (`wrangler deploy` builds the image and pushes it).
- Node **24+** for wrangler.

## 1. Secrets (`wrangler secret put`)

Run from `services/document-worker/`. **Do not** commit these; do not put them in
`wrangler.jsonc`. Values are the same ones the API's worker uses.

```bash
wrangler secret put DOCUMENT_WORKER_TOKEN     # shared secret; must match the API's DOCUMENT_WORKER_TOKEN
wrangler secret put DATABASE_URL              # Neon (production) connection string
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_BUCKET_NAME            # certificates bucket
wrangler secret put R2_MEDIA_BUCKET_NAME      # media bucket (optional; defaults to calibrafacil-media-dev)
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put GOTENBERG_URL             # https://calibrafacil-gotenberg.<...>.workers.dev
wrangler secret put GOTENBERG_TOKEN
wrangler secret put SIGNING_MASTER_KEY
wrangler secret put SIGNING_TSA_URL           # optional: RFC 3161 time-stamp authority; unset = no time-stamp
wrangler secret put SIGNING_TSA_AUTH          # optional: full Authorization header value of a contracted authority
wrangler secret put SIGNING_TSA_ICP_CONFORMANT # optional: "true" only for a credentialed ICP-Brasil authority
wrangler secret put SIGNING_TSA_TIMEOUT_MS    # optional: request timeout in ms (default 30000)
wrangler secret put INTEGRATIONS_MASTER_KEY
wrangler secret put RESEND_API_KEY            # optional (notifyCertificateReady email)
wrangler secret put RESEND_FROM_EMAIL         # optional
wrangler secret put EMAIL_FROM                # optional
wrangler secret put EMAIL_LOGO_URL            # optional
wrangler secret put WEB_URL                   # optional
wrangler secret put APP_URL                   # optional
```

Non-secret tuning (`NODE_ENV`, `PORT`, `QUEUE_BATCH_SIZE`, `QUEUE_STALE_AFTER_MS`)
is already in `wrangler.jsonc` under `vars`.

> Secrets are set on the **Worker**; `src/index.ts` forwards them into the
> container process via `DocumentWorkerContainer.envVars`. (`DOCUMENT_WORKER_TOKEN`
> is the one secret that stays on the Worker — it gates `/drain` and is not
> forwarded to the container.)

## 2. Deploy

```bash
cd services/document-worker
pnpm install            # standalone install — this dir is NOT in the pnpm workspace
pnpm deploy             # = wrangler deploy: builds Dockerfile.document-worker from repo root
```

Note the deployed Worker URL (e.g. `https://calibrafacil-document-worker.<acct>.workers.dev`).

### Smoke test (before touching production dispatch)

```bash
# Liveness (no container wake):
curl -s https://calibrafacil-document-worker.<acct>.workers.dev/health
# → {"ok":true}

# Insert one app_queue_job row by hand (psql against the same Neon DB), then:
curl -s -X POST https://calibrafacil-document-worker.<acct>.workers.dev/drain \
  -H "X-Worker-Token: <DOCUMENT_WORKER_TOKEN>"
# → {"accepted":true,"alreadyDraining":false}
```

Confirm the row goes `PENDING → PROCESSING → COMPLETED`, the PDF lands in R2,
and the audit row is written — i.e. byte-for-byte the same as the polling worker.

## 3. Point the API at it

Set these on the API (with `BACKGROUND_JOBS_MODE=queue`):

| Env var                               | Value                                                     |
| ------------------------------------- | --------------------------------------------------------- |
| `DOCUMENT_WORKER_URL`                 | the deployed Worker URL                                   |
| `DOCUMENT_WORKER_TOKEN`               | same value as the Worker secret                           |
| `DOCUMENT_WORKER_WAKE_TIMEOUT_MS`     | optional, per-attempt drain-ping timeout, default `12000` |
| `DOCUMENT_WORKER_WAKE_ATTEMPTS`       | optional, drain-ping attempts, default `2`                |
| `DOCUMENT_WORKER_WAKE_RETRY_DELAY_MS` | optional, backoff between wake attempts, default `500`    |

> The wake ping has to outlast a **cold start** (the container scales to zero
> after 15m idle; Cloudflare holds the request open while it boots, then it
> answers `202` and drains). The defaults give ~25s of total wake budget across
> attempts. A single short timeout would abort mid cold-start and strand the row
> in `PENDING` — nothing re-claims an un-claimed PENDING row, so the job never
> renders until the next enqueue or a manual drain.

Every queue job type is woken through the container once `DOCUMENT_WORKER_URL`
is set. **Rollback = unset `DOCUMENT_WORKER_URL`** and run the polling worker
(`apps/worker/src/bun.ts`): the rows are the same, nothing is re-queued.

## Scope notes

- **ZPL/TSPL printer labels are NOT here.** Those render synchronously in the
  API (`apps/api/src/routes/jobs.ts`, `renderLabel` → `c.text(...)`); only the
  PDF `LABEL` job is a render job that moves.
- **Schedulers stay out.** The 30-min integration-sync and daily-notification
  timers from `bun.ts` are intentionally absent — re-introducing a periodic
  database-waking timer is exactly what we are avoiding. The `/api/cron/*` jobs
  run in the API (`CRON_SCHEDULER=internal`).
- **At-least-once.** A row whose lease expires is re-queued, so handlers must
  be idempotent (they already are, and the receipt ledger guards duplicates).
