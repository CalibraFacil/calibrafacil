// The Postgres guard for calibration_job.status, generated from the state
// machine in @calibra-facil/schemas (job-transitions.ts, the single owner of
// which status may follow which).
//
// `pnpm --filter @calibra-facil/db gen:job-transitions-sql` prints the block.
// The block is pasted verbatim into the migration that (re)defines the function
// and into sql/schema-extras.sql; job-transitions-sql.test.ts fails when either
// copy differs from what the current table generates, so a change to the table
// cannot ship without a migration that carries the new pairs.
import { JOB_TRANSITIONS, type JobStatus } from "@calibra-facil/schemas";

export const JOB_TRANSITIONS_SQL_BEGIN =
  "-- BEGIN generated: calibra_calibration_job_status_guard";
export const JOB_TRANSITIONS_SQL_END =
  "-- END generated: calibra_calibration_job_status_guard";

/** SQLSTATE of an illegal status write: a user-defined class, never P0001. */
const JOB_TRANSITION_SQLSTATE = "CF001";

/** Setting that lifts the guard for one transaction (audited data repair). */
const JOB_STATUS_REPAIR_SETTING = "calibra.allow_status_repair";

type StatusPair = readonly [from: JobStatus, to: JobStatus];

/** Distinct (from, to) moves of the table, in table order. No-ops and `create` excluded. */
export function allowedStatusPairs(): StatusPair[] {
  const seen = new Set<string>();
  const pairs: StatusPair[] = [];
  for (const { from, to } of JOB_TRANSITIONS) {
    if (from === null || from === to) continue;
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([from, to]);
  }
  return pairs;
}

/** The statuses a new row may be inserted in (the targets of `from: null`). */
export function creationStatuses(): JobStatus[] {
  const statuses: JobStatus[] = [];
  for (const { from, to } of JOB_TRANSITIONS) {
    if (from === null && !statuses.includes(to)) statuses.push(to);
  }
  return statuses;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function jobTransitionsSqlBlock(): string {
  const pairs = allowedStatusPairs()
    .map(([from, to]) => `    (${literal(from)}, ${literal(to)})`)
    .join(",\n");
  const creation = creationStatuses().map(literal).join(", ");
  return `${JOB_TRANSITIONS_SQL_BEGIN}
CREATE OR REPLACE FUNCTION calibra_calibration_job_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR coalesce(current_setting('${JOB_STATUS_REPAIR_SETTING}', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN (${creation}) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal job creation status %', NEW.status
      USING ERRCODE = '${JOB_TRANSITION_SQLSTATE}',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A calibration job is created in DRAFT and walks the state machine.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
${pairs}
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal job transition % -> %', OLD.status, NEW.status
    USING ERRCODE = '${JOB_TRANSITION_SQLSTATE}',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the job with the lifecycle commands (packages/schemas job-transitions.ts); an audited repair sets ${JOB_STATUS_REPAIR_SETTING} = on for one transaction.';
END
$$;
${JOB_TRANSITIONS_SQL_END}`;
}

/**
 * The trigger that runs the function; static, repeated beside the block.
 * Postgres fires triggers in name order: "status" sorts after
 * calibration_job_immutable_guard, so a status change on a frozen job keeps
 * being reported as a frozen column (db-immutability.int.spec.ts) and this
 * guard answers for every job that is not frozen.
 */
export const JOB_STATUS_TRIGGER_SQL = `DROP TRIGGER IF EXISTS calibration_job_status_transition_guard ON public.calibration_job;
CREATE TRIGGER calibration_job_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.calibration_job
  FOR EACH ROW EXECUTE FUNCTION calibra_calibration_job_status_guard();`;
