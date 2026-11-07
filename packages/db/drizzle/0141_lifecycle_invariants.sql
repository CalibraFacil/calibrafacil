-- Lifecycle invariants that are not a status column (docs/architecture/state-machines.md).
--
-- 1. integration_sync_item.status defaulted to PENDING, a value no code wrote:
--    an item is recorded when its push starts. The default is now RUNNING, the
--    state INTEGRATION_SYNC_ITEM_MACHINE creates items in.
ALTER TABLE integration_sync_item ALTER COLUMN status SET DEFAULT 'RUNNING';

-- 2. Lifecycles held in pairs of columns rather than a status: the combinations
--    no writer produces are refused. NOT VALID: existing rows are not
--    re-checked (a legacy row in an odd combination does not block the
--    migration); every INSERT and UPDATE from now on is.
-- An order is closed or canceled, never both (reopen clears both).
ALTER TABLE service_order DROP CONSTRAINT IF EXISTS service_order_closed_xor_canceled;
ALTER TABLE service_order ADD CONSTRAINT service_order_closed_xor_canceled CHECK (closed_at IS NULL OR canceled_at IS NULL) NOT VALID;
-- A quote is approved through the portal or recorded manually by the lab, not both.
ALTER TABLE service_order_quote DROP CONSTRAINT IF EXISTS service_order_quote_single_approver;
ALTER TABLE service_order_quote ADD CONSTRAINT service_order_quote_single_approver CHECK (approved_by_portal_user_id IS NULL OR approved_manually_by_user_id IS NULL) NOT VALID;
-- An outbox row is processed or dead-lettered, never both.
ALTER TABLE service_order_email_outbox DROP CONSTRAINT IF EXISTS service_order_email_outbox_processed_xor_dead_letter;
ALTER TABLE service_order_email_outbox ADD CONSTRAINT service_order_email_outbox_processed_xor_dead_letter CHECK (processed_at IS NULL OR dead_letter_at IS NULL) NOT VALID;
-- Same for the out-of-tolerance outbox.
ALTER TABLE oot_email_outbox DROP CONSTRAINT IF EXISTS oot_email_outbox_processed_xor_dead_letter;
ALTER TABLE oot_email_outbox ADD CONSTRAINT oot_email_outbox_processed_xor_dead_letter CHECK (processed_at IS NULL OR dead_letter_at IS NULL) NOT VALID;
-- A revoked signing certificate is neither active nor the default (issuance filters on is_active).
ALTER TABLE organization_signing_certificate DROP CONSTRAINT IF EXISTS organization_signing_certificate_revoked_inactive;
ALTER TABLE organization_signing_certificate ADD CONSTRAINT organization_signing_certificate_revoked_inactive CHECK (revoked_at IS NULL OR (NOT is_active AND NOT is_default)) NOT VALID;
-- Only an active certificate can be a unit's default.
ALTER TABLE organization_signing_certificate DROP CONSTRAINT IF EXISTS organization_signing_certificate_default_active;
ALTER TABLE organization_signing_certificate ADD CONSTRAINT organization_signing_certificate_default_active CHECK (NOT is_default OR is_active) NOT VALID;
