// The desktop store's lifecycle columns enforced by SQLite, generated from their
// state machines (src/state-machines.ts): outbox.status, sync_conflicts.status
// and attachments.upload_status. A status written outside the machine's moves
// (a late accept over a discarded event, a conflict reopened) now aborts the
// statement. Existing rows are not re-checked; an older build's history value
// (sync_conflicts `ignored`) stays as it is.
//
// The SQL is generated (`sqliteStatusGuardsSql()`); state-machines.test.ts fails
// when this text differs from what the current machines generate. When a machine
// changes, add a NEW migration with the new output (the triggers are dropped
// and recreated); do not edit this one.
export const migration0026StatusGuards = {
  id: 26,
  name: "status_guards",
  sql: `
DROP TRIGGER IF EXISTS outbox_status_insert_guard;
CREATE TRIGGER outbox_status_insert_guard
BEFORE INSERT ON outbox
WHEN NEW.status NOT IN ('pending')
BEGIN
  SELECT RAISE(ABORT, 'illegal outbox event creation status');
END;
DROP TRIGGER IF EXISTS outbox_status_transition_guard;
CREATE TRIGGER outbox_status_transition_guard
BEFORE UPDATE OF status ON outbox
WHEN NEW.status IS NOT OLD.status
  AND (OLD.status || '>' || NEW.status) NOT IN ('pending>failed', 'pending>synced', 'failed>synced', 'pending>dead', 'failed>dead', 'pending>conflict', 'failed>conflict', 'dead>pending', 'conflict>pending', 'dead>discarded', 'pending>discarded', 'failed>discarded', 'conflict>discarded')
BEGIN
  SELECT RAISE(ABORT, 'illegal outbox event transition');
END;
DROP TRIGGER IF EXISTS sync_conflicts_status_insert_guard;
CREATE TRIGGER sync_conflicts_status_insert_guard
BEFORE INSERT ON sync_conflicts
WHEN NEW.status NOT IN ('open')
BEGIN
  SELECT RAISE(ABORT, 'illegal sync conflict creation status');
END;
DROP TRIGGER IF EXISTS sync_conflicts_status_transition_guard;
CREATE TRIGGER sync_conflicts_status_transition_guard
BEFORE UPDATE OF status ON sync_conflicts
WHEN NEW.status IS NOT OLD.status
  AND (OLD.status || '>' || NEW.status) NOT IN ('open>resolved', 'open>discarded_by_user')
BEGIN
  SELECT RAISE(ABORT, 'illegal sync conflict transition');
END;
DROP TRIGGER IF EXISTS attachments_upload_status_insert_guard;
CREATE TRIGGER attachments_upload_status_insert_guard
BEFORE INSERT ON attachments
WHEN NEW.upload_status NOT IN ('pending')
BEGIN
  SELECT RAISE(ABORT, 'illegal attachment upload creation upload_status');
END;
DROP TRIGGER IF EXISTS attachments_upload_status_transition_guard;
CREATE TRIGGER attachments_upload_status_transition_guard
BEFORE UPDATE OF upload_status ON attachments
WHEN NEW.upload_status IS NOT OLD.upload_status
  AND (OLD.upload_status || '>' || NEW.upload_status) NOT IN ('pending>uploaded', 'uploaded>synced', 'pending>synced', 'uploaded>pending', 'dead>pending', 'pending>dead', 'uploaded>dead')
BEGIN
  SELECT RAISE(ABORT, 'illegal attachment upload transition');
END;
`,
};
