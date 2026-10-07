/**
 * In-process scheduler for the jobs under /api/cron/*, for installs without an
 * external scheduler: `CRON_SCHEDULER=internal` (the Docker setup's default).
 *
 * The schedules come from apps/api/vercel.json, the list Vercel itself runs,
 * so the two can never drift. Each run goes through the same dispatcher (and
 * CRON_SECRET check) as an HTTP trigger; runCron's lease keeps two API
 * replicas from running a job at the same time.
 */
import { Cron } from "croner";

export type CronEntry = { path: string; schedule: string };

/** The `crons` list of a vercel.json document. */
export function readCronEntries(config: unknown): CronEntry[] {
  if (typeof config !== "object" || config === null) return [];
  const crons: unknown = Reflect.get(config, "crons");
  if (!Array.isArray(crons)) return [];

  return crons.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const path: unknown = Reflect.get(entry, "path");
    const schedule: unknown = Reflect.get(entry, "schedule");
    return typeof path === "string" &&
      path.startsWith("/api/cron/") &&
      typeof schedule === "string"
      ? [{ path, schedule }]
      : [];
  });
}

export function startCronScheduler(options: {
  entries: CronEntry[];
  dispatch: (request: Request) => Promise<Response>;
  secret: string | undefined;
}): Cron[] {
  return options.entries.map(
    (entry) =>
      new Cron(
        entry.schedule,
        // Vercel cron schedules are in UTC; protect skips a tick while the
        // previous run of the same job is still going.
        { name: entry.path, timezone: "Etc/UTC", protect: true },
        async () => {
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
        },
      ),
  );
}
