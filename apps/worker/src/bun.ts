import {
  failFast,
  failFastAsync,
  loadWorkerConfig,
  rawEnv,
  readRuntimeConfig,
  setProcessEnvDefault,
} from "@calibra-facil/config";
import { closeDatabases } from "@calibra-facil/db";
import { assertRlsStartup } from "@calibra-facil/db/rls-startup";
import { installGracefulShutdown } from "@calibra-facil/shared/graceful-shutdown";
import { touchHeartbeat } from "./heartbeat.js";
import { createPollLoop } from "./poll-loop.js";
import {
  createWorkerEnv,
  processQueueBatch,
  readQueueConfig,
} from "./queue-runtime.js";
import { createWorkerShutdownPlan } from "./shutdown.js";

type BunRuntime = {
  file(path: URL): {
    exists(): Promise<boolean>;
    text(): Promise<string>;
  };
};

declare const Bun: BunRuntime;

const workerDirectory = new URL("..", import.meta.url);
const isProduction = rawEnv().NODE_ENV === "production";

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
      setProcessEnvDefault(key, value);
    }
  }
}

await loadLocalEnv();

// Validate the configuration before doing anything else: a bad deploy exits
// here with one message that lists every problem.
failFast(() => loadWorkerConfig());
// Row-level security start-up check: enforced (the default) refuses a DATABASE_URL
// that RLS does not bind and a missing or bound DATABASE_OWNER_URL; shadow refuses a
// role RLS binds (migration 0123; DEPLOYMENT.md, "Row-level security").
await failFastAsync(() => assertRlsStartup());

const config = readQueueConfig();
const env = createWorkerEnv();

console.log(`[Worker] Starting ${config.workerId}`);

// The worker only drains the queue. The scheduled integration syncs and the
// 08:00 notifications are the API's cron jobs (apps/api/src/lib/cron-scheduler.ts):
// they run under the cron lease and enqueue the work this loop picks up, so a
// second scheduler here would run them twice (double e-mails).
//
// Self-scheduling: the next poll is set only after the previous one ends, so a
// slow batch never overlaps the next tick.
const poll = createPollLoop({
  intervalMs: config.pollIntervalMs,
  task: async (isStopping) => {
    await touchHeartbeat();
    try {
      return await processQueueBatch(env, config, isStopping);
    } finally {
      await touchHeartbeat();
    }
  },
  onError: (error) => {
    console.error("[Worker] queue poll failed", error);
  },
});
poll.start();

// SIGTERM (a container stop or upgrade) and SIGINT: claim no further job, let
// the one in hand finish (up to SHUTDOWN_GRACE_MS), close the database pools.
installGracefulShutdown(
  createWorkerShutdownPlan({
    stopWork: () => poll.stop(),
    closeDatabases,
    deadlineMs: readRuntimeConfig().shutdownGraceMs,
  }),
);
