-- Roadmap 2 C1/C2: what the certificate says about who signed, who calibrated and how traceability
-- is evidenced, modelled instead of free text.
--
-- C1: `authorized_signatory.title` is the role printed under the signature of the certificates the
-- person approves under that authorization (ISO/IEC 17025 §6.2.6, §7.8.2.1(o)). It replaces the
-- organization profile's single technical-manager title, which was printed for every approver.
--
-- C2: `organization_unit` carries the unit's own legal name, CNPJ and address (the calibrating body,
-- §7.8.2.1(a)); a unit that declares a CNPJ is a distinct establishment. `reference_standard`
-- records who calibrated the standard: the provider's accreditation number and whether its
-- accreditation body is an ILAC-MRA signatory (Cgcre/RBC). The SI-traceability sentence is printed
-- only when every standard used records both (and a certificate valid on the calibration day).
--
-- Every column is nullable or defaulted: nothing changes for an existing row. A standard recorded
-- before this migration is "not verified" (mra_recognized = false) until the lab fills the provider
-- in, so the sentence is omitted rather than asserted. Certificates already issued re-render from
-- their frozen input and are not affected.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). SET LOCAL lock_timeout fails fast instead of queueing
-- behind a long transaction while the short ACCESS EXCLUSIVE lock is taken.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "authorized_signatory" ADD COLUMN IF NOT EXISTS "title" text;
--> statement-breakpoint
ALTER TABLE "organization_unit" ADD COLUMN IF NOT EXISTS "legal_name" text;
--> statement-breakpoint
ALTER TABLE "organization_unit" ADD COLUMN IF NOT EXISTS "cnpj" text;
--> statement-breakpoint
ALTER TABLE "organization_unit" ADD COLUMN IF NOT EXISTS "street" text;
--> statement-breakpoint
ALTER TABLE "organization_unit" ADD COLUMN IF NOT EXISTS "number" text;
--> statement-breakpoint
ALTER TABLE "organization_unit" ADD COLUMN IF NOT EXISTS "complement" text;
--> statement-breakpoint
ALTER TABLE "organization_unit" ADD COLUMN IF NOT EXISTS "neighbourhood" text;
--> statement-breakpoint
ALTER TABLE "organization_unit" ADD COLUMN IF NOT EXISTS "city" text;
--> statement-breakpoint
ALTER TABLE "organization_unit" ADD COLUMN IF NOT EXISTS "state" text;
--> statement-breakpoint
ALTER TABLE "organization_unit" ADD COLUMN IF NOT EXISTS "cep" text;
--> statement-breakpoint
ALTER TABLE "reference_standard" ADD COLUMN IF NOT EXISTS "calibration_provider_accreditation_number" text;
--> statement-breakpoint
ALTER TABLE "reference_standard" ADD COLUMN IF NOT EXISTS "calibration_provider_mra_recognized" boolean DEFAULT false NOT NULL;
