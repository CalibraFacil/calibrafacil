/**
 * organization-id-migration.int.spec.ts: migration 0118 against a database in the
 * shape main had before it, holding representative data of two laboratories.
 *
 *   REQ-ORG-2  the backfill gives every child the organization of its parent
 *              (checked row by row, for a finance chain, a service-order chain,
 *              the audit logs and both naming conventions of the parents' own
 *              organization column); it is idempotent; its pre-check raises,
 *              changing nothing, on an orphan child and on rows that already
 *              point across tenants, but NOT on orphan audit rows (their entity
 *              was hard-deleted): those are attributed from their own data or
 *              stay NULL and are counted; a NEW audit row without an
 *              organization is refused by the CHECK; the audit logs stay
 *              append-only
 *   REQ-ORG-3  the composite keys and the (id, organization) uniques exist after
 *              it, once, however often it runs
 *
 * How the "main" shape is obtained: this branch's schema is cloned from the
 * worker database (pg_dump), the rows are written by the application's own writers, then
 * every organization_id column of the registry (with its keys and indexes) and
 * every (organization, id) unique is dropped. Compared catalog-for-catalog with a
 * database pushed from main's schema.ts, that revert is identical (columns,
 * constraints, indexes, triggers), so the data below sits in main's shape.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  CREATED_AFTER_0118,
  ORGANIZATION_BACKFILL,
  listTenancy,
} from "@calibra-facil/db/tenancy";
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

/** The tables of the database this migration runs on: those created later do not exist yet. */
const TABLES_AT_0118 = listTenancy().filter(
  (table) => !CREATED_AFTER_0118.includes(table.name),
);

const baseUrl = inject("testDbBaseUrl");
const workerUrl = process.env.DATABASE_URL;
const workerDatabase = new URL(workerUrl ?? "postgres://x/").pathname.slice(1);
const scratchName = `calibra_mig_${process.env.VITEST_POOL_ID ?? "0"}`;

/** A statement block of the migration 0118 runbook, verbatim (the list-item indentation removed). */
function documentedSql(pattern: RegExp): string {
  const block = readFileSync(
    new URL(
      "../../../../docs/operations/migration-0118-organization.md",
      import.meta.url,
    ),
    "utf8",
  ).match(pattern)?.[0];
  if (!block)
    throw new Error(
      `The migration 0118 runbook has no block matching ${pattern}`,
    );
  return block.replace(/^ {2}/gm, "");
}

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
  // Tables created after 0118 do not exist yet (their keys also depend on the
  // uniques dropped below).
  const later = CREATED_AFTER_0118.map(
    (table) => `DROP TABLE IF EXISTS ${table};`,
  );
  // The audit hash chain (migration 0131) is newer than 0118 as well: its trigger
  // reads NEW.organization_id, so it goes before the column does.
  const chain = [
    "DROP TRIGGER IF EXISTS job_audit_log_hash_chain ON job_audit_log;",
    "ALTER TABLE job_audit_log DROP COLUMN IF EXISTS chain_seq, DROP COLUMN IF EXISTS prev_hash, DROP COLUMN IF EXISTS row_hash;",
  ];
  const columns = ORGANIZATION_BACKFILL.map((entry) => entry.table)
    .toReversed()
    .map(
      (table) => `ALTER TABLE ${table} DROP COLUMN organization_id CASCADE;`,
    );
  const uniques = TABLES_AT_0118.flatMap((table) =>
    table.orgIdUniques.map(
      (unique) =>
        `ALTER TABLE ${table.name} DROP CONSTRAINT IF EXISTS ${unique.name};`,
    ),
  );
  return [...later, ...chain, ...columns, ...uniques].join("\n");
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

/** How many of the constraints of this design (by name) exist. */
function constraintCount(
  database: string,
  kind: "tenant_fk" | "unique",
): number {
  const names =
    kind === "tenant_fk"
      ? TABLES_AT_0118.flatMap((table) =>
          table.compositeKeys.map((key) => key.name),
        )
      : TABLES_AT_0118.flatMap((table) =>
          table.orgIdUniques.map((unique) => unique.name),
        );
  const list = names.map((name) => `'${name}'`).join(", ");
  return Number(
    mustPsql(
      database,
      `select count(*) from pg_constraint where connamespace = 'public'::regnamespace and conname in (${list});`,
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

/**
 * An empty database with the schema of this worker's database. Cloned with
 * pg_dump, not CREATE DATABASE ... TEMPLATE: that would take the template the
 * other workers clone from while they start up.
 */
function createScratch(): void {
  const admin = "postgres";
  mustPsql(admin, `DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE);`);
  mustPsql(admin, `CREATE DATABASE ${scratchName};`);
  const dump = spawnSync(
    "pg_dump",
    ["--schema-only", "--no-owner", "--no-privileges", "-d", workerDatabase],
    { encoding: "utf8", env: pgEnv(), maxBuffer: 256 * 1024 * 1024 },
  );
  if (dump.status !== 0) throw new Error(`pg_dump failed: ${dump.stderr}`);
  mustPsql(scratchName, dump.stdout);
}

describe("migration 0118 on a database in main's shape", () => {
  let org: { a: Tenant; b: Tenant };
  let expected: Record<string, string>;

  beforeAll(async () => {
    if (!workerUrl) throw new Error("DATABASE_URL is not set");
    createScratch();
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
    expect(constraintCount(scratchName, "tenant_fk")).toBe(0);
    expect(constraintCount(scratchName, "unique")).toBe(0);
  });

  it("REQ-ORG-2: the pre-check still raises on an orphan child (a non-audit table) and applies nothing", () => {
    const before = rowCounts(scratchName);
    // A real orphan cannot be written with the foreign keys on: bypass them for the probe row.
    mustPsql(
      scratchName,
      `set session_replication_role = replica;
       insert into job_standard (job_id, standard_id) values (987654, ${org.a.standardId});`,
    );

    const result = psql(scratchName, MIGRATION);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain(
      "migration 0118 cannot attribute rows to an organization",
    );
    expect(result.stderr).toContain(
      "job_standard: 1 row(s) whose job_id matches no calibration_job row",
    );
    // Only the orphan child is named: no audit log is.
    expect(result.stderr).not.toContain("_audit_log:");

    // Atomic: no column, no key, no row changed.
    expect(columnCount(scratchName)).toBe(0);
    expect(constraintCount(scratchName, "tenant_fk")).toBe(0);
    mustPsql(scratchName, `delete from job_standard where job_id = 987654;`);
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

  it("REQ-ORG-2: it backfills every child with the organization of its parent, row by row, and does not block on orphan audit rows", () => {
    // Audit rows of entities that were hard-deleted before the column existed.
    // (a) nothing on the row names the laboratory; (b) a hard-delete row carries the deleted
    // asset's snapshot, and an earlier row of the same asset has no data of its own;
    // (c) the snapshot names an organization that does not exist.
    mustPsql(
      scratchName,
      `insert into job_audit_log (job_id, action, performed_by) values (987654, 'delete', 'user-org-a');
       insert into asset_audit_log (asset_id, action, performed_by) values (777001, 'update', 'user-org-a');
       insert into asset_audit_log (asset_id, action, changes, performed_by)
         values (777001, 'delete', '{"asset":{"old":{"labOrganizationId":"org-a"},"new":null}}', 'user-org-a');
       insert into customer_audit_log (customer_id, action, changes, performed_by)
         values (777002, 'delete', '{"customer":{"old":{"labOrganizationId":"ghost-org"},"new":null}}', 'user-org-a');`,
    );

    // Two parents' unique indexes pre-built the way DEPLOYMENT.md says (CONCURRENTLY, under the
    // constraint's name): the migration must adopt them instead of building another.
    mustPsql(
      scratchName,
      `create unique index concurrently if not exists calibration_job_id_org_uidx on calibration_job (id, organization_id);`,
    );
    mustPsql(
      scratchName,
      `create unique index concurrently if not exists asset_id_org_uidx on asset (id, lab_organization_id);`,
    );

    // Two interrupted CREATE INDEX CONCURRENTLY leftovers (INVALID, under the constraint's name):
    // the DEPLOYMENT.md "drop the invalid ones" statement removes the first; the migration
    // drops the second by itself.
    for (const [table, name, columns] of [
      ["service", "service_id_org_uidx", "id, organization_id"],
      [
        "billing_document",
        "billing_document_id_org_uidx",
        "id, organization_id",
      ],
    ] as const) {
      mustPsql(
        scratchName,
        `create unique index concurrently ${name} on ${table} (${columns});`,
      );
      mustPsql(
        scratchName,
        `update pg_index set indisvalid = false where indexrelid = 'public.${name}'::regclass;`,
      );
    }
    const check = documentedSql(/SELECT c\.relname AS index_name[\s\S]*?;/);
    expect(
      mustPsql(scratchName, check).split("\n").filter(Boolean),
      "the documented check lists the two invalid leftovers first",
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "billing_document_id_org_uidx|billing_document|f|",
        ),
        expect.stringContaining("service_id_org_uidx|service|f|"),
      ]),
    );
    // Verbatim from DEPLOYMENT.md: drops every INVALID one (both here).
    mustPsql(
      scratchName,
      documentedSql(/SELECT format\('DROP INDEX CONCURRENTLY[\s\S]*?\\gexec/),
    );
    expect(
      mustPsql(
        scratchName,
        `select count(*) from pg_class where relname in ('service_id_org_uidx', 'billing_document_id_org_uidx');`,
      ).trim(),
    ).toBe("0");
    // Leftover the documented step did not get to (re-created invalid right before the migration).
    mustPsql(
      scratchName,
      `create unique index concurrently billing_document_id_org_uidx on billing_document (id, organization_id);`,
    );
    mustPsql(
      scratchName,
      `update pg_index set indisvalid = false where indexrelid = 'public.billing_document_id_org_uidx'::regclass;`,
    );

    const applied = psql(scratchName, MIGRATION);
    expect(applied.ok, applied.stderr).toBe(true);
    // The migration dropped the invalid leftover and built the constraint's own valid index.
    expect(
      mustPsql(
        scratchName,
        `select i.indisvalid from pg_constraint k join pg_index i on i.indexrelid = k.conindid where k.conname = 'billing_document_id_org_uidx';`,
      ).trim(),
    ).toBe("t");
    // The unattributable rows are counted, not raised.
    expect(applied.stderr).toContain(
      "job_audit_log has 1 audit row(s) of a deleted entity",
    );
    expect(applied.stderr).toContain(
      "customer_audit_log has 1 audit row(s) of a deleted entity",
    );
    expect(applied.stderr).not.toContain("asset_audit_log has");

    expect(columnCount(scratchName)).toBe(ORGANIZATION_BACKFILL.length);
    const after = snapshot(scratchName);
    for (const table of SEEDED_CHILD_TABLES) {
      const rows = new Set(after[table]?.trim().split("\n"));
      if (table === "job_standard") {
        // Re-inserted above: same rows, new ids.
        const owners = [...rows].map((line) => line.split("|")[1]);
        expect(owners.toSorted(), table).toEqual(["org-a", "org-b"]);
        continue;
      }
      // Every seeded row got its parent's organization (the probe rows are extra).
      for (const line of expected[table]?.trim().split("\n") ?? []) {
        expect(rows.has(line), `${table}: ${line}`).toBe(true);
      }
    }

    // The orphans: attributed from their own snapshot / siblings, or left NULL.
    expect(
      mustPsql(
        scratchName,
        `select coalesce(organization_id, 'NULL') from asset_audit_log where asset_id = 777001 order by id;`,
      ).trim(),
    ).toBe("org-a\norg-a");
    expect(
      mustPsql(
        scratchName,
        `select coalesce(organization_id, 'NULL') from job_audit_log where job_id = 987654;`,
      ).trim(),
    ).toBe("NULL");
    expect(
      mustPsql(
        scratchName,
        `select coalesce(organization_id, 'NULL') from customer_audit_log where customer_id = 777002;`,
      ).trim(),
    ).toBe("NULL");

    // NOT NULL on the children, nullable on exactly the 16 audit logs; RESTRICT on all.
    expect(
      mustPsql(
        scratchName,
        `select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'organization_id' and is_nullable = 'YES' and table_name in (${tableList()});`,
      ).trim(),
    ).toBe("16");
    expect(
      mustPsql(
        scratchName,
        `select count(*) from pg_constraint where contype = 'f' and confrelid = 'public.organization'::regclass and confdeltype = 'r' and pg_get_constraintdef(oid) like 'FOREIGN KEY (organization_id)%' and conrelid::regclass::text in (${tableList()});`,
      ).trim(),
    ).toBe(String(ORGANIZATION_BACKFILL.length));
  });

  it("REQ-ORG-3: the composite keys and the uniques exist, one of each", () => {
    const composites = TABLES_AT_0118.flatMap((table) => table.compositeKeys);
    const uniques = TABLES_AT_0118.flatMap((table) => table.orgIdUniques);
    expect(constraintCount(scratchName, "tenant_fk")).toBe(composites.length);
    expect(constraintCount(scratchName, "unique")).toBe(uniques.length);
    // The cross-tenant row the pre-check refused cannot be inserted any more
    // (the keys are NOT VALID, which still enforces every new row).
    const refused = psql(
      scratchName,
      `insert into job_standard (organization_id, job_id, standard_id) values ('org-a', ${org.a.jobId}, ${org.b.standardId});`,
    );
    expect(refused.ok).toBe(false);
    expect(refused.stderr).toContain("job_standard_standard_id_tenant_fk");
  });

  it("REQ-ORG-3: the pre-built unique indexes were adopted (one index, now the constraint's), and the composite keys validate with the DEPLOYMENT.md step", () => {
    // calibration_job / asset: the CONCURRENTLY-built index became the constraint, no duplicate.
    for (const [table, name] of [
      ["calibration_job", "calibration_job_id_org_uidx"],
      ["asset", "asset_id_org_uidx"],
    ] as const) {
      expect(
        mustPsql(
          scratchName,
          `select conindid::regclass::text from pg_constraint where conname = '${name}' and conrelid = '${table}'::regclass;`,
        ).trim(),
        name,
      ).toBe(name);
      expect(
        mustPsql(
          scratchName,
          `select count(*) from pg_index i where i.indrelid = '${table}'::regclass and i.indisunique and i.indnatts = 2 and pg_get_indexdef(i.indexrelid) like '%(id, %organization_id)';`,
        ).trim(),
        `${table} unique (id, org) indexes`,
      ).toBe("1");
    }
    // The composite keys were added NOT VALID: enforced, not yet marked validated.
    const unvalidated = () =>
      Number(
        mustPsql(
          scratchName,
          `select count(*) from pg_constraint where contype = 'f' and conname like '%\\_tenant\\_fk' and not convalidated;`,
        ).trim(),
      );
    const total = TABLES_AT_0118.flatMap((table) => table.compositeKeys).length;
    expect(unvalidated()).toBe(total);
    // The step of DEPLOYMENT.md, verbatim: one statement per constraint, each in autocommit
    // (\\gexec), so psql sends no BEGIN around them. Running it twice is harmless.
    const step = documentedSql(
      /SELECT format\('ALTER TABLE %s VALIDATE CONSTRAINT[\s\S]*?\\gexec/,
    );
    expect(step).not.toMatch(/\bDO \$\$/);
    mustPsql(scratchName, step);
    expect(unvalidated()).toBe(0);
    mustPsql(scratchName, step);
    expect(unvalidated()).toBe(0);
  });

  it("REQ-ORG-2: a NEW audit row without an organization is refused by the CHECK; the audit logs are append-only again", () => {
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
      'violates check constraint "job_audit_log_organization_id_required"',
    );
    // With an organization it is accepted.
    mustPsql(
      scratchName,
      `insert into job_audit_log (organization_id, job_id, action, performed_by) values ('org-a', ${org.a.jobId}, 'x', 'user-org-a');`,
    );
    // The constraint is NOT VALID while orphans remain: VALIDATE fails until they are attributed or archived.
    const validate = psql(
      scratchName,
      `alter table job_audit_log validate constraint job_audit_log_organization_id_required;`,
    );
    expect(validate.ok).toBe(false);
  });

  it("REQ-ORG-2: running it again changes nothing", () => {
    const before = snapshot(scratchName);
    const columns = columnCount(scratchName);
    const composites = constraintCount(scratchName, "tenant_fk");
    const uniques = constraintCount(scratchName, "unique");

    const again = psql(scratchName, MIGRATION);
    expect(again.ok, again.stderr).toBe(true);

    expect(snapshot(scratchName)).toEqual(before);
    expect(columnCount(scratchName)).toBe(columns);
    expect(constraintCount(scratchName, "tenant_fk")).toBe(composites);
    expect(constraintCount(scratchName, "unique")).toBe(uniques);
  });
});
