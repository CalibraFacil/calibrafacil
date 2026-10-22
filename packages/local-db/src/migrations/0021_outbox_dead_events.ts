import { PERMANENT_OUTBOX_REJECTION_CODES } from "@calibra-facil/contracts";

// Permanently refused events get their own outbox state (`dead`) instead of
// staying `failed` with no next attempt, which kept them eligible on every
// cycle and let ~50 of them crowd newer work out of the push page.
//
// - `error_code`: the cloud's rejection code, kept apart from the message.
// - `dead_at` / `discarded_at`: when the event was declared dead, and when a
//   person discarded it (the row stays as the local audit trace).
//
// Older builds recorded every cloud rejection as `failed` with a NULL next
// attempt and `last_error = '<CODE>: <reason>'`. Those rows are classified by
// that stored code with the same table the running code uses, so the two cannot
// disagree: permanent codes become `dead`; the rest keep retrying.
const permanentCodes = PERMANENT_OUTBOX_REJECTION_CODES.map(
  (code) => `'${code}'`,
).join(", ");

export const migration0021OutboxDeadEvents = {
  id: 21,
  name: "outbox_dead_events",
  sql: `
ALTER TABLE outbox ADD COLUMN error_code TEXT;
ALTER TABLE outbox ADD COLUMN dead_at TEXT;
ALTER TABLE outbox ADD COLUMN discarded_at TEXT;

UPDATE outbox
SET error_code = substr(last_error, 1, instr(last_error, ': ') - 1)
WHERE status = 'failed'
  AND next_attempt_at IS NULL
  AND instr(last_error, ': ') > 1
  AND substr(last_error, 1, instr(last_error, ': ') - 1) NOT GLOB '*[^A-Z0-9_]*';

UPDATE outbox
SET status = 'dead',
  dead_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'failed'
  AND next_attempt_at IS NULL
  AND error_code IN (${permanentCodes});

UPDATE domain_events
SET sync_state = 'dead'
WHERE event_id IN (SELECT event_id FROM outbox WHERE status = 'dead');
`,
};
