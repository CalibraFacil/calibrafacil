import { describe, expect, it } from "vitest";
import { and, eq, is, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { alias, getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import { forOrg, forOrgs } from "./for-org";
import * as schema from "./schema";
import { listTenancy, TENANT_COLUMNS } from "./tenancy";

// A connection-less drizzle instance: the builders compile to SQL (`toSQL()`)
// without ever reaching a database. The real-database behaviour (statements
// that execute, transactions) is covered by apps/api/src/lib/for-org.int.spec.ts.
const mock = drizzle.mock({ schema });
const ORG = "lab-a";

const { asset, customer, assetType, calibrationJob, organization } = schema;

function sqlOf(query: { toSQL(): { sql: string; params: unknown[] } }) {
  const { sql: text, params } = query.toSQL();
  return { text: text.replace(/\s+/g, " "), params };
}

describe("forOrg: select", () => {
  it("REQ-ORGDB-1: adds the organization predicate to a select without a where", () => {
    const o = forOrg(mock, ORG);
    const { text, params } = sqlOf(o.select({ id: asset.id }).from(asset));
    expect(text).toContain('"asset"."lab_organization_id" = $1');
    expect(params).toEqual([ORG]);
  });

  it("REQ-ORGDB-1: ANDs the predicate with the caller's where, however the where is spelled", () => {
    const o = forOrg(mock, ORG);
    const plain = sqlOf(
      o.select({ id: asset.id }).from(asset).where(eq(asset.id, 7)),
    );
    expect(plain.text).toContain('"asset"."lab_organization_id" = $1');
    expect(plain.text).toContain('"asset"."id" = $2');
    expect(plain.params).toEqual([ORG, 7]);

    const undefinedWhere = sqlOf(
      o.select({ id: asset.id }).from(asset).where(undefined),
    );
    expect(undefinedWhere.text).toContain('"asset"."lab_organization_id" = $1');

    const callback = sqlOf(
      o
        .select({ id: asset.id })
        .from(asset)
        .where(() => eq(asset.id, 9)),
    );
    expect(callback.text).toContain('"asset"."lab_organization_id" = $1');
    expect(callback.params).toEqual([ORG, 9]);
  });

  it("REQ-ORGDB-1: keeps the predicate through limit/orderBy/$dynamic and a second where", () => {
    const o = forOrg(mock, ORG);
    const query = o
      .select({ id: asset.id })
      .from(asset)
      .$dynamic()
      .where(eq(asset.id, 1))
      .where(eq(asset.id, 2))
      .orderBy(asset.id)
      .limit(3);
    const { text, params } = sqlOf(query);
    expect(text).toContain('"asset"."lab_organization_id" = $1');
    expect(params).toEqual([ORG, 2, 3]);
  });

  it("REQ-ORGDB-1: scopes a tenant table on the ON of an inner/left join, leaves a global table alone", () => {
    const o = forOrg(mock, ORG);
    const { text, params } = sqlOf(
      o
        .select({ id: asset.id, owner: customer.name, type: assetType.name })
        .from(asset)
        .innerJoin(customer, eq(customer.id, asset.customerId))
        .leftJoin(assetType, eq(assetType.id, asset.assetTypeId))
        .where(eq(asset.id, 5)),
    );
    expect(text).toMatch(
      /inner join "customer" on \("customer"\."id" = "asset"\."customer_id" and "customer"\."lab_organization_id" = \$\d+\)/,
    );
    expect(text).not.toMatch(/"asset_type"\."\w*organization_id"/);
    expect(params.filter((param) => param === ORG)).toHaveLength(2);
  });

  it("REQ-ORGDB-1: a tenant column named organization_id is used on tables that have that spelling", () => {
    const o = forOrg(mock, ORG);
    const { text } = sqlOf(
      o.select({ id: calibrationJob.id }).from(calibrationJob),
    );
    expect(text).toContain('"calibration_job"."organization_id" = $1');
  });

  it("REQ-ORGDB-1: a global table (no organization column) stays unscoped", () => {
    const o = forOrg(mock, ORG);
    const { text, params } = sqlOf(
      o.select({ id: organization.id }).from(organization),
    );
    expect(text).not.toContain("where");
    expect(params).toEqual([]);
  });

  it("REQ-ORGDB-1: refuses a join that cannot be scoped (right/full/cross) and a non-table source", () => {
    const o = forOrg(mock, ORG);
    const base = o.select({ id: asset.id }).from(asset);
    expect(() =>
      base.rightJoin(customer, eq(customer.id, asset.customerId)),
    ).toThrow(/forOrg/);
    expect(() =>
      base.fullJoin(customer, eq(customer.id, asset.customerId)),
    ).toThrow(/forOrg/);
    expect(() => base.crossJoin(customer)).toThrow(/forOrg/);
    expect(() => o.select().from(sql`generate_series(1, 3)`)).toThrow(/forOrg/);
  });

  it("REQ-ORGDB-1: scopes a table alias with the alias name", () => {
    const o = forOrg(mock, ORG);
    const other = alias(asset, "other_asset");
    const { text } = sqlOf(o.select({ id: other.id }).from(other));
    expect(text).toContain('"other_asset"."lab_organization_id" = $1');
  });

  it("REQ-ORGDB-1: a subquery built from the handle carries its own predicate", () => {
    const o = forOrg(mock, ORG);
    const inner = o
      .select({ id: calibrationJob.id })
      .from(calibrationJob)
      .where(eq(calibrationJob.assetId, asset.id));
    const { text, params } = sqlOf(
      o
        .select({ id: asset.id })
        .from(asset)
        .where(and(sql`exists (${inner})`)),
    );
    expect(text).toContain('"calibration_job"."organization_id" = $');
    expect(params.filter((param) => param === ORG)).toHaveLength(2);
  });

  it("REQ-ORGDB-1: selectDistinct is scoped like select", () => {
    const o = forOrg(mock, ORG);
    const { text } = sqlOf(
      o.selectDistinct({ name: customer.name }).from(customer),
    );
    expect(text).toContain("select distinct");
    expect(text).toContain('"customer"."lab_organization_id" = $1');
  });
});

describe("forOrg: update and delete", () => {
  it("REQ-ORGDB-1: update carries the predicate with and without a where", () => {
    const o = forOrg(mock, ORG);
    const bare = sqlOf(o.update(asset).set({ name: "x" }));
    expect(bare.text).toContain('"lab_organization_id" = $');
    expect(bare.params).toContain(ORG);

    const withWhere = sqlOf(
      o.update(asset).set({ name: "x" }).where(eq(asset.id, 4)),
    );
    expect(withWhere.text).toContain('"lab_organization_id" = $');
    expect(withWhere.text).toContain('"id" = $');
    expect(withWhere.params).toContain(ORG);
    expect(withWhere.params).toContain(4);
  });

  it("REQ-ORGDB-1: update cannot move a row to another organization", () => {
    const o = forOrg(mock, ORG);
    expect(() => o.update(asset).set({ labOrganizationId: "lab-b" })).toThrow(
      /forOrg/,
    );
  });

  it("REQ-ORGDB-1: update ... from is refused (the joined table could not be scoped)", () => {
    const o = forOrg(mock, ORG);
    expect(() => o.update(asset).set({ name: "x" }).from(customer)).toThrow(
      /forOrg/,
    );
  });

  it("REQ-ORGDB-1: delete carries the predicate with and without a where", () => {
    const o = forOrg(mock, ORG);
    const bare = sqlOf(o.delete(asset));
    expect(bare.text).toContain('"lab_organization_id" = $1');
    const withWhere = sqlOf(o.delete(asset).where(eq(asset.id, 8)));
    expect(withWhere.text).toContain('"lab_organization_id" = $1');
    expect(withWhere.params).toEqual([ORG, 8]);
  });
});

describe("forOrg: insert", () => {
  const base = {
    unitId: 1,
    customerId: 2,
    assetTypeId: 3,
    name: "Balanca",
    serialNumber: "SN-1",
    tag: "T-1",
  };

  // Drizzle types the column as required, so a row without it can only come from
  // a caller that dropped the key at runtime: the handle fills it in.
  function rowWithoutOrganization(tag: string) {
    const row = { ...base, tag, labOrganizationId: "dropped" };
    Reflect.deleteProperty(row, "labOrganizationId");
    return row;
  }

  it("REQ-ORGDB-1: sets the organization on a row that does not carry it", () => {
    const o = forOrg(mock, ORG);
    const { params } = sqlOf(
      o.insert(asset).values(rowWithoutOrganization("T-1")),
    );
    expect(params).toContain(ORG);
  });

  it("REQ-ORGDB-1: sets the organization on every row of a batch", () => {
    const o = forOrg(mock, ORG);
    const { params } = sqlOf(
      o
        .insert(asset)
        .values([
          rowWithoutOrganization("T-1"),
          { ...base, tag: "T-2", labOrganizationId: ORG },
        ]),
    );
    expect(params.filter((param) => param === ORG)).toHaveLength(2);
  });

  it("REQ-ORGDB-1: refuses a row addressed to another organization", () => {
    const o = forOrg(mock, ORG);
    expect(() =>
      o.insert(asset).values({ ...base, labOrganizationId: "lab-b" }),
    ).toThrow(/forOrg/);
    expect(() =>
      o.insert(asset).values([{ ...base, labOrganizationId: "lab-b" }]),
    ).toThrow(/forOrg/);
  });

  it("REQ-ORGDB-1: refuses insert ... select (rows would bypass the organization)", () => {
    const o = forOrg(mock, ORG);
    expect(() => o.insert(asset).select(mock.select().from(asset))).toThrow(
      /forOrg/,
    );
  });

  it("REQ-ORGDB-1: a global table is inserted untouched", () => {
    const o = forOrg(mock, ORG);
    const { params } = sqlOf(
      o.insert(assetType).values({
        name: "Tipo",
        slug: "tipo",
        definition: [],
      }),
    );
    expect(params).not.toContain(ORG);
  });
});

describe("forOrgs: a bounded set of laboratories", () => {
  it("REQ-ORGDB-1: scopes with IN over the given organizations and refuses inserts", () => {
    const o = forOrgs(mock, ["lab-a", "lab-b"]);
    const { text, params } = sqlOf(
      o.select({ id: asset.id }).from(asset).where(eq(asset.id, 1)),
    );
    expect(text).toMatch(/"asset"\."lab_organization_id" in \(\$1, \$2\)/);
    expect(params).toEqual(["lab-a", "lab-b", 1]);
    expect(() => o.insert(asset)).toThrow(/forOrg/);
  });

  it("REQ-ORGDB-1: an empty set matches nothing instead of everything", () => {
    const o = forOrgs(mock, []);
    const { text } = sqlOf(o.select({ id: asset.id }).from(asset));
    expect(text).toMatch(/where .*(false|1 = 0)/);
  });
});

describe("forOrg: transactions", () => {
  it("REQ-ORGDB-1: transaction hands the callback a handle bound to the same organization", async () => {
    const calls: string[] = [];
    // The mock has no connection, so `transaction` is replaced by one that just
    // runs the callback with the executor, like drizzle does with its `tx`.
    const fake = new Proxy(mock, {
      get(target, property) {
        if (property === "transaction") {
          return async (run: (tx: typeof mock) => Promise<unknown>) => {
            calls.push("begin");
            return run(target);
          };
        }
        return Reflect.get(target, property);
      },
    });
    const o = forOrg(fake, ORG);
    const text = await o.transaction(async (tx) => {
      expect(tx.organizationId).toBe(ORG);
      return sqlOf(tx.select({ id: asset.id }).from(asset)).text;
    });
    expect(calls).toEqual(["begin"]);
    expect(text).toContain('"asset"."lab_organization_id" = $1');
  });
});

describe("forOrg: executor access", () => {
  it("REQ-ORGDB-1: a handle only reads the executor members the caller uses", () => {
    const read: string[] = [];
    const watched = new Proxy(mock, {
      get(target, property) {
        if (typeof property === "string") read.push(property);
        return Reflect.get(target, property);
      },
    });
    const o = forOrg(watched, ORG);
    expect(read).toEqual([]);
    sqlOf(o.select({ id: asset.id }).from(asset));
    expect(read).toContain("select");
    expect(read).not.toContain("update");
    expect(read).not.toContain("delete");
    expect(read).not.toContain("insert");
  });

  it("REQ-ORGDB-1: advisoryXactLock runs pg_advisory_xact_lock on the executor", async () => {
    const statements: SQL[] = [];
    const recording = new Proxy(mock, {
      get(target, property) {
        if (property === "execute") {
          return async (statement: SQL) => {
            statements.push(statement);
          };
        }
        return Reflect.get(target, property);
      },
    });
    await forOrg(recording, ORG).advisoryXactLock(7, 9);
    const [statement] = statements;
    if (!statement) throw new Error("nothing was executed");
    const query = new PgDialect().sqlToQuery(statement);
    expect(query.sql).toContain("pg_advisory_xact_lock($1, $2)");
    expect(query.params).toEqual([7, 9]);
  });
});

describe("forOrg: coverage of the data model", () => {
  it("REQ-ORGDB-1: every tenant table of the schema can be scoped (it has exactly one organization column)", () => {
    const o = forOrg(mock, ORG);
    let scoped = 0;
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const config = getTableConfig(value);
      const tenantColumns = config.columns.filter((column) =>
        TENANT_COLUMNS.includes(column.name),
      );
      if (tenantColumns.length === 0) continue;
      expect(tenantColumns, config.name).toHaveLength(1);
      const { text } = sqlOf(o.delete(value));
      expect(text, config.name).toContain(`"${tenantColumns[0]?.name}" = $1`);
      scoped += 1;
    }
    expect(scoped).toBe(
      listTenancy().filter((table) => table.tenantColumns.length > 0).length,
    );
  });
});
