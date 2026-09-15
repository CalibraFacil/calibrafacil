# calibrafacil-document-worker

A Cloudflare Worker + Container that drains the `app_queue_job` table and
assembles documents — calibration certificates, service-order PDFs, and the
PDF-label job — **off** the Vercel queue function.

It is the "phase 2" of the build-time work in PR #398: moving the heavy
`processBackgroundJob` graph (react-dom SSR, XLSX templating, `@resvg/resvg-js`,
signing) out of `apps/api/api/queues/background.js` so that Vercel function
stops carrying a ~6 MB bundle and a native dependency. See
`.goals/document-worker-extraction.md` for the full design and decisions.

## How it works (push-driven, scale-to-zero — no idle DB polling)

```
API enqueueBackgroundJob(msg)
  │  (msg.type ∈ DOCUMENT_WORKER_JOB_TYPES?)
  ├── no  ─────────────────────────► Vercel Queue (unchanged)
  └── yes
        1. enqueueQueueJob(msg)  →  INSERT app_queue_job   (one Neon write)
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
enqueue's drain or by `releaseStaleQueueJobs` (10 min). This is what keeps Neon
free to auto-suspend — the reason the periodic Vercel crons were disabled.

## Prerequisites

- Cloudflare **Workers Paid** plan (Containers require it), same account as
  `services/gotenberg`.
- `services/gotenberg` already deployed (the container calls it via
  `GOTENBERG_URL`).
- Docker available locally (`wrangler deploy` builds the image and pushes it).
- Node **24+** for wrangler.

## 1. Secrets (`wrangler secret put`)

Run from `services/document-worker/`. **Do not** commit these; do not put them in
`wrangler.jsonc`. Values are the same ones the Vercel worker already uses.

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
and the audit row is written — i.e. byte-for-byte the same as the Vercel path.

## 3. Cut traffic over (incremental, reversible)

Set these on the **API** project in Vercel (Production):

| Env var                               | Value                                                     |
| ------------------------------------- | --------------------------------------------------------- |
| `DOCUMENT_WORKER_URL`                 | the deployed Worker URL                                   |
| `DOCUMENT_WORKER_TOKEN`               | same value as the Worker secret                           |
| `DOCUMENT_WORKER_JOB_TYPES`           | comma list of job types to route (see below)              |
| `DOCUMENT_WORKER_WAKE_TIMEOUT_MS`     | optional, per-attempt drain-ping timeout, default `12000` |
| `DOCUMENT_WORKER_WAKE_ATTEMPTS`       | optional, drain-ping attempts, default `2`                |
| `DOCUMENT_WORKER_WAKE_RETRY_DELAY_MS` | optional, backoff between wake attempts, default `500`    |

> The wake ping has to outlast a **cold start** (the container scales to zero
> after 15m idle; Cloudflare holds the request open while it boots, then it
> answers `202` and drains). The defaults give ~25s of total wake budget across
> attempts, comfortably inside the API function's 30s `maxDuration`. A single
> short timeout would abort mid cold-start and strand the row in `PENDING` —
> nothing re-claims an un-claimed PENDING row, so the job never renders.

`DOCUMENT_WORKER_JOB_TYPES` is an **allowlist**. Empty / unset = everything stays
on Vercel Queue (the default; deploying this service changes nothing until you
opt a type in). Valid values:

```
CERTIFICATE
CERTIFICATE_XLSX_PREVIEW
LABEL
SERVICE_ORDER_INTAKE_DOCUMENT
SERVICE_ORDER_TAG
SERVICE_ORDER_QUOTE
SERVICE_ORDER_DELIVERY_RECEIPT
```

**Phase 1 — one low-stakes type.** Start with the non-authoritative preview:

```
DOCUMENT_WORKER_JOB_TYPES=CERTIFICATE_XLSX_PREVIEW
```

Generate a preview, confirm it drains through the container with identical
output. **Rollback = remove the type** (or unset the var) → that type flows back
through the Vercel function immediately. No redeploy of this service needed.

**Phase 2 — roll the rest** once Phase 1 is proven:

```
DOCUMENT_WORKER_JOB_TYPES=CERTIFICATE,CERTIFICATE_XLSX_PREVIEW,LABEL,SERVICE_ORDER_INTAKE_DOCUMENT,SERVICE_ORDER_TAG,SERVICE_ORDER_QUOTE,SERVICE_ORDER_DELIVERY_RECEIPT
```

## 4. Reap the build win (only after Phase 2 is verified in production)

These are deliberately **not** done in this change — they remove the Vercel
fallback, so they only make sense once every render type drains through the
container in production:

- Delete the static `import { processBackgroundJob }` from
  `apps/api/vercel-src/queues/background.ts` (collapse it to a forwarder, or
  delete the queue function entirely → API goes 3 → 2 functions).
- Drop `external: ["@resvg/resvg-js"]` from
  `apps/api/scripts/build-vercel-functions.mjs` (resvg now lives only in this
  glibc container).
- Exclude `node_modules` from Vercel function packaging (the ~88 s win), now
  that nothing on Vercel runs the worker.

## Scope notes

- **ZPL/TSPL printer labels are NOT here.** Those render synchronously in the
  API (`apps/api/src/routes/jobs.ts`, `renderLabel` → `c.text(...)`); only the
  PDF `LABEL` job is a render job that moves.
- **Schedulers stay out.** The 30-min integration-sync and daily-notification
  timers from `bun.ts` are intentionally absent — re-introducing a periodic
  Neon-waking timer is exactly what we are avoiding. Those remain on their
  (currently disabled) Vercel crons.
- **At-least-once.** `app_queue_job` has no idempotency column, so handlers must
  be idempotent (they already are — Vercel Queue is at-least-once too).
