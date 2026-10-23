import {
  failFast,
  failFastAsync,
  loadWorkerConfig,
  rawEnv,
  setProcessEnvDefault,
} from "@calibra-facil/config";
import { assertRlsStartup } from "@calibra-facil/db/rls-startup";
import { processScheduledNotifications } from "@calibra-facil/jobs-core/scheduled";
import { processScheduledIntegrationSyncs } from "@calibra-facil/jobs-core/integrations";
import {
  createWorkerEnv,
  processQueueBatch,
  readQueueConfig,
} from "./queue-runtime.js";

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

// Validate the configuration before doing anything else: a bad deploy exits
// here with one message that lists every problem.
failFast(() => loadWorkerConfig());
// One query: a role that row-level security binds is refused in shadow mode
// (migration 0123; DEPLOYMENT.md, "Row-level security").
await failFastAsync(() => assertRlsStartup());

const config = readQueueConfig();
const env = createWorkerEnv();

console.log(`[Worker] Starting ${config.workerId}`);
scheduleEvery("queue poll", config.pollIntervalMs, () =>
  processQueueBatch(env, config).then(() => undefined),
);
scheduleEvery("integration scheduler", 30 * 60_000, () =>
  processScheduledIntegrationSyncs(env).then(() => undefined),
);
scheduleDailyAt(8, () =>
  processScheduledNotifications(env).then(() => undefined),
);

await processQueueBatch(env, config);
