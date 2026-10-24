// Start-up check of row-level security (roadmap P2-3, decision Q15).
//
// Migration 0123 enables RLS on every tenant table. A role that owns the tables
// (not FORCEd), a superuser and a BYPASSRLS role are exempt, so the application
// behaves as before while it connects as one of them ("shadow" mode). Any other
// role (a member of `calibra_app`) is bound by the policies, and an application
// that was not made to name its organization on every statement would silently
// see nothing. The role split is a deliberate deploy step (DEPLOYMENT.md), not
// something a connection string typo can do by accident, so:
//
//   - `shadow` (DATABASE_RLS_MODE, the default): start-up REFUSES a role that RLS
//     binds, with the reason and the fix;
//   - `enforced`: the owner has done the role split and says so; any role is accepted,
//     but `DATABASE_OWNER_URL` (the system path: the connection of the table
//     owner, `systemDb`) MUST be set too (Q40). Without it every system-path
//     statement (identity, the cross-laboratory listings of the sweeps, the
//     lookup of a message's laboratory) would run as the role RLS binds and
//     silently see nothing, so the process refuses to start instead.
//
// Before migration 0123 no table has RLS enabled and the check passes.
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
    ) as subject_to_rls
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
  };
}

/** The refusal message, or null when the role may start in `mode`. */
export function rlsStartupProblem(
  facts: RlsRoleFacts,
  mode: RlsMode,
): string | null {
  if (mode === "enforced") return null;
  if (!facts.rlsEnabled || !facts.subjectToRls) return null;
  return `connected as "${facts.role}", which is subject to row-level security (migration 0123: it neither owns the tenant tables nor is superuser/BYPASSRLS), so statements without an organization would silently match no row. Connect as the owner of the tables; set DATABASE_RLS_MODE=enforced only after the role split, see DEPLOYMENT.md ("Row-level security").`;
}

/**
 * The refusal message when `enforced` mode has no owner connection for the
 * system path, or null. Pure, so it needs no database.
 */
export function rlsOwnerUrlProblem(
  mode: RlsMode,
  ownerUrl: string | undefined,
): string | null {
  if (mode !== "enforced" || ownerUrl) return null;
  return 'DATABASE_RLS_MODE=enforced needs DATABASE_OWNER_URL, the connection of the table owner used by the system path (identity, cross-laboratory sweeps, the lookup of a message\'s laboratory): without it those statements would run as the restricted role and silently see nothing. Set DATABASE_OWNER_URL, see DEPLOYMENT.md ("Row-level security").';
}

/**
 * Runs the check on `executor` (default: the application's database) in `mode`
 * (default: DATABASE_RLS_MODE). Throws a `ConfigError` naming DATABASE_RLS_MODE
 * when the role must not start (or `enforced` has no `DATABASE_OWNER_URL`), so
 * `failFast` / `failFastAsync` print it and exit.
 */
export async function assertRlsStartup(
  options: {
    executor?: Pick<OrgExecutor, "execute">;
    mode?: RlsMode;
    /** Default: DATABASE_OWNER_URL. */
    ownerUrl?: string | undefined;
  } = {},
): Promise<RlsRoleFacts> {
  const config = readDatabaseConfig();
  const mode = options.mode ?? config.rlsMode;
  const ownerUrl = "ownerUrl" in options ? options.ownerUrl : config.ownerUrl;
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
      { variable: "DATABASE_RLS_MODE", message: problem },
    ]);
  }
  return facts;
}
