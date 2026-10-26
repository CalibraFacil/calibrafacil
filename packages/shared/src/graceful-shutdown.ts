/**
 * Graceful shutdown for the long-running servers (the API, the worker).
 *
 * On SIGTERM/SIGINT a process must (1) stop taking new work, (2) wait for the
 * work already running (a certificate render, a request) up to a deadline, then
 * (3) release its resources (database pools) and exit. An orchestrator that
 * stops a container sends SIGTERM and kills it after its grace period, so the
 * deadline here must stay below that period (`stop_grace_period` in
 * deploy/compose.yaml).
 *
 * The plan is injected so the logic is testable without signals or a real clock.
 */

export type ShutdownStep = {
  name: string;
  run: () => void | Promise<void>;
};

export type ShutdownPlan = {
  /** Stop accepting new work: close the listener, stop pollers and schedulers. */
  stop: readonly ShutdownStep[];
  /** Resolve once the work already running has finished. Bounded by the deadline. */
  drain: readonly ShutdownStep[];
  /** Release resources (database pools) once nothing runs, or the deadline passed. */
  close: readonly ShutdownStep[];
  /** How long `drain` may take before the process gives up and exits anyway. */
  deadlineMs: number;
};

export type ShutdownLogger = {
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
};

export type ShutdownResult = {
  /** True when every drain step finished within the deadline. */
  clean: boolean;
  /** Names of the steps that threw, or were still running at the deadline. */
  failed: string[];
};

/** Time allowed for closing resources after the drain, so a stuck pool cannot hang the exit. */
const CLOSE_TIMEOUT_MS = 2_000;

const consoleLogger: ShutdownLogger = {
  info: (message) => console.info(message),
  error: (message, error) =>
    error === undefined
      ? console.error(message)
      : console.error(message, error),
};

/** Runs the steps together; resolves with the names of those that threw. */
async function runSteps(
  steps: readonly ShutdownStep[],
  logger: ShutdownLogger,
  phase: string,
): Promise<string[]> {
  const failed: string[] = [];
  await Promise.all(
    steps.map(async (step) => {
      try {
        await step.run();
      } catch (error) {
        failed.push(step.name);
        logger.error(`[shutdown] ${phase}: ${step.name} failed`, error);
      }
    }),
  );
  return failed;
}

/** Runs the steps, but stops waiting for them at `ms`; the names still running are reported. */
async function runBounded(
  steps: readonly ShutdownStep[],
  ms: number,
  logger: ShutdownLogger,
  phase: string,
): Promise<{ failed: string[]; timedOut: boolean }> {
  const pending = new Set(steps.map((step) => step.name));
  const tracked = steps.map((step) => ({
    name: step.name,
    run: async () => {
      try {
        await step.run();
      } finally {
        pending.delete(step.name);
      }
    },
  }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  const outcome = await Promise.race([runSteps(tracked, logger, phase), limit]);
  clearTimeout(timer);
  if (outcome === "timeout") {
    return { failed: [...pending], timedOut: true };
  }
  return { failed: outcome, timedOut: false };
}

export async function runGracefulShutdown(
  plan: ShutdownPlan,
  options: { signal?: string; logger?: ShutdownLogger } = {},
): Promise<ShutdownResult> {
  const logger = options.logger ?? consoleLogger;
  const startedAt = Date.now();
  logger.info(
    `[shutdown] ${options.signal ?? "stop"} received: no longer taking new work (waiting up to ${plan.deadlineMs} ms for what is running)`,
  );

  const failed = await runSteps(plan.stop, logger, "stop");

  const drained = await runBounded(
    plan.drain,
    plan.deadlineMs,
    logger,
    "drain",
  );
  failed.push(...drained.failed);
  if (drained.timedOut) {
    logger.error(
      `[shutdown] deadline of ${plan.deadlineMs} ms passed with work still running: ${drained.failed.join(", ")}`,
    );
  }

  const closed = await runBounded(
    plan.close,
    CLOSE_TIMEOUT_MS,
    logger,
    "close",
  );
  failed.push(...closed.failed);

  const clean = !drained.timedOut && drained.failed.length === 0;
  logger.info(
    `[shutdown] done in ${Date.now() - startedAt} ms (${clean ? "clean" : "forced"})`,
  );
  return { clean, failed };
}

/**
 * Wires SIGTERM and SIGINT to {@link runGracefulShutdown}, then exits: 0 when
 * everything finished, 1 when the deadline passed or a step failed. A second
 * signal while shutting down exits at once (a second Ctrl-C).
 */
export function installGracefulShutdown(
  plan: ShutdownPlan,
  options: {
    logger?: ShutdownLogger;
    signals?: readonly string[];
    onSignal?: (signal: string, handler: () => void) => void;
    exit?: (code: number) => void;
  } = {},
): { shutdown: (signal: string) => Promise<ShutdownResult> } {
  const logger = options.logger ?? consoleLogger;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const onSignal =
    options.onSignal ??
    ((signal: string, handler: () => void) => {
      process.on(signal, handler);
    });
  let running: Promise<ShutdownResult> | null = null;

  const shutdown = (signal: string): Promise<ShutdownResult> => {
    if (running) {
      logger.error(`[shutdown] ${signal} again: exiting now`);
      exit(1);
      return running;
    }
    running = runGracefulShutdown(plan, { logger, signal }).then((result) => {
      exit(result.clean && result.failed.length === 0 ? 0 : 1);
      return result;
    });
    return running;
  };

  for (const signal of options.signals ?? ["SIGTERM", "SIGINT"]) {
    onSignal(signal, () => {
      void shutdown(signal);
    });
  }
  return { shutdown };
}
