/**
 * In-process scheduler for the jobs under /api/cron/*, for installs without an
 * external scheduler: `CRON_SCHEDULER=internal` (the Docker setup's default).
 *
 * The schedule is `CRON_ENTRIES` (src/cron/schedule.ts). Each run goes through the
 * same dispatcher (and CRON_SECRET check) as an HTTP trigger; runCron's lease
 * keeps two API replicas from running a job at the same time.
 */
import { Cron } from "croner";

export type CronEntry = { path: string; schedule: string };

/**
 * The runs in progress, so a shutdown can wait for them: a cron run that is
 * killed half-way (an e-mail drain between the send and its mark) is retried by
 * the next tick, but finishing it is cheaper and safer.
 */
export type InFlightRuns = {
  track: <T>(run: Promise<T>) => Promise<T>;
  /** Resolves once no tracked run is left (including ones started meanwhile). */
  idle: () => Promise<void>;
};

export function createInFlightRuns(): InFlightRuns {
  const running = new Set<Promise<unknown>>();
  return {
    track(run) {
      running.add(run);
      const forget = () => {
        running.delete(run);
      };
      run.then(forget, forget);
      return run;
    },
    async idle() {
      while (running.size > 0) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- a run may start while the previous batch settles.
        await Promise.allSettled(running);
      }
    },
  };
}

export function startCronScheduler(options: {
  entries: readonly CronEntry[];
  dispatch: (request: Request) => Promise<Response>;
  secret: string | undefined;
  /** Records each run so a shutdown can wait for it. */
  inFlight?: InFlightRuns;
}): Cron[] {
  const run = async (entry: CronEntry) => {
    const startedAt = Date.now();
    try {
      const response = await options.dispatch(
        new Request(`http://localhost${entry.path}`, {
          headers: options.secret
            ? { authorization: `Bearer ${options.secret}` }
            : {},
        }),
      );
      const outcome = `${response.status} in ${Date.now() - startedAt} ms`;
      if (response.ok) console.info(`[cron] ${entry.path}: ${outcome}`);
      else console.error(`[cron] ${entry.path}: ${outcome}`);
    } catch (error) {
      console.error(`[cron] ${entry.path} failed`, error);
    }
  };

  return options.entries.map(
    (entry) =>
      new Cron(
        entry.schedule,
        // The schedules are in UTC; protect skips a tick while the
        // previous run of the same job is still going.
        { name: entry.path, timezone: "Etc/UTC", protect: true },
        () => {
          const started = run(entry);
          return options.inFlight ? options.inFlight.track(started) : started;
        },
      ),
  );
}
