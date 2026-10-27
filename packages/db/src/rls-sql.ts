// Row-level security of the tenant tables, in SHADOW mode (roadmap P2-3, Q15).
//
// Every table of tenancy.ts that carries an organization column gets
// `ENABLE ROW LEVEL SECURITY` (never FORCE) and one policy, `tenant_isolation`,
// for the role `calibra_app`. The tables are owned by the migration owner, and an
// owner that is not FORCEd bypasses RLS, so a deployment that connects as the
// owner (every deployment today) sees no change at all; the policies only bite
// once the API connects as a member of `calibra_app` (DEPLOYMENT.md, "Row-level
// security").
//
// `pnpm --filter @calibra-facil/db gen:rls-sql` prints the per-table block. It is
// pasted verbatim into the migration that (re)defines it and into
// sql/schema-extras.sql; rls-sql.test.ts fails when either copy differs from
// what the current classification generates, so adding or removing a tenant
// table cannot ship without a migration that carries it.
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import {
  APPEND_ONLY_EVIDENCE_TABLES,
  NO_UPDATE_EVIDENCE_TABLES,
} from "./evidence-tables";
import * as schema from "./schema";
import { classifyTables, TENANT_COLUMNS } from "./tenancy";

export const RLS_SQL_BEGIN = "-- BEGIN generated: calibra_rls_tenant_isolation";
export const RLS_SQL_END = "-- END generated: calibra_rls_tenant_isolation";

/** The role the application connects as once the role split is done. */
export const APP_ROLE = "calibra_app";

/** The policy name on every tenant table. */
export const POLICY_NAME = "tenant_isolation";

/** Transaction-local setting that names the organization of the work. */
export const ORGANIZATION_SETTING = "calibra.organization_id";

export type RlsTable = {
  table: string;
  /** The organization column (`organization_id` / `lab_organization_id`). */
  column: string;
  /** SQL type of that column, for the cast of the setting. */
  sqlType: string;
};

/** Every tenant table with its organization column, sorted by table name. */
export function rlsTables(): RlsTable[] {
  const wanted = new Set(classifyTables().tenant.map((table) => table.name));
  const found: RlsTable[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    if (!wanted.has(config.name)) continue;
    if (config.schema !== undefined && config.schema !== "public") {
      throw new Error(`rls-sql: ${config.name} is not in the public schema`);
    }
    const columns = config.columns.filter((column) =>
      TENANT_COLUMNS.includes(column.name),
    );
    const [column] = columns;
    if (columns.length !== 1 || column === undefined) {
      throw new Error(
        `rls-sql: ${config.name} must carry exactly one organization column`,
      );
    }
    found.push({
      table: config.name,
      column: column.name,
      sqlType: column.getSQLType(),
    });
  }
  return found.sort((a, b) => a.table.localeCompare(b.table));
}

function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * The organization of the work, as the column's type. `NULLIF(.., '')`: a
 * transaction-local setting reads back as '' (not NULL) on a connection that
 * once set it, and the empty string must never match a row.
 */
export function organizationExpression(sqlType: string): string {
  return `NULLIF(current_setting('${ORGANIZATION_SETTING}', true), '')::${sqlType}`;
}

export function policyPredicate(entry: RlsTable): string {
  return `${ident(entry.column)} = ${organizationExpression(entry.sqlType)}`;
}

export function rlsTableStatements(entry: RlsTable): string {
  const table = `public.${ident(entry.table)}`;
  const predicate = policyPredicate(entry);
  return `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ${POLICY_NAME} ON ${table};
CREATE POLICY ${POLICY_NAME} ON ${table} AS PERMISSIVE FOR ALL TO ${APP_ROLE}
  USING (${predicate})
  WITH CHECK (${predicate});`;
}

export function rlsSqlBlock(): string {
  const statements = rlsTables().map(rlsTableStatements).join("\n");
  return `${RLS_SQL_BEGIN}\n${statements}\n${RLS_SQL_END}`;
}

/** First statement of the migration: fail fast, retry, instead of queueing traffic behind a long query. */
export const RLS_LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '5s';";

/**
 * Migration only (not in schema-extras.sql, which builds an empty database as
 * its owner): refuse to run as a role that RLS will bind. One DATABASE_URL
 * usually serves the migrations and the API; a role that is neither superuser,
 * BYPASSRLS nor the owner of the tables would be bound by the policies this
 * migration creates, the moment it also runs the application.
 */
export const RLS_MIGRATION_GUARD_SQL = `DO $$
DECLARE
  me record;
  foreign_tables integer;
BEGIN
  SELECT rolsuper, rolbypassrls INTO me FROM pg_roles WHERE rolname = current_user;
  IF me.rolsuper OR me.rolbypassrls THEN
    RETURN;
  END IF;
  SELECT count(*) INTO foreign_tables FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      AND NOT pg_has_role(current_user, c.relowner, 'USAGE');
  IF foreign_tables > 0 THEN
    RAISE EXCEPTION 'calibra: migration 0123 is run as %, which is neither the owner of the tenant tables nor superuser/BYPASSRLS, so row-level security would bind it (and the API when it shares this DATABASE_URL). Run migrations as the owner of the tables; see DEPLOYMENT.md, "Row-level security".', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;`;

/**
 * The role and its grants; static, repeated beside the block. Idempotent. The
 * role is NOLOGIN: nothing can connect as it until the owner creates a LOGIN
 * user that is a member of it (DEPLOYMENT.md). It gets plain DML on every table
 * and sequence of the schema (the policies are what narrows the tenant ones) and
 * the same on tables created later by the role that runs the migrations.
 * Creating the role needs CREATEROLE; without it the migration stops with the
 * one-time admin step (it never skips the role: the policies are addressed to it).
 */
export const RLS_ROLE_SQL = `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
    BEGIN
      CREATE ROLE ${APP_ROLE} NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'calibra: the role ${APP_ROLE} does not exist and % may not create it (CREATEROLE is missing). An administrator runs CREATE ROLE ${APP_ROLE} NOLOGIN; once, then this migration is run again. See DEPLOYMENT.md, "Row-level security".', current_user
        USING ERRCODE = 'insufficient_privilege';
    END;
  END IF;
END
$$;
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${APP_ROLE}', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO ${APP_ROLE};`;

export const EVIDENCE_GRANTS_BEGIN =
  "-- BEGIN generated: calibra_evidence_grants";
export const EVIDENCE_GRANTS_END = "-- END generated: calibra_evidence_grants";

function byName(names: readonly string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * What the application role may NOT do to the evidence tables (evidence-tables.ts):
 * the privileges layer of ISO/IEC 17025 7.5.2 / 8.4 immutability. Generated from the
 * lists there, pasted verbatim into the migration that (re)defines it and into
 * sql/schema-extras.sql (`pnpm --filter @calibra-facil/db gen:rls-sql evidence`);
 * rls-sql.test.ts fails when either copy differs.
 *
 * It must run AFTER `RLS_ROLE_SQL`: that statement grants UPDATE and DELETE on
 * ALL TABLES (and as a default privilege), so every migration that repeats it
 * repeats this block right after it. Idempotent (REVOKE of a privilege that is not
 * held is a no-op). Only the table owner can GRANT the privilege back.
 */
export function evidenceGrantsBlock(): string {
  const appendOnly = byName(APPEND_ONLY_EVIDENCE_TABLES).map(
    (table) =>
      `REVOKE UPDATE, DELETE, TRUNCATE ON public.${ident(table)} FROM ${APP_ROLE};`,
  );
  const noUpdate = byName(NO_UPDATE_EVIDENCE_TABLES).map(
    (table) =>
      `REVOKE UPDATE, TRUNCATE ON public.${ident(table)} FROM ${APP_ROLE};`,
  );
  return [
    EVIDENCE_GRANTS_BEGIN,
    ...appendOnly,
    ...noUpdate,
    EVIDENCE_GRANTS_END,
  ].join("\n");
}
