import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, runInTransactionScope } from "@calibra-facil/db";
import { forOrg, setTransactionOrganization } from "@calibra-facil/db/for-org";
import { rlsTables } from "@calibra-facil/db/rls-sql";
import {
  asset,
  calibrationJob,
  certificateInput,
  customer,
  jobAuditLog,
  organization,
  serviceOrder,
} from "@calibra-facil/db/schema";
import { truncateAll } from "../../test/integration/db";
import {
  seedTenant,
  seedTenantChildren,
  type Tenant,
} from "../../test/integration/tenancy-fixture";
import { openAppRoleDb, sqlStateOf } from "../../test/integration/rls";

// Real-database proof of the row-level-security policies (migration 0123,
// roadmap P2-3). The global `db` is the test superuser, which no policy binds
// (it stands for the owner: the system path, migrations); `openAppRoleDb()`
// connects as `calibra_app`, which is bound by the `tenant_isolation` policies.

const A = "lab-a";
const B = "lab-b";

/** The tables the criteria name, with their organization column. */
const REPRESENTATIVE = [
  { name: "calibration_job", column: "organization_id" },
  { name: "certificate_input", column: "organization_id" },
  { name: "customer", column: "lab_organization_id" },
  { name: "asset", column: "lab_organization_id" },
  { name: "service_order", column: "organization_id" },
  { name: "job_audit_log", column: "organization_id" },
] as const;

const SPARE_CLIENTS = ["client-spare-1", "client-spare-2", "client-spare-3"];

type Rows = Array<Record<string, unknown>>;

function rowsOf(result: unknown): Rows {
  if (Array.isArray(result)) return result;
  if (typeof result === "object" && result !== null) {
    const rows: unknown = Reflect.get(result, "rows");
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

function countOf(result: unknown): number {
  const [row] = rowsOf(result);
  const value: unknown = row?.count;
  return typeof value === "number" ? value : Number(value);
}

async function seedTwoTenants(): Promise<{ a: Tenant; b: Tenant }> {
  const a = await seedTenant(A);
  const b = await seedTenant(B);
  for (const tenant of [a, b]) {
    await seedTenantChildren(tenant);
    await db.insert(certificateInput).values({
      organizationId: tenant.orgId,
      jobId: tenant.jobId,
      schemaVersion: 1,
      input: {},
      sha256: `sha-${tenant.orgId}`,
      layoutKey: "default",
      layoutVersion: "1",
    });
  }
  // CLIENT organizations for the customers the tests insert as calibra_app
  // (a customer points at its portal organization). `organization` is global.
  await db.insert(organization).values(
    SPARE_CLIENTS.map((id) => ({
      id,
      name: id,
      slug: id,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      type: "CLIENT" as const,
      status: "ACTIVE" as const,
    })),
  );
  return { a, b };
}

/** Rows of `table` as seen by the owner, per organization column value. */
async function ownerCount(table: string, column: string, org: string) {
  const result = await db.execute(
    sql`select count(*)::int as count from ${sql.identifier(table)} where ${sql.identifier(column)} = ${org}`,
  );
  return countOf(result);
}

describe("row-level security, shadow mode", () => {
  let tenants: { a: Tenant; b: Tenant };

  beforeEach(async () => {
    await truncateAll();
    tenants = await seedTwoTenants();
  });

  it("REQ-RLS-2 [HIGH RISK]: as the owner (today's production connection) the policies change nothing: both laboratories stay fully visible and writable", async () => {
    for (const { name, column } of REPRESENTATIVE) {
      expect(await ownerCount(name, column, A), name).toBeGreaterThan(0);
      expect(await ownerCount(name, column, B), name).toBeGreaterThan(0);
    }
    // RLS is enabled on the table, but the owner is not bound: no FORCE.
    const flags = rowsOf(
      await db.execute(
        sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'customer' and relnamespace = 'public'::regnamespace`,
      ),
    );
    expect(flags).toEqual([
      { relrowsecurity: true, relforcerowsecurity: false },
    ]);
    // A write across the organizations, unscoped, as the owner.
    const updated = await db
      .update(customer)
      .set({ name: "renamed by the owner" })
      .returning({ id: customer.id });
    expect(updated.length).toBeGreaterThanOrEqual(2);
  });

  it("REQ-RLS-1: every tenant table has RLS enabled (not forced) and the tenant_isolation policy for calibra_app", async () => {
    const policies = rowsOf(
      await db.execute(
        sql`select tablename, roles::text as roles, cmd from pg_policies where schemaname = 'public' and policyname = 'tenant_isolation'`,
      ),
    );
    const flags = rowsOf(
      await db.execute(
        sql`select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`,
      ),
    );
    const expected = rlsTables().map((entry) => entry.table);
    expect(policies.map((row) => row.tablename).sort()).toEqual(
      [...expected].sort(),
    );
    for (const row of policies) {
      expect(row.roles, String(row.tablename)).toBe("{calibra_app}");
      expect(row.cmd, String(row.tablename)).toBe("ALL");
    }
    const enabled = flags
      .filter((row) => row.relrowsecurity === true)
      .map((row) => row.relname)
      .sort();
    expect(enabled).toEqual([...expected].sort());
    expect(flags.filter((row) => row.relforcerowsecurity === true)).toEqual([]);
  });

  it("REQ-RLS-3 [HIGH RISK]: as calibra_app with org A set, rows of org B are invisible on every representative table, and every tenant table", async () => {
    const app = openAppRoleDb();
    await app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, A);
      for (const { name, column } of REPRESENTATIVE) {
        const own = countOf(
          await tx.execute(
            sql`select count(*)::int as count from ${sql.identifier(name)}`,
          ),
        );
        expect(own, `${name}: A's rows`).toBe(
          await ownerCount(name, column, A),
        );
        expect(own, name).toBeGreaterThan(0);
        const foreign = countOf(
          await tx.execute(
            sql`select count(*)::int as count from ${sql.identifier(name)} where ${sql.identifier(column)} = ${B}`,
          ),
        );
        expect(foreign, `${name}: B's rows`).toBe(0);
      }
      // Every tenant table, not just the named ones: nothing of B leaks.
      for (const { table, column } of rlsTables()) {
        const foreign = countOf(
          await tx.execute(
            sql`select count(*)::int as count from ${sql.identifier(table)} where ${sql.identifier(column)} is distinct from ${A}`,
          ),
        );
        expect(foreign, table).toBe(0);
      }
    });
  });

  it("REQ-RLS-3 [HIGH RISK]: with org A set, writing a row of org B is refused (WITH CHECK), and updating or deleting B's rows touches none", async () => {
    const app = openAppRoleDb();
    const { b } = tenants;

    const insertForeign = app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, A);
      await tx.insert(customer).values({
        labOrganizationId: B,
        authOrganizationId: "client-spare-1",
        name: "intruder",
        taxId: "99",
      });
    });
    // 42501: new row violates row-level security policy.
    expect(await sqlStateOf(insertForeign)).toBe("42501");

    // Moving an own row to the other organization is refused too (WITH CHECK
    // applies to the new row of an UPDATE).
    const moveOwn = app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, A);
      await tx
        .update(customer)
        .set({ labOrganizationId: B })
        .where(eq(customer.id, tenants.a.customerId));
    });
    expect(await sqlStateOf(moveOwn)).toBe("42501");

    await app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, A);
      const updated = await tx
        .update(calibrationJob)
        .set({ updatedAt: new Date() })
        .where(eq(calibrationJob.id, b.jobId))
        .returning({ id: calibrationJob.id });
      expect(updated).toEqual([]);
      const deleted = await tx
        .delete(asset)
        .where(eq(asset.id, b.assetId))
        .returning({ id: asset.id });
      expect(deleted).toEqual([]);
      const touchedOrders = await tx
        .update(serviceOrder)
        .set({ claimedDefect: "tampered" })
        .where(eq(serviceOrder.id, b.serviceOrderId))
        .returning({ id: serviceOrder.id });
      expect(touchedOrders).toEqual([]);
    });

    // Nothing of B changed, as the owner sees it.
    const [job] = await db
      .select({ id: calibrationJob.id })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, b.jobId));
    expect(job?.id).toBe(b.jobId);
    expect(await ownerCount("asset", "lab_organization_id", B)).toBeGreaterThan(
      0,
    );
    const [order] = await db
      .select({ claimedDefect: serviceOrder.claimedDefect })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, b.serviceOrderId));
    expect(order?.claimedDefect).toBe("Nao liga");
  });

  it("REQ-RLS-3 [HIGH RISK]: with org A set, an own-organization write goes through", async () => {
    const app = openAppRoleDb();
    const inserted = await app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, A);
      return tx
        .insert(customer)
        .values({
          labOrganizationId: A,
          authOrganizationId: "client-spare-1",
          name: "own",
          taxId: "55",
        })
        .returning({ id: customer.id });
    });
    expect(inserted).toHaveLength(1);
    expect(await ownerCount("customer", "lab_organization_id", A)).toBe(2);
  });

  it("REQ-RLS-3 [HIGH RISK]: with no organization set, nothing is visible and nothing can be written (fail closed)", async () => {
    const app = openAppRoleDb();
    for (const { name } of REPRESENTATIVE) {
      const visible = countOf(
        await app.db.execute(
          sql`select count(*)::int as count from ${sql.identifier(name)}`,
        ),
      );
      expect(visible, name).toBe(0);
    }
    for (const { table } of rlsTables()) {
      const visible = countOf(
        await app.db.execute(
          sql`select count(*)::int as count from ${sql.identifier(table)}`,
        ),
      );
      expect(visible, table).toBe(0);
    }
    const insert = app.db.insert(customer).values({
      labOrganizationId: A,
      authOrganizationId: "client-spare-2",
      name: "nowhere",
      taxId: "77",
    });
    expect(await sqlStateOf(insert)).toBe("42501");
    // The same with an empty setting (what a connection reads back after a
    // transaction that once set it): '' matches no row either.
    await app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, "");
      const visible = countOf(
        await tx.execute(sql`select count(*)::int as count from customer`),
      );
      expect(visible).toBe(0);
    });
  });

  it("REQ-RLS-3: the org-bound handle works as calibra_app inside its transaction (reads, inserts, updates), and sees nothing of another laboratory", async () => {
    const app = openAppRoleDb();
    const result = await forOrg(app.db, A).transaction(async (o) => {
      const jobs = await o
        .select({ id: calibrationJob.id })
        .from(calibrationJob);
      const audits = await o.select({ id: jobAuditLog.id }).from(jobAuditLog);
      const [created] = await o
        .insert(customer)
        .values({
          labOrganizationId: o.organizationId,
          authOrganizationId: "client-spare-3",
          name: "via handle",
          taxId: "88",
        })
        .returning({ id: customer.id });
      const renamed = await o
        .update(customer)
        .set({ name: "via handle 2" })
        .where(eq(customer.id, created?.id ?? -1))
        .returning({ id: customer.id });
      return { jobs, audits, renamed };
    });
    expect(result.jobs.map((row) => row.id)).toEqual([tenants.a.jobId]);
    expect(result.audits.length).toBeGreaterThan(0);
    expect(result.renamed).toHaveLength(1);

    // The handle bound to B, on A's connection setting: B's own rows only.
    const seenAsB = await forOrg(app.db, B).transaction((o) =>
      o.select({ id: calibrationJob.id }).from(calibrationJob),
    );
    expect(seenAsB.map((row) => row.id)).toEqual([tenants.b.jobId]);
  });

  it("REQ-RLS-3: a handle read outside a transaction sets no organization, so under calibra_app it matches nothing (fail closed)", async () => {
    const app = openAppRoleDb();
    const outside = await forOrg(app.db, A)
      .select({ id: calibrationJob.id })
      .from(calibrationJob);
    expect(outside).toEqual([]);
    // As the owner (production today) the very same handle read is unchanged.
    const asOwner = await forOrg(db, A)
      .select({ id: calibrationJob.id })
      .from(calibrationJob);
    expect(asOwner.map((row) => row.id)).toEqual([tenants.a.jobId]);
  });

  it("REQ-RLS-4: the organization is transaction-local: it is gone after the transaction and never reaches the next one on the same connection", async () => {
    const app = openAppRoleDb();
    const read = async (executor: Pick<typeof app.db, "execute">) =>
      rowsOf(
        await executor.execute(
          sql`select current_setting('calibra.organization_id', true) as org`,
        ),
      )[0]?.org;

    await forOrg(app.db, A).transaction((o) =>
      o.select({ id: calibrationJob.id }).from(calibrationJob),
    );
    // The one connection: whatever the first transaction set must be gone.
    const after = await read(app.db);
    expect(after === null || after === "").toBe(true);

    // Inside the transaction the handle's own organization is the setting.
    const seen = await app.db.transaction(async (tx) => {
      const o = forOrg(tx, A);
      return o.transaction(async () => read(tx));
    });
    expect(seen).toBe(A);

    // The next transaction (another laboratory, then none) starts clean.
    const next = await forOrg(app.db, B).transaction((o) =>
      o.select({ id: calibrationJob.id }).from(calibrationJob),
    );
    expect(next.map((row) => row.id)).toEqual([tenants.b.jobId]);
    const none = await app.db.transaction(async (tx) => read(tx));
    expect(none === null || none === "").toBe(true);
    const rowsWithoutOrg = await app.db.select().from(calibrationJob);
    expect(rowsWithoutOrg).toEqual([]);
  });

  it("REQ-RLS-4: a transaction that rolls back leaves no organization behind either", async () => {
    const app = openAppRoleDb();
    await expect(
      forOrg(app.db, A).transaction(async () => {
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    const rows = await app.db.select().from(calibrationJob);
    expect(rows).toEqual([]);
  });

  it("REQ-RLS-4: inside an outer transaction (a transaction scope, a caller's db.transaction) the handle's transaction is a savepoint: it sets its organization and puts the outer one back", async () => {
    const app = openAppRoleDb();
    const trace = await app.db.transaction(async (outer) => {
      await setTransactionOrganization(outer, A);
      const org = async () =>
        rowsOf(
          await outer.execute(
            sql`select current_setting('calibra.organization_id', true) as org`,
          ),
        )[0]?.org;
      const before = await org();
      const insideB = await forOrg(outer, B).transaction(async (o) => {
        const jobs = await o
          .select({ id: calibrationJob.id })
          .from(calibrationJob);
        return { org: await org(), jobs: jobs.map((row) => row.id) };
      });
      const after = await org();
      const jobsAfter = await outer.select().from(calibrationJob);
      return { before, insideB, after, jobsAfter: jobsAfter.length };
    });
    expect(trace.before).toBe(A);
    expect(trace.insideB.org).toBe(B);
    expect(trace.insideB.jobs).toEqual([tenants.b.jobId]);
    expect(trace.after).toBe(A);
    expect(trace.jobsAfter).toBe(1);
  });

  it("REQ-RLS-4: inside a transaction scope (P2-4a) the handle's transaction is a savepoint that sets the organization, and it is gone when the scope commits", async () => {
    const read = async () =>
      rowsOf(
        await db.execute(
          sql`select current_setting('calibra.organization_id', true) as org`,
        ),
      )[0]?.org;
    const inScope = await runInTransactionScope(async () => {
      const jobs = await forOrg(db, A).transaction(async (o) => {
        const rows = await o
          .select({ id: calibrationJob.id })
          .from(calibrationJob);
        return { org: await read(), ids: rows.map((row) => row.id) };
      });
      return jobs;
    });
    expect(inScope.org).toBe(A);
    expect(inScope.ids).toEqual([tenants.a.jobId]);
    // The scope has committed: the setting did not outlive it on any connection
    // this process holds (the owner pool).
    const after = await read();
    expect(after === null || after === "").toBe(true);
  });
});
