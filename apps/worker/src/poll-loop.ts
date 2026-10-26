// A self-scheduling poll loop: the next tick is scheduled only after the
// previous one has finished, so ticks never overlap (a `setInterval` fires again
// while a slow batch, such as a certificate render, is still running, and two
// ticks then work the same queue from one process). `stop()` ends the loop and
// resolves once the tick in progress has finished, which is what a graceful
// shutdown waits for.

export type PollLoop = {
  /** Runs the first tick at once, then every `intervalMs` after a tick ends. */
  start: () => void;
  /** No further tick starts; resolves when the one in progress has finished. */
  stop: () => Promise<void>;
  /** True once `stop()` has been called, for work that should stop early. */
  isStopping: () => boolean;
};

export function createPollLoop(options: {
  intervalMs: number;
  /** One tick. `isStopping()` turns true when a shutdown has begun. */
  task: (isStopping: () => boolean) => Promise<unknown>;
  onError: (error: unknown) => void;
}): PollLoop {
  let stopping = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: Promise<void> = Promise.resolve();

  const isStopping = () => stopping;

  const tick = async () => {
    timer = undefined;
    try {
      await options.task(isStopping);
    } catch (error) {
      options.onError(error);
    }
    if (!stopping) timer = setTimeout(run, options.intervalMs);
  };

  const run = () => {
    current = tick();
  };

  return {
    start() {
      if (started || stopping) return;
      started = true;
      run();
    },
    async stop() {
      stopping = true;
      clearTimeout(timer);
      timer = undefined;
      await current;
    },
    isStopping,
  };
}
