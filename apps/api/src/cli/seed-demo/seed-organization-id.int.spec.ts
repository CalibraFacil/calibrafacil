/**
 * seed-organization-id.int.spec.ts: REQ-ORG-5 for the demo seed and the seeds of
 * packages/db.
 *
 * The demo seed creates its tenant rows through the application's own writers (the
 * HTTP API in-process), which set organization_id; the only direct database writes
 * of the seed are the back-dating updates of apps/api/src/cli/seed-demo/timeline.ts.
 * So the guarantee has two halves, both tested here:
 *   1. the back-dating rewrites the audit rows, standards links and the job's
 *      timeline WITHOUT touching their organization (non-null, the lab's);
 *   2. no seed writer inserts into a tenant child table without naming
 *      organizationId (a source scan over apps/api/src/cli/seed-demo and the
 *      packages/db seeds, so a new writer cannot skip it).
 */
import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { assetAuditLog, jobAuditLog } from "@calibra-facil/db/schema";
import { ORGANIZATION_BACKFILL } from "@calibra-facil/db/tenancy";
import { truncateAll } from "../../../test/integration/db";
import {
  seedTenant,
  seedTenantChildren,
} from "../../../test/integration/tenancy-fixture";
import { getExecuteRows } from "../../lib/db";
import { applyJobTimeline } from "./timeline";

function camel(table: string): string {
  return table.replace(/_([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

const TENANT_CHILD_EXPORTS = new Set(
  ORGANIZATION_BACKFILL.map((entry) => camel(entry.table)),
);

function sourceFiles(directory: URL): URL[] {
  const inDb = directory.pathname.endsWith("/packages/db/src/");
  return (
    readdirSync(directory)
      .filter((name) => name.endsWith(".ts") && !name.includes(".spec."))
      // packages/db/src also holds the schema and runtime modules: only its seeds are seed writers.
      .filter((name) => !inDb || name.startsWith("seed-"))
      .map((name) => new URL(name, directory))
  );
}

describe("REQ-ORG-5: the seeds set the lab organization on tenant child rows", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-ORG-5: the seed's back-dating keeps every audit row and standards link attributed to the lab (non-null)", async () => {
    const lab = await seedTenant("org-seed");
    await seedTenantChildren(lab);
    // The "last calibration date advanced" row the timeline back-dates.
    await db.insert(assetAuditLog).values({
      organizationId: lab.orgId,
      assetId: lab.assetId,
      action: "update",
      performedBy: lab.userId,
    });
    const decidedAt = new Date("2026-03-10T12:00:00.000Z");

    await applyJobTimeline(
      lab.jobId,
      lab.assetId,
      {
        createdAt: new Date("2026-03-01T09:00:00.000Z"),
        dueDate: new Date("2026-04-01T09:00:00.000Z"),
        performedAt: new Date("2026-03-05T09:00:00.000Z"),
        submittedAt: new Date("2026-03-06T09:00:00.000Z"),
        decidedAt,
        final: "APPROVED",
      },
      new Date("2020-01-01T00:00:00.000Z"),
    );

    for (const [table, where] of [
      ["job_audit_log", sql`job_id = ${lab.jobId}`],
      ["job_standard", sql`job_id = ${lab.jobId}`],
      ["asset_audit_log", sql`asset_id = ${lab.assetId}`],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      const rows = getExecuteRows<{ organization_id: string | null }>(
        await db.execute(
          sql`select organization_id from ${sql.identifier(table)} where ${where}`,
        ),
      );
      expect(rows.length, table).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.organization_id, table).toBe(lab.orgId);
      }
    }
    // ... and the rewrite really happened on those rows.
    const [audit] = await db
      .select({ performedAt: jobAuditLog.performedAt })
      .from(jobAuditLog)
      .where(
        sql`${jobAuditLog.jobId} = ${lab.jobId} and ${jobAuditLog.action} = 'create'`,
      );
    expect(audit?.performedAt.toISOString()).toBe("2026-03-01T09:00:00.000Z");
  });

  it("REQ-ORG-5: no demo-seed or packages/db seed writer inserts a tenant child row without organizationId", () => {
    const directories = [
      new URL("./", import.meta.url),
      new URL("../../../../../packages/db/src/", import.meta.url),
    ];
    const inserts: string[] = [];
    for (const directory of directories) {
      for (const file of sourceFiles(directory)) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(/\.insert\((\w+)\)/g)) {
          const name = match[1] ?? "";
          if (!TENANT_CHILD_EXPORTS.has(name)) continue;
          const end = source.indexOf(";", match.index);
          const statement = source.slice(match.index, end);
          inserts.push(`${file.pathname.split("/").at(-1)}:${name}`);
          expect(statement, `${file.pathname} inserts ${name}`).toContain(
            "organizationId",
          );
        }
      }
    }
    // Today the seeds insert none (they go through the API); the scan is the guard.
    expect(inserts).toEqual([]);
  });
});
