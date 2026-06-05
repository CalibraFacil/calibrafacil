// HTTP drain server — the entrypoint for the `services/document-worker`
// Cloudflare Container.
//
// Unlike `bun.ts` (which polls the database every couple of seconds and never
// lets the database scale to zero), this server does NOT poll. It sleeps until
// the API pings `POST /drain` after enqueueing an `app_queue_job` row, then
// drains the queue to empty and goes idle again. The Cloudflare Container's
// `sleepAfter` then scales the instance back to zero. Net effect: the database
// is only touched when there is real work — which is the whole point of moving
// this off Vercel without re-introducing the "wake Neon every 2s" problem.
import {
  createWorkerEnv,
  drainQueue,
  readQueueConfig,
  type QueueRuntimeConfig,
  type WorkerEnv,
} from "./queue-runtime.js";

// Minimal Bun.serve typing — avoids pulling in @types/bun just for one symbol.
declare const Bun: {
  serve(options: {
    port?: number;
    fetch(request: Request): Response | Promise<Response>;
  }): unknown;
};

const config: QueueRuntimeConfig = readQueueConfig();
const port = Number(process.env.PORT ?? 8080);

// Build the worker Env lazily so the HTTP port binds immediately (Cloudflare
// considers the container started once the port is listening) and a missing
// secret surfaces as a loud drain error rather than a silent failed start.
let cachedEnv: WorkerEnv | null = null;
function getEnv(): WorkerEnv {
  if (!cachedEnv) cachedEnv = createWorkerEnv();
  return cachedEnv;
}

let draining = false;
let wakeRequested = false;

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
      const processed = await drainQueue(getEnv(), config);
      if (processed > 0) {
        console.log(`[DocumentWorker] Drained ${processed} job(s)`);
      }
    } while (wakeRequested);
  } catch (error) {
    console.error("[DocumentWorker] Drain failed", error);
  } finally {
    draining = false;
  }
}

Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, draining });
    }

    if (request.method === "POST" && url.pathname === "/drain") {
      const alreadyDraining = draining;
      // Kick the drain and respond immediately. The container keeps processing
      // after the response (it is a long-running process, not a request-scoped
      // Worker), so we never hold the caller on a long PDF render.
      void runDrain();
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
