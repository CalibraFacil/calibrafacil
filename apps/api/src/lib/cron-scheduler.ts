/**
 * In-process scheduler for the jobs under /api/cron/*, for installs without an
 * external scheduler: `CRON_SCHEDULER=internal` (the Docker setup's default).
 *
 * CRON_ENTRIES is the one schedule of the platform (UTC); a test keeps it in
 * step with the handlers of src/cron/dispatch.ts. Each run goes through the
 * same dispatcher (and CRON_SECRET check) as an HTTP trigger; runCron's lease
 * keeps two API replicas from running a job at the same time.
 */
import { Cron } from "croner";

export type CronEntry = { path: string; schedule: string };

export const CRON_ENTRIES: readonly CronEntry[] = [
  { path: "/api/cron/integrations", schedule: "*/30 * * * *" },
  { path: "/api/cron/notifications", schedule: "0 8 * * *" },
  { path: "/api/cron/portal-digest", schedule: "0 9 * * *" },
  { path: "/api/cron/auth-maintenance", schedule: "30 4 * * 1" },
  { path: "/api/cron/service-order-emails", schedule: "*/30 * * * *" },
  { path: "/api/cron/oot-emails", schedule: "*/30 * * * *" },
  { path: "/api/cron/queue-backstop", schedule: "*/30 * * * *" },
  { path: "/api/cron/spc-recompute", schedule: "0 3 * * *" },
  { path: "/api/cron/email-domain-health", schedule: "30 3 * * *" },
  { path: "/api/cron/certificate-drift", schedule: "0 6 * * *" },
  { path: "/api/cron/records-purge", schedule: "0 5 * * 0" },
  { path: "/api/cron/sync-change-log-purge", schedule: "15 4 * * *" },
];

export function startCronScheduler(options: {
  entries: readonly CronEntry[];
  dispatch: (request: Request) => Promise<Response>;
  secret: string | undefined;
}): Cron[] {
  return options.entries.map(
    (entry) =>
      new Cron(
        entry.schedule,
        // The schedules are in UTC; protect skips a tick while the
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
