// Shared DB-queue runtime used by both worker entrypoints:
//   - `bun.ts`   — the legacy always-on poller (local `pnpm dev:worker`)
//   - `serve.ts` — the HTTP drain server that runs inside the
//                  `services/document-worker` Cloudflare Container
//
// Both build the worker `Env` from process env, claim `app_queue_job` rows
// (`FOR UPDATE SKIP LOCKED`), run them through `worker.queue`, then
// complete/fail with backoff. Keeping the runtime in one place means the
// container and the local poller stay byte-for-byte identical in how they
// process a job.
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  claimQueueJobs,
  completeQueueJob,
  failQueueJob,
  releaseStaleQueueJobs,
  type ClaimedQueueJob,
} from "@calibra-facil/db/queue";
import {
  appQueueJobReceiptKey,
  claimQueueReceipt,
  completeQueueReceipt,
  readQueueReceiptsMode,
  releaseQueueReceipt,
  type QueueReceiptClaim,
  type QueueReceiptsMode,
} from "@calibra-facil/db/queue-receipts";
import worker from "./index.js";

export type WorkerEnv = Parameters<typeof worker.queue>[1];

export type QueueRuntimeConfig = {
  workerId: string;
  batchSize: number;
  pollIntervalMs: number;
  staleAfterMs: number;
};

export function readQueueConfig(): QueueRuntimeConfig {
  return {
    workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
    batchSize: Number(process.env.QUEUE_BATCH_SIZE ?? 10),
    pollIntervalMs: Number(process.env.QUEUE_POLL_INTERVAL_MS ?? 2_000),
    staleAfterMs: Number(process.env.QUEUE_STALE_AFTER_MS ?? 10 * 60_000),
  };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function createR2Bucket(bucket = requiredEnv("R2_BUCKET_NAME")) {
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });

  return {
    async get(key: string) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!response.Body) return null;
      const bytes = await response.Body.transformToByteArray();
      return {
        async arrayBuffer() {
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          return copy.buffer;
        },
      };
    },
    async put(
      key: string,
      body: Buffer | Uint8Array | ArrayBuffer,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body instanceof ArrayBuffer ? new Uint8Array(body) : body,
          ContentType: options?.httpMetadata?.contentType,
        }),
      );
    },
  };
}

export function createWorkerEnv(): WorkerEnv {
  const databaseUrl = requiredEnv("DATABASE_URL");
  process.env.NODE_ENV ??= "production";

  return {
    DATABASE_URL: databaseUrl,
    CERTIFICATES_BUCKET: createR2Bucket(),
    MEDIA_BUCKET: createR2Bucket(
      process.env.R2_MEDIA_BUCKET_NAME ?? "calibrafacil-media-dev",
    ),
    GOTENBERG_URL: process.env.GOTENBERG_URL,
    GOTENBERG_TOKEN: process.env.GOTENBERG_TOKEN,
    SIGNING_MASTER_KEY: requiredEnv("SIGNING_MASTER_KEY"),
    INTEGRATIONS_MASTER_KEY: requiredEnv("INTEGRATIONS_MASTER_KEY"),
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    // Marketing-audience sync (Resend Contacts) — operator-set, optional.
    RESEND_AUDIENCE_ID: process.env.RESEND_AUDIENCE_ID,
    RESEND_TOPIC_NOVIDADES_ID: process.env.RESEND_TOPIC_NOVIDADES_ID,
    RESEND_TOPIC_DICAS_ID: process.env.RESEND_TOPIC_DICAS_ID,
    MARKETING_CONTACT_SYNC_ENABLED: process.env.MARKETING_CONTACT_SYNC_ENABLED,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_LOGO_URL: process.env.EMAIL_LOGO_URL,
    WEB_URL: process.env.WEB_URL,
    APP_URL: process.env.APP_URL,
  };
}

function createBatch(jobs: ClaimedQueueJob[]) {
  const states = new Map<number, "acked" | "retry">();
  // REQ-REL-OBS-002: capture the REAL error the worker's queue handler caught so
  // it is written to app_queue_job.last_error instead of a generic placeholder.
  const errors = new Map<number, unknown>();

  return {
    batch: {
      messages: jobs.map((job) => ({
        body: job.payload,
        ack: () => states.set(job.id, "acked"),
        retry: (error?: unknown) => {
          states.set(job.id, "retry");
          if (error !== undefined) errors.set(job.id, error);
        },
      })),
    },
    states,
    errors,
  };
}

// Idempotency-ledger gate for one claimed row. The receipt key is
// the app_queue_job row id, stable across stale-lease reclaims of the SAME row
// — a new enqueue for the same business id is a new row and always runs.
// `owned: true` means this worker holds the receipt lease and must settle it
// (complete on ack, release on failure). Fail open: a ledger error never
// blocks a job.
type ReceiptDecision = {
  job: ClaimedQueueJob;
  run: boolean;
  owned: boolean;
};

async function decideWithReceipt(
  job: ClaimedQueueJob,
  mode: QueueReceiptsMode,
): Promise<ReceiptDecision> {
  if (mode === "off") return { job, run: true, owned: false };

  const key = appQueueJobReceiptKey(job.id);
  let claim: QueueReceiptClaim;
  try {
    claim = await claimQueueReceipt({ jobType: job.type, idempotencyKey: key });
  } catch (error) {
    console.error(
      `[QueueReceipt] ledger unavailable — running job ${job.id} without receipt`,
      error,
    );
    return { job, run: true, owned: false };
  }

  if (claim.outcome === "claimed") return { job, run: true, owned: true };

  console.warn(
    `[QueueReceipt] duplicate delivery (${mode}): type=${job.type} key=${key} state=${claim.outcome}`,
  );
  if (mode === "shadow") return { job, run: true, owned: false };

  // Enforce mode: settle the row without re-running the work.
  if (claim.outcome === "duplicate-completed") {
    await completeQueueJob(job.id);
  } else {
    // Another worker holds a live lease (stale reclaim raced a slow run):
    // back off through the normal retry path instead of running twice.
    await failQueueJob(job.id, "queue receipt lease held by another worker");
  }
  return { job, run: false, owned: false };
}

async function settleReceipt(
  decision: ReceiptDecision,
  succeeded: boolean,
): Promise<void> {
  if (!decision.owned) return;
  const params = {
    jobType: decision.job.type,
    idempotencyKey: appQueueJobReceiptKey(decision.job.id),
  };
  try {
    // Release on failure expires the lease immediately so the queue's own
    // 5s·2^n retry backoff is not blocked behind the full receipt lease.
    await (succeeded
      ? completeQueueReceipt(params)
      : releaseQueueReceipt(params));
  } catch (error) {
    console.error(
      `[QueueReceipt] failed to settle receipt for job ${decision.job.id}`,
      error,
    );
  }
}

// Claim and process a single batch. Returns the number of jobs claimed so
// callers can loop (drain) or schedule the next poll. Does NOT release stale
// jobs — callers decide when to do that (once per poll tick / once per drain).
async function claimAndProcessBatch(
  env: WorkerEnv,
  workerId: string,
  batchSize: number,
): Promise<number> {
  const claimed = await claimQueueJobs(workerId, batchSize);
  if (claimed.length === 0) return 0;

  const mode = readQueueReceiptsMode();
  const decisions: ReceiptDecision[] = [];
  for (const job of claimed) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- receipt claims are cheap single-row upserts; sequential keeps log ordering deterministic.
    decisions.push(await decideWithReceipt(job, mode));
  }
  const runnable = decisions.filter((decision) => decision.run);
  const jobs = runnable.map((decision) => decision.job);
  if (jobs.length === 0) return claimed.length;

  console.log(`[Worker] Claimed ${jobs.length} queue job(s)`);
  const { batch, states, errors } = createBatch(jobs);
  const executionContext: ExecutionContext = {
    props: {},
    waitUntil(promise) {
      void promise.catch((error) => {
        console.error("[Worker] waitUntil task failed", error);
      });
    },
    passThroughOnException() {
      // Local queue processing has no upstream request to pass through.
    },
  };

  try {
    await worker.queue(batch, env, executionContext);
  } catch (error) {
    await Promise.all(
      runnable.map(async (decision) => {
        await settleReceipt(decision, false);
        await failQueueJob(decision.job.id, error);
      }),
    );
    return claimed.length;
  }

  await Promise.all(
    runnable.map(async (decision) => {
      const acked = states.get(decision.job.id) === "acked";
      await settleReceipt(decision, acked);
      if (acked) {
        await completeQueueJob(decision.job.id);
        return;
      }
      await failQueueJob(
        decision.job.id,
        // Prefer the real error the handler retried with; the generic string
        // is only a fallback for a job that was neither acked nor retried
        // with an error (should not happen, but never lose the failure).
        errors.get(decision.job.id) ?? "Job was not acknowledged by worker",
      );
    }),
  );

  return claimed.length;
}

// Release stale jobs, then claim + process one batch. Used by the legacy
// poller (`bun.ts`) on each tick.
export async function processQueueBatch(
  env: WorkerEnv,
  config: QueueRuntimeConfig,
): Promise<number> {
  await releaseStaleQueueJobs(config.staleAfterMs);
  return claimAndProcessBatch(env, config.workerId, config.batchSize);
}

// Release stale jobs, then keep claiming + processing batches until the queue
// is empty. Used by the container's `/drain` endpoint (`serve.ts`) so the
// container can wake on a request, fully drain, and scale back to zero —
// without polling the database while idle. `maxBatches` is a runaway guard.
export async function drainQueue(
  env: WorkerEnv,
  config: QueueRuntimeConfig,
  maxBatches = 1_000,
): Promise<number> {
  await releaseStaleQueueJobs(config.staleAfterMs);

  let processed = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const count = await claimAndProcessBatch(
      env,
      config.workerId,
      config.batchSize,
    );
    if (count === 0) break;
    processed += count;
  }

  return processed;
}
