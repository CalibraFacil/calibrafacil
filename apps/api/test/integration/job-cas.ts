import { vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, getDb } from "@calibra-facil/db";
import {
  isTransactionScopeCallback,
  outsideTransactionScope,
} from "@calibra-facil/db/testing";
import { calibrationJob, jobAuditLog } from "@calibra-facil/db/schema";
import { setJobStatus } from "./job-fixtures";

// Shared fixtures for the compare-and-set specs on calibration_job writes
// (jobs.ts, public-api-v2/, sync.ts). Harness code: statements issued here are
// skipped by the tenant SQL guard (test/integration/ is classified as harness).

type JobChange = Partial<{
  status: typeof calibrationJob.$inferSelect.status;
  organizationId: string;
  /** A write that keeps the status: another actor saved the worksheet. */
  data: Record<string, unknown>;
  updatedAt: Date;
}>;

/**
 * What another actor does to the job: a status change walks the legal
 * transitions (the database refuses any other), the rest is a plain update.
 */
async function applyChange(
  jobId: number,
  change: JobChange,
  executor: Parameters<typeof setJobStatus>[3] = db,
): Promise<void> {
  const { status, ...columns } = change;
  if (status !== undefined) {
    await setJobStatus(jobId, status, columns, executor);
    return;
  }
  await executor
    .update(calibrationJob)
    .set(columns)
    .where(eq(calibrationJob.id, jobId));
}

/**
 * Forces the interleaving of a lost compare-and-set, deterministically: the
 * handler has already read the job, and right before it opens the transaction
 * that carries its write, another actor changes the job (`change`). A live race
 * can legitimately serialise either way, so asserting on one is flaky; this
 * fixes the order instead. Callers must `vi.restoreAllMocks()` afterwards.
 */
export function changeJobBeforeNextTransaction(
  jobId: number,
  change: JobChange,
): void {
  // `db` is a Proxy over the cached instance; spy on the instance itself.
  const instance = getDb();
  const originalTransaction = instance.transaction.bind(instance);
  // Another actor's committed write, on its own connection: inside a
  // transaction scope `db` is the request's transaction, which the other actor
  // is not part of.
  const otherActorChangesJob = () =>
    outsideTransactionScope(() => applyChange(jobId, change));
  vi.spyOn(instance, "transaction").mockImplementationOnce(
    async (callback, config) => {
      if (!isTransactionScopeCallback(callback)) {
        await otherActorChangesJob();
        return originalTransaction(callback, config);
      }
      // A request that runs in a transaction scope (the desktop sync apply):
      // the write's own transaction is the savepoint it opens inside the scope,
      // so that is the moment right before which the other actor writes.
      return originalTransaction(async (tx) => {
        const savepoint = tx.transaction.bind(tx);
        vi.spyOn(tx, "transaction").mockImplementationOnce(
          async (inner, innerConfig) => {
            await otherActorChangesJob();
            return savepoint(inner, innerConfig);
          },
        );
        return callback(tx);
      }, config);
    },
  );
}

/** Every column of the job row except the ones a status change may touch. */
export async function jobRow(jobId: number) {
  const [row] = await db
    .select()
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId));
  if (!row) throw new Error(`jobRow: job ${jobId} not found`);
  return row;
}

/** The row without the columns that any writer legitimately bumps. */
export function withoutVolatile(row: typeof calibrationJob.$inferSelect) {
  return { ...row, status: undefined, updatedAt: undefined };
}

export async function auditActions(jobId: number): Promise<string[]> {
  const rows = await db
    .select({ action: jobAuditLog.action })
    .from(jobAuditLog)
    .where(eq(jobAuditLog.jobId, jobId));
  return rows.map((row) => row.action);
}

/**
 * Makes every insert into job_audit_log fail (a temporary trigger), to prove the
 * status write and its audit row commit together or not at all. Returns the
 * function that removes the trigger; always call it in a `finally`.
 */
export async function failJobAuditInserts(): Promise<() => Promise<void>> {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION cas_test_fail_job_audit() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'cas_test: job_audit_log insert forced to fail';
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.execute(sql`
    CREATE TRIGGER cas_test_fail_job_audit
    BEFORE INSERT ON job_audit_log
    FOR EACH ROW EXECUTE FUNCTION cas_test_fail_job_audit()
  `);
  return async () => {
    await db.execute(
      sql`DROP TRIGGER IF EXISTS cas_test_fail_job_audit ON job_audit_log`,
    );
    await db.execute(sql`DROP FUNCTION IF EXISTS cas_test_fail_job_audit()`);
  };
}

/**
 * A real race, ordered by a row lock: `change` is applied inside a transaction
 * that holds the job's row lock; `request` runs meanwhile and blocks on its
 * first write to the job; once it is waiting, the lock holder commits and the
 * request's UPDATE re-evaluates its WHERE against the changed row. Use for
 * writes that are not wrapped in a transaction the handler opens itself.
 */
export async function raceWithRowLock(params: {
  jobId: number;
  change: JobChange;
  request: () => Promise<Response>;
}): Promise<Response> {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked: () => void = () => {};
  const lockTaken = new Promise<void>((resolve) => {
    locked = resolve;
  });

  const holder = db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT 1 FROM calibration_job WHERE id = ${params.jobId} FOR UPDATE`,
    );
    await applyChange(params.jobId, params.change, tx);
    locked();
    await gate;
  });

  await lockTaken;
  const pending = params.request();

  const deadline = Date.now() + 20_000;
  for (;;) {
    const waiting = await db.execute(sql`
      SELECT 1 FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `);
    // postgres-js returns the rows as an array.
    if (Array.isArray(waiting) && waiting.length > 0) break;
    if (Date.now() > deadline) {
      release();
      await holder;
      throw new Error("raceWithRowLock: the request never blocked on the row");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  release();
  await holder;
  return pending;
}
