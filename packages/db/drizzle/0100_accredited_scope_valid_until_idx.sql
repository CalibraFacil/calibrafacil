-- #427 Phase 2 — index for the daily scope-line expiry sweep.
-- checkAccreditedScopeLinesExpiring filters and orders on valid_until across
-- all tenants every cron run; without an index each page is a sequential
-- scan + sort. Partial: lines without a vigência never expire.
CREATE INDEX IF NOT EXISTS "accredited_scope_line_valid_until_idx"
  ON "accredited_scope_line" ("valid_until")
  WHERE "valid_until" IS NOT NULL;
