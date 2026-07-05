-- CMP-07 (#692): drop the self-deleting subject-entity FKs on 12 audit-log
-- tables (14 FKs — certificate_release_audit_log and organization_api_key_audit_log
-- each have TWO: subject + organization). Each subject FK carried ON DELETE
-- CASCADE, so deleting the subject (or, for the two-FK tables, the organization)
-- erased the append-only ISO/IEC 17025 audit trail that documents the deletion.
--
-- Same soft-reference pattern as PR #691 (customer/method audit logs): the FK is
-- dropped, the id column stays as a plain value, and the lookup indexes + the
-- performed_by/actor → user FKs are untouched. Forward-only and idempotent;
-- dropping an FK never invalidates existing rows.
--
-- DELIBERATELY NOT TOUCHED (Pedro's pending design decision): the userId → user
-- ON DELETE CASCADE on the personnel_competence / training_record /
-- authorized_signatory SUBJECT tables, and Better Auth deleteUser config.
--
-- Constraint names were VERIFIED against packages/db/drizzle/0000_late_donald_blake.sql
-- (and, for the two later tables, 0029/0047 + their 0058 rebuild). The operator
-- must re-verify against prod pg_constraint before applying (names are Drizzle
-- convention, but a manual/renamed prod constraint would differ).
ALTER TABLE "asset_audit_log" DROP CONSTRAINT IF EXISTS "asset_audit_log_asset_id_asset_id_fk";--> statement-breakpoint
ALTER TABLE "job_audit_log" DROP CONSTRAINT IF EXISTS "job_audit_log_job_id_calibration_job_id_fk";--> statement-breakpoint
ALTER TABLE "reference_standard_audit_log" DROP CONSTRAINT IF EXISTS "reference_standard_audit_log_standard_id_reference_standard_id_fk";--> statement-breakpoint
ALTER TABLE "service_audit_log" DROP CONSTRAINT IF EXISTS "service_audit_log_service_id_service_id_fk";--> statement-breakpoint
ALTER TABLE "calibration_request_audit_log" DROP CONSTRAINT IF EXISTS "calibration_request_audit_log_request_id_calibration_request_id_fk";--> statement-breakpoint
ALTER TABLE "certificate_release_audit_log" DROP CONSTRAINT IF EXISTS "certificate_release_audit_log_certificate_release_id_certificate_release_id_fk";--> statement-breakpoint
ALTER TABLE "certificate_release_audit_log" DROP CONSTRAINT IF EXISTS "certificate_release_audit_log_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "corrective_action_audit_log" DROP CONSTRAINT IF EXISTS "corrective_action_audit_log_capa_id_corrective_action_id_fk";--> statement-breakpoint
ALTER TABLE "non_conformance_audit_log" DROP CONSTRAINT IF EXISTS "non_conformance_audit_log_nc_id_non_conformance_id_fk";--> statement-breakpoint
ALTER TABLE "personnel_competence_audit_log" DROP CONSTRAINT IF EXISTS "personnel_competence_audit_log_competence_id_personnel_competence_id_fk";--> statement-breakpoint
ALTER TABLE "training_record_audit_log" DROP CONSTRAINT IF EXISTS "training_record_audit_log_training_record_id_training_record_id_fk";--> statement-breakpoint
ALTER TABLE "authorized_signatory_audit_log" DROP CONSTRAINT IF EXISTS "authorized_signatory_audit_log_signatory_id_authorized_signatory_id_fk";--> statement-breakpoint
ALTER TABLE "organization_api_key_audit_log" DROP CONSTRAINT IF EXISTS "organization_api_key_audit_log_api_key_id_organization_api_key_id_fk";--> statement-breakpoint
ALTER TABLE "organization_api_key_audit_log" DROP CONSTRAINT IF EXISTS "organization_api_key_audit_log_organization_id_organization_id_fk";
