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
import worker from "./index.js";
import { processScheduledNotifications } from "./scheduled.js";
import { processScheduledIntegrationSyncs } from "./integrations.js";

type WorkerEnv = Parameters<typeof worker.queue>[1];

type BunRuntime = {
  env: Record<string, string | undefined>;
  file(path: URL): {
    exists(): Promise<boolean>;
    text(): Promise<string>;
  };
};

declare const Bun: BunRuntime;

const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
const batchSize = Number(process.env.QUEUE_BATCH_SIZE ?? 10);
const pollIntervalMs = Number(process.env.QUEUE_POLL_INTERVAL_MS ?? 2_000);
const staleAfterMs = Number(process.env.QUEUE_STALE_AFTER_MS ?? 10 * 60_000);
const workerDirectory = new URL("..", import.meta.url);
const isProduction = process.env.NODE_ENV === "production";

function parseLocalEnv(contents: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

async function loadLocalEnv() {
  if (isProduction) return;

  for (const filename of [".env", ".env.local"]) {
    const file = Bun.file(new URL(filename, workerDirectory));
    if (!(await file.exists())) continue;

    const localEnv = parseLocalEnv(await file.text());
    for (const [key, value] of Object.entries(localEnv)) {
      process.env[key] ??= value;
    }
  }
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

function createEnv(): WorkerEnv {
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
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_LOGO_URL: process.env.EMAIL_LOGO_URL,
    WEB_URL: process.env.WEB_URL,
    APP_URL: process.env.APP_URL,
  };
}

function createBatch(jobs: ClaimedQueueJob[]) {
  const states = new Map<number, "acked" | "retry">();

  return {
    batch: {
      messages: jobs.map((job) => ({
        body: job.payload,
        ack: () => states.set(job.id, "acked"),
        retry: () => states.set(job.id, "retry"),
      })),
    },
    states,
  };
}

async function processQueueBatch(env: WorkerEnv) {
  await releaseStaleQueueJobs(staleAfterMs);
  const jobs = await claimQueueJobs(workerId, batchSize);
  if (jobs.length === 0) return;

  console.log(`[Worker] Claimed ${jobs.length} queue job(s)`);
  const { batch, states } = createBatch(jobs);
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
    await Promise.all(jobs.map((job) => failQueueJob(job.id, error)));
    return;
  }

  await Promise.all(
    jobs.map((job) =>
      states.get(job.id) === "acked"
        ? completeQueueJob(job.id)
        : failQueueJob(job.id, "Job was not acknowledged by worker"),
    ),
  );
}

function scheduleEvery(
  label: string,
  intervalMs: number,
  task: () => Promise<void>,
) {
  setInterval(() => {
    task().catch((error) => {
      console.error(`[Worker] ${label} failed`, error);
    });
  }, intervalMs);
}

function scheduleDailyAt(hourUtc: number, task: () => Promise<void>) {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(hourUtc, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

    setTimeout(() => {
      task()
        .catch((error) => {
          console.error("[Worker] daily scheduled task failed", error);
        })
        .finally(scheduleNext);
    }, next.getTime() - now.getTime());
  };

  scheduleNext();
}

await loadLocalEnv();

const env = createEnv();

console.log(`[Worker] Starting ${workerId}`);
scheduleEvery("queue poll", pollIntervalMs, () => processQueueBatch(env));
scheduleEvery("integration scheduler", 30 * 60_000, () =>
  processScheduledIntegrationSyncs(env).then(() => undefined),
);
scheduleDailyAt(8, () =>
  processScheduledNotifications(env).then(() => undefined),
);

await processQueueBatch(env);
