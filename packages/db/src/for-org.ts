/**
 * Organization-bound data handle (P2-2, REQ-ORGDB-1).
 *
 * `forOrg(db, organizationId)` returns a handle with the same query surface as
 * Drizzle (`select`, `selectDistinct`, `selectDistinctOn`, `insert`, `update`,
 * `delete`, `transaction`) in which every tenant table (tenancy.ts: a table with
 * `organization_id` / `lab_organization_id`) is scoped to that organization
 * without the caller writing the predicate:
 *
 *   - `select`: the `from()` table gets `<org column> = $org` in the WHERE, ANDed
 *     with whatever `.where()` the caller adds (a later `.where()` replaces the
 *     caller's condition, never the organization's); an inner/left joined tenant
 *     table gets it in its ON clause;
 *   - `update` / `delete`: same WHERE rule; `set()` cannot touch the organization
 *     column, so a row cannot be moved to another organization;
 *   - `insert`: every row gets the organization column; a row addressed to
 *     another organization throws.
 *
 * Global tables (no organization column: `organization`, `user`, `asset_type`...)
 * pass through untouched. Shapes that cannot be scoped fail closed instead of
 * running unscoped: a non-table `from`/join source (subquery, `sql`), right/full/
 * cross/lateral joins, `update ... from`, `insert ... select`.
 *
 * The handle is a thin Proxy over the Drizzle builders, so every query keeps its
 * Drizzle result type. It works on the global `db` and on the `tx` of
 * `db.transaction` alike: `forOrg(tx, organizationId)`, or `o.transaction(...)`
 * for a transaction that stays bound.
 *
 * `forOrgs(db, ids)` binds a bounded SET of organizations (`IN (...)`): for the
 * portal certificate endpoints, which list across every laboratory the signed-in
 * customer user belongs to. It cannot insert.
 */
import { and, eq, getTableColumns, inArray, is, SQL, sql } from "drizzle-orm";
import {
  PgTable,
  type PgColumn,
  type PgDatabase,
  type PgQueryResultHKT,
} from "drizzle-orm/pg-core";
import type * as schema from "./schema";
import { TENANT_COLUMNS } from "./tenancy";

/** What a handle needs from the global `db` or a transaction. */
export type OrgExecutor = Pick<
  PgDatabase<PgQueryResultHKT, typeof schema>,
  | "select"
  | "selectDistinct"
  | "selectDistinctOn"
  | "insert"
  | "update"
  | "delete"
  | "execute"
  | "transaction"
>;

type TransactionConfig = Parameters<OrgExecutor["transaction"]>[1];

type ScopedSurface = Pick<
  OrgExecutor,
  "select" | "selectDistinct" | "selectDistinctOn" | "update" | "delete"
>;

/** Handle bound to ONE organization (reads, writes and inserts). */
export type OrgDb = ScopedSurface &
  Pick<OrgExecutor, "insert"> & {
    readonly organizationId: string;
    /**
     * `pg_advisory_xact_lock(key1, key2)`: serialises concurrent transactions on
     * a pair of keys (e.g. customer and asset). It locks no table and reads no
     * tenant row, so it is the one piece of raw SQL the handle offers. Only
     * meaningful inside `transaction()`.
     */
    advisoryXactLock(key1: number, key2: number): Promise<void>;
    transaction<R>(
      run: (tx: OrgDb) => Promise<R>,
      config?: TransactionConfig,
    ): Promise<R>;
  };

/** Handle bound to a bounded SET of organizations (reads and updates only). */
export type OrgSetDb = ScopedSurface & {
  readonly organizationIds: readonly string[];
  insert(table: PgTable): never;
  transaction<R>(
    run: (tx: OrgSetDb) => Promise<R>,
    config?: TransactionConfig,
  ): Promise<R>;
};

type Scope = { readonly ids: readonly string[] };

const MESSAGE_PREFIX = "forOrg:";

function refuse(what: string): never {
  throw new Error(`${MESSAGE_PREFIX} ${what}`);
}

// --- tenant column lookup ----------------------------------------------------

const tenantColumnCache = new WeakMap<object, PgColumn | null>();

function tenantColumnOf(table: PgTable): PgColumn | null {
  const cached = tenantColumnCache.get(table);
  if (cached !== undefined) return cached;
  const column =
    Object.values(getTableColumns(table)).find((candidate) =>
      TENANT_COLUMNS.includes(candidate.name),
    ) ?? null;
  tenantColumnCache.set(table, column);
  return column;
}

function tenantKeyOf(table: PgTable): string | null {
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    if (TENANT_COLUMNS.includes(column.name)) return key;
  }
  return null;
}

function predicateFor(table: PgTable, scope: Scope): SQL | undefined {
  const column = tenantColumnOf(table);
  if (!column) return undefined;
  const [only] = scope.ids;
  return scope.ids.length === 1 && only !== undefined
    ? eq(column, only)
    : inArray(column, [...scope.ids]);
}

function requireTable(source: unknown, where: string): PgTable {
  if (is(source, PgTable)) return source;
  return refuse(
    `${where} takes a table only (a subquery or raw sql could not be scoped to the organization)`,
  );
}

// --- generic proxy plumbing --------------------------------------------------

type Hook<T extends object> = (proxy: T, target: T) => unknown;

function invoke(target: object, method: string, args: unknown[]): unknown {
  const fn: unknown = Reflect.get(target, method, target);
  if (typeof fn !== "function") {
    return refuse(`${method}() is not available on this builder`);
  }
  return Reflect.apply(fn, target, args);
}

/**
 * A Proxy of a Drizzle builder in which `hooks` replace methods and every other
 * method runs on the real builder. A method that returns the builder itself
 * (Drizzle's chaining) returns the proxy instead, so the hooks survive the chain.
 */
function intercept<T extends object>(
  target: T,
  hooks: ReadonlyMap<string, Hook<T>>,
): T {
  const proxy: T = new Proxy(target, {
    get(_, property) {
      const hook = typeof property === "string" ? hooks.get(property) : null;
      if (hook) return hook(proxy, target);
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args);
        return result === target ? proxy : result;
      };
    },
  });
  return proxy;
}

/**
 * A where/on condition as SQL. Anything else is refused: dropping an unknown
 * condition would silently widen the query.
 */
function asCondition(value: unknown): SQL | undefined {
  if (value === undefined) return undefined;
  if (is(value, SQL)) return value;
  return refuse("a where/on condition must be a drizzle SQL expression");
}

function requireBuilder(value: unknown, what: string): object {
  if (typeof value === "object" && value !== null) return value;
  return refuse(`${what} did not return a query builder`);
}

function blocked(what: string): Hook<object> {
  return () => () => refuse(`${what} is not supported (it cannot be scoped)`);
}

/** `where(condition)` with the organization predicate ANDed in. */
function scopedWhere(base: SQL | undefined): Hook<object> {
  return (proxy, target) => (condition: unknown) => {
    let result: unknown;
    if (typeof condition === "function") {
      result = invoke(target, "where", [
        (aliases: unknown) =>
          and(
            base,
            asCondition(Reflect.apply(condition, undefined, [aliases])),
          ),
      ]);
    } else {
      result = invoke(target, "where", [and(base, asCondition(condition))]);
    }
    return result === target ? proxy : result;
  };
}

// --- select ------------------------------------------------------------------

function scopedJoin(name: string, scope: Scope): Hook<object> {
  return (proxy, target) => (table: unknown, on: unknown) => {
    const joined = requireTable(table, `${name}()`);
    const predicate = predicateFor(joined, scope);
    // The organization goes in the ON clause: for an inner join it filters the
    // joined rows, for a left join it keeps the left row and nulls the other
    // organization's match.
    const scopedOn =
      predicate === undefined
        ? on
        : typeof on === "function"
          ? (aliases: unknown) =>
              and(
                asCondition(Reflect.apply(on, undefined, [aliases])),
                predicate,
              )
          : and(asCondition(on), predicate);
    const result = invoke(target, name, [table, scopedOn]);
    return result === target ? proxy : result;
  };
}

const UNSCOPABLE_JOINS = [
  "rightJoin",
  "fullJoin",
  "crossJoin",
  "innerJoinLateral",
  "leftJoinLateral",
  "crossJoinLateral",
] as const;

function selectQueryHooks(
  base: SQL | undefined,
  scope: Scope,
): ReadonlyMap<string, Hook<object>> {
  const hooks = new Map<string, Hook<object>>([
    ["where", scopedWhere(base)],
    ["innerJoin", scopedJoin("innerJoin", scope)],
    ["leftJoin", scopedJoin("leftJoin", scope)],
  ]);
  for (const name of UNSCOPABLE_JOINS) {
    hooks.set(name, blocked(`${name}()`));
  }
  return hooks;
}

function scopeSelectBuilder(builder: object, scope: Scope): object {
  return intercept(
    builder,
    new Map<string, Hook<object>>([
      [
        "from",
        () => (source: unknown) => {
          const table = requireTable(source, "from()");
          const base = predicateFor(table, scope);
          const query = requireBuilder(
            invoke(builder, "from", [source]),
            "from()",
          );
          // Preset: a query that never calls .where() still carries it.
          if (base) invoke(query, "where", [base]);
          return intercept(query, selectQueryHooks(base, scope));
        },
      ],
    ]),
  );
}

// --- update / delete ---------------------------------------------------------

function scopeUpdateBuilder(
  builder: object,
  table: PgTable,
  scope: Scope,
): object {
  const base = predicateFor(table, scope);
  const key = tenantKeyOf(table);
  return intercept(
    builder,
    new Map<string, Hook<object>>([
      [
        "set",
        () => (values: unknown) => {
          if (
            key !== null &&
            typeof values === "object" &&
            values !== null &&
            key in values
          ) {
            refuse(
              `update cannot set ${key}: a row cannot be moved to another organization`,
            );
          }
          const query = requireBuilder(
            invoke(builder, "set", [values]),
            "set()",
          );
          if (base) invoke(query, "where", [base]);
          return intercept(
            query,
            new Map<string, Hook<object>>([
              ["where", scopedWhere(base)],
              ["from", blocked("update ... from")],
            ]),
          );
        },
      ],
    ]),
  );
}

function scopeDeleteQuery(query: object, table: PgTable, scope: Scope): object {
  const base = predicateFor(table, scope);
  if (base) invoke(query, "where", [base]);
  return intercept(
    query,
    new Map<string, Hook<object>>([["where", scopedWhere(base)]]),
  );
}

// --- insert ------------------------------------------------------------------

function withOrganization(
  row: unknown,
  key: string,
  organizationId: string,
): unknown {
  if (typeof row !== "object" || row === null) {
    return refuse("insert values must be objects");
  }
  const given: unknown = Reflect.get(row, key);
  if (given !== undefined && given !== organizationId) {
    return refuse(
      `insert addressed to another organization (${key} is not the bound organization)`,
    );
  }
  return { ...row, [key]: organizationId };
}

function scopeInsertBuilder(
  builder: object,
  table: PgTable,
  organizationId: string,
): object {
  const key = tenantKeyOf(table);
  return intercept(
    builder,
    new Map<string, Hook<object>>([
      ["select", blocked("insert ... select")],
      [
        "values",
        () => (values: unknown) => {
          if (key === null) return invoke(builder, "values", [values]);
          const scoped = Array.isArray(values)
            ? values.map((row) => withOrganization(row, key, organizationId))
            : withOrganization(values, key, organizationId);
          return invoke(builder, "values", [scoped]);
        },
      ],
    ]),
  );
}

// --- the handles -------------------------------------------------------------
//
// Every member is read from the executor when the handle's member is USED, not
// when the handle is built: a handle is cheap, and it only ever touches the
// executor members the caller actually calls.

function scopedSelect(
  executor: OrgExecutor,
  scope: Scope,
): OrgExecutor["select"] {
  return new Proxy(executor.select, {
    apply: (target, _self, args) =>
      scopeSelectBuilder(
        requireBuilder(Reflect.apply(target, executor, args), "select()"),
        scope,
      ),
  });
}

function scopedSelectDistinct(
  executor: OrgExecutor,
  scope: Scope,
): OrgExecutor["selectDistinct"] {
  return new Proxy(executor.selectDistinct, {
    apply: (target, _self, args) =>
      scopeSelectBuilder(
        requireBuilder(
          Reflect.apply(target, executor, args),
          "selectDistinct()",
        ),
        scope,
      ),
  });
}

function scopedSelectDistinctOn(
  executor: OrgExecutor,
  scope: Scope,
): OrgExecutor["selectDistinctOn"] {
  return new Proxy(executor.selectDistinctOn, {
    apply: (target, _self, args) =>
      scopeSelectBuilder(
        requireBuilder(
          Reflect.apply(target, executor, args),
          "selectDistinctOn()",
        ),
        scope,
      ),
  });
}

function scopedUpdate(
  executor: OrgExecutor,
  scope: Scope,
): OrgExecutor["update"] {
  return new Proxy(executor.update, {
    apply: (target, _self, args) =>
      scopeUpdateBuilder(
        requireBuilder(Reflect.apply(target, executor, args), "update()"),
        requireTable(args[0], "update()"),
        scope,
      ),
  });
}

function scopedDelete(
  executor: OrgExecutor,
  scope: Scope,
): OrgExecutor["delete"] {
  return new Proxy(executor.delete, {
    apply: (target, _self, args) =>
      scopeDeleteQuery(
        requireBuilder(Reflect.apply(target, executor, args), "delete()"),
        requireTable(args[0], "delete()"),
        scope,
      ),
  });
}

function scopedInsert(
  executor: OrgExecutor,
  organizationId: string,
): OrgExecutor["insert"] {
  return new Proxy(executor.insert, {
    apply: (target, _self, args) =>
      scopeInsertBuilder(
        requireBuilder(Reflect.apply(target, executor, args), "insert()"),
        requireTable(args[0], "insert()"),
        organizationId,
      ),
  });
}

async function advisoryXactLock(
  executor: OrgExecutor,
  key1: number,
  key2: number,
): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(${key1}, ${key2})`);
}

function bindOne(executor: OrgExecutor, organizationId: string): OrgDb {
  const scope: Scope = { ids: [organizationId] };
  return {
    organizationId,
    get select() {
      return scopedSelect(executor, scope);
    },
    get selectDistinct() {
      return scopedSelectDistinct(executor, scope);
    },
    get selectDistinctOn() {
      return scopedSelectDistinctOn(executor, scope);
    },
    get update() {
      return scopedUpdate(executor, scope);
    },
    get delete() {
      return scopedDelete(executor, scope);
    },
    get insert() {
      return scopedInsert(executor, organizationId);
    },
    advisoryXactLock: (key1, key2) => advisoryXactLock(executor, key1, key2),
    transaction: (run, config) =>
      executor.transaction((tx) => run(bindOne(tx, organizationId)), config),
  };
}

function bindSet(
  executor: OrgExecutor,
  organizationIds: readonly string[],
): OrgSetDb {
  const scope: Scope = { ids: organizationIds };
  return {
    organizationIds,
    get select() {
      return scopedSelect(executor, scope);
    },
    get selectDistinct() {
      return scopedSelectDistinct(executor, scope);
    },
    get selectDistinctOn() {
      return scopedSelectDistinctOn(executor, scope);
    },
    get update() {
      return scopedUpdate(executor, scope);
    },
    get delete() {
      return scopedDelete(executor, scope);
    },
    insert: () =>
      refuse(
        "forOrgs() cannot insert: a row needs exactly one organization, use forOrg()",
      ),
    transaction: (run, config) =>
      executor.transaction((tx) => run(bindSet(tx, organizationIds)), config),
  };
}

/**
 * Handle bound to one organization. `executor` is the global `db` or the `tx`
 * of a `db.transaction`.
 */
export function forOrg(executor: OrgExecutor, organizationId: string): OrgDb {
  if (organizationId.length === 0) {
    return refuse("organizationId must not be empty");
  }
  return bindOne(executor, organizationId);
}

/**
 * Handle bound to a bounded set of organizations (reads/updates/deletes with
 * `IN (...)`; no insert). An empty set matches no row.
 */
export function forOrgs(
  executor: OrgExecutor,
  organizationIds: readonly string[],
): OrgSetDb {
  return bindSet(executor, [...new Set(organizationIds)]);
}
