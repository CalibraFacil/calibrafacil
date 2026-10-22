# Tenancy of the data model

Decision Q15 (`docs/auditoria-perguntas.md`): Postgres row-level security is the
next layer of tenant isolation, and it needs an organization on every tenant
row. This document is the classification behind it (REQ-ORG-1). The tables
below the marker are **generated from `packages/db/src/schema.ts`** and
`packages/db/src/tenancy.ts`; a test (`packages/db/src/tenancy.test.ts`) fails
when they drift, and when a table is neither tenant nor classified global. To
refresh them after a schema change:

```bash
pnpm --dir packages/db tenancy:doc
```

## Rules

1. **Every table is tenant or global.** A tenant table carries
   `organization_id` (or `lab_organization_id` for the tables that predate the
   convention: `asset`, `customer`, `customer_group`, `asset_oot_event`,
   `portal_export_job`), `NOT NULL` (except the 16 audit logs, rule 4). A global
   table has no organization column and
   an entry with its reason in `GLOBAL_TABLES` (`tenancy.ts`): identity, platform
   plumbing, global catalogs. A new table without either fails the test.
2. **Evidence is not cascaded.** The organization column of every table that
   gained it in migration 0118 is a foreign key to `organization` with
   `ON DELETE RESTRICT`, like the rest of the evidence
   (`docs/architecture/records-retention.md`). Older configuration tables keep
   their `CASCADE`; they hold no evidence.
3. **A child cannot point at another tenant's parent.** For the children of
   migration 0118 the parent exposes `UNIQUE (id, organization)` and the child
   carries a composite foreign key `(parent_id, organization_id) → parent
(id, organization)` next to the single-column key (named `*_tenant_fk`; the
   column order is the one the `integration_*` composite keys already use). The
   composite key repeats the delete action of its single-column twin, so it adds
   an integrity check without adding a delete edge: `records-retention.ts` leaves
   the `*_tenant_fk` keys out of the delete graph.
4. **Audit logs name their laboratory themselves.** The `*_audit_log` tables
   point at the entity they document through a soft reference (no foreign key, so
   the "delete" row survives the entity). They now also carry `organization_id`,
   written by the code that appends the row, so the retention purge, the tenant
   SQL guard and row-level security see them without a join. Unlike the other
   children the column is **nullable**, guarded by
   `CHECK (organization_id IS NOT NULL) NOT VALID` (migration 0118 and
   `schema-extras.sql`): every new row must carry it, while legacy rows of an
   entity that was hard-deleted before the column existed are tolerated.
   **Those legacy rows keep `organization_id` NULL and are invisible to
   tenant-scoped reads and to row-level security**; they are only reachable by
   the platform. Once they are attributed or archived,
   `ALTER TABLE <log> VALIDATE CONSTRAINT <log>_organization_id_required` turns
   the guarantee into a full one. The foreign key to `organization` stays
   `RESTRICT`.
5. **Every insert sets the organization.** For the 21 children whose column is
   `NOT NULL` without a default, TypeScript forces it. It does **not** for the 16
   nullable audit logs: there the `CHECK` in Postgres refuses a new row without an
   organization, and the integration tier's tenant SQL guard
   (`apps/api/test/integration/tenant-sql-*.ts`) flags an insert whose column list
   omits it. The guard derives its tenant tables from these columns, so every
   statement on these tables must also carry an organization predicate (or a
   reasoned allowlist entry).

## Migration 0118

`packages/db/drizzle/0118_organization_id_everywhere.sql`, one transaction:

1. add `organization_id text` to each child, backfill it with a set-based
   `UPDATE ... FROM parent`, parents first (the `*_audit_log` tables are
   append-only, so the backfill lifts that trigger with the transaction-local
   `calibra.allow_audit_rewrite` and puts it back);
2. **audit logs whose entity is gone** (expected: they outlive it) are
   attributed only from what the row itself carries: the snapshot of the deleted
   row in `changes` (`asset`, `customer`, `method` deletes) and the attributed
   siblings of the same entity when they agree. Nothing heuristic (no actor
   membership). The rest stay NULL and the migration only `RAISE NOTICE`s the
   count per table;
3. **pre-check for every other child** (finance, service-order children,
   `job_standard`, ...): a row left without an organization is real corruption
   and makes the migration `RAISE` with the table and the count, before any
   constraint is added; so does any existing row that points across tenants;
4. `SET NOT NULL` (audit logs: the `CHECK ... NOT VALID` instead), foreign key to
   `organization` `RESTRICT`, an index led by `organization_id`
   (`(organization_id, performed_at)` on the audit logs);
5. `UNIQUE (id, organization)` on the parents (an index pre-built `CONCURRENTLY`
   under the constraint's name is adopted), then the composite foreign keys, added
   `NOT VALID` (new rows are enforced at once; the existing rows were checked in
   step 3; `VALIDATE CONSTRAINT` runs afterwards without blocking writes, see
   `DEPLOYMENT.md`).

Every step is idempotent (the project applies migration DDL by hand and the
drizzle bookkeeping table lags behind). Nothing in it needs `schema-extras.sql`:
columns, foreign keys, unique constraints and indexes are all expressed in
`schema.ts`, which is what builds new databases.

<!-- BEGIN GENERATED: tenancy -->

<!-- Generated by `pnpm --dir packages/db tenancy:doc`; do not edit by hand. -->

## Summary

134 tables: 118 tenant (an organization column), 16 global (no organization column, with the reason below). Of the tenant tables, 102 have the column NOT NULL and 16 (the audit logs) have it nullable, guarded by a `CHECK (organization_id IS NOT NULL) NOT VALID` that refuses every new row without one. 37 tenant tables gained `organization_id` in migration 0118.

## Global tables

| Table                         | Why it has no organization column                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `account`                     | Identity (Better Auth): credentials of a user, shared by all their memberships.                                      |
| `app_queue_job`               | Platform job queue: an opaque payload and a lease, not tenant data. The jobs it carries re-check their organization. |
| `asset_type`                  | Global catalog of instrument types shared by every laboratory (slug unique platform-wide).                           |
| `cron_run`                    | Platform scheduler ledger (one row per cron run).                                                                    |
| `email_suppression`           | Deliverability list keyed by recipient address: a bounced or complained address is suppressed for every sender.      |
| `email_webhook_event`         | Idempotency ledger of provider webhooks (svix id), before any organization is known.                                 |
| `legal_metrology_regulation`  | Global regulatory catalog (Inmetro regimes by category), read-only for laboratories.                                 |
| `notification_preference`     | Per-user preference (`user_id`, unique): follows the person across organizations.                                    |
| `organization`                | The tenant root itself: its id is the organization (a CLIENT organization belongs to a portal customer).             |
| `passkey`                     | Identity (Better Auth): credentials of a user, shared by all their memberships.                                      |
| `platform_event_log`          | Platform-level evidence (sign-ups, impersonation, sign-in events): never purged with an organization.                |
| `public_code_redeem_throttle` | Abuse throttle keyed by client address and time window, before any organization is known.                            |
| `queue_job_receipt`           | Platform delivery ledger of queue messages (at-least-once dedupe).                                                   |
| `session`                     | Identity (Better Auth). Only a pointer (`active_organization_id`) to the organization chosen at sign-in.             |
| `user`                        | Identity (Better Auth). A person can belong to several organizations; the membership is `member`.                    |
| `verification`                | Identity (Better Auth): one-time tokens (magic links, e-mail verification) keyed by identifier.                      |

## Tenant tables that gained `organization_id` in migration 0118

The value was backfilled from the parent along the path shown (parents first).

| Table                               | Parent path to the organization                                                               | Pointer                             | organization_id            | Organization FK | Composite keys                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------- | --------------- | ---------------------------------------- |
| `receivable_installment`            | `receivable_installment` → `billing_document` → `organization`                                | `document_id`                       | NOT NULL                   | RESTRICT        | `document_id`                            |
| `payment_receipt`                   | `payment_receipt` → `receivable_installment` → `billing_document` → `organization`            | `installment_id`                    | NOT NULL                   | RESTRICT        | `installment_id`                         |
| `billing_document_item`             | `billing_document_item` → `billing_document` → `organization`                                 | `document_id`                       | NOT NULL                   | RESTRICT        | `document_id`                            |
| `billing_group_service_order`       | `billing_group_service_order` → `billing_group` → `organization`                              | `group_id`                          | NOT NULL                   | RESTRICT        | `group_id`, `service_order_id`           |
| `commercial_agreement_service_term` | `commercial_agreement_service_term` → `commercial_agreement` → `organization`                 | `agreement_id`                      | NOT NULL                   | RESTRICT        | `agreement_id`, `service_id`, `unit_id`  |
| `commercial_agreement_unit_scope`   | `commercial_agreement_unit_scope` → `commercial_agreement` → `organization`                   | `agreement_id`                      | NOT NULL                   | RESTRICT        | `agreement_id`, `unit_id`                |
| `job_standard`                      | `job_standard` → `calibration_job` → `organization`                                           | `job_id`                            | NOT NULL                   | RESTRICT        | `job_id`, `standard_id`                  |
| `asset_oot_impact_assessment`       | `asset_oot_impact_assessment` → `asset_oot_event` → `organization`                            | `event_id`                          | NOT NULL                   | RESTRICT        | `event_id`                               |
| `calibration_request_item`          | `calibration_request_item` → `calibration_request` → `organization`                           | `request_id`                        | NOT NULL                   | RESTRICT        | `request_id`, `asset_id`                 |
| `service_order_asset_snapshot`      | `service_order_asset_snapshot` → `service_order` → `organization`                             | `service_order_id`                  | NOT NULL                   | RESTRICT        | `service_order_id`, `asset_id`           |
| `service_order_attachment`          | `service_order_attachment` → `service_order` → `organization`                                 | `service_order_id`                  | NOT NULL                   | RESTRICT        | `service_order_id`                       |
| `service_order_certificate_link`    | `service_order_certificate_link` → `service_order` → `organization`                           | `service_order_id`                  | NOT NULL                   | RESTRICT        | `service_order_id`, `certificate_job_id` |
| `service_order_delivery_document`   | `service_order_delivery_document` → `service_order` → `organization`                          | `service_order_id`                  | NOT NULL                   | RESTRICT        | `service_order_id`                       |
| `service_order_email_log`           | `service_order_email_log` → `service_order` → `organization`                                  | `service_order_id`                  | NOT NULL                   | RESTRICT        | `service_order_id`                       |
| `service_order_evaluation`          | `service_order_evaluation` → `service_order` → `organization`                                 | `service_order_id`                  | NOT NULL                   | RESTRICT        | `service_order_id`                       |
| `service_order_execution`           | `service_order_execution` → `service_order` → `organization`                                  | `service_order_id`                  | NOT NULL                   | RESTRICT        | `service_order_id`                       |
| `service_order_execution_item`      | `service_order_execution_item` → `service_order_execution` → `service_order` → `organization` | `execution_id`                      | NOT NULL                   | RESTRICT        | `execution_id`                           |
| `service_order_intake_document`     | `service_order_intake_document` → `service_order` → `organization`                            | `service_order_id`                  | NOT NULL                   | RESTRICT        | `service_order_id`                       |
| `service_order_quote`               | `service_order_quote` → `service_order` → `organization`                                      | `service_order_id`                  | NOT NULL                   | RESTRICT        | `service_order_id`                       |
| `service_order_quote_item`          | `service_order_quote_item` → `service_order_quote` → `service_order` → `organization`         | `quote_id`                          | NOT NULL                   | RESTRICT        | `quote_id`                               |
| `service_order_tag`                 | `service_order_tag` → `service_order` → `organization`                                        | `service_order_id`                  | NOT NULL                   | RESTRICT        | `service_order_id`                       |
| `asset_audit_log`                   | `asset_audit_log` → `asset` → `organization`                                                  | `asset_id` (soft: no FK)            | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `asset_oot_audit_log`               | `asset_oot_audit_log` → `asset_oot_event` → `organization`                                    | `event_id` (soft: no FK)            | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `authorized_signatory_audit_log`    | `authorized_signatory_audit_log` → `authorized_signatory` → `organization`                    | `signatory_id` (soft: no FK)        | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `calibration_request_audit_log`     | `calibration_request_audit_log` → `calibration_request` → `organization`                      | `request_id` (soft: no FK)          | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `control_chart_audit_log`           | `control_chart_audit_log` → `control_chart` → `organization`                                  | `control_chart_id` (soft: no FK)    | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `corrective_action_audit_log`       | `corrective_action_audit_log` → `corrective_action` → `organization`                          | `capa_id` (soft: no FK)             | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `customer_audit_log`                | `customer_audit_log` → `customer` → `organization`                                            | `customer_id` (soft: no FK)         | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `job_audit_log`                     | `job_audit_log` → `calibration_job` → `organization`                                          | `job_id` (soft: no FK)              | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `method_audit_log`                  | `method_audit_log` → `calibration_method` → `organization`                                    | `method_id` (soft: no FK)           | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `non_conformance_audit_log`         | `non_conformance_audit_log` → `non_conformance` → `organization`                              | `nc_id` (soft: no FK)               | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `personnel_competence_audit_log`    | `personnel_competence_audit_log` → `personnel_competence` → `organization`                    | `competence_id` (soft: no FK)       | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `proficiency_test_audit_log`        | `proficiency_test_audit_log` → `proficiency_test` → `organization`                            | `proficiency_test_id` (soft: no FK) | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `reference_standard_audit_log`      | `reference_standard_audit_log` → `reference_standard` → `organization`                        | `standard_id` (soft: no FK)         | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `service_audit_log`                 | `service_audit_log` → `service` → `organization`                                              | `service_id` (soft: no FK)          | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `training_record_audit_log`         | `training_record_audit_log` → `training_record` → `organization`                              | `training_record_id` (soft: no FK)  | nullable + CHECK NOT VALID | RESTRICT        | -                                        |
| `visit_audit_log`                   | `visit_audit_log` → `calibration_visit` → `organization`                                      | `visit_id` (soft: no FK)            | nullable + CHECK NOT VALID | RESTRICT        | -                                        |

## Tenant tables with their own organization column

| Table                                     | Organization column   | FK to organization |
| ----------------------------------------- | --------------------- | ------------------ |
| `accredited_scope_line`                   | `organization_id`     | CASCADE            |
| `accredited_scope_line_audit_log`         | `organization_id`     | none               |
| `asset`                                   | `lab_organization_id` | CASCADE            |
| `asset_oot_event`                         | `lab_organization_id` | RESTRICT           |
| `authorized_signatory`                    | `organization_id`     | RESTRICT           |
| `automatic_send_audit_log`                | `organization_id`     | none               |
| `automatic_send_rule`                     | `organization_id`     | CASCADE            |
| `billing_document`                        | `organization_id`     | RESTRICT           |
| `billing_group`                           | `organization_id`     | RESTRICT           |
| `calibration_job`                         | `organization_id`     | RESTRICT           |
| `calibration_method`                      | `organization_id`     | CASCADE            |
| `calibration_request`                     | `organization_id`     | RESTRICT           |
| `calibration_visit`                       | `organization_id`     | RESTRICT           |
| `certificate_numbering_audit_log`         | `organization_id`     | none               |
| `certificate_numbering_profile`           | `organization_id`     | CASCADE            |
| `certificate_numbering_sequence`          | `organization_id`     | RESTRICT           |
| `certificate_release`                     | `organization_id`     | RESTRICT           |
| `certificate_release_audit_log`           | `organization_id`     | none               |
| `certificate_release_policy`              | `organization_id`     | CASCADE            |
| `check_standard_reading`                  | `organization_id`     | RESTRICT           |
| `commercial_agreement`                    | `organization_id`     | RESTRICT           |
| `control_chart`                           | `organization_id`     | RESTRICT           |
| `corrective_action`                       | `organization_id`     | RESTRICT           |
| `customer`                                | `lab_organization_id` | CASCADE            |
| `customer_group`                          | `lab_organization_id` | CASCADE            |
| `environmental_limits`                    | `organization_id`     | CASCADE            |
| `financial_audit_log`                     | `organization_id`     | none               |
| `integration_connection`                  | `organization_id`     | CASCADE            |
| `integration_event_log`                   | `organization_id`     | none               |
| `integration_oauth_app`                   | `organization_id`     | CASCADE            |
| `integration_object_link`                 | `organization_id`     | CASCADE            |
| `integration_sync_cursor`                 | `organization_id`     | CASCADE            |
| `integration_sync_item`                   | `organization_id`     | CASCADE            |
| `integration_sync_run`                    | `organization_id`     | CASCADE            |
| `invitation`                              | `organization_id`     | CASCADE            |
| `issued_certificate_snapshot`             | `organization_id`     | RESTRICT           |
| `job_commercial_snapshot`                 | `organization_id`     | RESTRICT           |
| `lab_account_setup_token`                 | `organization_id`     | CASCADE            |
| `mass_composition_profile`                | `organization_id`     | CASCADE            |
| `material`                                | `organization_id`     | CASCADE            |
| `member`                                  | `organization_id`     | CASCADE            |
| `member_unit_assignment`                  | `organization_id`     | CASCADE            |
| `member_visual_signature`                 | `organization_id`     | CASCADE            |
| `non_conformance`                         | `organization_id`     | RESTRICT           |
| `notification`                            | `organization_id`     | CASCADE            |
| `oot_email_outbox`                        | `organization_id`     | CASCADE            |
| `oot_impact_assessment`                   | `organization_id`     | RESTRICT           |
| `oot_notification`                        | `organization_id`     | RESTRICT           |
| `organization_api_key`                    | `organization_id`     | CASCADE            |
| `organization_api_key_audit_log`          | `organization_id`     | none               |
| `organization_custom_domain`              | `organization_id`     | CASCADE            |
| `organization_email_domain`               | `organization_id`     | CASCADE            |
| `organization_event_log`                  | `organization_id`     | none               |
| `organization_integration`                | `organization_id`     | CASCADE            |
| `organization_signing_certificate`        | `organization_id`     | CASCADE            |
| `organization_unit`                       | `organization_id`     | CASCADE            |
| `personnel_competence`                    | `organization_id`     | RESTRICT           |
| `portal_export_job`                       | `lab_organization_id` | CASCADE            |
| `proficiency_test`                        | `organization_id`     | RESTRICT           |
| `pt_plan_item`                            | `organization_id`     | RESTRICT           |
| `public_api_idempotency_key`              | `organization_id`     | CASCADE            |
| `public_api_resource_ref`                 | `organization_id`     | CASCADE            |
| `public_api_webhook_delivery`             | `organization_id`     | CASCADE            |
| `public_api_webhook_subscription`         | `organization_id`     | CASCADE            |
| `reference_standard`                      | `organization_id`     | RESTRICT           |
| `reference_standard_certificate_document` | `organization_id`     | RESTRICT           |
| `scheduled_notification`                  | `organization_id`     | CASCADE            |
| `service`                                 | `organization_id`     | CASCADE            |
| `service_order`                           | `organization_id`     | RESTRICT           |
| `service_order_email_outbox`              | `organization_id`     | CASCADE            |
| `service_order_event_log`                 | `organization_id`     | none               |
| `service_order_numbering_sequence`        | `organization_id`     | RESTRICT           |
| `service_order_outsourced_cost`           | `organization_id`     | RESTRICT           |
| `service_order_public_access_token`       | `organization_id`     | CASCADE            |
| `service_order_settings`                  | `organization_id`     | CASCADE            |
| `sso_provider`                            | `organization_id`     | CASCADE            |
| `standard_recall`                         | `organization_id`     | RESTRICT           |
| `supplier`                                | `organization_id`     | CASCADE            |
| `sync_applied_event`                      | `organization_id`     | CASCADE            |
| `training_record`                         | `organization_id`     | RESTRICT           |
| `visit_reschedule_request`                | `organization_id`     | RESTRICT           |

## Composite keys

Parents that expose 14 `UNIQUE (id, organization)` targets:

- `asset`: `asset_id_org_uidx` on (`id`, `lab_organization_id`)
- `asset_oot_event`: `asset_oot_event_id_org_uidx` on (`id`, `lab_organization_id`)
- `billing_document`: `billing_document_id_org_uidx` on (`id`, `organization_id`)
- `billing_group`: `billing_group_id_org_uidx` on (`id`, `organization_id`)
- `calibration_job`: `calibration_job_id_org_uidx` on (`id`, `organization_id`)
- `calibration_request`: `calibration_request_id_org_uidx` on (`id`, `organization_id`)
- `commercial_agreement`: `commercial_agreement_id_org_uidx` on (`id`, `organization_id`)
- `organization_unit`: `organization_unit_id_org_uidx` on (`id`, `organization_id`)
- `receivable_installment`: `receivable_installment_id_org_uidx` on (`id`, `organization_id`)
- `reference_standard`: `reference_standard_id_org_uidx` on (`id`, `organization_id`)
- `service`: `service_id_org_uidx` on (`id`, `organization_id`)
- `service_order`: `service_order_id_org_uidx` on (`id`, `organization_id`)
- `service_order_execution`: `service_order_execution_id_org_uidx` on (`id`, `organization_id`)
- `service_order_quote`: `service_order_quote_id_org_uidx` on (`id`, `organization_id`)

29 composite foreign keys `(pointer, organization_id) → parent (id, organization)`; each repeats the delete action of the single-column key beside it:

- `asset_oot_impact_assessment`.`event_id` → `asset_oot_event` (`id`, `lab_organization_id`): CASCADE
- `billing_document_item`.`document_id` → `billing_document` (`id`, `organization_id`): CASCADE
- `billing_group_service_order`.`group_id` → `billing_group` (`id`, `organization_id`): CASCADE
- `billing_group_service_order`.`service_order_id` → `service_order` (`id`, `organization_id`): RESTRICT
- `calibration_request_item`.`request_id` → `calibration_request` (`id`, `organization_id`): CASCADE
- `calibration_request_item`.`asset_id` → `asset` (`id`, `lab_organization_id`): RESTRICT
- `commercial_agreement_service_term`.`agreement_id` → `commercial_agreement` (`id`, `organization_id`): CASCADE
- `commercial_agreement_service_term`.`service_id` → `service` (`id`, `organization_id`): CASCADE
- `commercial_agreement_service_term`.`unit_id` → `organization_unit` (`id`, `organization_id`): CASCADE
- `commercial_agreement_unit_scope`.`agreement_id` → `commercial_agreement` (`id`, `organization_id`): CASCADE
- `commercial_agreement_unit_scope`.`unit_id` → `organization_unit` (`id`, `organization_id`): CASCADE
- `job_standard`.`job_id` → `calibration_job` (`id`, `organization_id`): CASCADE
- `job_standard`.`standard_id` → `reference_standard` (`id`, `organization_id`): RESTRICT
- `payment_receipt`.`installment_id` → `receivable_installment` (`id`, `organization_id`): CASCADE
- `receivable_installment`.`document_id` → `billing_document` (`id`, `organization_id`): CASCADE
- `service_order_asset_snapshot`.`service_order_id` → `service_order` (`id`, `organization_id`): CASCADE
- `service_order_asset_snapshot`.`asset_id` → `asset` (`id`, `lab_organization_id`): RESTRICT
- `service_order_attachment`.`service_order_id` → `service_order` (`id`, `organization_id`): CASCADE
- `service_order_certificate_link`.`service_order_id` → `service_order` (`id`, `organization_id`): CASCADE
- `service_order_certificate_link`.`certificate_job_id` → `calibration_job` (`id`, `organization_id`): RESTRICT
- `service_order_delivery_document`.`service_order_id` → `service_order` (`id`, `organization_id`): CASCADE
- `service_order_email_log`.`service_order_id` → `service_order` (`id`, `organization_id`): CASCADE
- `service_order_evaluation`.`service_order_id` → `service_order` (`id`, `organization_id`): CASCADE
- `service_order_execution`.`service_order_id` → `service_order` (`id`, `organization_id`): CASCADE
- `service_order_execution_item`.`execution_id` → `service_order_execution` (`id`, `organization_id`): CASCADE
- `service_order_intake_document`.`service_order_id` → `service_order` (`id`, `organization_id`): CASCADE
- `service_order_quote`.`service_order_id` → `service_order` (`id`, `organization_id`): CASCADE
- `service_order_quote_item`.`quote_id` → `service_order_quote` (`id`, `organization_id`): CASCADE
- `service_order_tag`.`service_order_id` → `service_order` (`id`, `organization_id`): CASCADE

Skipped on purpose: nullable pointers that are set to NULL when their target is deleted. A composite `SET NULL` would also null `organization_id`, so they stay single-column references:

- `billing_document_item`.`job_commercial_snapshot_id` → `job_commercial_snapshot`
- `billing_document_item`.`job_id` → `calibration_job`
- `billing_document_item`.`material_id` → `material`
- `calibration_request_item`.`converted_job_id` → `calibration_job`
- `service_order_execution_item`.`material_id` → `material`
- `service_order_execution_item`.`quote_item_id` → `service_order_quote_item`
- `service_order_quote_item`.`material_id` → `material`

<!-- END GENERATED: tenancy -->
