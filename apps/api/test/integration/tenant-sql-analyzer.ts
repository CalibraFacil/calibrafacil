import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import * as schema from "@calibra-facil/db/schema";

// Pure statement analysis for the tenant SQL guard (no database, no vitest
// runtime). See tenant-sql-guard.ts for how statements are observed/enforced.

/** Column names that scope a row to a laboratory tenant. */
export const TENANT_COLUMNS = ["organization_id", "lab_organization_id"];

/** table name -> the tenant columns it carries (derived from schema.ts). */
export type TenantTables = ReadonlyMap<string, readonly string[]>;

export function deriveTenantTables(): {
  tenant: TenantTables;
  untenanted: string[];
} {
  const tenant = new Map<string, readonly string[]>();
  const untenanted: string[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    const columns = config.columns
      .map((column) => column.name)
      .filter((name) => TENANT_COLUMNS.includes(name));
    if (columns.length > 0) tenant.set(config.name, columns);
    else untenanted.push(config.name);
  }
  return { tenant, untenanted: untenanted.toSorted() };
}

export type StatementKind = "select" | "insert" | "update" | "delete";

export type StatementFinding = {
  kind: StatementKind;
  tables: string[];
  reason: "no-org-predicate" | "insert-without-org-column";
};

export type StatementAnalysis = {
  /** Tenant tables the statement touches (empty -> out of scope). */
  tenantTables: string[];
  findings: StatementFinding[];
};

/** Lower-case, drop comments and string-literal contents, collapse whitespace. */
export function normalizeSql(statement: string): string {
  return statement
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const IDENT = String.raw`"?(?:\w+)"?`;
const TABLE_REF = new RegExp(
  String.raw`\b(from|join|update|into)\s+(?:only\s+)?(?:${IDENT}\.)?"?(\w+)"?`,
  "g",
);
const INSERT_TARGET = new RegExp(
  String.raw`\binsert into\s+(?:${IDENT}\.)?"?(\w+)"?\s*(\([^)]*\))?`,
  "g",
);

// organization column compared against a parameter / literal / list / subquery,
// in either operand order. `set "organization_id" = $1` has the same shape, so
// the region handed to this regex must not contain a SET list.
const TENANT_COL = String.raw`(?:${IDENT}\.)?"?(?:${TENANT_COLUMNS.join("|")})"?`;
const RHS = String.raw`(?:\$\d+|\(|any\b|'|\d)`;
const ORG_PREDICATE = new RegExp(
  `${TENANT_COL}\\s*(?:=|<>|!=|\\bin\\b|\\bis not distinct from\\b)\\s*${RHS}|${RHS}\\s*=\\s*${TENANT_COL}(?![\\w"])`,
);

function leadingKeyword(sql: string): string {
  return /^\(?\s*(\w+)/.exec(sql)?.[1] ?? "";
}

function predicateRegion(kind: StatementKind, sql: string): string {
  if (kind === "update" || kind === "delete") {
    const at = sql.indexOf(" where ");
    return at === -1 ? "" : sql.slice(at);
  }
  const at = sql.indexOf(" from ");
  return at === -1 ? sql : sql.slice(at);
}

export function analyzeStatement(
  statement: string,
  tenant: TenantTables,
): StatementAnalysis {
  const sql = normalizeSql(statement);
  const keyword = leadingKeyword(sql);
  const tenantTables = new Set<string>();
  const findings: StatementFinding[] = [];

  // INSERT targets: the column list must carry the tenant column.
  for (const match of sql.matchAll(INSERT_TARGET)) {
    const table = match[1];
    if (!table) continue;
    const columns = tenant.get(table);
    if (!columns) continue;
    tenantTables.add(table);
    const list = match[2] ?? "";
    if (!columns.some((column) => list.includes(`"${column}"`))) {
      findings.push({
        kind: "insert",
        tables: [table],
        reason: "insert-without-org-column",
      });
    }
  }

  // Tables read or modified (FROM / JOIN / UPDATE targets; DELETE FROM).
  const touched = new Set<string>();
  for (const match of sql.matchAll(TABLE_REF)) {
    const [, clause, table] = match;
    if (!table || clause === "into" || !tenant.has(table)) continue;
    touched.add(table);
    tenantTables.add(table);
  }

  if (touched.size > 0) {
    const kind: StatementKind =
      keyword === "update" || keyword === "delete" ? keyword : "select";
    const region = predicateRegion(kind, sql);
    if (!ORG_PREDICATE.test(region)) {
      findings.push({
        kind: keyword === "insert" ? "insert" : kind,
        tables: [...touched].toSorted(),
        reason: "no-org-predicate",
      });
    }
  }

  return { tenantTables: [...tenantTables].toSorted(), findings };
}
