import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import * as schema from "@calibra-facil/db/schema";
import { normalizeSql, type TenantTables } from "./tenant-sql-analyzer";

// "Reached through an org-scoped read" provenance for the tenant SQL guard.
//
// Most handlers read a row through an organization-scoped query (404 when it
// belongs to another tenant) and then update/read related rows by primary key
// or by a foreign key to that row. Those follow-up statements carry no org
// predicate of their own, but they are safe: they only run for ids that the
// scoped read just returned. The tracker makes that explicit and checkable:
//
//   * every CLEAN (org-scoped) statement records the primary-key values it
//     looked up (`"t"."id" = $n` / `in ($n, ...)`), per table;
//   * a later FLAGGED statement is covered when one of its equality predicates
//     is `"T"."id" = <value>` for a value recorded for T, or `"T"."col" = <value>`
//     where `col` is a foreign key to a table P and <value> was recorded for P.
//
// An unscoped PK access to an id that was never read through a scoped query in
// the same test (the actual cross-tenant hole) is NOT covered and fails.

/** table -> column -> referenced table, derived from schema.ts foreign keys. */
export function deriveForeignKeys(): ReadonlyMap<
  string,
  ReadonlyMap<string, string>
> {
  const result = new Map<string, Map<string, string>>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      const [column] = reference.columns;
      const [foreignColumn] = reference.foreignColumns;
      if (!column || !foreignColumn || reference.columns.length !== 1) continue;
      if (foreignColumn.name !== "id") continue;
      const target = getTableConfig(foreignColumn.table).name;
      const byColumn = result.get(config.name) ?? new Map<string, string>();
      byColumn.set(column.name, target);
      result.set(config.name, byColumn);
    }
  }
  return result;
}

type Equality = { qualifier: string | null; column: string; values: string[] };

const EQUALITY =
  /(?:"(\w+)"\.)?"(\w+)"\s*=\s*\$(\d+)(?![\w$])|(?:"(\w+)"\.)?"(\w+)"\s+in\s+\(((?:\$\d+(?:\s*,\s*)?)+)\)/g;

export function extractEqualities(
  statement: string,
  params: readonly unknown[],
): Equality[] {
  const sql = normalizeSql(statement);
  const at = sql.indexOf(" where ");
  const fromAt = sql.indexOf(" from ");
  // Predicates live after FROM (selects) / WHERE (writes); for simplicity scan
  // everything after the first FROM/WHERE keyword (SET lists carry no `= $n`
  // that matches a key column used for provenance except the keys themselves).
  const region = sql.slice(at === -1 ? Math.max(fromAt, 0) : at);
  const found: Equality[] = [];
  for (const match of region.matchAll(EQUALITY)) {
    const qualifier = match[1] ?? match[4] ?? null;
    const column = match[2] ?? match[5];
    if (!column) continue;
    const placeholders = match[3]
      ? [match[3]]
      : (match[6]?.match(/\d+/g) ?? []);
    const values = placeholders
      .map((n) => params[Number(n) - 1])
      .filter((value) => typeof value === "string" || typeof value === "number")
      .map(String);
    if (values.length > 0) found.push({ qualifier, column, values });
  }
  return found;
}

function resolveTable(
  qualifier: string | null,
  touched: readonly string[],
  known: (table: string) => boolean,
): string | null {
  if (qualifier && (touched.includes(qualifier) || known(qualifier))) {
    return qualifier;
  }
  const [only] = touched;
  return touched.length === 1 && only ? only : null;
}

const WINDOW = 300;

export class ScopedRowTracker {
  private readonly rows = new Map<string, number>();
  private clock = 0;

  constructor(
    private readonly foreignKeys: ReadonlyMap<
      string,
      ReadonlyMap<string, string>
    >,
    private readonly tenant: TenantTables,
  ) {}

  reset(): void {
    this.rows.clear();
    this.clock = 0;
  }

  /** Record the primary keys an org-scoped (clean) statement looked up. */
  record(
    statement: string,
    params: readonly unknown[],
    tenantTables: readonly string[],
  ): void {
    this.clock += 1;
    for (const equality of extractEqualities(statement, params)) {
      if (equality.column !== "id") continue;
      const table = resolveTable(equality.qualifier, tenantTables, (name) =>
        this.tenant.has(name),
      );
      if (!table || !this.tenant.has(table)) continue;
      for (const value of equality.values) {
        this.rows.set(`${table}\u0000${value}`, this.clock);
      }
    }
  }

  private seen(table: string, value: string): boolean {
    const at = this.rows.get(`${table}\u0000${value}`);
    return at !== undefined && this.clock - at <= WINDOW;
  }

  /** True when a flagged statement only touches rows a scoped read returned. */
  covers(
    statement: string,
    params: readonly unknown[],
    tenantTables: readonly string[],
  ): boolean {
    this.clock += 1;
    for (const equality of extractEqualities(statement, params)) {
      const table = resolveTable(equality.qualifier, tenantTables, (name) =>
        this.foreignKeys.has(name),
      );
      if (!table) continue;
      const parent =
        equality.column === "id"
          ? table
          : this.foreignKeys.get(table)?.get(equality.column);
      if (!parent) continue;
      if (equality.values.every((value) => this.seen(parent, value))) {
        return true;
      }
    }
    return false;
  }
}
