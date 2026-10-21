-- A certificate can be amended only once: the amend route now serialises on the
-- original job's row, and this index is the last line of defence against two
-- concurrent amendments both inserting a DRAFT that supersedes the same job.
--
-- Databases that already hold two jobs superseding the same original (only
-- possible through the old amend race) cannot take the index. Instead of failing
-- on an opaque unique-violation, or silently editing regulated rows, the guard
-- below stops the migration and names the duplicates. Resolve each by hand (the
-- extra DRAFT amendment is normally cancelled through the application, which
-- keeps its audit trail), then re-run the migration.
--
-- Idempotent, because this project applies migration DDL by hand and the
-- drizzle bookkeeping table lags behind it.
DO $$
DECLARE
  duplicates text;
BEGIN
  SELECT string_agg(
           format('original job id %s superseded by job ids [%s]', supersedes_id, amendments),
           E'\n' ORDER BY supersedes_id)
    INTO duplicates
    FROM (
      SELECT supersedes_id, string_agg(id::text, ', ' ORDER BY id) AS amendments
        FROM "calibration_job"
       WHERE supersedes_id IS NOT NULL
       GROUP BY supersedes_id
      HAVING count(*) > 1
    ) d;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION E'Cannot add job_supersedes_id_uidx: calibration_job rows share a supersedes_id:\n%', duplicates
      USING HINT = 'Keep one amendment per original (cancel the extra DRAFT through the application so the audit trail is preserved), then re-run this migration.';
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_supersedes_id_uidx"
  ON "calibration_job" ("supersedes_id")
  WHERE "supersedes_id" IS NOT NULL;
