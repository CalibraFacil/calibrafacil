// Start-up check of row-level security (roadmap P2-3, P2-18k; decisions Q15, Q31, Q40).
//
// Migration 0123 enables RLS on every tenant table (not FORCEd). A role that owns
// the tables, a superuser and a BYPASSRLS role are exempt; any other role (a
// member of `calibra_app`) is bound by the `tenant_isolation` policies, and an
// application that did not name its organization on every statement would
// silently see nothing. The application now does, so the normal setup is the
// role split: DATABASE_URL is `calibra_app`, DATABASE_OWNER_URL is the owner (the
// system path: Better Auth, cross-laboratory lookups; the migrations too). The
// check makes a typo in either URL a start-up error instead of a silent hole:
//
//   - `enforced` (DATABASE_RLS_MODE, the default): DATABASE_URL must be a role
//     the policies bind on EVERY tenant table (an application that connected as
//     the owner, owns even one table, or is a member of the owner, so it can
//     SET ROLE, would run with no second wall there and nobody would know);
//     DATABASE_OWNER_URL must be set
//     (Q40: otherwise the system path would run as the application role and
//     silently match nothing) and must NOT be a role the policies bind;
//   - `shadow`, kept for diagnosis: the application connects as the owner and
//     start-up REFUSES a role that RLS binds, so shadow mode can never silently
//     hide data, and warns loudly when that happens in production.
//
// Before migration 0123 no table has RLS enabled and the role checks pass.
import { ConfigError, readDatabaseConfig } from "@calibra-facil/config";
import { sql } from "drizzle-orm";
import type { OrgExecutor } from "./for-org";

export type RlsMode = "shadow" | "enforced";

export type RlsRoleFacts = {
  /** `current_user`. */
  role: string;
  isSuperuser: boolean;
  bypassesRls: boolean;
  /** Some table of the `public` schema has row-level security enabled. */
  rlsEnabled: boolean;
  /**
   * Some table with RLS enabled would filter this role: it neither owns the
   * table (directly or through a role it inherits) nor bypasses RLS, or the
   * table is FORCEd.
   */
  subjectToRls: boolean;
  /**
   * The role owns, or can become (membership, inherited or not: `SET ROLE`), the
   * owner of SOME table with RLS enabled. Such a role is exempt from the policies
   * of that table, so the wall would have a hole even though other tables bind it.
   */
  ownsSomeRlsTable: boolean;
};

/** The one query of the check. Reads catalogs only. */
const FACTS_QUERY = sql`
  select
    current_user::text as role,
    coalesce(r.rolsuper, false) as is_superuser,
    coalesce(r.rolbypassrls, false) as bypasses_rls,
    exists (
      select 1 from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
    ) as rls_enabled,
    (
      not coalesce(r.rolsuper, false) and not coalesce(r.rolbypassrls, false) and exists (
        select 1 from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
          and (c.relforcerowsecurity or not pg_has_role(current_user, c.relowner, 'USAGE'))
      )
    ) as subject_to_rls,
    exists (
      select 1 from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
        and pg_has_role(current_user, c.relowner, 'MEMBER')
    ) as owns_some_rls_table
  from pg_roles r
  where r.rolname = current_user
`;

function rowOf(result: unknown): unknown {
  const rows: unknown = Array.isArray(result)
    ? result
    : typeof result === "object" && result !== null
      ? Reflect.get(result, "rows")
      : undefined;
  return Array.isArray(rows) ? rows[0] : undefined;
}

function field(row: unknown, name: string): unknown {
  return typeof row === "object" && row !== null
    ? Reflect.get(row, name)
    : undefined;
}

export async function readRlsRoleFacts(
  executor: Pick<OrgExecutor, "execute">,
): Promise<RlsRoleFacts> {
  const row = rowOf(await executor.execute(FACTS_QUERY));
  const role = field(row, "role");
  if (typeof role !== "string") {
    throw new Error("rls start-up check: the role query returned no row");
  }
  return {
    role,
    isSuperuser: field(row, "is_superuser") === true,
    bypassesRls: field(row, "bypasses_rls") === true,
    rlsEnabled: field(row, "rls_enabled") === true,
    subjectToRls: field(row, "subject_to_rls") === true,
    ownsSomeRlsTable: field(row, "owns_some_rls_table") === true,
  };
}

/** The refusal message for the application connection, or null when it may start in `mode`. */
export function rlsStartupProblem(
  facts: RlsRoleFacts,
  mode: RlsMode,
): string | null {
  if (!facts.rlsEnabled) return null;
  if (mode === "enforced") {
    if (facts.subjectToRls && !facts.ownsSomeRlsTable) return null;
    return `DATABASE_RLS_MODE=enforced (the default), but DATABASE_URL connects as "${facts.role}", which owns (or is a member of the owner of, or can SET ROLE to the owner of) some tenant table, or is superuser/BYPASSRLS, so row-level security would not apply to the application. Connect the application as the role calibra_app (or a member of it) and put the owner's connection in DATABASE_OWNER_URL; to run as the owner on purpose (diagnosis), set DATABASE_RLS_MODE=shadow. See DEPLOYMENT.md ("Row-level security").`;
  }
  if (!facts.subjectToRls) return null;
  return `DATABASE_RLS_MODE=shadow, but DATABASE_URL connects as "${facts.role}", which is subject to row-level security (migration 0123: it neither owns the tenant tables nor is superuser/BYPASSRLS), so statements without an organization would silently match no row. Connect as the owner of the tables, or use DATABASE_RLS_MODE=enforced (the default) with DATABASE_OWNER_URL set, see DEPLOYMENT.md ("Row-level security").`;
}

/**
 * The refusal message when `enforced` mode has no owner connection for the
 * system path, or null (Q40). Pure, so it needs no database.
 */
export function rlsOwnerUrlProblem(
  mode: RlsMode,
  ownerUrl: string | undefined,
): string | null {
  if (mode !== "enforced" || ownerUrl) return null;
  return 'DATABASE_RLS_MODE=enforced (the default) needs DATABASE_OWNER_URL, the connection of the table owner used by the system path (identity, cross-laboratory sweeps, the lookup of a message\'s laboratory): without it those statements would run as the restricted role and silently see nothing. Set DATABASE_OWNER_URL, see DEPLOYMENT.md ("Row-level security").';
}

/**
 * The refusal message when the system path's role is one the policies bind
 * (`enforced` only), or null. Such a role would match no row on every
 * cross-laboratory lookup (Better Auth, the portal scope) instead of failing.
 */
export function rlsSystemRoleProblem(
  mode: RlsMode,
  systemFacts: RlsRoleFacts,
): string | null {
  if (mode !== "enforced") return null;
  if (!systemFacts.rlsEnabled || !systemFacts.subjectToRls) return null;
  return `DATABASE_OWNER_URL connects as "${systemFacts.role}", which is subject to row-level security, so the system path would match no row. It must be the owner of the tables (or superuser/BYPASSRLS). See DEPLOYMENT.md ("Row-level security").`;
}

/** Shadow mode is for diagnosis; running production on the owner has no second wall. */
export const SHADOW_IN_PRODUCTION_WARNING =
  'WARNING: DATABASE_RLS_MODE=shadow in production: the application connects as the table owner, so row-level security does NOT protect any laboratory\'s data from a missed organization predicate. Shadow mode is for diagnosis only; use DATABASE_RLS_MODE=enforced (the default) with DATABASE_URL as calibra_app and DATABASE_OWNER_URL as the owner, see DEPLOYMENT.md ("Row-level security").';

/**
 * Runs the check on `executor` (default: the application's database) in `mode`
 * (default: DATABASE_RLS_MODE). In `enforced` mode it also needs
 * DATABASE_OWNER_URL (checked before any query) and checks the system path's own
 * connection (`systemExecutor`, default: `getSystemDb()`). Throws a `ConfigError`
 * naming the variable at fault when the process must not start, so `failFast` /
 * `failFastAsync` print it and exit.
 */
export async function assertRlsStartup(
  options: {
    executor?: Pick<OrgExecutor, "execute">;
    systemExecutor?: Pick<OrgExecutor, "execute">;
    mode?: RlsMode;
    /** Default: DATABASE_OWNER_URL. */
    ownerUrl?: string | undefined;
    /** Default: console.warn. */
    warn?: (message: string) => void;
    /** Default: NODE_ENV. */
    production?: boolean;
  } = {},
): Promise<RlsRoleFacts> {
  const config = readDatabaseConfig();
  const mode = options.mode ?? config.rlsMode;
  const ownerUrl = "ownerUrl" in options ? options.ownerUrl : config.ownerUrl;
  const production = options.production ?? config.nodeEnv === "production";
  if (mode === "shadow" && production) {
    (options.warn ?? console.warn)(SHADOW_IN_PRODUCTION_WARNING);
  }
  const missingOwner = rlsOwnerUrlProblem(mode, ownerUrl);
  if (missingOwner !== null) {
    throw new ConfigError("database", [
      { variable: "DATABASE_OWNER_URL", message: missingOwner },
    ]);
  }
  const executor = options.executor ?? (await import("./db.js")).getDb();
  const facts = await readRlsRoleFacts(executor);
  const problem = rlsStartupProblem(facts, mode);
  if (problem !== null) {
    throw new ConfigError("database", [
      {
        variable: mode === "enforced" ? "DATABASE_URL" : "DATABASE_RLS_MODE",
        message: problem,
      },
    ]);
  }
  if (mode === "enforced") {
    const systemExecutor =
      options.systemExecutor ?? (await import("./db.js")).getSystemDb();
    const systemProblem = rlsSystemRoleProblem(
      mode,
      await readRlsRoleFacts(systemExecutor),
    );
    if (systemProblem !== null) {
      throw new ConfigError("database", [
        { variable: "DATABASE_OWNER_URL", message: systemProblem },
      ]);
    }
  }
  return facts;
}
