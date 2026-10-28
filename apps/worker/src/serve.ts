// HTTP drain server — the entrypoint for the `services/document-worker`
// Cloudflare Container.
//
// Unlike `bun.ts` (which polls the database every couple of seconds and never
// lets the database scale to zero), this server does NOT poll. It sleeps until
// the API pings `POST /drain` after enqueueing an `app_queue_job` row, then
// drains the queue to empty and goes idle again. The Cloudflare Container's
// `sleepAfter` then scales the instance back to zero. Net effect: the database
// is only touched when there is real work — which is the whole point of moving
// this off the serverless platform without re-introducing the "wake Neon every 2s" problem.
import {
  failFast,
  failFastAsync,
  loadWorkerConfig,
  readRuntimeConfig,
} from "@calibra-facil/config";
import { closeDatabases } from "@calibra-facil/db";
import { assertRlsStartup } from "@calibra-facil/db/rls-startup";
import { installGracefulShutdown } from "@calibra-facil/shared/graceful-shutdown";
import {
  createWorkerEnv,
  drainQueue,
  readQueueConfig,
  type QueueRuntimeConfig,
  type WorkerEnv,
} from "./queue-runtime.js";
import { createWorkerShutdownPlan } from "./shutdown.js";

// Minimal Bun.serve typing — avoids pulling in @types/bun just for one symbol.
declare const Bun: {
  serve(options: {
    port?: number;
    fetch(request: Request): Response | Promise<Response>;
  }): { stop(closeActiveConnections?: boolean): Promise<void> };
};

// Validate the configuration before binding the port: a bad deploy exits here
// with one message that lists every problem, instead of starting and failing
// every drain later.
const config: QueueRuntimeConfig = failFast(() => {
  loadWorkerConfig();
  return readQueueConfig();
});
// Row-level security start-up check: enforced (the default) refuses a DATABASE_URL
// that RLS does not bind and a missing or bound DATABASE_OWNER_URL; shadow refuses a
// role RLS binds (migration 0123; docs/operations/row-level-security.md).
await failFastAsync(() => assertRlsStartup());
const port = readRuntimeConfig().listenPort ?? 8080;

// Build the worker Env lazily (it opens the object-store clients) so the HTTP
// port binds as soon as the configuration has been validated above.
let cachedEnv: WorkerEnv | null = null;
function getEnv(): WorkerEnv {
  if (!cachedEnv) cachedEnv = createWorkerEnv();
  return cachedEnv;
}

let draining = false;
let wakeRequested = false;
// Set on SIGTERM/SIGINT: no further ping starts a drain and the running one
// claims nothing more after the job in hand.
let stopping = false;
let currentDrain: Promise<void> = Promise.resolve();

// Drain the queue to empty. The `draining` guard means only one drain runs at a
// time; a `/drain` ping that arrives mid-drain sets `wakeRequested`, and the
// loop runs one more pass afterwards. That closes the race where a job is
// enqueued in the instant between the last empty claim and `draining = false`.
async function runDrain(): Promise<void> {
  if (draining) {
    wakeRequested = true;
    return;
  }

  draining = true;
  try {
    do {
      wakeRequested = false;
      const processed = await drainQueue(
        getEnv(),
        config,
        undefined,
        () => stopping,
      );
      if (processed > 0) {
        console.log(`[DocumentWorker] Drained ${processed} job(s)`);
      }
    } while (wakeRequested && !stopping);
  } catch (error) {
    console.error("[DocumentWorker] Drain failed", error);
  } finally {
    draining = false;
  }
}

const server = Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, draining });
    }

    if (request.method === "POST" && url.pathname === "/drain") {
      if (stopping) {
        return Response.json({ accepted: false, stopping }, { status: 503 });
      }
      const alreadyDraining = draining;
      // Kick the drain and respond immediately. The container keeps processing
      // after the response (it is a long-running process, not a request-scoped
      // Worker), so we never hold the caller on a long PDF render.
      // A ping during a drain only asks it for another pass: keep the promise
      // of the drain that is really running.
      const started = runDrain();
      if (!alreadyDraining) currentDrain = started;
      return Response.json(
        { accepted: true, alreadyDraining },
        { status: 202 },
      );
    }

    return new Response("Not found\n", { status: 404 });
  },
});

console.log(
  `[DocumentWorker] Listening on :${port} (worker ${config.workerId})`,
);

// SIGTERM (a container stop) and SIGINT: stop listening, let the job in hand
// finish (up to SHUTDOWN_GRACE_MS), close the database pools.
installGracefulShutdown(
  createWorkerShutdownPlan({
    stopWork: () => {
      stopping = true;
      return currentDrain;
    },
    stopListening: () => {
      void server.stop();
    },
    closeDatabases,
    deadlineMs: readRuntimeConfig().shutdownGraceMs,
  }),
);
