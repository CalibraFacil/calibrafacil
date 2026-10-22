import { describe, it } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-job-audit-insert-outside-owner";

const DRIZZLE_INSERT =
  "export const w = (tx: any) => tx.insert(jobAuditLog).values({});\n";

describe("calibra/no-job-audit-insert-outside-owner (real oxlint)", () => {
  it("REQ-AUD-3: reports insert(jobAuditLog) in a job command, a route and the worker", async () => {
    await expectViolation(RULE, {
      "apps/api/src/modules/jobs/new-command.ts": DRIZZLE_INSERT,
    });
    await expectViolation(RULE, {
      "apps/api/src/routes/jobs.ts": DRIZZLE_INSERT,
    });
    await expectViolation(RULE, { "apps/worker/src/index.ts": DRIZZLE_INSERT });
  }, 60_000);

  it("REQ-AUD-3: reports the transaction, namespaced, multi-line and executor forms", async () => {
    await expectViolation(RULE, {
      "apps/api/src/lib/tx-form.ts":
        "export const w = async (db: any) => db.transaction(async (tx: any) => tx.insert(jobAuditLog).values({}));\n",
    });
    await expectViolation(RULE, {
      "apps/api/src/lib/ns-form.ts":
        "export const w = (db: any, schema: any) => db.insert(schema.jobAuditLog).values({});\n",
    });
    await expectViolation(RULE, {
      "apps/api/src/lib/multi-line.ts":
        "export const w = (db: any) =>\n  db\n    .insert(\n      jobAuditLog,\n    )\n    .values({});\n",
    });
  }, 60_000);

  it("REQ-AUD-3: reports raw SQL that inserts into job_audit_log (the worker's pg client)", async () => {
    await expectViolation(RULE, {
      "apps/worker/src/raw.ts":
        "export const w = (client: any) => client.query(`\n    INSERT INTO job_audit_log (organization_id, job_id)\n    VALUES ($1, $2)\n  `, []);\n",
    });
    await expectViolation(RULE, {
      "apps/api/src/lib/raw-string.ts":
        'export const w = (client: any) => client.query("insert into job_audit_log (job_id) values ($1)", []);\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/lib/raw-quoted.ts":
        "export const w = (client: any) => client.query('INSERT INTO \"job_audit_log\" (job_id) VALUES ($1)', []);\n",
    });
  }, 60_000);

  it("REQ-AUD-3: allows the appendJobEvent module itself", async () => {
    await expectClean(RULE, {
      "packages/db/src/job-events.ts": DRIZZLE_INSERT,
    });
  });

  it("REQ-AUD-3: reads, updates, deletes and other tables are not inserts to guard", async () => {
    await expectClean(RULE, {
      "apps/api/src/routes/other.ts":
        "export const a = (db: any) => db.select().from(jobAuditLog);\n" +
        "export const b = (db: any) => db.update(jobAuditLog).set({});\n" +
        "export const c = (db: any) => db.insert(assetAuditLog).values({});\n" +
        "export const d = (db: any) => db.insert(methodAuditLog).values({});\n" +
        "export const e = (c: any) => c.query('SELECT * FROM job_audit_log');\n" +
        "export const f = (c: any) => c.query('INSERT INTO asset_audit_log (x) VALUES ($1)');\n",
    });
  });

  it("REQ-AUD-3: tests and test helpers are allowlisted explicitly", async () => {
    await expectClean(RULE, {
      "apps/api/src/routes/foo.spec.ts": DRIZZLE_INSERT,
      "apps/api/src/routes/foo.int.spec.ts": DRIZZLE_INSERT,
      "apps/api/src/lib/__tests__/bar.ts": DRIZZLE_INSERT,
      "apps/api/test/integration/tenancy-fixture.ts": DRIZZLE_INSERT,
      "apps/worker/test/integration/db.ts": DRIZZLE_INSERT,
    });
  }, 60_000);

  it("REQ-AUD-3: has no grandfathered legacy writers (every site goes through appendJobEvent)", async () => {
    await expectViolation(RULE, {
      "apps/api/src/cli/seed-demo/timeline.ts": DRIZZLE_INSERT,
    });
    await expectViolation(RULE, {
      "packages/db/src/queue-render-recovery.ts": DRIZZLE_INSERT,
    });
  }, 60_000);
});
