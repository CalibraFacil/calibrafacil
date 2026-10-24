import { vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, getDb } from "@calibra-facil/db";
import { outsideTransactionScope } from "@calibra-facil/db/testing";
import {
  outsideApplication,
  shadowApplicationDatabase,
} from "./rls-shadow-mode";
import { calibrationJob, jobAuditLog } from "@calibra-facil/db/schema";
import { setJobStatus } from "./job-fixtures";

// Shared fixtures for the compare-and-set specs on calibration_job writes
// (jobs.ts, public-api-v2/, sync/). Harness code: statements issued here are
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
 * The statements that take the row lock of a calibration job: its UPDATE, and a
 * SELECT ... FOR UPDATE (the amendment and approval serialise on one). Drizzle
 * writes them as `update "calibration_job" set ...` and
 * `select ... from "calibration_job" ... for update`.
 */
const JOB_LOCKING_STATEMENT =
  /^\s*(update\s+"calibration_job"\s|select\b[\s\S]*\bfrom\s+"calibration_job"\b[\s\S]*\bfor\s+update\b)/i;

/**
 * Makes `before` run once, right before the first statement of this transaction
 * (or of a savepoint opened inside it) that takes the job's row lock. The
 * handler's own transaction is the one that carries its reads and its write
 * (`orgDb(org).transaction` names the laboratory first, then reads, then
 * writes), so "between the read and the write" is a moment INSIDE it: the other
 * actor commits on its own connection, and the write's WHERE is re-evaluated
 * against the changed row, exactly as in a live race. Nothing of this
 * transaction holds the job row yet at that moment, so the other actor's write
 * never waits on it.
 */
function armTransaction<T extends Pick<typeof db, "session" | "transaction">>(
  tx: T,
  before: () => Promise<void>,
): T {
  const session = tx.session;
  const prepareQuery = session.prepareQuery.bind(session);
  vi.spyOn(session, "prepareQuery").mockImplementation((query, ...rest) => {
    const prepared = prepareQuery(query, ...rest);
    if (!JOB_LOCKING_STATEMENT.test(query.sql)) return prepared;
    const execute = prepared.execute.bind(prepared);
    return Object.assign(prepared, {
      execute: async (...args: Parameters<typeof execute>) => {
        await before();
        return execute(...args);
      },
    });
  });
  // A savepoint opens a session of its own: arm it too.
  const savepoint = tx.transaction.bind(tx);
  vi.spyOn(tx, "transaction").mockImplementation((callback, config) =>
    savepoint((inner) => callback(armTransaction(inner, before)), config),
  );
  return tx;
}

/**
 * Forces the interleaving of a lost compare-and-set, deterministically: the
 * handler has already read the job, and right before the statement that takes
 * its row lock (the write, or the `FOR UPDATE` an approval or amendment
 * serialises on), another actor changes the job (`change`). A live race can
 * legitimately serialise either way, so asserting on one is flaky; this fixes
 * the order instead. Callers must `vi.restoreAllMocks()` afterwards.
 *
 * It works for every way a handler reaches its transaction: the plain
 * `db.transaction`, `orgDb(org).transaction` (which names the laboratory for
 * row-level security, so the same interleaving holds when the request runs as
 * `calibra_app`) and the savepoint inside a transaction scope (the desktop sync
 * apply).
 */
export function changeJobBeforeNextTransaction(
  jobId: number,
  change: JobChange,
): void {
  let fired = false;
  // Another actor's committed write, on its own connection: inside a
  // transaction scope `db` is the request's transaction, which the other actor
  // is not part of, and under the RLS shadow report (requests run as
  // `calibra_app`) it is the owner, not the application under test.
  const otherActorChangesJob = async () => {
    if (fired) return;
    fired = true;
    await outsideApplication(() =>
      outsideTransactionScope(() => applyChange(jobId, change)),
    );
  };
  // `db` is a Proxy over the cached instance; spy on the instances themselves:
  // the owner's, and under the RLS shadow report the calibra_app pool a request
  // actually runs on.
  const instances = [getDb(), shadowApplicationDatabase()];
  for (const instance of instances) {
    if (!instance) continue;
    const originalTransaction = instance.transaction.bind(instance);
    vi.spyOn(instance, "transaction").mockImplementation((callback, config) =>
      originalTransaction(
        (tx) => callback(armTransaction(tx, otherActorChangesJob)),
        config,
      ),
    );
  }
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
