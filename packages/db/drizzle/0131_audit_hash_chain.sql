-- Tamper evidence for the audit trail: a per-organization hash chain on job_audit_log
-- (roadmap 2, B1; ISO/IEC 17025 7.5.2, 8.4, 7.11.3).
--
-- Revoking UPDATE/DELETE (migration 0130) keeps the application from rewriting history; this
-- makes a rewrite by anyone else (the owner, a restored backup, a superuser) DETECTABLE.
--
--   * job_audit_log gains chain_seq (1, 2, 3... within the organization), prev_hash and row_hash
--     = sha256(prev_hash || 'job_audit_log' || LF || chain_seq || LF || canonical row), where the
--     canonical row is the jsonb text of the nine immutable columns (id, organization_id, job_id,
--     action, changes, performed_by, performed_at, ip_address, reason; NULLs left out).
--   * A BEFORE INSERT trigger assigns all three under a per-organization advisory lock
--     (pg_advisory_xact_lock(hashtextextended('job_audit_log:<org>', 7041)), held to COMMIT or
--     ROLLBACK): concurrent writers of one organization are serialised and cannot fork the chain;
--     the unique index on (organization_id, chain_seq) refuses a fork even where the lock does not
--     apply (REPEATABLE READ / SERIALIZABLE read a stale head). The lock lives in its own bigint
--     keyspace, apart from the two-int advisory locks of the numbering code. A transaction that
--     takes a row lock AFTER its first audit insert while another takes it before can deadlock
--     (Postgres detects it, 40P01): write the audit row last. An INSERT cannot choose its own
--     chain values: the trigger overwrites them. A row without organization (an orphan of
--     migration 0118) is left unchained.
--   * Existing rows are chained here, per organization in id order, by
--     calibra_audit_chain_backfill (owner-only; the append-only trigger yields to the owner hatch
--     of migration 0130 for the call). The table is locked SHARE ROW EXCLUSIVE for the migration so
--     no unchained row can slip in between the backfill and the trigger. It reads the table once
--     and updates each row once, so it is linear; there is no production data to speak of.
--   * calibra_audit_chain_verify(table, org) recomputes an organization's chain and returns the
--     first break (a row edited, a link deleted from the middle or the head, a row that never got
--     a link). The daily cron `audit-chain-verify` and `apps/api/src/cli/verify-audit-chain.ts`
--     call it for every organization, record a checkpoint (the head) so that a deletion of the
--     TAIL between two runs is caught too, and alert on a mismatch. Anchoring the head with an
--     external timestamp (ACT) is not done here (roadmap 2 B4): the checkpoint event is the hook.
--
-- Other evidence tables are not chained yet: organization_event_log has foreign-key columns that
-- Postgres rewrites (ON DELETE SET NULL), so a chain over it must leave them out
-- (calibra_audit_chain_columns); two chains per organization also raise the lock-ordering risk
-- above. Adding one is a column set, the column list, an index and a trigger.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS; the backfill only touches
-- rows without a link), because this project applies migration DDL by hand and the drizzle
-- bookkeeping table lags behind it. Functions and triggers are not expressible in schema.ts, so
-- the same objects are repeated in sql/schema-extras.sql (used to build new databases); the
-- columns and the index are in schema.ts. packages/db/src/audit-chain-sql.test.ts keeps the copies
-- equal.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
LOCK TABLE public.job_audit_log IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
ALTER TABLE public.job_audit_log
  ADD COLUMN IF NOT EXISTS chain_seq bigint,
  ADD COLUMN IF NOT EXISTS prev_hash bytea,
  ADD COLUMN IF NOT EXISTS row_hash bytea;
--> statement-breakpoint
-- BEGIN audit hash chain functions (migration 0131)
-- The columns a chained table's hash covers, in no particular order (the canonical
-- text sorts them). A column NOT listed is not covered: that is how the foreign-key
-- ON DELETE SET NULL columns of an event log (rewritten by Postgres when a user or
-- unit is deleted) stay out of a chain, and how a column added later stays out until
-- a migration adds it here. Adding a table to the chain: list it here, add a column
-- set (chain_seq bigint, prev_hash bytea, row_hash bytea), a unique index on
-- (organization_id, chain_seq) and the BEFORE INSERT trigger below.
CREATE OR REPLACE FUNCTION calibra_audit_chain_columns(p_table text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE p_table
    WHEN 'job_audit_log' THEN ARRAY[
      'id', 'organization_id', 'job_id', 'action', 'changes',
      'performed_by', 'performed_at', 'ip_address', 'reason'
    ]
  END
$$;
--> statement-breakpoint
-- The canonical text of a row: a jsonb object of the covered columns that are not NULL
-- (jsonb text is deterministic: keys sorted, one spacing). A NULL column and an absent
-- one hash the same, so a column that a later migration adds to the list does not
-- change the hash of the rows written before it.
CREATE OR REPLACE FUNCTION calibra_audit_chain_content(p_table text, p_row jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(
           jsonb_object_agg(c.k, p_row -> c.k)
             FILTER (WHERE p_row -> c.k IS NOT NULL AND p_row -> c.k <> 'null'::jsonb),
           '{}'::jsonb
         )::text
    FROM unnest(public.calibra_audit_chain_columns(p_table)) AS c(k)
$$;
--> statement-breakpoint
-- row_hash = sha256(prev_hash || table || LF || chain_seq || LF || canonical row). The first
-- link of a chain has no prev_hash (NULL, hashed as the empty string).
CREATE OR REPLACE FUNCTION calibra_audit_chain_hash(
  p_table text, p_seq bigint, p_prev bytea, p_row jsonb
)
RETURNS bytea
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT sha256(
    coalesce(p_prev, '\x'::bytea)
    || convert_to(
         p_table || E'\n' || p_seq::text || E'\n' || public.calibra_audit_chain_content(p_table, p_row),
         'UTF8')
  )
$$;
--> statement-breakpoint
-- BEFORE INSERT trigger: links the new row to the head of its organization's chain.
--
-- Serialisation. The head is "the row with the highest chain_seq of this organization", so two
-- transactions must not read it at the same time: each takes
-- pg_advisory_xact_lock(hashtextextended('<table>:<organization>', 7041)) first and keeps it to
-- COMMIT or ROLLBACK, so the next writer reads the head the previous one left (READ COMMITTED:
-- the head SELECT is a new statement, after the lock). One bigint key per (table, organization),
-- a keyspace apart from the two-int advisory locks of the application (certificate and billing
-- numbering) and from its hashtextextended(..., 0) lock; it is never held while waiting for
-- another advisory lock. Cost: transactions that write an audit row for the same organization run
-- one after the other from their first audit insert on; a transaction that takes a row lock AFTER
-- its first audit insert while another takes it BEFORE can deadlock (Postgres detects it, 40P01,
-- and aborts one), so write the audit row last. Under REPEATABLE READ or SERIALIZABLE the head
-- read can be stale; the unique index on (organization_id, chain_seq) then refuses the fork (23505)
-- instead of letting it happen.
-- Whatever chain_seq, prev_hash or row_hash an insert carries is overwritten: the application
-- cannot choose its place in the chain. A row without an organization (an orphan of migration
-- 0118) is left unchained.
CREATE OR REPLACE FUNCTION calibra_audit_chain_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_head_seq bigint;
  v_head_hash bytea;
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.chain_seq := NULL;
    NEW.prev_hash := NULL;
    NEW.row_hash := NULL;
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(TG_TABLE_NAME || ':' || NEW.organization_id, 7041));

  EXECUTE format(
    'SELECT t.chain_seq, t.row_hash FROM %I.%I t
      WHERE t.organization_id = $1 AND t.chain_seq IS NOT NULL
      ORDER BY t.chain_seq DESC LIMIT 1',
    TG_TABLE_SCHEMA, TG_TABLE_NAME)
    INTO v_head_seq, v_head_hash
    USING NEW.organization_id;

  NEW.chain_seq := coalesce(v_head_seq, 0) + 1;
  NEW.prev_hash := v_head_hash;
  NEW.row_hash := public.calibra_audit_chain_hash(
    TG_TABLE_NAME, NEW.chain_seq, NEW.prev_hash, to_jsonb(NEW));
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- The head of an organization's chain: its last link and the number of links. No row when the
-- organization has none.
CREATE OR REPLACE FUNCTION calibra_audit_chain_head(p_table text, p_org text)
RETURNS TABLE (out_chain_seq bigint, out_row_hash bytea, out_links bigint)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF public.calibra_audit_chain_columns(p_table) IS NULL THEN
    RAISE EXCEPTION 'calibra: % is not a chained table', p_table;
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT t.chain_seq, t.row_hash,
            (SELECT count(*) FROM public.%1$I c WHERE c.organization_id = $1 AND c.chain_seq IS NOT NULL)
       FROM public.%1$I t
      WHERE t.organization_id = $1 AND t.chain_seq IS NOT NULL
      ORDER BY t.chain_seq DESC LIMIT 1', p_table)
    USING p_org;
END
$$;
--> statement-breakpoint
-- The row_hash of one link, or NULL when the organization has no such link: what a checkpoint
-- (the head some earlier verification recorded) is compared with, so a deletion of the TAIL of a
-- chain, which the chain itself cannot show, is caught by the next run.
CREATE OR REPLACE FUNCTION calibra_audit_chain_link_hash(p_table text, p_org text, p_seq bigint)
RETURNS bytea
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_hash bytea;
BEGIN
  IF public.calibra_audit_chain_columns(p_table) IS NULL THEN
    RAISE EXCEPTION 'calibra: % is not a chained table', p_table;
  END IF;
  EXECUTE format(
    'SELECT t.row_hash FROM public.%I t WHERE t.organization_id = $1 AND t.chain_seq = $2', p_table)
    INTO v_hash
    USING p_org, p_seq;
  RETURN v_hash;
END
$$;
--> statement-breakpoint
-- Recomputes an organization's chain and returns its FIRST break (no row = intact):
--   sequence_gap        the link is not the one after its predecessor (a link was deleted, or the
--                       first one is not 1)
--   prev_hash_mismatch  prev_hash is not the predecessor's row_hash
--   row_hash_mismatch   the stored content does not hash to row_hash (a row was edited)
--   unchained_row       a row of the organization that never got a link (trigger bypassed)
-- out_row_id names the row to look at (for a gap, the first row after the hole). Read-only.
CREATE OR REPLACE FUNCTION calibra_audit_chain_verify(p_table text, p_org text)
RETURNS TABLE (
  out_row_id integer,
  out_chain_seq bigint,
  out_kind text,
  out_expected bytea,
  out_actual bytea
)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF public.calibra_audit_chain_columns(p_table) IS NULL THEN
    RAISE EXCEPTION 'calibra: % is not a chained table', p_table;
  END IF;
  RETURN QUERY EXECUTE format(
    'WITH chained AS (
       SELECT t.id AS row_id, t.chain_seq AS seq, t.prev_hash, t.row_hash,
              lag(t.chain_seq) OVER w AS lag_seq,
              lag(t.row_hash) OVER w AS lag_hash,
              public.calibra_audit_chain_hash(%2$L, t.chain_seq, t.prev_hash, to_jsonb(t)) AS recomputed
         FROM public.%1$I t
        WHERE t.organization_id = $1 AND t.chain_seq IS NOT NULL
       WINDOW w AS (ORDER BY t.chain_seq)
     ), breaks AS (
       SELECT c.row_id, c.seq,
              CASE
                WHEN c.seq IS DISTINCT FROM coalesce(c.lag_seq, 0) + 1 THEN ''sequence_gap''
                WHEN c.prev_hash IS DISTINCT FROM c.lag_hash THEN ''prev_hash_mismatch''
                WHEN c.row_hash IS DISTINCT FROM c.recomputed THEN ''row_hash_mismatch''
              END AS kind,
              CASE
                WHEN c.seq IS DISTINCT FROM coalesce(c.lag_seq, 0) + 1 THEN NULL
                WHEN c.prev_hash IS DISTINCT FROM c.lag_hash THEN c.lag_hash
                ELSE c.recomputed
              END AS expected,
              CASE
                WHEN c.seq IS DISTINCT FROM coalesce(c.lag_seq, 0) + 1 THEN NULL
                WHEN c.prev_hash IS DISTINCT FROM c.lag_hash THEN c.prev_hash
                ELSE c.row_hash
              END AS actual
         FROM chained c
     )
     SELECT b.row_id, b.seq, b.kind, b.expected, b.actual FROM breaks b WHERE b.kind IS NOT NULL
     UNION ALL
     SELECT min(u.id), NULL::bigint, ''unchained_row'', NULL::bytea, NULL::bytea
       FROM public.%1$I u
      WHERE u.organization_id = $1 AND u.chain_seq IS NULL
     HAVING count(*) > 0
     ORDER BY 2 NULLS LAST
     LIMIT 1', p_table, p_table)
    USING p_org;
END
$$;
--> statement-breakpoint
-- Links the rows of a chained table that have no link yet (a table that existed before its chain,
-- or rows written with the trigger disabled), per organization, in id order, after the current
-- head. With p_rebuild the organization's links are dropped first and the whole chain is
-- recomputed in id order: for the demo seed, which back-dates audit rows on purpose, and for an
-- audited repair; it deliberately rewrites history, which is why it is owner-only (the append-only
-- trigger yields to calibra.allow_audit_rewrite for the table owner, set here for the call).
-- Returns the number of links written. p_org NULL = every organization.
CREATE OR REPLACE FUNCTION calibra_audit_chain_backfill(
  p_table text, p_org text DEFAULT NULL, p_rebuild boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
-- public stays on the path: the UPDATEs below fire the append-only trigger, whose own
-- unqualified calls (calibra_history_rewrite_allowed) resolve under this function's setting.
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org record;
  v_row record;
  v_seq bigint;
  v_prev bytea;
  v_hash bytea;
  v_total bigint := 0;
  v_was text := coalesce(current_setting('calibra.allow_audit_rewrite', true), '');
BEGIN
  IF NOT public.calibra_session_is_owner() THEN
    RAISE EXCEPTION 'calibra: the audit chain can be (re)built by the table owner only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF public.calibra_audit_chain_columns(p_table) IS NULL THEN
    RAISE EXCEPTION 'calibra: % is not a chained table', p_table;
  END IF;

  PERFORM set_config('calibra.allow_audit_rewrite', 'on', true);

  IF p_rebuild THEN
    EXECUTE format(
      'UPDATE public.%I SET chain_seq = NULL, prev_hash = NULL, row_hash = NULL
        WHERE organization_id IS NOT NULL AND ($1 IS NULL OR organization_id = $1)
          AND chain_seq IS NOT NULL', p_table)
      USING p_org;
  END IF;

  FOR v_org IN EXECUTE format(
    'SELECT DISTINCT organization_id AS id FROM public.%I
      WHERE organization_id IS NOT NULL AND chain_seq IS NULL
        AND ($1 IS NULL OR organization_id = $1)
      ORDER BY 1', p_table)
    USING p_org
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(p_table || ':' || v_org.id, 7041));
    v_seq := NULL;
    v_prev := NULL;
    EXECUTE format(
      'SELECT t.chain_seq, t.row_hash FROM public.%I t
        WHERE t.organization_id = $1 AND t.chain_seq IS NOT NULL
        ORDER BY t.chain_seq DESC LIMIT 1', p_table)
      INTO v_seq, v_prev
      USING v_org.id;
    v_seq := coalesce(v_seq, 0);

    FOR v_row IN EXECUTE format(
      'SELECT t.id, to_jsonb(t) AS j FROM public.%I t
        WHERE t.organization_id = $1 AND t.chain_seq IS NULL
        ORDER BY t.id', p_table)
      USING v_org.id
    LOOP
      v_seq := v_seq + 1;
      v_hash := public.calibra_audit_chain_hash(p_table, v_seq, v_prev, v_row.j);
      EXECUTE format(
        'UPDATE public.%I SET chain_seq = $1, prev_hash = $2, row_hash = $3 WHERE id = $4', p_table)
        USING v_seq, v_prev, v_hash, v_row.id;
      v_prev := v_hash;
      v_total := v_total + 1;
    END LOOP;
  END LOOP;

  PERFORM set_config('calibra.allow_audit_rewrite', v_was, true);
  RETURN v_total;
END
$$;
-- END audit hash chain functions (migration 0131)
--> statement-breakpoint
SELECT public.calibra_audit_chain_backfill('job_audit_log');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS job_audit_log_org_chain_seq_uidx
  ON public.job_audit_log USING btree (organization_id, chain_seq);
--> statement-breakpoint
DROP TRIGGER IF EXISTS job_audit_log_hash_chain ON public.job_audit_log;
CREATE TRIGGER job_audit_log_hash_chain
  BEFORE INSERT ON public.job_audit_log
  FOR EACH ROW EXECUTE FUNCTION calibra_audit_chain_before_insert();
