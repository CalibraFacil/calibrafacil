-- #647: accreditation vigência window on the organization. Nullable — orgs
-- without a filled window keep the pre-#647 behavior (REQ-CMP-VIG-004).
ALTER TABLE "organization" ADD COLUMN "accreditation_valid_from" timestamp;
ALTER TABLE "organization" ADD COLUMN "accreditation_valid_until" timestamp;
