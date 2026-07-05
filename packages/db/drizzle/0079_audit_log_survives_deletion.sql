-- CMP-06 (#649): the deletion audit row must survive the deletion it documents.
-- customer_audit_log.customer_id and method_audit_log.method_id had
-- ON DELETE CASCADE to their subject entity, so deleting a customer/method
-- erased its own audit trail (violates the ISO/IEC 17025 append-only trail).
-- Drop ONLY the two subject-entity FKs (soft reference — the id value remains
-- as a plain integer on the audit row). The performed_by → user FKs and the
-- lookup indexes stay untouched. Forward-only and idempotent; dropping an FK
-- never invalidates existing rows.
ALTER TABLE "customer_audit_log" DROP CONSTRAINT IF EXISTS "customer_audit_log_customer_id_customer_id_fk";
--> statement-breakpoint
ALTER TABLE "method_audit_log" DROP CONSTRAINT IF EXISTS "method_audit_log_method_id_calibration_method_id_fk";
