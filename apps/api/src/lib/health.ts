import { HeadBucketCommand, type S3Client } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  countQueueJobsByStatus,
  type QueueDepth,
} from "@calibra-facil/db/queue";
import { createR2Client, type R2Env } from "./storage";

// dependency-checking readiness probe behind GET /api/health.
//
// The root `GET /api` liveness response stays a static `{status:"ok"}` (it must
// never depend on anything); this probe answers the different question "can
// this deployment actually serve requests": is Postgres reachable, is R2
// reachable, and what does the job-queue backlog look like. Any dependency
// failure turns the response into HTTP 503 so uptime monitors and deploy
// gates see a real signal instead of a hardcoded ok.
//
// Deliberate limits (the endpoint is unauthenticated):
//   - errors are redacted to the error NAME only (structural tag, never the
//     message — a Postgres/S3 error message can embed hosts or bucket names);
//   - every check runs under a short timeout so health can't hang;
//   - queue depth is informational; a deep backlog does not flip readiness.

const DEFAULT_CHECK_TIMEOUT_MS = 3_000;

export type HealthCheck = {
  ok: boolean;
  latencyMs: number;
  /** Structural error tag (error name or "timeout") — never a raw message. */
  error?: string;
  /** True when the dependency is not configured in this environment. */
  skipped?: boolean;
};

export type HealthReport = {
  status: "ok" | "unavailable";
  checks: {
    database: HealthCheck;
    storage: HealthCheck;
    queue: HealthCheck & { depth?: QueueDepth };
  };
};

export type HealthCheckDeps = {
  pingDatabase: () => Promise<void>;
  /** Null when R2 is not configured (local dev) — reported as skipped. */
  probeStorage: (() => Promise<void>) | null;
  readQueueDepth: () => Promise<QueueDepth>;
  timeoutMs: number;
};

function readEnvString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readStorageEnv(env: Record<string, unknown>): R2Env | null {
  const accountId = readEnvString(env.R2_ACCOUNT_ID);
  const accessKeyId = readEnvString(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = readEnvString(env.R2_SECRET_ACCESS_KEY);
  const bucketName = readEnvString(env.R2_BUCKET_NAME);
  const mediaBucketName = readEnvString(env.R2_MEDIA_BUCKET_NAME);

  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucketName ||
    !mediaBucketName
  ) {
    return null;
  }

  return {
    R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET_NAME: bucketName,
    R2_MEDIA_BUCKET_NAME: mediaBucketName,
  };
}

function createStorageProbe(
  env: Record<string, unknown>,
): (() => Promise<void>) | null {
  const storageEnv = readStorageEnv(env);
  if (!storageEnv) {
    return null;
  }

  return async () => {
    // HEAD the documents bucket: proves endpoint reachability + credentials
    // without transferring object data.
    const client: S3Client = createR2Client(storageEnv);
    await client.send(
      new HeadBucketCommand({ Bucket: storageEnv.R2_BUCKET_NAME }),
    );
  };
}

function defaultDeps(env: Record<string, unknown>): HealthCheckDeps {
  return {
    pingDatabase: async () => {
      await db.execute(sql`select 1`);
    },
    probeStorage: createStorageProbe(env),
    readQueueDepth: countQueueJobsByStatus,
    timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
  };
}

function errorTag(error: unknown): string {
  if (error instanceof Error && error.name !== "") {
    return error.name;
  }
  return "UnknownError";
}

class HealthCheckTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`health check timed out after ${timeoutMs}ms`);
    this.name = "timeout";
  }
}

type CheckResult<T> =
  | { ok: true; value: T; latencyMs: number }
  | { ok: false; latencyMs: number; error: string };

async function runCheck<T>(
  run: () => Promise<T>,
  timeoutMs: number,
): Promise<CheckResult<T>> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new HealthCheckTimeoutError(timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
    return { ok: true, value, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: errorTag(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runHealthCheck(
  deps: HealthCheckDeps,
): Promise<HealthReport> {
  const [databaseResult, storageResult, queueResult] = await Promise.all([
    runCheck(deps.pingDatabase, deps.timeoutMs),
    deps.probeStorage
      ? runCheck(deps.probeStorage, deps.timeoutMs)
      : Promise.resolve(null),
    runCheck(deps.readQueueDepth, deps.timeoutMs),
  ]);

  const database: HealthCheck = databaseResult.ok
    ? { ok: true, latencyMs: databaseResult.latencyMs }
    : databaseResult;

  const storage: HealthCheck = storageResult
    ? storageResult.ok
      ? { ok: true, latencyMs: storageResult.latencyMs }
      : storageResult
    : { ok: true, latencyMs: 0, skipped: true };

  const queue: HealthCheck & { depth?: QueueDepth } = queueResult.ok
    ? { ok: true, latencyMs: queueResult.latencyMs, depth: queueResult.value }
    : queueResult;

  const healthy = database.ok && storage.ok && queue.ok;

  return {
    status: healthy ? "ok" : "unavailable",
    checks: { database, storage, queue },
  };
}

export async function runApiHealthCheck(
  env: Record<string, unknown>,
  overrides: Partial<HealthCheckDeps> = {},
): Promise<HealthReport> {
  return runHealthCheck({ ...defaultDeps(env), ...overrides });
}
