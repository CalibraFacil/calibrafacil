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
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import {
  loadWorkerConfig,
  readJobsConfig,
  setProcessEnvDefault,
  workerSigningEnv,
} from "@calibra-facil/config";
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
import { rejectDeadLetteredCertificateRenders } from "@calibra-facil/db/queue-render-recovery";
import {
  appQueueJobReceiptKey,
  claimQueueReceipt,
  completeQueueReceipt,
  readQueueReceiptsMode,
  releaseQueueReceipt,
  type QueueReceiptClaim,
  type QueueReceiptsMode,
} from "@calibra-facil/db/queue-receipts";
import { resolveS3EndpointConfig } from "@calibra-facil/shared/storage-endpoint";
import worker, { type ExecutionContext } from "@calibra-facil/jobs-core";

export type WorkerEnv = Parameters<typeof worker.queue>[1];

export type QueueRuntimeConfig = {
  workerId: string;
  batchSize: number;
  pollIntervalMs: number;
  staleAfterMs: number;
};

/**
 * Names this worker in the queue (`locked_by`, the fencing token). The process id
 * alone is the same in every container replica (it is 1 or close to it), so two
 * replicas would share an identity and fence each other's leases: it carries the
 * host name and a random suffix too.
 */
export function defaultWorkerId(): string {
  return `${hostname()}-${process.pid}-${randomBytes(4).toString("hex")}`;
}

export function readQueueConfig(): QueueRuntimeConfig {
  const jobs = readJobsConfig();
  return {
    workerId: jobs.workerId ?? defaultWorkerId(),
    batchSize: jobs.queueBatchSize,
    pollIntervalMs: jobs.queuePollIntervalMs,
    staleAfterMs: jobs.queueStaleAfterMs,
  };
}

type StorageSettings = ReturnType<typeof loadWorkerConfig>["storage"];

function createR2Bucket(storage: StorageSettings, bucket: string) {
  const { endpoint, region, forcePathStyle } = resolveS3EndpointConfig({
    R2_ACCOUNT_ID: storage.accountId,
    R2_ENDPOINT: storage.endpoint,
    R2_REGION: storage.region,
  });
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: storage.accessKeyId ?? "",
      secretAccessKey: storage.secretAccessKey ?? "",
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

/**
 * Builds the worker environment from the validated worker configuration: a
 * missing database, storage credential or key throws one aggregated error
 * listing every problem.
 */
export function createWorkerEnv(): WorkerEnv {
  const config = loadWorkerConfig();
  const { storage } = config;
  setProcessEnvDefault("NODE_ENV", "production");

  return {
    DATABASE_URL: config.database.url ?? "",
    DATABASE_OWNER_URL: config.database.ownerUrl,
    DATABASE_RLS_MODE: config.database.rlsMode,
    CERTIFICATES_BUCKET: createR2Bucket(storage, storage.bucketName ?? ""),
    MEDIA_BUCKET: createR2Bucket(
      storage,
      storage.mediaBucketName ?? "calibrafacil-media-dev",
    ),
    GOTENBERG_URL: config.rendering.gotenbergUrl,
    GOTENBERG_TOKEN: config.rendering.gotenbergToken,
    // The master key and every SIGNING_TSA_* variable, shared with the API.
    ...workerSigningEnv(config.signing),
    INTEGRATIONS_MASTER_KEY: config.integrations.masterKey,
    PUBLIC_API_MASTER_KEY: config.integrations.publicApiMasterKey,
    RESEND_API_KEY: config.email.resendApiKey,
    RESEND_FROM_EMAIL: config.email.resendFromEmail,
    EMAIL_FROM: config.email.emailFrom,
    EMAIL_LOGO_URL: config.email.emailLogoUrl,
    WEB_URL: config.origins.webUrl,
    APP_URL: config.origins.appUrl,
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
        // claimQueueJobs already counted this delivery in `attempts`;
        // failQueueJob dead-letters the row once it reaches `maxAttempts`, so
        // that is exactly the delivery whose failure must be final.
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
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
  workerId: string,
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
    await completeQueueJob(job.id, workerId);
  } else {
    // Another worker holds a live lease (stale reclaim raced a slow run):
    // back off through the normal retry path instead of running twice.
    await failQueueJob(
      job.id,
      workerId,
      "queue receipt lease held by another worker",
    );
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

// Claim and process up to `batchSize` jobs. Returns the number of jobs claimed
// so callers can loop (drain) or schedule the next poll. Does NOT release stale
// jobs — callers decide when to do that (once per poll tick / once per drain).
//
// Rows are claimed ONE AT A TIME and each is processed before the next is
// claimed. Claiming a whole batch up front stamps every row with the same
// `locked_at`, so a row queued behind slow jobs would hold an aging lease it is
// not using — long enough for another drainer or the backstop cron to reclaim it
// and, on its final attempt, dead-letter (and reject) a healthy certificate. A
// row still waiting is PENDING and untouched; its lease starts when its turn does.
async function claimAndProcessBatch(
  env: WorkerEnv,
  workerId: string,
  batchSize: number,
  isStopping: () => boolean,
): Promise<number> {
  const mode = readQueueReceiptsMode();
  let claimedCount = 0;

  for (let slot = 0; slot < batchSize; slot += 1) {
    // A shutdown claims nothing more: the job in hand was the last.
    if (isStopping()) break;
    // oxlint-disable-next-line eslint/no-await-in-loop -- one row is claimed only once the previous one is settled; see above.
    const [job] = await claimQueueJobs(workerId, 1);
    if (!job) break;
    claimedCount += 1;

    // oxlint-disable-next-line eslint/no-await-in-loop -- receipt claims are cheap single-row upserts.
    const decision = await decideWithReceipt(job, workerId, mode);
    if (!decision.run) continue;

    console.log(`[Worker] Claimed queue job ${job.id}`);
    // oxlint-disable-next-line eslint/no-await-in-loop -- jobs run sequentially by design.
    await processClaimedJob(env, decision, workerId);
  }

  return claimedCount;
}

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

// Settle the row FIRST, fenced by this worker's lease, and settle the receipt
// only when that applied. A fenced-out worker (its lease expired and the row was
// reclaimed) no longer owns the row — and by extension not the receipt the new
// owner claimed — so it must not complete or release either, or it would
// clobber the new owner's state.
async function processClaimedJob(
  env: WorkerEnv,
  decision: ReceiptDecision,
  workerId: string,
): Promise<void> {
  const { job } = decision;
  const { batch, states, errors } = createBatch([job]);

  try {
    await worker.queue(batch, env, executionContext);
  } catch (error) {
    if (await failQueueJob(job.id, workerId, error)) {
      await settleReceipt(decision, false);
    }
    return;
  }

  if (states.get(job.id) === "acked") {
    if (await completeQueueJob(job.id, workerId)) {
      await settleReceipt(decision, true);
    }
    return;
  }
  const applied = await failQueueJob(
    job.id,
    workerId,
    // Prefer the real error the handler retried with; the generic string
    // is only a fallback for a job that was neither acked nor retried
    // with an error (should not happen, but never lose the failure).
    errors.get(job.id) ?? "Job was not acknowledged by worker",
  );
  if (applied) await settleReceipt(decision, false);
}

// Reclaim expired PROCESSING leases. A row whose lease expired on its final
// attempt is dead-lettered (FAILED) instead of re-queued — a job that crashes the
// worker process must not be re-claimed forever — and the certificate it left in
// GENERATING_PDF is rejected here, since no worker will ever finish it. The
// rejection is best-effort: the queue-backstop cron's stuck-render sweep is the
// safety net, so a failure must never stop the drain.
async function reclaimStaleJobs(staleAfterMs: number): Promise<void> {
  const { deadLettered } = await releaseStaleQueueJobs(staleAfterMs);
  if (deadLettered.length === 0) return;

  console.error(
    `[Worker] Dead-lettered ${deadLettered.length} queue job(s) whose lease expired on the final attempt`,
  );
  await rejectDeadLetteredCertificateRenders(deadLettered).catch((error) => {
    console.error("[Worker] Failed to reject dead-lettered renders", error);
  });
}

// Release stale jobs, then claim + process one batch. Used by the legacy
// poller (`bun.ts`) on each tick.
export async function processQueueBatch(
  env: WorkerEnv,
  config: QueueRuntimeConfig,
  isStopping: () => boolean = () => false,
): Promise<number> {
  await reclaimStaleJobs(config.staleAfterMs);
  return claimAndProcessBatch(
    env,
    config.workerId,
    config.batchSize,
    isStopping,
  );
}

// Release stale jobs, then keep claiming + processing batches until the queue
// is empty. Used by the container's `/drain` endpoint (`serve.ts`) so the
// container can wake on a request, fully drain, and scale back to zero —
// without polling the database while idle. `maxBatches` is a runaway guard.
export async function drainQueue(
  env: WorkerEnv,
  config: QueueRuntimeConfig,
  maxBatches = 1_000,
  isStopping: () => boolean = () => false,
): Promise<number> {
  await reclaimStaleJobs(config.staleAfterMs);

  let processed = 0;
  for (let batch = 0; batch < maxBatches && !isStopping(); batch += 1) {
    const count = await claimAndProcessBatch(
      env,
      config.workerId,
      config.batchSize,
      isStopping,
    );
    if (count === 0) break;
    processed += count;
  }

  return processed;
}
