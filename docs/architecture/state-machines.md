# Lifecycles as state machines

Every lifecycle in the product is declared once, as data, and enforced at three layers. Before
this, only `calibration_job.status` worked this way; the other ~40 status columns were `text` with a
TypeScript union, their rules copied into route handlers and frontends, and most writes were a blind
`UPDATE … WHERE id` after a read.

## The pattern

1. **The machine is data** (`packages/schemas/src/state-machine.ts`, `defineStateMachine`): the
   states, the commands, and `{ from, command, to }` rows. `from: null` is creation. A command may
   land in several states from one state when the target depends on data (an evaluation that needs a
   quote or not); the caller then names the target it computed (`requireTransition(from, cmd, to)`).
   The definition is validated when the module loads: unknown states or commands, duplicate rows,
   a command without rows and **a state nothing can reach** all throw, so a dead value cannot stay in
   the vocabulary.
2. **Every writer names a command.** Routes, the worker, the desktop store and the UI ask the machine
   (`canTransition`, `allowedFrom`, `targetOf`, `commandsFrom`) instead of keeping their own status
   lists. The write is a compare-and-set on the status it was checked from (or the row is read
   `FOR UPDATE` first when other writes precede it); losing the race is a 409
   `status_transition_conflict`, thrown as a `DomainError` so the transaction rolls back.
3. **The database refuses anything else.** `packages/db/src/status-machines.ts` lists every guarded
   column; `status-guard-sql.ts` generates one `BEFORE INSERT OR UPDATE OF <column>` trigger per
   column from its machine (migration 0140, and `sql/schema-extras.sql` for new databases). An INSERT
   must use a creation state; an UPDATE must be a listed move (rewriting the same value is always
   allowed). A refused write raises SQLSTATE `CF001`, which the API maps to 409
   `status_transition_conflict` and reports as a defect. The hatches are the job guard's: the
   seed/purge `calibra.allow_audit_rewrite` and `calibra.allow_status_repair` for an audited repair,
   both for the table owner only. Integration fixtures that place rows mid-lifecycle use
   `withStatusRepair` (`apps/api/test/integration/state-fixtures.ts`).

The desktop store follows the same pattern with SQLite triggers (`packages/local-db/src/
state-machines.ts`, local migration 0026). Lifecycles held in pairs of columns rather than a status
get CHECK constraints (migration 0141). Process and UI state that is not persisted uses a transition
table or a reducer over a discriminated union.

## Changing a machine

Edit the machine in `packages/schemas/src/machines/`, then
`pnpm --filter @calibra-facil/db gen:status-guards-sql` and paste the output into a **new** migration
and into the generated region of `sql/schema-extras.sql`. `status-guard-sql.test.ts` fails until both
carry exactly what the machine generates; it also checks that each column's default is a creation
state. For the desktop store, regenerate with `sqliteStatusGuardsSql()` into a new local migration.

## Inventory

| Column                                                                                                                      | Machine                                                                                                                         | Notes                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `calibration_job.status`                                                                                                    | `JOB_TRANSITIONS` (job-transitions.ts)                                                                                          | The original; its own generator (0119/0139).                                                                              |
| `service_order.status`                                                                                                      | `SERVICE_ORDER_MACHINE`                                                                                                         | `set_status` walks the declared graph; evaluate, repair, quote, deliver, close, cancel and reopen are their own commands. |
| `service_order_quote.status`                                                                                                | `SERVICE_ORDER_QUOTE_MACHINE`                                                                                                   | draft → sent → approved \| rejected.                                                                                      |
| `calibration_visit.status`, `visit_reschedule_request.status`                                                               | `VISIT_MACHINE`, `VISIT_RESCHEDULE_REQUEST_MACHINE`                                                                             | Start/settle derived from the visit's jobs.                                                                               |
| `calibration_request.status`                                                                                                | `CALIBRATION_REQUEST_MACHINE`                                                                                                   |                                                                                                                           |
| `calibration_method.status`                                                                                                 | `METHOD_MACHINE`                                                                                                                | Two publish routes, one command.                                                                                          |
| `asset.status`, `reference_standard.status`, `mass_composition_profile.status`                                              | `ASSET_MACHINE`, `REFERENCE_STANDARD_MACHINE`, `MASS_PROFILE_MACHINE`                                                           | Asset and standard statuses are free classifications (`set_status`: any → any) today.                                     |
| `corrective_action.status`, `non_conformance.status`                                                                        | `CORRECTIVE_ACTION_MACHINE`, `NON_CONFORMANCE_MACHINE`                                                                          |                                                                                                                           |
| `standard_recall.status`, `oot_notification.status`, `asset_oot_event.status`                                               | `STANDARD_RECALL_MACHINE`, `OOT_NOTIFICATION_MACHINE`, `ASSET_OOT_EVENT_MACHINE`                                                |                                                                                                                           |
| `personnel_competence.status`, `training_record.status`, `authorized_signatory.status`                                      | `COMPETENCE_MACHINE`, `TRAINING_MACHINE`, `SIGNATORY_MACHINE`                                                                   |                                                                                                                           |
| `proficiency_test.overall_status`, `control_chart.status`, `certificate_release.status`                                     | `PT_OVERALL_MACHINE`, `SPC_MACHINE`, `CERTIFICATE_RELEASE_MACHINE`                                                              | Derived by one pure function; the machine lists the moves the derivation may make.                                        |
| `commercial_agreement.status`, `billing_document.status` / `export_status`, `receivable_installment.status`                 | `COMMERCIAL_AGREEMENT_MACHINE`, `BILLING_DOCUMENT_MACHINE`, `BILLING_EXPORT_MACHINE`, `RECEIVABLE_INSTALLMENT_MACHINE`          | Includes the ERP poll's mirroring (`sync_remote`).                                                                        |
| `organization_integration.status`, `integration_sync_run.status`, `integration_sync_item.status`                            | `INTEGRATION_MACHINE`, `INTEGRATION_SYNC_RUN_MACHINE`, `INTEGRATION_SYNC_ITEM_MACHINE`                                          |                                                                                                                           |
| `public_api_webhook_subscription.status`, `public_api_webhook_delivery.status`                                              | `WEBHOOK_SUBSCRIPTION_MACHINE`, `WEBHOOK_DELIVERY_MACHINE`                                                                      |                                                                                                                           |
| `organization.status`, `organization_unit.status`, `organization_email_domain.status` / `key_status`, `notification.status` | `ORGANIZATION_MACHINE`, `ORGANIZATION_UNIT_MACHINE`, `EMAIL_DOMAIN_MACHINE`, `EMAIL_DOMAIN_KEY_MACHINE`, `NOTIFICATION_MACHINE` |                                                                                                                           |
| `app_queue_job.status`, `queue_job_receipt.status`, `portal_export_job.status`, `cron_run.last_status`                      | `APP_QUEUE_JOB_MACHINE`, `QUEUE_JOB_RECEIPT_MACHINE`, `PORTAL_EXPORT_JOB_MACHINE`, `CRON_RUN_MACHINE`                           | `cron_run.last_status` is nullable.                                                                                       |
| `invitation.status`                                                                                                         | `INVITATION_MACHINE`                                                                                                            | Documented, not guarded: Better-Auth writes it.                                                                           |
| desktop `outbox.status`, `sync_conflicts.status`, `attachments.upload_status`                                               | `OUTBOX_MACHINE`, `SYNC_CONFLICT_MACHINE`, `ATTACHMENT_UPLOAD_MACHINE` (local-db)                                               | SQLite triggers; a late push result is a no-op, not a resurrection.                                                       |
| desktop local server process                                                                                                | `LOCAL_SERVER_TRANSITIONS` (apps/desktop)                                                                                       | Every state change goes through `#moveTo`.                                                                                |

Not guarded: `billing_group.status` (no writer exists) and `issued_certificate_snapshot.status`
(append-only; a certificate's lifecycle is its status events, `certificate-lifecycle.ts`).

Pair-of-column invariants (migration 0141, `NOT VALID`: new writes only): an order is closed xor
canceled; a quote has at most one approver; an outbox row is processed xor dead-lettered (both
outboxes); a revoked signing certificate is neither active nor default, and a default certificate is
active.

Frontend: the job page's action dialogs are one reducer (`features/jobs/job-dialog-state.ts`); the
competence dialogs and the certificate revoke dialog hold one "which dialog / which record" state; the
label request is one flow state with a polling limit; the execute form's leave permission is consumed
by the navigation it was granted for.

## Behaviour that changed while making it explicit

Most tables encode what the code already did. These moves changed, because the old behaviour was a
defect once written down:

- An order's evaluation is recorded only at intake (it could rewind a delivered or closed order); a
  repair is finished only from the bench; the desktop execution save starts a repair only from an
  approved quote (it forced `repair_in_progress` from any stage).
- Reopen returns to `awaiting_tech_evaluation` when the remembered stage is not one it may return to.
- Confirming an `IN_PROGRESS` visit keeps it in progress (it rewound to `CONFIRMED`); cancelling or
  completing a visit supersedes its pending reschedule request (it stayed pending forever).
- Revoking an already revoked signatory is a 409 (it overwrote who revoked it and when).
- The public API's request cancel clears the approval fields, as the lab's reject does.
- An integration sync message redelivered for a finished run does nothing (it revived the run); an
  audit-pack redelivery never overwrites a finished export (it marked a completed export `FAILED`).
- Billing issue, void and payment lock the document; quote decisions and portal decisions lock the
  quote and the order.
- Never-written states were removed: quote `expired`/`canceled`/`superseded`, signatory
  `SUSPENDED`/`EXPIRED`, organization `OFFBOARDING`, export `PENDING`, sync item `PENDING` (its
  default is now `RUNNING`).

Decided with the rest (questions Q60–Q68): an out-of-tolerance or sent-for-calibration standard
returns to use only by renewal (§6.4.9); an ineffective CAPA verification returns the CAPA to
implementation, so a CAPA closes only after an effective check (§8.7); signing out of the desktop
forgets its offline access (the data stays). Asset statuses, agreements, recalls, the ERP mirror and
`billing_group` keep their current behaviour, encoded as is.
