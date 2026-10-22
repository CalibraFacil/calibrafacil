# Retention of regulated records

Decision Q16 (`docs/auditoria-perguntas.md`): technical records, certificates,
audit logs and event logs are kept **10 years minimum**. The period is
configurable per organization and **never below 5 years**. Nothing is purged
automatically until an operator enables it.

This document is the inventory behind that decision (REQ-RET-1). The tables
below the marker are **generated from `packages/db/src/schema.ts`**; a test
(`packages/db/src/records-retention.test.ts`) fails when they drift. To refresh
them after a schema change:

```bash
pnpm --dir packages/db retention:inventory
```

## Model

| Piece                                            | Where                                     | What it does                                                                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organization.retention_years`                   | schema.ts, migration 0117                 | Retention period, default 10, `CHECK (retention_years >= 5)`.                                                                                                                             |
| `organization.legal_hold` (+ `_reason`)          | schema.ts, migration 0117                 | While true the purge job never touches the organization.                                                                                                                                  |
| `organization.deleted_at/_by`, `deletion_reason` | schema.ts, migration 0117                 | Soft delete of a LAB organization. `CHECK (deleted_at IS NULL OR status = 'SUSPENDED')`, so `requireOrganization` refuses every member.                                                   |
| `calibra_retain_until(org, record_date)`         | migration 0117, `sql/schema-extras.sql`   | `record_date + retention_years` of that organization: the first date a record may be purged.                                                                                              |
| `organization_lab_delete_guard` trigger          | migration 0117, `sql/schema-extras.sql`   | `DELETE` of a LAB organization raises, unless `calibra.allow_org_purge = 'on'` (purge job, empty-org cleanup) or the seed hatch `calibra.allow_audit_rewrite` is set for the transaction. |
| Evidence foreign keys                            | schema.ts, migration 0117                 | Every FK that cascaded a delete into evidence is `RESTRICT`.                                                                                                                              |
| Purge job `records-purge`                        | `apps/api/src/lib/records-purge.ts`, cron | Disabled unless `RECORDS_PURGE_ENABLED=true`; dry-run unless `RECORDS_PURGE_MODE=execute`. See `DEPLOYMENT.md`.                                                                           |

### Rules

1. **Evidence is never the target of a CASCADE.** A foreign key from an
   evidence table to a non-evidence table (organization, customer, asset, unit,
   reference standard, numbering profile) is `RESTRICT`. The only CASCADE edges
   into evidence are _owned parts_ of an evidence aggregate (an invoice line to
   its invoice, an attachment to its service order); they are listed in
   `OWNED_PART_EDGES` with a reason, and the owner itself cannot be reached by a
   cascade. `SET NULL` stays on actor columns (`created_by`, `performed_by`, ...):
   the row survives, only the reference to the person is cleared.
2. **A LAB organization is soft-deleted, not deleted.** Soft delete sets
   `deleted_at`, `deleted_by`, `deletion_reason` and `status = 'SUSPENDED'` in
   one statement (`softDeleteLabOrganization` in `apps/api/src/lib/records-retention.ts`).
   The sign-in and membership lookups ignore a soft-deleted organization
   (`findDefaultActiveOrganizationId`, `hasActiveLabMembership`,
   `hasPendingLabInvitation`, the magic-link preview and the public sign-up
   membership check). The Better Auth `organization.delete` endpoint is disabled.
   The owner soft-deletes from the organization settings
   (`POST /api/organization/soft-delete`: owner only, the organization's name
   typed as confirmation, and a reason), and the same function revokes every
   active API key of the laboratory with an audit row each. A key whose
   organization is suspended or soft-deleted is refused by `requireApiKeyAuth`
   with 403 `organization_suspended` / `organization_deleted`, revoked or not.
   Issued certificates stay verifiable at `/verify`: that route does not look at
   the organization's lifecycle.
3. **A CLIENT organization** (the system-owned organization behind a portal
   customer) is still hard-deleted with its customer, because the customer's
   foreign keys are RESTRICT: a customer that has jobs, service orders, billing
   documents, requests or visits cannot be deleted, and the routes answer `409`.
4. **Provisioning cleanup** (`cleanupFailedLabProvisioning`) may hard-delete a
   just-created organization only after proving, in the same transaction and
   under a lock on the organization row, that no evidence table holds a row of
   it (`evidenceTablesHoldingRecords`). Otherwise it soft-deletes.
5. **The purge job** hard-deletes only organizations that are soft-deleted, not
   under legal hold, whose **newest evidence** is older than `retention_years`
   (`calibra_retain_until(org, newest) <= now()`), after writing a
   `records.purge.*` event to `platform_event_log` (append-only, survives the
   purge). In dry-run (the default) it only logs what it would purge.

### What the purge job does not do

- It does not remove objects from storage (certificate PDFs, attachments in
  R2/S3). The purge event records the organization and the row counts; storage
  cleanup is a separate step to be run against the same list.
- It does not touch `platform_event_log` or other platform-level evidence.
- It never runs unless an operator sets `RECORDS_PURGE_ENABLED=true`, and never
  deletes unless `RECORDS_PURGE_MODE=execute`.

### Known pointer columns

Some evidence rows carry a nullable pointer (not an actor) with `SET NULL`:
`automatic_send_audit_log.applied_rule_id`,
`certificate_release.applied_policy_id`, `certificate_numbering_audit_log.profile_id`,
`billing_document_item.job_id`, `service_order.billing_document_id` and similar.
Deleting the referenced configuration row nulls the pointer but keeps the
evidence row (migration 0115 already allows exactly that). They are listed below
under "Nulled".

<!-- BEGIN GENERATED: records-retention -->

<!-- Generated by `pnpm --dir packages/db retention:inventory`; do not edit by hand. -->

## Evidence tables

73 evidence tables out of 135; 394 foreign keys in schema.ts, 114 of them ON DELETE CASCADE.
Each entry lists the foreign keys the table itself carries, which are the only way a parent's deletion reaches it.

### Technical records (calibration, SPC, OOT) (10)

- `asset_oot_event`
  - `job_id` to `calibration_job`: RESTRICT. blocks the delete of the parent.
  - `asset_id` to `asset`: RESTRICT. blocks the delete of the parent.
  - `customer_id` to `customer`: RESTRICT. blocks the delete of the parent.
  - `lab_organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
- `asset_oot_impact_assessment`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `event_id` to `asset_oot_event`: CASCADE. owned part: removed only with its owner.
  - `portal_user_id` to `user`: RESTRICT. blocks the delete of the parent.
- `calibration_job`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
  - `customer_id` to `customer`: RESTRICT. blocks the delete of the parent.
  - `asset_id` to `asset`: RESTRICT. blocks the delete of the parent.
  - `service_id` to `service`: RESTRICT. blocks the delete of the parent.
  - `technician_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `visit_id` to `calibration_visit`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `source_service_order_id` to `service_order`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `created_by` to `user`: RESTRICT. blocks the delete of the parent.
  - `approved_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `rejected_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `check_standard_reading`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
  - `standard_id` to `reference_standard`: RESTRICT. blocks the delete of the parent.
  - `created_by` to `user`: RESTRICT. blocks the delete of the parent.
- `control_chart`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
  - `standard_id` to `reference_standard`: RESTRICT. blocks the delete of the parent.
  - `nc_id` to `non_conformance`: NO ACTION. blocks the delete of the parent.
  - `capa_id` to `corrective_action`: NO ACTION. blocks the delete of the parent.
  - `created_by` to `user`: RESTRICT. blocks the delete of the parent.
- `job_standard`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `job_id` to `calibration_job`: CASCADE. owned part: removed only with its owner.
  - `standard_id` to `reference_standard`: RESTRICT. blocks the delete of the parent.
- `oot_impact_assessment`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `nc_id` to `non_conformance`: RESTRICT. blocks the delete of the parent.
  - `signed_by` to `user`: RESTRICT. blocks the delete of the parent.
  - `created_by` to `user`: RESTRICT. blocks the delete of the parent.
- `oot_notification`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `nc_id` to `non_conformance`: RESTRICT. blocks the delete of the parent.
  - `job_id` to `calibration_job`: RESTRICT. blocks the delete of the parent.
  - `recall_id` to `standard_recall`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `approved_by` to `user`: RESTRICT. blocks the delete of the parent.
- `proficiency_test`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
  - `standard_id` to `reference_standard`: RESTRICT. blocks the delete of the parent.
  - `capa_id` to `corrective_action`: NO ACTION. blocks the delete of the parent.
  - `created_by` to `user`: RESTRICT. blocks the delete of the parent.
- `pt_plan_item`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
  - `created_by` to `user`: RESTRICT. blocks the delete of the parent.

### Certificates (4)

- `certificate_input`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `job_id` to `calibration_job`: RESTRICT. blocks the delete of the parent.
- `certificate_numbering_sequence`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `profile_id` to `certificate_numbering_profile`: RESTRICT. blocks the delete of the parent.
- `certificate_release`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `calibration_job_id` to `calibration_job`: CASCADE. owned part: removed only with its owner.
  - `applied_policy_id` to `certificate_release_policy`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `released_by_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `issued_certificate_snapshot`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `job_id` to `calibration_job`: RESTRICT. blocks the delete of the parent.
  - `issued_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `voided_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.

### Audit logs (22)

- `accredited_scope_line_audit_log`
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `asset_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `asset_oot_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `authorized_signatory_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
- `automatic_send_audit_log`
  - `service_order_id` to `service_order`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `applied_rule_id` to `automatic_send_rule`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `actor_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `calibration_request_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `certificate_numbering_audit_log`
  - `profile_id` to `certificate_numbering_profile`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `performed_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `certificate_release_audit_log`
  - `actor_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `applied_policy_id` to `certificate_release_policy`: SET NULL. pointer column: the row stays, the pointer is cleared.
- `control_chart_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `corrective_action_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `customer_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `financial_audit_log`
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `job_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `method_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `non_conformance_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `organization_api_key_audit_log`
  - `performed_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `personnel_competence_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
- `proficiency_test_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `reference_standard_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `service_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.
- `training_record_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
- `visit_audit_log`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `performed_by` to `user`: NO ACTION. blocks the delete of the parent.

### Event logs (4)

- `integration_event_log`: no foreign keys (soft references only).
- `organization_event_log`
  - `unit_id` to `organization_unit`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `actor_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `actor_member_id` to `member`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `platform_event_log` Platform-level: never purged with an organization.
  - `actor_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `target_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `service_order_event_log`: no foreign keys (soft references only).

### Reference standards and their certificates (3)

- `reference_standard`
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `created_by` to `user`: RESTRICT. blocks the delete of the parent.
- `reference_standard_certificate_document`
  - `standard_id` to `reference_standard`: RESTRICT. blocks the delete of the parent.
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
  - `uploaded_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `standard_recall`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `standard_id` to `reference_standard`: RESTRICT. blocks the delete of the parent.
  - `nc_id` to `non_conformance`: RESTRICT. blocks the delete of the parent.
  - `approved_by` to `user`: RESTRICT. blocks the delete of the parent.
  - `created_by` to `user`: RESTRICT. blocks the delete of the parent.

### Non-conformities and corrective actions (2)

- `corrective_action`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `responsible_id` to `user`: NO ACTION. blocks the delete of the parent.
  - `verified_by` to `user`: NO ACTION. blocks the delete of the parent.
  - `closed_by` to `user`: NO ACTION. blocks the delete of the parent.
  - `created_by` to `user`: RESTRICT. blocks the delete of the parent.
- `non_conformance`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `job_id` to `calibration_job`: NO ACTION. blocks the delete of the parent.
  - `detected_by` to `user`: NO ACTION. blocks the delete of the parent.
  - `disposition_approved_by` to `user`: NO ACTION. blocks the delete of the parent.
  - `resolved_by` to `user`: NO ACTION. blocks the delete of the parent.
  - `capa_id` to `corrective_action`: NO ACTION. blocks the delete of the parent.
  - `created_by` to `user`: RESTRICT. blocks the delete of the parent.

### Personnel competence and authorization (3)

- `authorized_signatory`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `asset_type_id` to `asset_type`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `authorized_by` to `user`: NO ACTION. blocks the delete of the parent.
  - `revoked_by` to `user`: NO ACTION. blocks the delete of the parent.
- `personnel_competence`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `asset_type_id` to `asset_type`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `requested_by` to `user`: NO ACTION. blocks the delete of the parent.
  - `evaluated_by` to `user`: NO ACTION. blocks the delete of the parent.
  - `approved_by` to `user`: NO ACTION. blocks the delete of the parent.
  - `created_by` to `user`: NO ACTION. blocks the delete of the parent.
- `training_record`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `competence_id` to `personnel_competence`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `created_by` to `user`: NO ACTION. blocks the delete of the parent.

### Service orders, requests and visits (17)

- `calibration_request`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
  - `customer_id` to `customer`: RESTRICT. blocks the delete of the parent.
  - `auth_organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `submitted_by` to `user`: RESTRICT. blocks the delete of the parent.
  - `reviewed_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `approved_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `rejected_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `converted_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `calibration_request_item`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `request_id` to `calibration_request`: CASCADE. owned part: removed only with its owner.
  - `asset_id` to `asset`: RESTRICT. blocks the delete of the parent.
  - `converted_job_id` to `calibration_job`: SET NULL. pointer column: the row stays, the pointer is cleared.
- `calibration_visit`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
  - `customer_id` to `customer`: RESTRICT. blocks the delete of the parent.
  - `source_request_id` to `calibration_request`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `technician_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `created_by` to `user`: RESTRICT. blocks the delete of the parent.
  - `confirmed_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `cancelled_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `customer_confirmed_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `service_order`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
  - `customer_id` to `customer`: RESTRICT. blocks the delete of the parent.
  - `asset_id` to `asset`: RESTRICT. blocks the delete of the parent.
  - `opened_by_user_id` to `user`: RESTRICT. blocks the delete of the parent.
  - `responsible_technician_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `inmetro_repair_mark_applied_by_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `billing_document_id` to `billing_document`: SET NULL. pointer column: the row stays, the pointer is cleared.
- `service_order_asset_snapshot`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `service_order_id` to `service_order`: CASCADE. owned part: removed only with its owner.
  - `asset_id` to `asset`: RESTRICT. blocks the delete of the parent.
- `service_order_attachment`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `service_order_id` to `service_order`: CASCADE. owned part: removed only with its owner.
  - `uploaded_by_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `service_order_certificate_link`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `service_order_id` to `service_order`: CASCADE. owned part: removed only with its owner.
  - `certificate_job_id` to `calibration_job`: RESTRICT. blocks the delete of the parent.
  - `linked_by_user_id` to `user`: RESTRICT. blocks the delete of the parent.
- `service_order_delivery_document`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `service_order_id` to `service_order`: CASCADE. owned part: removed only with its owner.
  - `issued_by_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `service_order_evaluation`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `service_order_id` to `service_order`: CASCADE. owned part: removed only with its owner.
  - `technician_id` to `user`: RESTRICT. blocks the delete of the parent.
- `service_order_execution`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `service_order_id` to `service_order`: CASCADE. owned part: removed only with its owner.
  - `started_by_user_id` to `user`: RESTRICT. blocks the delete of the parent.
  - `finished_by_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `service_order_execution_item`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `execution_id` to `service_order_execution`: CASCADE. owned part: removed only with its owner.
  - `quote_item_id` to `service_order_quote_item`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `material_id` to `material`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `technician_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `service_order_intake_document`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `service_order_id` to `service_order`: CASCADE. owned part: removed only with its owner.
  - `issued_by_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `service_order_numbering_sequence`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
- `service_order_outsourced_cost`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `service_order_id` to `service_order`: CASCADE. owned part: removed only with its owner.
  - `created_by_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `service_order_quote`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `service_order_id` to `service_order`: CASCADE. owned part: removed only with its owner.
  - `sent_by_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `approved_by_portal_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `approved_manually_by_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `created_by_user_id` to `user`: RESTRICT. blocks the delete of the parent.
- `service_order_quote_item`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `quote_id` to `service_order_quote`: CASCADE. owned part: removed only with its owner.
  - `material_id` to `material`: SET NULL. pointer column: the row stays, the pointer is cleared.
- `visit_reschedule_request`
  - `visit_id` to `calibration_visit`: CASCADE. owned part: removed only with its owner.
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `customer_id` to `customer`: RESTRICT. blocks the delete of the parent.
  - `requested_by` to `user`: RESTRICT. blocks the delete of the parent.
  - `resolved_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.

### Finance documents and agreements (8)

- `billing_document`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `customer_id` to `customer`: RESTRICT. blocks the delete of the parent.
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
  - `agreement_id` to `commercial_agreement`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `issued_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `voided_by` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
  - `created_by` to `user`: NO ACTION. blocks the delete of the parent.
  - `updated_by` to `user`: NO ACTION. blocks the delete of the parent.
- `billing_document_item`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `document_id` to `billing_document`: CASCADE. owned part: removed only with its owner.
  - `job_id` to `calibration_job`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `job_commercial_snapshot_id` to `job_commercial_snapshot`: SET NULL. pointer column: the row stays, the pointer is cleared.
  - `material_id` to `material`: SET NULL. pointer column: the row stays, the pointer is cleared.
- `billing_group`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `customer_id` to `customer`: RESTRICT. blocks the delete of the parent.
  - `created_by_user_id` to `user`: SET NULL. actor column: the row stays, the actor reference is cleared.
- `billing_group_service_order`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `group_id` to `billing_group`: CASCADE. owned part: removed only with its owner.
  - `service_order_id` to `service_order`: RESTRICT. blocks the delete of the parent.
- `commercial_agreement`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `customer_id` to `customer`: RESTRICT. blocks the delete of the parent.
  - `created_by` to `user`: NO ACTION. blocks the delete of the parent.
  - `updated_by` to `user`: NO ACTION. blocks the delete of the parent.
- `job_commercial_snapshot`
  - `job_id` to `calibration_job`: CASCADE. owned part: removed only with its owner.
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `customer_id` to `customer`: RESTRICT. blocks the delete of the parent.
  - `unit_id` to `organization_unit`: RESTRICT. blocks the delete of the parent.
  - `service_id` to `service`: RESTRICT. blocks the delete of the parent.
  - `agreement_id` to `commercial_agreement`: SET NULL. pointer column: the row stays, the pointer is cleared.
- `payment_receipt`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `installment_id` to `receivable_installment`: CASCADE. owned part: removed only with its owner.
  - `recorded_by` to `user`: NO ACTION. blocks the delete of the parent.
- `receivable_installment`
  - `organization_id` to `organization`: RESTRICT. blocks the delete of the parent.
  - `document_id` to `billing_document`: CASCADE. owned part: removed only with its owner.

## Delete paths from the roots

For each root, the CASCADE closure is followed (what Postgres removes with the row), and every foreign key from that closure into an evidence table is classified by what it does to the evidence.

### Deleting a `organization` row

Rows Postgres deletes along with it (45 tables by CASCADE): `accredited_scope_line`, `asset`, `automatic_send_rule`, `calibration_method`, `certificate_numbering_profile`, `certificate_release_policy`, `commercial_agreement_service_term`, `commercial_agreement_unit_scope`, `customer`, `customer_group`, `environmental_limits`, `integration_connection`, `integration_oauth_app`, `integration_object_link`, `integration_sync_cursor`, `integration_sync_item`, `integration_sync_run`, `invitation`, `lab_account_setup_token`, `mass_composition_profile`, `material`, `member`, `member_unit_assignment`, `member_visual_signature`, `notification`, `oot_email_outbox`, `organization_api_key`, `organization_custom_domain`, `organization_email_domain`, `organization_integration`, `organization_signing_certificate`, `organization_unit`, `portal_export_job`, `public_api_idempotency_key`, `public_api_resource_ref`, `public_api_webhook_delivery`, `public_api_webhook_subscription`, `scheduled_notification`, `service`, `service_order_email_outbox`, `service_order_public_access_token`, `service_order_settings`, `sso_provider`, `supplier`, `sync_applied_event`.

- Evidence deleted by CASCADE: **0**.
- Evidence columns nulled by SET NULL: **9**.
- Evidence tables that make Postgres refuse the delete (RESTRICT / NO ACTION): **95**.

Nulled:

- `organization` → `automatic_send_rule` (`organization_id`) ⇒ `automatic_send_audit_log.applied_rule_id` (`automatic_send_audit_log`)
- `organization` → `material` (`organization_id`) ⇒ `billing_document_item.material_id` (`billing_document_item`)
- `organization` → `certificate_numbering_profile` (`organization_id`) ⇒ `certificate_numbering_audit_log.profile_id` (`certificate_numbering_audit_log`)
- `organization` → `certificate_release_policy` (`organization_id`) ⇒ `certificate_release.applied_policy_id` (`certificate_release`)
- `organization` → `certificate_release_policy` (`organization_id`) ⇒ `certificate_release_audit_log.applied_policy_id` (`certificate_release_audit_log`)
- `organization` → `member` (`organization_id`) ⇒ `organization_event_log.actor_member_id` (`organization_event_log`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `organization_event_log.unit_id` (`organization_event_log`)
- `organization` → `material` (`organization_id`) ⇒ `service_order_execution_item.material_id` (`service_order_execution_item`)
- `organization` → `material` (`organization_id`) ⇒ `service_order_quote_item.material_id` (`service_order_quote_item`)

Refused by:

- `organization` ⇒ `asset_audit_log.organization_id` RESTRICT (`asset_audit_log`)
- `organization` ⇒ `asset_oot_audit_log.organization_id` RESTRICT (`asset_oot_audit_log`)
- `organization` → `asset` (`lab_organization_id`) ⇒ `asset_oot_event.asset_id` RESTRICT (`asset_oot_event`)
- `organization` → `customer` (`auth_organization_id`) ⇒ `asset_oot_event.customer_id` RESTRICT (`asset_oot_event`)
- `organization` ⇒ `asset_oot_event.lab_organization_id` RESTRICT (`asset_oot_event`)
- `organization` ⇒ `asset_oot_impact_assessment.organization_id` RESTRICT (`asset_oot_impact_assessment`)
- `organization` ⇒ `authorized_signatory.organization_id` RESTRICT (`authorized_signatory`)
- `organization` ⇒ `authorized_signatory_audit_log.organization_id` RESTRICT (`authorized_signatory_audit_log`)
- `organization` → `customer` (`auth_organization_id`) ⇒ `billing_document.customer_id` RESTRICT (`billing_document`)
- `organization` ⇒ `billing_document.organization_id` RESTRICT (`billing_document`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `billing_document.unit_id` RESTRICT (`billing_document`)
- `organization` ⇒ `billing_document_item.organization_id` RESTRICT (`billing_document_item`)
- `organization` → `customer` (`auth_organization_id`) ⇒ `billing_group.customer_id` RESTRICT (`billing_group`)
- `organization` ⇒ `billing_group.organization_id` RESTRICT (`billing_group`)
- `organization` ⇒ `billing_group_service_order.organization_id` RESTRICT (`billing_group_service_order`)
- `organization` → `asset` (`lab_organization_id`) ⇒ `calibration_job.asset_id` RESTRICT (`calibration_job`)
- `organization` → `customer` (`auth_organization_id`) ⇒ `calibration_job.customer_id` RESTRICT (`calibration_job`)
- `organization` ⇒ `calibration_job.organization_id` RESTRICT (`calibration_job`)
- `organization` → `service` (`organization_id`) ⇒ `calibration_job.service_id` RESTRICT (`calibration_job`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `calibration_job.unit_id` RESTRICT (`calibration_job`)
- `organization` ⇒ `calibration_request.auth_organization_id` RESTRICT (`calibration_request`)
- `organization` → `customer` (`auth_organization_id`) ⇒ `calibration_request.customer_id` RESTRICT (`calibration_request`)
- `organization` ⇒ `calibration_request.organization_id` RESTRICT (`calibration_request`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `calibration_request.unit_id` RESTRICT (`calibration_request`)
- `organization` ⇒ `calibration_request_audit_log.organization_id` RESTRICT (`calibration_request_audit_log`)
- `organization` → `asset` (`lab_organization_id`) ⇒ `calibration_request_item.asset_id` RESTRICT (`calibration_request_item`)
- `organization` ⇒ `calibration_request_item.organization_id` RESTRICT (`calibration_request_item`)
- `organization` → `customer` (`auth_organization_id`) ⇒ `calibration_visit.customer_id` RESTRICT (`calibration_visit`)
- `organization` ⇒ `calibration_visit.organization_id` RESTRICT (`calibration_visit`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `calibration_visit.unit_id` RESTRICT (`calibration_visit`)
- `organization` ⇒ `certificate_input.organization_id` RESTRICT (`certificate_input`)
- `organization` ⇒ `certificate_numbering_sequence.organization_id` RESTRICT (`certificate_numbering_sequence`)
- `organization` → `certificate_numbering_profile` (`organization_id`) ⇒ `certificate_numbering_sequence.profile_id` RESTRICT (`certificate_numbering_sequence`)
- `organization` ⇒ `certificate_release.organization_id` RESTRICT (`certificate_release`)
- `organization` ⇒ `check_standard_reading.organization_id` RESTRICT (`check_standard_reading`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `check_standard_reading.unit_id` RESTRICT (`check_standard_reading`)
- `organization` → `customer` (`auth_organization_id`) ⇒ `commercial_agreement.customer_id` RESTRICT (`commercial_agreement`)
- `organization` ⇒ `commercial_agreement.organization_id` RESTRICT (`commercial_agreement`)
- `organization` ⇒ `control_chart.organization_id` RESTRICT (`control_chart`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `control_chart.unit_id` RESTRICT (`control_chart`)
- `organization` ⇒ `control_chart_audit_log.organization_id` RESTRICT (`control_chart_audit_log`)
- `organization` ⇒ `corrective_action.organization_id` RESTRICT (`corrective_action`)
- `organization` ⇒ `corrective_action_audit_log.organization_id` RESTRICT (`corrective_action_audit_log`)
- `organization` ⇒ `customer_audit_log.organization_id` RESTRICT (`customer_audit_log`)
- `organization` ⇒ `issued_certificate_snapshot.organization_id` RESTRICT (`issued_certificate_snapshot`)
- `organization` ⇒ `job_audit_log.organization_id` RESTRICT (`job_audit_log`)
- `organization` → `customer` (`auth_organization_id`) ⇒ `job_commercial_snapshot.customer_id` RESTRICT (`job_commercial_snapshot`)
- `organization` ⇒ `job_commercial_snapshot.organization_id` RESTRICT (`job_commercial_snapshot`)
- `organization` → `service` (`organization_id`) ⇒ `job_commercial_snapshot.service_id` RESTRICT (`job_commercial_snapshot`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `job_commercial_snapshot.unit_id` RESTRICT (`job_commercial_snapshot`)
- `organization` ⇒ `job_standard.organization_id` RESTRICT (`job_standard`)
- `organization` ⇒ `method_audit_log.organization_id` RESTRICT (`method_audit_log`)
- `organization` ⇒ `non_conformance.organization_id` RESTRICT (`non_conformance`)
- `organization` ⇒ `non_conformance_audit_log.organization_id` RESTRICT (`non_conformance_audit_log`)
- `organization` ⇒ `oot_impact_assessment.organization_id` RESTRICT (`oot_impact_assessment`)
- `organization` ⇒ `oot_notification.organization_id` RESTRICT (`oot_notification`)
- `organization` ⇒ `payment_receipt.organization_id` RESTRICT (`payment_receipt`)
- `organization` ⇒ `personnel_competence.organization_id` RESTRICT (`personnel_competence`)
- `organization` ⇒ `personnel_competence_audit_log.organization_id` RESTRICT (`personnel_competence_audit_log`)
- `organization` ⇒ `proficiency_test.organization_id` RESTRICT (`proficiency_test`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `proficiency_test.unit_id` RESTRICT (`proficiency_test`)
- `organization` ⇒ `proficiency_test_audit_log.organization_id` RESTRICT (`proficiency_test_audit_log`)
- `organization` ⇒ `pt_plan_item.organization_id` RESTRICT (`pt_plan_item`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `pt_plan_item.unit_id` RESTRICT (`pt_plan_item`)
- `organization` ⇒ `receivable_installment.organization_id` RESTRICT (`receivable_installment`)
- `organization` ⇒ `reference_standard.organization_id` RESTRICT (`reference_standard`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `reference_standard.unit_id` RESTRICT (`reference_standard`)
- `organization` ⇒ `reference_standard_audit_log.organization_id` RESTRICT (`reference_standard_audit_log`)
- `organization` ⇒ `reference_standard_certificate_document.organization_id` RESTRICT (`reference_standard_certificate_document`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `reference_standard_certificate_document.unit_id` RESTRICT (`reference_standard_certificate_document`)
- `organization` ⇒ `service_audit_log.organization_id` RESTRICT (`service_audit_log`)
- `organization` → `asset` (`lab_organization_id`) ⇒ `service_order.asset_id` RESTRICT (`service_order`)
- `organization` → `customer` (`auth_organization_id`) ⇒ `service_order.customer_id` RESTRICT (`service_order`)
- `organization` ⇒ `service_order.organization_id` RESTRICT (`service_order`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `service_order.unit_id` RESTRICT (`service_order`)
- `organization` → `asset` (`lab_organization_id`) ⇒ `service_order_asset_snapshot.asset_id` RESTRICT (`service_order_asset_snapshot`)
- `organization` ⇒ `service_order_asset_snapshot.organization_id` RESTRICT (`service_order_asset_snapshot`)
- `organization` ⇒ `service_order_attachment.organization_id` RESTRICT (`service_order_attachment`)
- `organization` ⇒ `service_order_certificate_link.organization_id` RESTRICT (`service_order_certificate_link`)
- `organization` ⇒ `service_order_delivery_document.organization_id` RESTRICT (`service_order_delivery_document`)
- `organization` ⇒ `service_order_evaluation.organization_id` RESTRICT (`service_order_evaluation`)
- `organization` ⇒ `service_order_execution.organization_id` RESTRICT (`service_order_execution`)
- `organization` ⇒ `service_order_execution_item.organization_id` RESTRICT (`service_order_execution_item`)
- `organization` ⇒ `service_order_intake_document.organization_id` RESTRICT (`service_order_intake_document`)
- `organization` ⇒ `service_order_numbering_sequence.organization_id` RESTRICT (`service_order_numbering_sequence`)
- `organization` → `organization_unit` (`organization_id`) ⇒ `service_order_numbering_sequence.unit_id` RESTRICT (`service_order_numbering_sequence`)
- `organization` ⇒ `service_order_outsourced_cost.organization_id` RESTRICT (`service_order_outsourced_cost`)
- `organization` ⇒ `service_order_quote.organization_id` RESTRICT (`service_order_quote`)
- `organization` ⇒ `service_order_quote_item.organization_id` RESTRICT (`service_order_quote_item`)
- `organization` ⇒ `standard_recall.organization_id` RESTRICT (`standard_recall`)
- `organization` ⇒ `training_record.organization_id` RESTRICT (`training_record`)
- `organization` ⇒ `training_record_audit_log.organization_id` RESTRICT (`training_record_audit_log`)
- `organization` ⇒ `visit_audit_log.organization_id` RESTRICT (`visit_audit_log`)
- `organization` → `customer` (`auth_organization_id`) ⇒ `visit_reschedule_request.customer_id` RESTRICT (`visit_reschedule_request`)
- `organization` ⇒ `visit_reschedule_request.organization_id` RESTRICT (`visit_reschedule_request`)

### Deleting a `customer` row

Rows Postgres deletes along with it (3 tables by CASCADE): `asset`, `automatic_send_rule`, `certificate_release_policy`.

- Evidence deleted by CASCADE: **0**.
- Evidence columns nulled by SET NULL: **3**.
- Evidence tables that make Postgres refuse the delete (RESTRICT / NO ACTION): **15**.

Nulled:

- `customer` → `automatic_send_rule` (`customer_id`) ⇒ `automatic_send_audit_log.applied_rule_id` (`automatic_send_audit_log`)
- `customer` → `certificate_release_policy` (`customer_id`) ⇒ `certificate_release.applied_policy_id` (`certificate_release`)
- `customer` → `certificate_release_policy` (`customer_id`) ⇒ `certificate_release_audit_log.applied_policy_id` (`certificate_release_audit_log`)

Refused by:

- `customer` → `asset` (`customer_id`) ⇒ `asset_oot_event.asset_id` RESTRICT (`asset_oot_event`)
- `customer` ⇒ `asset_oot_event.customer_id` RESTRICT (`asset_oot_event`)
- `customer` ⇒ `billing_document.customer_id` RESTRICT (`billing_document`)
- `customer` ⇒ `billing_group.customer_id` RESTRICT (`billing_group`)
- `customer` → `asset` (`customer_id`) ⇒ `calibration_job.asset_id` RESTRICT (`calibration_job`)
- `customer` ⇒ `calibration_job.customer_id` RESTRICT (`calibration_job`)
- `customer` ⇒ `calibration_request.customer_id` RESTRICT (`calibration_request`)
- `customer` → `asset` (`customer_id`) ⇒ `calibration_request_item.asset_id` RESTRICT (`calibration_request_item`)
- `customer` ⇒ `calibration_visit.customer_id` RESTRICT (`calibration_visit`)
- `customer` ⇒ `commercial_agreement.customer_id` RESTRICT (`commercial_agreement`)
- `customer` ⇒ `job_commercial_snapshot.customer_id` RESTRICT (`job_commercial_snapshot`)
- `customer` → `asset` (`customer_id`) ⇒ `service_order.asset_id` RESTRICT (`service_order`)
- `customer` ⇒ `service_order.customer_id` RESTRICT (`service_order`)
- `customer` → `asset` (`customer_id`) ⇒ `service_order_asset_snapshot.asset_id` RESTRICT (`service_order_asset_snapshot`)
- `customer` ⇒ `visit_reschedule_request.customer_id` RESTRICT (`visit_reschedule_request`)

### Deleting a `asset` row

Rows Postgres deletes along with it (0 tables by CASCADE): none.

- Evidence deleted by CASCADE: **0**.
- Evidence columns nulled by SET NULL: **0**.
- Evidence tables that make Postgres refuse the delete (RESTRICT / NO ACTION): **5**.

Refused by:

- `asset` ⇒ `asset_oot_event.asset_id` RESTRICT (`asset_oot_event`)
- `asset` ⇒ `calibration_job.asset_id` RESTRICT (`calibration_job`)
- `asset` ⇒ `calibration_request_item.asset_id` RESTRICT (`calibration_request_item`)
- `asset` ⇒ `service_order.asset_id` RESTRICT (`service_order`)
- `asset` ⇒ `service_order_asset_snapshot.asset_id` RESTRICT (`service_order_asset_snapshot`)

### Deleting a `user` row

Rows Postgres deletes along with it (12 tables by CASCADE): `account`, `invitation`, `lab_account_setup_token`, `member`, `member_unit_assignment`, `member_visual_signature`, `notification`, `notification_preference`, `passkey`, `portal_export_job`, `session`, `sso_provider`.

- Evidence deleted by CASCADE: **0**.
- Evidence columns nulled by SET NULL: **41**.
- Evidence tables that make Postgres refuse the delete (RESTRICT / NO ACTION): **55**.

Nulled:

- `user` ⇒ `authorized_signatory.user_id` (`authorized_signatory`)
- `user` ⇒ `automatic_send_audit_log.actor_user_id` (`automatic_send_audit_log`)
- `user` ⇒ `billing_document.issued_by` (`billing_document`)
- `user` ⇒ `billing_document.voided_by` (`billing_document`)
- `user` ⇒ `billing_group.created_by_user_id` (`billing_group`)
- `user` ⇒ `calibration_job.approved_by` (`calibration_job`)
- `user` ⇒ `calibration_job.rejected_by` (`calibration_job`)
- `user` ⇒ `calibration_job.technician_id` (`calibration_job`)
- `user` ⇒ `calibration_request.approved_by` (`calibration_request`)
- `user` ⇒ `calibration_request.converted_by` (`calibration_request`)
- `user` ⇒ `calibration_request.rejected_by` (`calibration_request`)
- `user` ⇒ `calibration_request.reviewed_by` (`calibration_request`)
- `user` ⇒ `calibration_visit.cancelled_by` (`calibration_visit`)
- `user` ⇒ `calibration_visit.confirmed_by` (`calibration_visit`)
- `user` ⇒ `calibration_visit.customer_confirmed_by` (`calibration_visit`)
- `user` ⇒ `calibration_visit.technician_id` (`calibration_visit`)
- `user` ⇒ `certificate_numbering_audit_log.performed_by` (`certificate_numbering_audit_log`)
- `user` ⇒ `certificate_release.released_by_user_id` (`certificate_release`)
- `user` ⇒ `certificate_release_audit_log.actor_user_id` (`certificate_release_audit_log`)
- `user` ⇒ `issued_certificate_snapshot.issued_by` (`issued_certificate_snapshot`)
- `user` ⇒ `issued_certificate_snapshot.voided_by` (`issued_certificate_snapshot`)
- `user` ⇒ `organization_api_key_audit_log.performed_by` (`organization_api_key_audit_log`)
- `user` → `member` (`user_id`) ⇒ `organization_event_log.actor_member_id` (`organization_event_log`)
- `user` ⇒ `organization_event_log.actor_user_id` (`organization_event_log`)
- `user` ⇒ `personnel_competence.user_id` (`personnel_competence`)
- `user` ⇒ `platform_event_log.actor_user_id` (`platform_event_log`)
- `user` ⇒ `platform_event_log.target_user_id` (`platform_event_log`)
- `user` ⇒ `reference_standard_certificate_document.uploaded_by` (`reference_standard_certificate_document`)
- `user` ⇒ `service_order.inmetro_repair_mark_applied_by_user_id` (`service_order`)
- `user` ⇒ `service_order.responsible_technician_id` (`service_order`)
- `user` ⇒ `service_order_attachment.uploaded_by_user_id` (`service_order_attachment`)
- `user` ⇒ `service_order_delivery_document.issued_by_user_id` (`service_order_delivery_document`)
- `user` ⇒ `service_order_execution.finished_by_user_id` (`service_order_execution`)
- `user` ⇒ `service_order_execution_item.technician_id` (`service_order_execution_item`)
- `user` ⇒ `service_order_intake_document.issued_by_user_id` (`service_order_intake_document`)
- `user` ⇒ `service_order_outsourced_cost.created_by_user_id` (`service_order_outsourced_cost`)
- `user` ⇒ `service_order_quote.approved_by_portal_user_id` (`service_order_quote`)
- `user` ⇒ `service_order_quote.approved_manually_by_user_id` (`service_order_quote`)
- `user` ⇒ `service_order_quote.sent_by_user_id` (`service_order_quote`)
- `user` ⇒ `training_record.user_id` (`training_record`)
- `user` ⇒ `visit_reschedule_request.resolved_by` (`visit_reschedule_request`)

Refused by:

- `user` ⇒ `accredited_scope_line_audit_log.performed_by` NO ACTION (`accredited_scope_line_audit_log`)
- `user` ⇒ `asset_audit_log.performed_by` NO ACTION (`asset_audit_log`)
- `user` ⇒ `asset_oot_audit_log.performed_by` NO ACTION (`asset_oot_audit_log`)
- `user` ⇒ `asset_oot_impact_assessment.portal_user_id` RESTRICT (`asset_oot_impact_assessment`)
- `user` ⇒ `authorized_signatory.authorized_by` NO ACTION (`authorized_signatory`)
- `user` ⇒ `authorized_signatory.revoked_by` NO ACTION (`authorized_signatory`)
- `user` ⇒ `billing_document.created_by` NO ACTION (`billing_document`)
- `user` ⇒ `billing_document.updated_by` NO ACTION (`billing_document`)
- `user` ⇒ `calibration_job.created_by` RESTRICT (`calibration_job`)
- `user` ⇒ `calibration_request.submitted_by` RESTRICT (`calibration_request`)
- `user` ⇒ `calibration_request_audit_log.performed_by` NO ACTION (`calibration_request_audit_log`)
- `user` ⇒ `calibration_visit.created_by` RESTRICT (`calibration_visit`)
- `user` ⇒ `check_standard_reading.created_by` RESTRICT (`check_standard_reading`)
- `user` ⇒ `commercial_agreement.created_by` NO ACTION (`commercial_agreement`)
- `user` ⇒ `commercial_agreement.updated_by` NO ACTION (`commercial_agreement`)
- `user` ⇒ `control_chart.created_by` RESTRICT (`control_chart`)
- `user` ⇒ `control_chart_audit_log.performed_by` NO ACTION (`control_chart_audit_log`)
- `user` ⇒ `corrective_action.closed_by` NO ACTION (`corrective_action`)
- `user` ⇒ `corrective_action.created_by` RESTRICT (`corrective_action`)
- `user` ⇒ `corrective_action.responsible_id` NO ACTION (`corrective_action`)
- `user` ⇒ `corrective_action.verified_by` NO ACTION (`corrective_action`)
- `user` ⇒ `corrective_action_audit_log.performed_by` NO ACTION (`corrective_action_audit_log`)
- `user` ⇒ `customer_audit_log.performed_by` NO ACTION (`customer_audit_log`)
- `user` ⇒ `financial_audit_log.performed_by` NO ACTION (`financial_audit_log`)
- `user` ⇒ `job_audit_log.performed_by` NO ACTION (`job_audit_log`)
- `user` ⇒ `method_audit_log.performed_by` NO ACTION (`method_audit_log`)
- `user` ⇒ `non_conformance.created_by` RESTRICT (`non_conformance`)
- `user` ⇒ `non_conformance.detected_by` NO ACTION (`non_conformance`)
- `user` ⇒ `non_conformance.disposition_approved_by` NO ACTION (`non_conformance`)
- `user` ⇒ `non_conformance.resolved_by` NO ACTION (`non_conformance`)
- `user` ⇒ `non_conformance_audit_log.performed_by` NO ACTION (`non_conformance_audit_log`)
- `user` ⇒ `oot_impact_assessment.created_by` RESTRICT (`oot_impact_assessment`)
- `user` ⇒ `oot_impact_assessment.signed_by` RESTRICT (`oot_impact_assessment`)
- `user` ⇒ `oot_notification.approved_by` RESTRICT (`oot_notification`)
- `user` ⇒ `payment_receipt.recorded_by` NO ACTION (`payment_receipt`)
- `user` ⇒ `personnel_competence.approved_by` NO ACTION (`personnel_competence`)
- `user` ⇒ `personnel_competence.created_by` NO ACTION (`personnel_competence`)
- `user` ⇒ `personnel_competence.evaluated_by` NO ACTION (`personnel_competence`)
- `user` ⇒ `personnel_competence.requested_by` NO ACTION (`personnel_competence`)
- `user` ⇒ `proficiency_test.created_by` RESTRICT (`proficiency_test`)
- `user` ⇒ `proficiency_test_audit_log.performed_by` NO ACTION (`proficiency_test_audit_log`)
- `user` ⇒ `pt_plan_item.created_by` RESTRICT (`pt_plan_item`)
- `user` ⇒ `reference_standard.created_by` RESTRICT (`reference_standard`)
- `user` ⇒ `reference_standard_audit_log.performed_by` NO ACTION (`reference_standard_audit_log`)
- `user` ⇒ `service_audit_log.performed_by` NO ACTION (`service_audit_log`)
- `user` ⇒ `service_order.opened_by_user_id` RESTRICT (`service_order`)
- `user` ⇒ `service_order_certificate_link.linked_by_user_id` RESTRICT (`service_order_certificate_link`)
- `user` ⇒ `service_order_evaluation.technician_id` RESTRICT (`service_order_evaluation`)
- `user` ⇒ `service_order_execution.started_by_user_id` RESTRICT (`service_order_execution`)
- `user` ⇒ `service_order_quote.created_by_user_id` RESTRICT (`service_order_quote`)
- `user` ⇒ `standard_recall.approved_by` RESTRICT (`standard_recall`)
- `user` ⇒ `standard_recall.created_by` RESTRICT (`standard_recall`)
- `user` ⇒ `training_record.created_by` NO ACTION (`training_record`)
- `user` ⇒ `visit_audit_log.performed_by` NO ACTION (`visit_audit_log`)
- `user` ⇒ `visit_reschedule_request.requested_by` RESTRICT (`visit_reschedule_request`)

## Organization footprint

Tables with no organization footprint (16): `account`, `app_queue_job`, `asset_type`, `cron_run`, `email_suppression`, `email_webhook_event`, `legal_metrology_regulation`, `notification_preference`, `organization`, `passkey`, `platform_event_log`, `public_code_redeem_throttle`, `queue_job_receipt`, `session`, `user`, `verification`.

Evidence outside the footprint: `platform_event_log`.

<!-- END GENERATED: records-retention -->
