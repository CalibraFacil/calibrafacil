import { eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { calibrationJob } from "@calibra-facil/db/schema";
import { JOB_TRANSITIONS } from "@calibra-facil/schemas";
import type { JobStatus } from "@calibra-facil/schemas";

// Harness code: fixtures for calibration_job rows that must be in a status other
// than DRAFT. Postgres enforces the status machine (migration 0119), so a
// fixture cannot insert an APPROVED job or flip a status at will: it inserts in
// DRAFT and walks the real transitions of packages/schemas/src/job-transitions.ts,
// as a user would. A state no sequence of legal moves reaches is put in place
// with the audited-repair hatches instead (see `setJobStatus`).

const DRAFT: JobStatus = "DRAFT";

type JobInsert = typeof calibrationJob.$inferInsert;
type JobRow = typeof calibrationJob.$inferSelect;
type JobColumns = Partial<Omit<JobInsert, "status">>;
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Shortest chain of legal moves from `from` to `to` (table order), null when none exists. */
function pathBetween(from: JobStatus, to: JobStatus): JobStatus[] | null {
  if (from === to) return [];
  const previous = new Map<JobStatus, JobStatus>();
  const queue: JobStatus[] = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const move of JOB_TRANSITIONS) {
      if (move.from !== current || move.to === current) continue;
      if (move.to === from || previous.has(move.to)) continue;
      previous.set(move.to, current);
      queue.push(move.to);
    }
  }
  if (!previous.has(to)) return null;
  const path: JobStatus[] = [];
  let step: JobStatus | undefined = to;
  while (step !== undefined && step !== from) {
    path.unshift(step);
    step = previous.get(step);
  }
  return path;
}

/**
 * Moves a job to `target` through legal transitions only, with `columns`
 * written by the last move (every move keeps `updatedAt` when given). A
 * SUPERSEDED target needs `supersededById` (the amendment link), and a target no
 * chain of legal moves reaches (CANCELED back to REVIEW, APPROVED to REJECTED...)
 * is a state no writer produces: it is put in place by an audited repair
 * (SET LOCAL calibra.allow_status_repair / allow_audit_rewrite, one transaction),
 * which is also what a test about a pre-existing illegal state does.
 */
export async function setJobStatus(
  jobId: number,
  target: JobStatus,
  columns: JobColumns = {},
  executor: Executor = db,
): Promise<JobRow> {
  const [current] = await executor
    .select({ status: calibrationJob.status })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId));
  if (!current) throw new Error(`setJobStatus: job ${jobId} not found`);

  const path = pathBetween(current.status, target);
  const amendment = target === "SUPERSEDED" && columns.supersededById != null;
  const reachable =
    path !== null &&
    (target !== "SUPERSEDED" || amendment || current.status === target);
  if (!reachable) {
    const repair = async (tx: Executor) => {
      await tx.execute(sql`set local calibra.allow_status_repair = 'on'`);
      await tx.execute(sql`set local calibra.allow_audit_rewrite = 'on'`);
      const [row] = await tx
        .update(calibrationJob)
        .set({ ...columns, status: target })
        .where(eq(calibrationJob.id, jobId))
        .returning();
      if (!row) throw new Error(`setJobStatus: job ${jobId} not found`);
      return row;
    };
    return executor === db
      ? db.transaction((tx) => repair(tx))
      : repair(executor);
  }

  const steps = path ?? [];
  if (steps.length === 0) {
    const [row] = await executor
      .update(calibrationJob)
      .set({ ...columns, status: target })
      .where(eq(calibrationJob.id, jobId))
      .returning();
    if (!row) throw new Error(`setJobStatus: job ${jobId} not found`);
    return row;
  }

  let last: JobRow | undefined;
  for (const [index, status] of steps.entries()) {
    const isLast = index === steps.length - 1;
    // eslint-disable-next-line no-await-in-loop
    const [row] = await executor
      .update(calibrationJob)
      .set(
        isLast
          ? { ...columns, status }
          : {
              status,
              ...(columns.updatedAt ? { updatedAt: columns.updatedAt } : {}),
            },
      )
      .where(eq(calibrationJob.id, jobId))
      .returning();
    if (!row) throw new Error(`setJobStatus: job ${jobId} not found`);
    last = row;
  }
  if (!last) throw new Error(`setJobStatus: job ${jobId} not found`);
  return last;
}

/**
 * Inserts job rows the way the app creates them (DRAFT) and walks each one to
 * the status its `values` ask for. Every other column is written at insert, so
 * the rows are what a direct insert would have produced (`updatedAt` and the
 * amendment link are carried by the last move).
 */
export async function insertJobs(
  values: JobInsert | JobInsert[],
): Promise<JobRow[]> {
  const list = Array.isArray(values) ? values : [values];
  if (list.length === 0) return [];
  const inserted = await db
    .insert(calibrationJob)
    .values(
      list.map((row) =>
        // The amendment link is written by the move that supersedes the job.
        row.status === "SUPERSEDED"
          ? {
              ...row,
              status: DRAFT,
              supersededById: null,
              supersededAt: null,
              amendmentReason: null,
            }
          : { ...row, status: DRAFT },
      ),
    )
    .returning();

  const rows: JobRow[] = [];
  for (const [index, row] of inserted.entries()) {
    const wanted = list[index]?.status ?? DRAFT;
    if (wanted === DRAFT) {
      rows.push(row);
      continue;
    }
    const source = list[index];
    // eslint-disable-next-line no-await-in-loop
    const moved = await setJobStatus(row.id, wanted, {
      ...(source?.updatedAt ? { updatedAt: source.updatedAt } : {}),
      ...(wanted === "SUPERSEDED"
        ? {
            supersededById: source?.supersededById ?? null,
            supersededAt: source?.supersededAt ?? null,
            amendmentReason: source?.amendmentReason ?? null,
          }
        : {}),
    });
    rows.push(moved);
  }
  return rows;
}

export async function insertJob(values: JobInsert): Promise<JobRow> {
  const [row] = await insertJobs(values);
  if (!row) throw new Error("insertJob: insert failed");
  return row;
}
