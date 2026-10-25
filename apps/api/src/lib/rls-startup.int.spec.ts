import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ConfigError } from "@calibra-facil/config";
import { db } from "@calibra-facil/db";
import { rlsTables } from "@calibra-facil/db/rls-sql";
import {
  assertRlsStartup,
  readRlsRoleFacts,
} from "@calibra-facil/db/rls-startup";
import {
  createRoleDatabase,
  type RoleDatabase,
} from "@calibra-facil/db/role-connection";
import { assetType, customer, organization } from "@calibra-facil/db/schema";
import { setTransactionOrganization } from "@calibra-facil/db/for-org";
import { truncateAll } from "../../test/integration/db";
import { seedTenant } from "../../test/integration/tenancy-fixture";
import { sqlStateOf } from "../../test/integration/rls";

// The proof that the application's role is NOT bound by row-level security while
// DATABASE_RLS_MODE=shadow, the diagnosis mode (REQ-RLS-2), against a role that is a real table OWNER
// but not a superuser (the test Postgres user is a superuser, which proves
// nothing: it bypasses everything), plus the start-up check and the migration
// guard in every case: owner, BYPASSRLS, a calibra_app member, enforced mode.

const suffix = process.env.VITEST_POOL_ID ?? "0";
const OWNER = `t_owner_${suffix}`;
const BYPASS = `t_bypass_${suffix}`;
const MEMBER = `t_member_${suffix}`;
// Roles the application must NOT be able to hide behind: it owns one table, or it can
// become the owner (membership with and without INHERIT, `SET ROLE`).
const PARTIAL = `t_partial_${suffix}`;
const INHERITS = `t_inherits_${suffix}`;
const NOINHERIT = `t_noinherit_${suffix}`;
const ROLES = [PARTIAL, INHERITS, NOINHERIT, OWNER, BYPASS, MEMBER];

const MIGRATION = readFileSync(
  new URL(
    "../../../../packages/db/drizzle/0123_rls_shadow_mode.sql",
    import.meta.url,
  ),
  "utf8",
);

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

type Rows = Array<Record<string, unknown>>;

function rowsOf(result: unknown): Rows {
  if (Array.isArray(result)) return result;
  if (typeof result === "object" && result !== null) {
    const rows: unknown = Reflect.get(result, "rows");
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

async function dropRoles(): Promise<void> {
  for (const role of ROLES) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- DDL, one at a time.
    await db.execute(
      sql.raw(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
            REASSIGN OWNED BY ${role} TO CURRENT_USER;
            DROP OWNED BY ${role};
            DROP ROLE ${role};
          END IF;
        END $$`),
    );
  }
}

const open: RoleDatabase[] = [];
function connectAs(role: string | null): RoleDatabase {
  const database = createRoleDatabase(databaseUrl(), { role, max: 1 });
  open.push(database);
  return database;
}

async function countCustomers(executor: RoleDatabase): Promise<number> {
  const rows = await executor.db.select({ id: customer.id }).from(customer);
  return rows.length;
}

describe("row-level security: who the policies bind", () => {
  beforeAll(async () => {
    await dropRoles();
    await db.execute(sql.raw(`CREATE ROLE ${OWNER} NOLOGIN`));
    await db.execute(
      sql.raw(`CREATE ROLE ${BYPASS} NOLOGIN BYPASSRLS IN ROLE calibra_app`),
    );
    await db.execute(
      sql.raw(`CREATE ROLE ${MEMBER} NOLOGIN IN ROLE calibra_app`),
    );
    // OWNER owns every table of the schema: today's production connection,
    // except that it is not a superuser.
    await db.execute(
      sql.raw(`
        DO $$ DECLARE t record; BEGIN
          FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
            EXECUTE format('ALTER TABLE public.%I OWNER TO ${OWNER}', t.tablename);
          END LOOP;
        END $$`),
    );
    await db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${OWNER}`));
    await db.execute(
      sql.raw(
        `CREATE ROLE ${PARTIAL} NOLOGIN IN ROLE calibra_app; GRANT CREATE ON SCHEMA public TO ${PARTIAL}`,
      ),
    );
    await db.execute(
      sql.raw(`CREATE ROLE ${INHERITS} NOLOGIN IN ROLE calibra_app, ${OWNER}`),
    );
    await db.execute(
      sql.raw(
        `CREATE ROLE ${NOINHERIT} NOLOGIN NOINHERIT IN ROLE calibra_app, ${OWNER}`,
      ),
    );
  });

  afterAll(async () => {
    await Promise.all(open.splice(0).map((database) => database.close()));
    await dropRoles();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedTenant("lab-a");
    await seedTenant("lab-b");
  });

  it("REQ-RLS-2 [HIGH RISK]: a non-superuser role that OWNS the tables sees and writes both laboratories with no organization set", async () => {
    const owner = connectAs(OWNER);
    const identity = rowsOf(
      await owner.db.execute(
        sql`select current_user::text as who, r.rolsuper, r.rolbypassrls from pg_roles r where r.rolname = current_user`,
      ),
    );
    expect(identity).toEqual([
      { who: OWNER, rolsuper: false, rolbypassrls: false },
    ]);
    const owners = rowsOf(
      await owner.db.execute(
        sql`select distinct tableowner from pg_tables where schemaname = 'public'`,
      ),
    );
    expect(owners).toEqual([{ tableowner: OWNER }]);

    // RLS is enabled on the table and the owner is still not bound by it.
    expect(await countCustomers(owner)).toBe(2);
    const labs = rowsOf(
      await owner.db.execute(
        sql`select distinct lab_organization_id from customer order by 1`,
      ),
    );
    expect(labs.map((row) => row.lab_organization_id)).toEqual([
      "lab-a",
      "lab-b",
    ]);
    const updated = await owner.db
      .update(customer)
      .set({ name: "renamed by the owner" })
      .returning({ id: customer.id });
    expect(updated).toHaveLength(2);
  });

  describe("with the sync change log (migration 0122) next to the policies", () => {
    async function newClient(id: string): Promise<void> {
      await db.insert(organization).values({
        id,
        name: id,
        slug: id,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        type: "CLIENT",
        status: "ACTIVE",
      });
    }

    async function logged(lab: string): Promise<number> {
      const rows = rowsOf(
        await db.execute(
          sql`select count(*)::int as count from sync_change_log where organization_id = ${lab} and entity_type = 'customer'`,
        ),
      );
      return Number(rows[0]?.count);
    }

    it("REQ-RLS-1: sync_change_log is a tenant table with the tenant_isolation policy, and the drift list carries it", async () => {
      expect(rlsTables().map((entry) => entry.table)).toContain(
        "sync_change_log",
      );
      const policies = rowsOf(
        await db.execute(
          sql`select roles::text as roles from pg_policies where schemaname = 'public' and tablename = 'sync_change_log' and policyname = 'tenant_isolation'`,
        ),
      );
      expect(policies).toEqual([{ roles: "{calibra_app}" }]);
    });

    it("REQ-RLS-2 [HIGH RISK]: as the non-superuser owner the change-log trigger still appends an entry for the written row", async () => {
      await newClient("client-trg-owner");
      const before = await logged("lab-a");
      const owner = connectAs(OWNER);
      await owner.db.insert(customer).values({
        labOrganizationId: "lab-a",
        authOrganizationId: "client-trg-owner",
        name: "logged by the owner",
      });
      expect(await logged("lab-a")).toBe(before + 1);
    });

    it("REQ-RLS-3: as calibra_app with the organization set, the trigger appends the entry for the own laboratory", async () => {
      await newClient("client-trg-app");
      const before = await logged("lab-a");
      const member = connectAs(MEMBER);
      await member.db.transaction(async (tx) => {
        await setTransactionOrganization(tx, "lab-a");
        await tx.insert(customer).values({
          labOrganizationId: "lab-a",
          authOrganizationId: "client-trg-app",
          name: "logged by the app role",
        });
      });
      expect(await logged("lab-a")).toBe(before + 1);
    });

    it("REQ-RLS-3: a write of the GLOBAL asset_type catalog fans an entry out to every laboratory, which one laboratory's setting refuses (a cutover point: such writes keep the owner connection)", async () => {
      const member = connectAs(MEMBER);
      const write = member.db.transaction(async (tx) => {
        await setTransactionOrganization(tx, "lab-a");
        await tx.insert(assetType).values({
          name: "Tipo novo",
          slug: "tipo-novo",
          definition: [],
        });
      });
      expect(await sqlStateOf(write)).toBe("42501");
      // The owner is not bound: the same write passes.
      const owner = connectAs(OWNER);
      await owner.db.insert(assetType).values({
        name: "Tipo novo",
        slug: "tipo-novo",
        definition: [],
      });
    });
  });

  it("REQ-RLS-2: a BYPASSRLS role sees both laboratories, a calibra_app member sees none", async () => {
    expect(await countCustomers(connectAs(BYPASS))).toBe(2);
    expect(await countCustomers(connectAs(MEMBER))).toBe(0);
  });

  describe("start-up check (assertRlsStartup)", () => {
    it("REQ-RLS-2 [HIGH RISK]: shadow mode accepts the owner, a BYPASSRLS role and the superuser", async () => {
      for (const who of [
        connectAs(OWNER),
        connectAs(BYPASS),
        connectAs(null),
      ]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one connection each.
        const facts = await assertRlsStartup({
          executor: who.db,
          mode: "shadow",
        });
        expect(facts.rlsEnabled).toBe(true);
        expect(facts.subjectToRls).toBe(false);
      }
    });

    it("REQ-RLS-2 [HIGH RISK]: shadow mode refuses a calibra_app member, naming the role, DATABASE_RLS_MODE and DEPLOYMENT.md", async () => {
      const refused = await assertRlsStartup({
        executor: connectAs(MEMBER).db,
        mode: "shadow",
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refused).toBeInstanceOf(ConfigError);
      if (!(refused instanceof ConfigError)) throw new Error("not refused");
      expect(refused.message).toContain(MEMBER);
      expect(refused.message).toContain("DATABASE_RLS_MODE=enforced");
      expect(refused.message).toContain("DEPLOYMENT.md");
    });

    it("REQ-RLS-2: enforced mode (the default) accepts the calibra_app member with the owner on the system path", async () => {
      const facts = await assertRlsStartup({
        executor: connectAs(MEMBER).db,
        systemExecutor: connectAs(OWNER).db,
        mode: "enforced",
        ownerUrl: "postgres://owner@localhost/db",
      });
      expect(facts.subjectToRls).toBe(true);
      expect(facts.role).toBe(MEMBER);
    });

    it("REQ-RLS-2 [HIGH RISK]: enforced mode refuses an application connection that is the owner, a BYPASSRLS role or the superuser (no second wall), naming DATABASE_URL", async () => {
      for (const who of [
        connectAs(OWNER),
        connectAs(BYPASS),
        connectAs(null),
      ]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one connection each.
        const refused = await assertRlsStartup({
          executor: who.db,
          systemExecutor: connectAs(OWNER).db,
          ownerUrl: "postgres://owner@localhost/db",
          mode: "enforced",
        }).then(
          () => null,
          (error: unknown) => error,
        );
        expect(refused).toBeInstanceOf(ConfigError);
        if (!(refused instanceof ConfigError)) throw new Error("not refused");
        expect(refused.issues.map((issue) => issue.variable)).toEqual([
          "DATABASE_URL",
        ]);
      }
    });

    it("REQ-RLS-2 [HIGH RISK]: enforced mode refuses a role that owns only SOME tenant table, and a member of the owner with or without INHERIT (it can SET ROLE), naming DATABASE_URL", async () => {
      await db.execute(sql.raw(`ALTER TABLE customer OWNER TO ${PARTIAL}`));
      try {
        const cases = [
          {
            who: PARTIAL,
            facts: { subjectToRls: true, ownsSomeRlsTable: true },
          },
          {
            who: INHERITS,
            facts: { subjectToRls: false, ownsSomeRlsTable: true },
          },
          {
            who: NOINHERIT,
            facts: { subjectToRls: true, ownsSomeRlsTable: true },
          },
        ];
        for (const { who, facts } of cases) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- one connection each.
          const executor = connectAs(who).db;
          // oxlint-disable-next-line eslint/no-await-in-loop -- one connection each.
          const refused = await assertRlsStartup({
            executor,
            systemExecutor: connectAs(OWNER).db,
            ownerUrl: "postgres://owner@localhost/db",
            mode: "enforced",
          }).then(
            () => null,
            (error: unknown) => error,
          );
          expect(refused, who).toBeInstanceOf(ConfigError);
          if (!(refused instanceof ConfigError)) throw new Error("not refused");
          expect(refused.issues.map((issue) => issue.variable)).toEqual([
            "DATABASE_URL",
          ]);
          expect(refused.message).toContain(who);
          // oxlint-disable-next-line eslint/no-await-in-loop -- one connection each.
          const read = await readRlsRoleFacts(executor);
          expect(read.ownsSomeRlsTable, who).toBe(facts.ownsSomeRlsTable);
        }
      } finally {
        await db.execute(sql.raw(`ALTER TABLE customer OWNER TO ${OWNER}`));
      }
    });

    it("REQ-RLS-2 [HIGH RISK]: enforced mode refuses a NOINHERIT member of the owner even when it owns no table itself", async () => {
      const facts = await readRlsRoleFacts(connectAs(NOINHERIT).db);
      expect(facts.ownsSomeRlsTable).toBe(true);
      expect(facts.subjectToRls).toBe(true);
      await expect(
        assertRlsStartup({
          executor: connectAs(NOINHERIT).db,
          systemExecutor: connectAs(OWNER).db,
          ownerUrl: "postgres://owner@localhost/db",
          mode: "enforced",
        }),
      ).rejects.toBeInstanceOf(ConfigError);
    });

    it("REQ-RLS-2 [HIGH RISK]: enforced mode refuses a system path that is missing or that RLS binds (Q40), naming DATABASE_OWNER_URL", async () => {
      for (const options of [
        { ownerUrl: undefined, systemExecutor: undefined },
        {
          ownerUrl: "postgres://owner@localhost/db",
          systemExecutor: connectAs(MEMBER).db,
        },
      ]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one connection each.
        const refused = await assertRlsStartup({
          executor: connectAs(MEMBER).db,
          mode: "enforced",
          ...options,
        }).then(
          () => null,
          (error: unknown) => error,
        );
        expect(refused).toBeInstanceOf(ConfigError);
        if (!(refused instanceof ConfigError)) throw new Error("not refused");
        expect(refused.issues.map((issue) => issue.variable)).toEqual([
          "DATABASE_OWNER_URL",
        ]);
      }
    });

    it("REQ-RLS-2: a FORCEd table binds even its owner, so shadow mode refuses the owner then", async () => {
      await db.execute(sql`alter table customer force row level security`);
      try {
        const refused = await assertRlsStartup({
          executor: connectAs(OWNER).db,
          mode: "shadow",
        }).then(
          () => "accepted",
          (error: unknown) => error,
        );
        expect(refused).toBeInstanceOf(ConfigError);
      } finally {
        await db.execute(sql`alter table customer no force row level security`);
      }
    });

    it("REQ-RLS-2: before migration 0123 (RLS not enabled on any table) a calibra_app member passes in shadow mode", async () => {
      const tables = rlsTables();
      for (const { table } of tables) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- DDL, one at a time.
        await db.execute(
          sql.raw(`alter table public."${table}" disable row level security`),
        );
      }
      try {
        const facts = await assertRlsStartup({
          executor: connectAs(MEMBER).db,
          mode: "shadow",
        });
        expect(facts.rlsEnabled).toBe(false);
      } finally {
        for (const { table } of tables) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- DDL, one at a time.
          await db.execute(
            sql.raw(`alter table public."${table}" enable row level security`),
          );
        }
      }
    });
  });

  describe("migration 0123 guards", () => {
    /** Runs the migration file in a transaction as `role` (SET LOCAL ROLE), rolled back after. */
    async function runMigrationAs(
      role: string,
      before: string[] = [],
      commit = false,
    ): Promise<void> {
      const admin = connectAs(null);
      class Rollback extends Error {}
      await admin.db.$client
        .begin(async (transaction) => {
          for (const statement of before) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- in order.
            await transaction.unsafe(statement);
          }
          await transaction.unsafe(`set local role ${role}`);
          await transaction.unsafe(MIGRATION);
          if (!commit) throw new Rollback("rolled back on purpose");
        })
        .catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        });
    }

    it("REQ-RLS-2 [HIGH RISK]: run by a role RLS would bind (a calibra_app member), it stops before changing anything", async () => {
      await expect(runMigrationAs(MEMBER)).rejects.toThrow(
        /neither the owner of the tenant tables/,
      );
      await expect(runMigrationAs(MEMBER)).rejects.toThrow(/DEPLOYMENT\.md/);
    });

    it("REQ-RLS-2: run by a non-superuser OWNER it applies again (idempotent) and leaves the owner unbound", async () => {
      await runMigrationAs(OWNER, [], true);
      const owner = connectAs(OWNER);
      expect(await countCustomers(owner)).toBe(2);
    });

    it("REQ-RLS-2: where the role calibra_app is missing and the owner lacks CREATEROLE, it stops naming the one-time admin step", async () => {
      const hold = `calibra_app_held_${suffix}`;
      const failed = await runMigrationAs(OWNER, [
        `alter role calibra_app rename to ${hold}`,
      ]).then(
        () => null,
        (error: unknown) => error,
      );
      expect(String(failed)).toContain("CREATE ROLE calibra_app NOLOGIN; once");
      expect(String(failed)).toContain("CREATEROLE");
      // The rename was rolled back with the transaction.
      const present = rowsOf(
        await db.execute(
          sql`select 1 as present from pg_roles where rolname = 'calibra_app'`,
        ),
      );
      expect(present).toHaveLength(1);
    });

    it("REQ-RLS-2: the migration gives up on a lock after 5s (lock_timeout) instead of queueing behind a long query", async () => {
      const holder = connectAs(null);
      const release: { run: () => void } = { run: () => undefined };
      const held = new Promise<void>((resolve) => {
        release.run = resolve;
      });
      class Done extends Error {}
      const locking = holder.db.$client
        .begin(async (transaction) => {
          await transaction.unsafe(
            "lock table customer in access exclusive mode",
          );
          await held;
          throw new Done("release");
        })
        .catch((error: unknown) => {
          if (!(error instanceof Done)) throw error;
        });
      try {
        // Give the holder time to take the lock, then run the migration.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const started = Date.now();
        const state = await sqlStateOf(runMigrationAs(OWNER));
        expect(state).toBe("55P03");
        expect(Date.now() - started).toBeLessThan(30_000);
      } finally {
        release.run();
        await locking;
      }
    });
  });
});
