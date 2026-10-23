import {
  failFast,
  failFastAsync,
  rawEnv,
  setProcessEnv,
} from "@calibra-facil/config";
import { assertRlsStartup } from "@calibra-facil/db/rls-startup";
import app from "./index";
import { GET as dispatchCron } from "../vercel-src/cron/dispatch";
import { readCronEntries, startCronScheduler } from "./lib/cron-scheduler";
import { buildApiBootEnv } from "./server/startup";

type BunServer = {
  hostname: string;
  port: number;
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
// One query: refuse to start as a role that row-level security binds while
// DATABASE_RLS_MODE=shadow (migration 0123; DEPLOYMENT.md, "Row-level security").
await failFastAsync(() => assertRlsStartup());
const port = config.runtime.listenPort ?? 3000;
const hostname = config.runtime.host;

const server = Bun.serve({
  hostname,
  port,
  // @ts-expect-error Bun supports idleTimeout, but the bundled type in this workspace has not caught up.
  idleTimeout: 120,
  fetch(request) {
    // On Vercel, /api/cron/* are separate functions triggered by vercel.json.
    // Here (local dev, Docker, any VM) the same handlers are served by this
    // process, so any scheduler can trigger them with the CRON_SECRET bearer
    // token. See DEPLOYMENT.md for the schedule.
    if (new URL(request.url).pathname.startsWith("/api/cron/")) {
      return dispatchCron(request);
    }
    return app.fetch(request, env);
  },
});

console.info(
  `Calibra Facil API listening on http://${server.hostname}:${server.port}`,
);

// CRON_SCHEDULER=internal runs the vercel.json schedule in this process, for
// installs without an external scheduler (the Docker setup turns it on).
if (config.jobs.cronScheduler === "internal") {
  const jobs = startCronScheduler({
    entries: readCronEntries(
      JSON.parse(
        await Bun.file(new URL("../vercel.json", import.meta.url)).text(),
      ),
    ),
    dispatch: dispatchCron,
    secret: config.jobs.cronSecret,
  });
  console.info(`Scheduled ${jobs.length} cron jobs in-process (UTC)`);
}
