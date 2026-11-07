// The desktop store's lifecycles as data (see @calibra-facil/schemas
// state-machine.ts), with the SQLite triggers generated from them (migration
// 0026). Every writer in outbox.ts, conflicts.ts and attachments.ts names a
// command of these tables; the triggers refuse any other status write, whoever
// issues it.
import {
  defineStateMachine,
  type StateMachine,
} from "@calibra-facil/schemas/state-machine";
import {
  ATTACHMENT_UPLOAD_STATUSES,
  OUTBOX_STATUSES,
  SYNC_CONFLICT_STATUSES,
} from "@calibra-facil/schemas/sync-status";

// outbox.status: one local change on its way to the cloud.
//   create   appendOutboxEvent: pending
//   fail     a transport error or a transient refusal: retried with backoff
//   accept   the cloud applied it
//   reject   a permanent refusal: dead (its dependents are held, not sent)
//   conflict the cloud's record moved since the desktop's base
//   requeue  a dead event retried by the user, or a conflict resolved by
//              keeping the local change
//   discard  an audited give-up: a dead event, a held dependent, or a conflict
//              discarded by the user (the trace stays in domain_events)
export const OUTBOX_MACHINE = defineStateMachine({
  name: "outbox event",
  states: OUTBOX_STATUSES,
  commands: [
    "create",
    "fail",
    "accept",
    "reject",
    "conflict",
    "requeue",
    "discard",
  ],
  transitions: [
    { from: null, command: "create", to: "pending" },
    { from: "pending", command: "fail", to: "failed" },
    { from: "failed", command: "fail", to: "failed" },
    { from: "pending", command: "accept", to: "synced" },
    { from: "failed", command: "accept", to: "synced" },
    { from: "pending", command: "reject", to: "dead" },
    { from: "failed", command: "reject", to: "dead" },
    { from: "pending", command: "conflict", to: "conflict" },
    { from: "failed", command: "conflict", to: "conflict" },
    { from: "dead", command: "requeue", to: "pending" },
    { from: "conflict", command: "requeue", to: "pending" },
    { from: "dead", command: "discard", to: "discarded" },
    { from: "pending", command: "discard", to: "discarded" },
    { from: "failed", command: "discard", to: "discarded" },
    { from: "conflict", command: "discard", to: "discarded" },
  ],
});

// sync_conflicts.status: a change the cloud refused as stale.
//   create   recorded from the push result: open
//   resolve  the user keeps the local change (its event is requeued)
//   discard  the user gives the local change up (audited; a reason for a
//              regulated record)
// `ignored` is history only: older builds wrote it and marked the change synced
// although the cloud never received it; no code writes it now.
const SYNC_CONFLICT_MACHINE = defineStateMachine({
  name: "sync conflict",
  states: SYNC_CONFLICT_STATUSES,
  commands: ["create", "resolve", "discard"],
  transitions: [
    { from: null, command: "create", to: "open" },
    { from: "open", command: "resolve", to: "resolved" },
    { from: "open", command: "discard", to: "discarded_by_user" },
  ],
});

// attachments.upload_status: the bytes of a file captured offline.
//   create  pending
//   upload  the file reached the object store (uploaded; repeating is a no-op)
//   link    the cloud linked it to its record (synced)
//   retry   back to pending for another upload (also a dead one, by the user)
//   kill    the upload or its event was refused for good
const ATTACHMENT_UPLOAD_MACHINE = defineStateMachine({
  name: "attachment upload",
  states: ATTACHMENT_UPLOAD_STATUSES,
  commands: ["create", "upload", "link", "retry", "kill"],
  transitions: [
    { from: null, command: "create", to: "pending" },
    { from: "pending", command: "upload", to: "uploaded" },
    { from: "uploaded", command: "upload", to: "uploaded" },
    { from: "uploaded", command: "link", to: "synced" },
    { from: "pending", command: "link", to: "synced" },
    { from: "uploaded", command: "retry", to: "pending" },
    { from: "dead", command: "retry", to: "pending" },
    { from: "pending", command: "kill", to: "dead" },
    { from: "uploaded", command: "kill", to: "dead" },
  ],
});

type GuardedLocalColumn = {
  table: string;
  column: string;
  machine: Pick<
    StateMachine<string, string>,
    "name" | "creationStates" | "statePairs"
  >;
  /** States rows written by older builds may hold; they are never moved. */
  history?: readonly string[];
};

const LOCAL_GUARDED_COLUMNS: readonly GuardedLocalColumn[] = [
  { table: "outbox", column: "status", machine: OUTBOX_MACHINE },
  {
    table: "sync_conflicts",
    column: "status",
    machine: SYNC_CONFLICT_MACHINE,
    history: ["ignored"],
  },
  {
    table: "attachments",
    column: "upload_status",
    machine: ATTACHMENT_UPLOAD_MACHINE,
  },
];

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The SQLite triggers of one column: creation states on INSERT, listed moves on UPDATE. */
function sqliteStatusGuardSql(guarded: GuardedLocalColumn): string {
  const { table, column, machine } = guarded;
  const created = machine.creationStates().map(literal).join(", ");
  const pairs = machine
    .statePairs()
    .map(([from, to]) => literal(`${from}>${to}`))
    .join(", ");
  return `DROP TRIGGER IF EXISTS ${table}_${column}_insert_guard;
CREATE TRIGGER ${table}_${column}_insert_guard
BEFORE INSERT ON ${table}
WHEN NEW.${column} NOT IN (${created})
BEGIN
  SELECT RAISE(ABORT, 'illegal ${machine.name} creation ${column}');
END;
DROP TRIGGER IF EXISTS ${table}_${column}_transition_guard;
CREATE TRIGGER ${table}_${column}_transition_guard
BEFORE UPDATE OF ${column} ON ${table}
WHEN NEW.${column} IS NOT OLD.${column}
  AND (OLD.${column} || '>' || NEW.${column}) NOT IN (${pairs})
BEGIN
  SELECT RAISE(ABORT, 'illegal ${machine.name} transition');
END;`;
}

export function sqliteStatusGuardsSql(): string {
  return LOCAL_GUARDED_COLUMNS.map(sqliteStatusGuardSql).join("\n");
}
