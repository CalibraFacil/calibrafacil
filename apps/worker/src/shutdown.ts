import type { ShutdownPlan } from "@calibra-facil/shared/graceful-shutdown";

// What a worker does on SIGTERM/SIGINT (wired in bun.ts and serve.ts): claim no
// further job, let the job in hand finish (a certificate render can take many
// seconds), then release the database pools. A job still running at the
// deadline is not lost: its lease expires and another worker reclaims it
// (releaseStaleQueueJobs). The deadline is SHUTDOWN_GRACE_MS; the container's
// stop_grace_period stays above it.

export type WorkerShutdownParts = {
  /** Stops taking work; resolves once the job in hand has settled. */
  stopWork: () => Promise<void>;
  /** Stops listening, for the HTTP drain server. */
  stopListening?: () => void;
  closeDatabases: () => Promise<void>;
  deadlineMs: number;
};

export function createWorkerShutdownPlan(
  parts: WorkerShutdownParts,
): ShutdownPlan {
  // Started in the stop phase (it flips the "stopping" flag the claim loop
  // checks), awaited in the drain phase.
  let settled: Promise<void> = Promise.resolve();
  return {
    stop: [
      {
        name: "queue polling",
        run: () => {
          settled = parts.stopWork();
        },
      },
      ...(parts.stopListening
        ? [{ name: "http server", run: parts.stopListening }]
        : []),
    ],
    drain: [{ name: "job in progress", run: () => settled }],
    close: [{ name: "database pools", run: parts.closeDatabases }],
    deadlineMs: parts.deadlineMs,
  };
}
