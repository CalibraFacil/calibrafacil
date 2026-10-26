import type { ShutdownPlan } from "@calibra-facil/shared/graceful-shutdown";

import type { InFlightRuns } from "../lib/cron-scheduler";

// What the API does on SIGTERM/SIGINT (wired in src/bun.ts), kept free of Bun
// and the database so it is testable: stop listening and stop the in-process
// cron schedule, wait for the requests and cron runs already under way, then
// release the database pools and the error reporter. The deadline is
// SHUTDOWN_GRACE_MS; the container's stop_grace_period stays above it.

export type ApiShutdownParts = {
  /** Stops accepting connections; resolves when the requests already running are done. */
  stopServer: () => Promise<void>;
  /** Stops the scheduled cron jobs (they keep the process alive). */
  stopCron: () => void;
  inFlightCron: InFlightRuns;
  closeDatabases: () => Promise<void>;
  flushErrors: () => Promise<void>;
  deadlineMs: number;
};

export function createApiShutdownPlan(parts: ApiShutdownParts): ShutdownPlan {
  // `server.stop()` both closes the listener and settles when the requests in
  // flight have finished, so it is started in the stop phase and awaited in the
  // drain phase.
  let serverStopped: Promise<void> = Promise.resolve();
  return {
    stop: [
      {
        name: "http server",
        run: () => {
          serverStopped = parts.stopServer();
        },
      },
      { name: "cron scheduler", run: parts.stopCron },
    ],
    drain: [
      { name: "in-flight requests", run: () => serverStopped },
      { name: "running cron jobs", run: () => parts.inFlightCron.idle() },
    ],
    close: [
      { name: "error reporter", run: parts.flushErrors },
      { name: "database pools", run: parts.closeDatabases },
    ],
    deadlineMs: parts.deadlineMs,
  };
}
