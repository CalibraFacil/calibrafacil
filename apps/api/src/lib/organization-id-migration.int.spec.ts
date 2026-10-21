/**
 * organization-id-migration.int.spec.ts: migration 0118 against a database in the
 * shape main had before it, holding representative data of two laboratories.
 *
 *   REQ-ORG-2  the backfill gives every child the organization of its parent
 *              (checked row by row, for a finance chain, a service-order chain,
 *              the audit logs and both naming conventions of the parents' own
 *              organization column); it is idempotent; its pre-check raises,
 *              changing nothing, on rows it cannot attribute and on rows that
 *              already point across tenants; the audit logs stay append-only
 *   REQ-ORG-3  the composite keys and the (id, organization) uniques exist after
 *              it, once, however often it runs
 *
 * How the "main" shape is obtained: this branch's schema is cloned from the
 * template database, the rows are written by the application's own writers, then
 * every organization_id column of the registry (with its keys and indexes) and
 * every (organization, id) unique is dropped. Compared catalog-for-catalog with a
 * database pushed from main's schema.ts, that revert is identical (columns,
 * constraints, indexes, triggers), so the data below sits in main's shape.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { ORGANIZATION_BACKFILL, listTenancy } from "@calibra-facil/db/tenancy";
import {
  SEEDED_CHILD_TABLES,
  seedTenant,
  seedTenantChildren,
  type Tenant,
} from "../../test/integration/tenancy-fixture";
import { getExecuteRows } from "./db";

const MIGRATION = readFileSync(
  new URL(
    "../../../../packages/db/drizzle/0118_organization_id_everywhere.sql",
    import.meta.url,
  ),
  "utf8",
);

const baseUrl = inject("testDbBaseUrl");
const template = inject("testDbTemplate");
const workerUrl = process.env.DATABASE_URL;
const scratchName = `calibra_mig_${process.env.VITEST_POOL_ID ?? "0"}`;

function pgEnv(): Record<string, string> {
  const url = new URL(`${baseUrl}/postgres`);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username || "postgres"),
    PGPASSWORD: decodeURIComponent(url.password || ""),
  };
}

/** Runs SQL through psql in `database`; returns stdout, or the failure's stderr. */
function psql(
  database: string,
  input: string,
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-A", "-t", "-d", database],
    { input, encoding: "utf8", env: pgEnv() },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function mustPsql(database: string, input: string): string {
  const result = psql(database, input);
  if (!result.ok) throw new Error(`psql failed: ${result.stderr}`);
  return result.stdout;
}

/** Drops the organization_id columns (keys, indexes) and (id, organization) uniques 0118 adds. */
function revertToMain(): string {
  const columns = ORGANIZATION_BACKFILL.map((entry) => entry.table)
    .toReversed()
    .map(
      (table) => `ALTER TABLE ${table} DROP COLUMN organization_id CASCADE;`,
    );
  const uniques = listTenancy().flatMap((table) =>
    table.orgIdUniques.map(
      (unique) =>
        `ALTER TABLE ${table.name} DROP CONSTRAINT IF EXISTS ${unique.name};`,
    ),
  );
  return [...columns, ...uniques].join("\n");
}

function tableList(): string {
  return ORGANIZATION_BACKFILL.map((entry) => `'${entry.table}'`).join(", ");
}

function columnCount(database: string): number {
  return Number(
    mustPsql(
      database,
      `select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'organization_id' and table_name in (${tableList()});`,
    ).trim(),
  );
}

function constraintCount(database: string, suffix: string): number {
  return Number(
    mustPsql(
      database,
      `select count(*) from pg_constraint where connamespace = 'public'::regnamespace and conname like '%${suffix}';`,
    ).trim(),
  );
}

/** `id|organization_id` of every row of every seeded table, in a stable order. */
function snapshot(database: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const table of SEEDED_CHILD_TABLES) {
    result[table] = mustPsql(
      database,
      `select id, organization_id from ${table} order by id;`,
    );
  }
  return result;
}

function rowCounts(database: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const table of SEEDED_CHILD_TABLES) {
    result[table] = mustPsql(database, `select count(*) from ${table};`);
  }
  return result;
}

async function createScratch(): Promise<void> {
  const admin = "postgres";
  mustPsql(admin, `DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE);`);
  // CREATE DATABASE ... TEMPLATE refuses while another session is on the
  // template (a worker cloning it at the same moment): retry briefly.
  let lastError = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = psql(
      admin,
      `CREATE DATABASE ${scratchName} TEMPLATE ${template};`,
    );
    if (result.ok) return;
    lastError = result.stderr;
    await sleep(500);
  }
  throw new Error(`could not create ${scratchName}: ${lastError}`);
}

describe("migration 0118 on a database in main's shape", () => {
  let org: { a: Tenant; b: Tenant };
  let expected: Record<string, string>;

  beforeAll(async () => {
    if (!workerUrl) throw new Error("DATABASE_URL is not set");
    await createScratch();
    // The db singleton follows DATABASE_URL: point it at the scratch database
    // while seeding, then put the worker's database back (afterAll).
    process.env.DATABASE_URL = `${baseUrl}/${scratchName}`;

    org = { a: await seedTenant("org-a"), b: await seedTenant("org-b") };
    await seedTenantChildren(org.a);
    await seedTenantChildren(org.b);
    expected = snapshot(scratchName);
    // Two laboratories, every seeded table holds a row of each.
    for (const table of SEEDED_CHILD_TABLES) {
      const owners = new Set(
        getExecuteRows<{ organization_id: string }>(
          await db.execute(
            sql`select organization_id from ${sql.identifier(table)}`,
          ),
        ).map((row) => row.organization_id),
      );
      expect([...owners].toSorted(), table).toEqual(["org-a", "org-b"]);
    }

    mustPsql(scratchName, revertToMain());
  }, 120_000);

  afterAll(() => {
    process.env.DATABASE_URL = workerUrl;
    psql("postgres", `DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE);`);
  });

  it("REQ-ORG-2: before the migration none of the tables has organization_id nor the composite keys (main's shape)", () => {
    expect(columnCount(scratchName)).toBe(0);
    expect(constraintCount(scratchName, "_tenant_fk")).toBe(0);
    expect(constraintCount(scratchName, "_id_org_uidx")).toBe(0);
  });

  it("REQ-ORG-2: the pre-check raises on an audit row whose entity is gone and applies nothing", () => {
    const before = rowCounts(scratchName);
    mustPsql(
      scratchName,
      `insert into job_audit_log (job_id, action, performed_by) values (987654, 'delete', 'user-org-a');`,
    );

    const result = psql(scratchName, MIGRATION);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain(
      "migration 0118 cannot attribute rows to an organization",
    );
    expect(result.stderr).toContain(
      "job_audit_log: 1 row(s) whose job_id matches no calibration_job row",
    );
    // Only the orphan is named: nothing else is unattributable.
    expect(result.stderr).not.toContain("asset_audit_log:");

    // Atomic: no column, no key, no row changed.
    expect(columnCount(scratchName)).toBe(0);
    expect(constraintCount(scratchName, "_tenant_fk")).toBe(0);
    mustPsql(scratchName, `delete from job_audit_log where job_id = 987654;`);
    expect(rowCounts(scratchName)).toEqual(before);
  });

  it("REQ-ORG-2: the pre-check raises on a row that already points at another tenant's row", () => {
    // org A's job_standard row (its organization comes from the job) naming org B's standard.
    mustPsql(
      scratchName,
      `delete from job_standard;
       insert into job_standard (job_id, standard_id) values (${org.a.jobId}, ${org.b.standardId});`,
    );
    const result = psql(scratchName, MIGRATION);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain(
      "migration 0118 found rows that point at another tenant",
    );
    expect(result.stderr).toContain(
      "job_standard: 1 row(s) whose standard_id belongs to another organization",
    );
    expect(columnCount(scratchName)).toBe(0);

    // Put the two legitimate rows back.
    mustPsql(
      scratchName,
      `delete from job_standard;
       insert into job_standard (job_id, standard_id) values (${org.a.jobId}, ${org.a.standardId}), (${org.b.jobId}, ${org.b.standardId});`,
    );
  });

  it("REQ-ORG-2: it backfills every child with the organization of its parent, row by row", () => {
    const applied = psql(scratchName, MIGRATION);
    expect(applied.stderr).toBe("");
    expect(applied.ok).toBe(true);

    expect(columnCount(scratchName)).toBe(ORGANIZATION_BACKFILL.length);
    const after = snapshot(scratchName);
    for (const table of SEEDED_CHILD_TABLES) {
      if (table === "job_standard") {
        // Re-inserted above: same rows, new ids.
        const owners = after[table]
          ?.split("\n")
          .map((line) => line.split("|")[1]);
        expect(owners?.toSorted(), table).toEqual(["org-a", "org-b"]);
        continue;
      }
      expect(after[table], table).toEqual(expected[table]);
    }

    // NOT NULL, RESTRICT, in Postgres.
    expect(
      mustPsql(
        scratchName,
        `select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'organization_id' and is_nullable = 'YES' and table_name in (${tableList()});`,
      ).trim(),
    ).toBe("0");
    expect(
      mustPsql(
        scratchName,
        `select count(*) from pg_constraint where contype = 'f' and confrelid = 'public.organization'::regclass and confdeltype = 'r' and pg_get_constraintdef(oid) like 'FOREIGN KEY (organization_id)%' and conrelid::regclass::text in (${tableList()});`,
      ).trim(),
    ).toBe(String(ORGANIZATION_BACKFILL.length));
  });

  it("REQ-ORG-3: the composite keys and the uniques exist, one of each", () => {
    const composites = listTenancy().flatMap((table) => table.compositeKeys);
    const uniques = listTenancy().flatMap((table) => table.orgIdUniques);
    expect(constraintCount(scratchName, "_tenant_fk")).toBe(composites.length);
    expect(constraintCount(scratchName, "_id_org_uidx")).toBe(uniques.length);
    // The cross-tenant row the pre-check refused cannot be inserted any more.
    const refused = psql(
      scratchName,
      `insert into job_standard (organization_id, job_id, standard_id) values ('org-a', ${org.a.jobId}, ${org.b.standardId});`,
    );
    expect(refused.ok).toBe(false);
    expect(refused.stderr).toContain("job_standard_standard_id_tenant_fk");
  });

  it("REQ-ORG-2: the audit logs are append-only again after the backfill", () => {
    const update = psql(
      scratchName,
      `update job_audit_log set reason = 'rewritten';`,
    );
    expect(update.ok).toBe(false);
    expect(update.stderr).toContain("append-only");
    const insertWithout = psql(
      scratchName,
      `insert into job_audit_log (job_id, action, performed_by) values (${org.a.jobId}, 'x', 'user-org-a');`,
    );
    expect(insertWithout.ok).toBe(false);
    expect(insertWithout.stderr).toContain(
      'null value in column "organization_id"',
    );
  });

  it("REQ-ORG-2: running it again changes nothing", () => {
    const before = snapshot(scratchName);
    const columns = columnCount(scratchName);
    const composites = constraintCount(scratchName, "_tenant_fk");
    const uniques = constraintCount(scratchName, "_id_org_uidx");

    const again = psql(scratchName, MIGRATION);
    expect(again.ok, again.stderr).toBe(true);

    expect(snapshot(scratchName)).toEqual(before);
    expect(columnCount(scratchName)).toBe(columns);
    expect(constraintCount(scratchName, "_tenant_fk")).toBe(composites);
    expect(constraintCount(scratchName, "_id_org_uidx")).toBe(uniques);
  });
});
