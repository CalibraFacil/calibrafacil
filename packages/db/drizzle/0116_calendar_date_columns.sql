-- Calendar days stored as `date`, not `timestamp` (Q10).
--
-- These columns name a CALENDAR DAY (an accreditation bound, an asset's last /
-- next calibration and legal verification, a reference standard's calibration
-- dates, a job's due date, a billing document's issue/due date, an installment's
-- due date) but were `timestamp` columns holding UTC instants. Typed values
-- arrived as UTC midnight or as local noon (~15:00Z) and generated values carried
-- a time of day, so a comparison with "today" depended on the hour it ran.
--
-- The day an existing value names is decided by the rule display already uses
-- (`getDateOnlyDay` in @calibra-facil/documents): an exact-UTC-midnight value
-- names its UTC day; any other instant names its America/Sao_Paulo day.
--
-- Triggers: ALTER COLUMN ... TYPE rewrites the table without firing row
-- triggers, so the calibration_job immutability guard (0115) does not see this
-- as an edit of APPROVED jobs. The guard compares to_jsonb(OLD) with to_jsonb(NEW);
-- an unchanged `due_date` is the same date on both sides, so it still compares equal.
-- Indexes on these columns are rebuilt by Postgres. Nothing in
-- sql/schema-extras.sql references them.
--
-- Idempotent, because this project applies migration DDL by hand and the
-- drizzle bookkeeping table lags behind it: a column that is already `date`
-- (or does not exist) is skipped.
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'organization'
       AND c.column_name = 'accreditation_valid_from'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "organization" ALTER COLUMN "accreditation_valid_from" TYPE date USING (CASE WHEN "accreditation_valid_from" = date_trunc('day', "accreditation_valid_from") THEN "accreditation_valid_from"::date ELSE (("accreditation_valid_from" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'organization'
       AND c.column_name = 'accreditation_valid_until'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "organization" ALTER COLUMN "accreditation_valid_until" TYPE date USING (CASE WHEN "accreditation_valid_until" = date_trunc('day', "accreditation_valid_until") THEN "accreditation_valid_until"::date ELSE (("accreditation_valid_until" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'asset'
       AND c.column_name = 'last_calibration_date'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "asset" ALTER COLUMN "last_calibration_date" TYPE date USING (CASE WHEN "last_calibration_date" = date_trunc('day', "last_calibration_date") THEN "last_calibration_date"::date ELSE (("last_calibration_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'asset'
       AND c.column_name = 'next_calibration_date'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "asset" ALTER COLUMN "next_calibration_date" TYPE date USING (CASE WHEN "next_calibration_date" = date_trunc('day', "next_calibration_date") THEN "next_calibration_date"::date ELSE (("next_calibration_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'asset'
       AND c.column_name = 'next_legal_verification_date'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "asset" ALTER COLUMN "next_legal_verification_date" TYPE date USING (CASE WHEN "next_legal_verification_date" = date_trunc('day', "next_legal_verification_date") THEN "next_legal_verification_date"::date ELSE (("next_legal_verification_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'reference_standard'
       AND c.column_name = 'calibration_date'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "reference_standard" ALTER COLUMN "calibration_date" TYPE date USING (CASE WHEN "calibration_date" = date_trunc('day', "calibration_date") THEN "calibration_date"::date ELSE (("calibration_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'reference_standard'
       AND c.column_name = 'next_calibration_date'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "reference_standard" ALTER COLUMN "next_calibration_date" TYPE date USING (CASE WHEN "next_calibration_date" = date_trunc('day', "next_calibration_date") THEN "next_calibration_date"::date ELSE (("next_calibration_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'reference_standard_certificate_document'
       AND c.column_name = 'calibration_date'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "reference_standard_certificate_document" ALTER COLUMN "calibration_date" TYPE date USING (CASE WHEN "calibration_date" = date_trunc('day', "calibration_date") THEN "calibration_date"::date ELSE (("calibration_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'reference_standard_certificate_document'
       AND c.column_name = 'next_calibration_date'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "reference_standard_certificate_document" ALTER COLUMN "next_calibration_date" TYPE date USING (CASE WHEN "next_calibration_date" = date_trunc('day', "next_calibration_date") THEN "next_calibration_date"::date ELSE (("next_calibration_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'calibration_job'
       AND c.column_name = 'due_date'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "calibration_job" ALTER COLUMN "due_date" TYPE date USING (CASE WHEN "due_date" = date_trunc('day', "due_date") THEN "due_date"::date ELSE (("due_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'billing_document'
       AND c.column_name = 'issue_date'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "billing_document" ALTER COLUMN "issue_date" TYPE date USING (CASE WHEN "issue_date" = date_trunc('day', "issue_date") THEN "issue_date"::date ELSE (("issue_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'billing_document'
       AND c.column_name = 'due_date'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "billing_document" ALTER COLUMN "due_date" TYPE date USING (CASE WHEN "due_date" = date_trunc('day', "due_date") THEN "due_date"::date ELSE (("due_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF (
    SELECT c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'receivable_installment'
       AND c.column_name = 'due_date'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "receivable_installment" ALTER COLUMN "due_date" TYPE date USING (CASE WHEN "due_date" = date_trunc('day', "due_date") THEN "due_date"::date ELSE (("due_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date END);
  END IF;
END $$;
