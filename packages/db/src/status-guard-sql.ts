// The Postgres guard of a status column, generated from its state machine
// (packages/schemas `defineStateMachine`). It generalises the calibration_job
// guard (job-transitions-sql.ts), which keeps its own generator and migration.
//
// For every column in STATUS_GUARDED_COLUMNS (status-machines.ts) the block
// below defines `calibra_<table>_<column>_guard()`; a BEFORE INSERT OR UPDATE OF
// <column> trigger runs it. It refuses:
//   - an INSERT in a state the machine does not create rows in;
//   - an UPDATE that moves the column along a pair the machine does not list.
// Writing the same value again is always allowed (an UPDATE that touches other
// columns). The hatches are the job guard's (migration 0130): the seed/owner
// rewrite setting and `calibra.allow_status_repair = on` for one audited repair
// transaction, both for a session of the table owner only, so the application
// role (calibra_app) cannot lift a guard by setting them.
//
// `pnpm --filter @calibra-facil/db gen:status-guards-sql` prints every block and
// trigger. The blocks are pasted verbatim into the migration that (re)defines
// them and into sql/schema-extras.sql; status-guard-sql.test.ts fails when a
// copy differs from what the current machines generate, so a change to a table
// cannot ship without a migration that carries it.

/** The part of a machine the guard reads. */
type GuardMachine = {
  readonly name: string;
  creationStates(): readonly string[];
  statePairs(): readonly (readonly [string, string])[];
};

export type GuardedColumn = {
  readonly table: string;
  readonly column: string;
  readonly machine: GuardMachine;
  /**
   * A nullable column: NULL is a legal value on insert and a legal starting
   * point of any listed move (cron_run.last_status before the first outcome).
   */
  readonly nullable?: boolean;
};

/** SQLSTATE of an illegal status write: a user-defined class, never P0001. */
const STATUS_TRANSITION_SQLSTATE = "CF001";

/** Setting that lifts the guards for one transaction (audited data repair). */
const STATUS_REPAIR_SETTING = "calibra.allow_status_repair";

function statusGuardFunctionName(guarded: GuardedColumn): string {
  return `calibra_${guarded.table}_${guarded.column}_guard`;
}

function statusGuardTriggerName(guarded: GuardedColumn): string {
  return `${guarded.table}_${guarded.column}_transition_guard`;
}

export function statusGuardBegin(guarded: GuardedColumn): string {
  return `-- BEGIN generated: ${statusGuardFunctionName(guarded)}`;
}

function statusGuardEnd(guarded: GuardedColumn): string {
  return `-- END generated: ${statusGuardFunctionName(guarded)}`;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function statusGuardSqlBlock(guarded: GuardedColumn): string {
  const { column, machine } = guarded;
  const fn = statusGuardFunctionName(guarded);
  const pairs = machine
    .statePairs()
    .map(([from, to]) => `    (${literal(from)}, ${literal(to)})`)
    .join(",\n");
  const creation = machine.creationStates().map(literal).join(", ");
  const nullInsert = guarded.nullable ? `NEW.${column} IS NULL OR ` : "";
  const nullStart = guarded.nullable
    ? `
  IF OLD.${column} IS NULL AND NEW.${column} IN (${creation}) THEN
    RETURN NEW;
  END IF;
`
    : "";
  const pairCheck =
    pairs.length > 0
      ? `
  IF (OLD.${column}, NEW.${column}) IN (
${pairs}
  ) THEN
    RETURN NEW;
  END IF;
`
      : "";
  return `${statusGuardBegin(guarded)}
CREATE OR REPLACE FUNCTION ${fn}()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('${STATUS_REPAIR_SETTING}', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF ${nullInsert}NEW.${column} IN (${creation}) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal ${machine.name} creation ${column} %', NEW.${column}
      USING ERRCODE = '${STATUS_TRANSITION_SQLSTATE}',
            TABLE = TG_TABLE_NAME,
            COLUMN = '${column}',
            HINT = 'A ${machine.name} is created in ${machine.creationStates().join(", ")}.';
  END IF;

  IF NEW.${column} IS NOT DISTINCT FROM OLD.${column} THEN
    RETURN NEW;
  END IF;
${nullStart}${pairCheck}
  RAISE EXCEPTION 'calibra: illegal ${machine.name} transition % -> %', OLD.${column}, NEW.${column}
    USING ERRCODE = '${STATUS_TRANSITION_SQLSTATE}',
          TABLE = TG_TABLE_NAME,
          COLUMN = '${column}',
          HINT = 'Move the ${machine.name} with its lifecycle commands (packages/schemas state machines); an audited repair sets ${STATUS_REPAIR_SETTING} = on for one transaction.';
END
$$;
${statusGuardEnd(guarded)}`;
}

/** The trigger that runs the function; static, repeated beside the block. */
export function statusGuardTriggerSql(guarded: GuardedColumn): string {
  const trigger = statusGuardTriggerName(guarded);
  return `DROP TRIGGER IF EXISTS ${trigger} ON public.${guarded.table};
CREATE TRIGGER ${trigger}
  BEFORE INSERT OR UPDATE OF ${guarded.column} ON public.${guarded.table}
  FOR EACH ROW EXECUTE FUNCTION ${statusGuardFunctionName(guarded)}();`;
}

/** Block and trigger of every column, in registry order: what a migration and schema-extras carry. */
export function statusGuardsSql(columns: readonly GuardedColumn[]): string {
  return columns
    .map(
      (guarded) =>
        `${statusGuardSqlBlock(guarded)}\n\n${statusGuardTriggerSql(guarded)}`,
    )
    .join("\n\n");
}

/** The generated block of `guarded` inside `text`, markers included; null when absent. */
export function statusGuardBlockIn(
  text: string,
  guarded: GuardedColumn,
): string | null {
  const beginMarker = statusGuardBegin(guarded);
  const endMarker = statusGuardEnd(guarded);
  const begin = text.indexOf(beginMarker);
  if (begin === -1) return null;
  const end = text.indexOf(endMarker, begin);
  if (end === -1) return null;
  return text.slice(begin, end + endMarker.length);
}
