import {
  failFast,
  failFastAsync,
  rawEnv,
  setProcessEnv,
} from "@calibra-facil/config";
import { closeDatabases } from "@calibra-facil/db";
import { assertRlsStartup } from "@calibra-facil/db/rls-startup";
import { installGracefulShutdown } from "@calibra-facil/shared/graceful-shutdown";
import app from "./index";
import { GET as dispatchCron } from "./cron/dispatch";
import {
  CRON_ENTRIES,
  createInFlightRuns,
  startCronScheduler,
} from "./lib/cron-scheduler";
import { flushErrorReporter } from "./lib/observability";
import { createApiShutdownPlan } from "./server/shutdown";
import { buildApiBootEnv } from "./server/startup";

type BunServer = {
  hostname: string;
  port: number;
  /** Stops accepting connections; settles once the requests in flight are done. */
  stop(closeActiveConnections?: boolean): Promise<void>;
};

type BunRuntime = {
  file(path: URL): {
    exists(): Promise<boolean>;
    text(): Promise<string>;
  };
  serve(options: {
    hostname: string;
    port: number;
    fetch(request: Request): Response | Promise<Response>;
  }): BunServer;
};

declare const Bun: BunRuntime;

const appDirectory = new URL("..", import.meta.url);
const processEnv = rawEnv();
const isProduction = processEnv.NODE_ENV === "production";

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
  if (isProduction) return {};

  const env: Record<string, string> = {};

  for (const filename of [".env", ".env.local"]) {
    const file = Bun.file(new URL(filename, appDirectory));
    if (await file.exists()) {
      Object.assign(env, parseLocalEnv(await file.text()));
    }
  }

  return env;
}

async function createEnv() {
  const localEnv = await loadLocalEnv();
  // Assemble the bindings and validate the configuration: a bad deploy stops
  // here with one message that lists every problem.
  const { bindings, config } = failFast(() =>
    buildApiBootEnv(processEnv, localEnv),
  );

  for (const [key, value] of Object.entries(bindings)) {
    if (typeof value === "string") {
      setProcessEnv(key, value);
    }
  }

  return { env: bindings, config };
}

const { env, config } = await createEnv();
// Row-level security start-up check (migration 0123; DEPLOYMENT.md, "Row-level
// security"): with DATABASE_RLS_MODE=enforced (the default) refuse a DATABASE_URL
// that RLS does not bind and a missing or bound DATABASE_OWNER_URL; in shadow mode
// refuse a role RLS binds (and warn loudly in production).
await failFastAsync(() => assertRlsStartup());
const port = config.runtime.listenPort ?? 3000;
const hostname = config.runtime.host;

const server = Bun.serve({
  hostname,
  port,
  // @ts-expect-error Bun supports idleTimeout, but the bundled type in this workspace has not caught up.
  idleTimeout: 120,
  fetch(request) {
    // The /api/cron/* handlers are served by this process, so the internal
    // scheduler or any external one can trigger them with the CRON_SECRET
    // bearer token. See DEPLOYMENT.md for the schedule.
    if (new URL(request.url).pathname.startsWith("/api/cron/")) {
      return dispatchCron(request);
    }
    return app.fetch(request, env);
  },
});

console.info(
  `Calibra Facil API listening on http://${server.hostname}:${server.port}`,
);

// CRON_SCHEDULER=internal runs the cron schedule in this process, for installs
// without an external scheduler (the Docker setup turns it on).
const inFlightCron = createInFlightRuns();
let cronJobs: ReturnType<typeof startCronScheduler> = [];
if (config.jobs.cronScheduler === "internal") {
  cronJobs = startCronScheduler({
    entries: CRON_ENTRIES,
    dispatch: dispatchCron,
    secret: config.jobs.cronSecret,
    inFlight: inFlightCron,
  });
  console.info(`Scheduled ${cronJobs.length} cron jobs in-process (UTC)`);
}

// SIGTERM (a container stop or upgrade) and SIGINT: stop taking new work, let
// the requests and cron runs already under way finish (up to SHUTDOWN_GRACE_MS),
// then close the database pools and exit.
installGracefulShutdown(
  createApiShutdownPlan({
    stopServer: () => server.stop(),
    stopCron: () => {
      for (const job of cronJobs) job.stop();
    },
    inFlightCron,
    closeDatabases,
    flushErrors: () => flushErrorReporter(),
    deadlineMs: config.runtime.shutdownGraceMs,
  }),
);
