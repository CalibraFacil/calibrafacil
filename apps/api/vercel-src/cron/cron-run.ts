import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";

// Wraps every cron handler so the whole cron system fails loudly and safely:
//
//  - Failure isolation: a throw becomes a structured 500 (never an uncaught
//    rejection), so one broken cron can't take down the function with an
//    unstructured stack.
//  - Visibility: the run's outcome is written to the `cron_run` heartbeat table
//    (last_success_at / last_status / consecutive_failures), and a failed run
//    returns a non-2xx so Vercel marks the invocation failed. Both are how a
//    silently-broken cron (the kind that 404'd unnoticed) becomes detectable.
//  - Overlap protection: a short row-lease (`locked_until`) prevents a slow run
//    from overlapping the next trigger. A row-lease — not pg_advisory_lock — is
//    used because Neon's pooled endpoint is PgBouncer transaction-mode, where
//    session-scoped advisory locks are unreliable.
//
// The whole mechanism is FAIL-OPEN: if `cron_run` is missing (migration not yet
// applied) or the DB hiccups while leasing, the task still runs without a lease
// or heartbeat rather than blocking the cron. This decouples deploy from
// migration — the routing/handler work keeps functioning regardless.

const DEFAULT_LEASE_SECONDS = 120;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro desconhecido no cron";
}

// Drizzle's db.execute returns a PG QueryResult — rows is on `.rows` for the
// neon driver and the result is array-like for postgres.js. Handle both without
// `as` assertions (banned by oxlint).
function rowsLength(result: unknown): number {
  const rows: unknown = Reflect.get(Object(result), "rows") ?? result;
  return Array.isArray(rows) ? rows.length : 0;
}

async function recordOutcome(
  job: string,
  status: "ok" | "error",
  errorMessage: string | null,
): Promise<void> {
  try {
    if (status === "ok") {
      await db.execute(
        sql`UPDATE cron_run
            SET locked_until = NULL,
                last_success_at = now(),
                last_status = 'ok',
                last_error = NULL,
                consecutive_failures = 0
            WHERE job = ${job}`,
      );
    } else {
      await db.execute(
        sql`UPDATE cron_run
            SET locked_until = NULL,
                last_status = 'error',
                last_error = ${errorMessage},
                consecutive_failures = consecutive_failures + 1
            WHERE job = ${job}`,
      );
    }
  } catch (error) {
    // Heartbeat is best-effort — never let recording an outcome mask the run.
    console.error("[Cron] failed to record heartbeat", {
      job,
      message: getErrorMessage(error),
    });
  }
}

export interface RunCronOptions {
  /** How long the lease is held before another run may steal it. */
  leaseSeconds?: number;
  /**
   * Optional predicate: return true if `result` represents a failed run even
   * though the task did not throw (e.g. every sub-task failed). A failed run is
   * recorded as an error and returned as a 500 so it surfaces in Vercel.
   */
  failed?: (result: unknown) => boolean;
}

/**
 * Run a cron `task` under the lease + heartbeat described above and return the
 * HTTP Response the dispatcher should send.
 *
 * On success the response body is the task's own return value (so existing
 * per-cron response contracts are preserved). On a skipped run (lease held by a
 * concurrent invocation) it returns 200 `{ skipped: true }`. On failure it
 * returns 500 `{ ok: false, error }`.
 */
export async function runCron(
  job: string,
  options: RunCronOptions,
  task: () => Promise<unknown>,
): Promise<Response> {
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  let leased = false;

  try {
    await db.execute(
      sql`INSERT INTO cron_run (job) VALUES (${job})
          ON CONFLICT (job) DO NOTHING`,
    );
    const acquired = await db.execute(
      sql`UPDATE cron_run
          SET locked_until = now() + (${leaseSeconds}::int * interval '1 second'),
              last_run_at = now()
          WHERE job = ${job}
            AND (locked_until IS NULL OR locked_until < now())
          RETURNING job`,
    );
    if (rowsLength(acquired) === 0) {
      // Another invocation holds the lease — skip without touching its row.
      console.warn("[Cron] skipped: another run holds the lease", { job });
      return Response.json(
        { skipped: true, reason: "another run holds the lease" },
        { status: 200 },
      );
    }
    leased = true;
  } catch (error) {
    // cron_run unavailable (migration lag) or a DB hiccup — fail open and run
    // the task anyway, just without a lease or heartbeat.
    console.warn("[Cron] lease unavailable, proceeding without it", {
      job,
      message: getErrorMessage(error),
    });
  }

  try {
    const value = await task();
    const isFailure = options.failed?.(value) ?? false;
    if (leased) {
      await recordOutcome(job, isFailure ? "error" : "ok", null);
    }
    return Response.json(value ?? { ok: true }, {
      status: isFailure ? 500 : 200,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Cron] task failed", { job, message });
    if (leased) {
      await recordOutcome(job, "error", message);
    }
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
