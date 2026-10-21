import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, truncateAll } from "../test/integration/db";
import { seedOrg } from "../test/integration/seed";
import { seedIssuableJob } from "../test/integration/seed-certificate";

/**
 * The worker writes to calibration_job after approval (the thermal label, the
 * SUPERSEDED watermark refresh). Migration 0115 freezes an approved job in
 * Postgres, so the worker tier must run against those triggers and prove the
 * worker's own statements stay inside the allow-list.
 */
beforeEach(async () => {
  await truncateAll();
});

async function seedJob(status: "APPROVED" | "SUPERSEDED") {
  const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
  const job = await seedIssuableJob({
    organizationId: org.orgId,
    unitId: org.unitId,
    userId: org.userId,
    status,
  });
  return job;
}

function firstRow(result: unknown): Record<string, unknown> | undefined {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === "object" && "rows" in result
      ? result.rows
      : [];
  return Array.isArray(rows) ? rows[0] : undefined;
}

describe("worker real-DB tier runs against the immutability triggers", () => {
  it("REQ-DBIMM-001 the worker database carries the calibration_job guard and the append-only triggers", async () => {
    const guard = firstRow(
      await db.execute(
        sql`select count(*)::int as n from pg_trigger
            where tgname = 'calibration_job_immutable_guard' and not tgisinternal`,
      ),
    );
    const appendOnly = firstRow(
      await db.execute(
        sql`select count(*)::int as n from pg_trigger
            where tgfoid = 'calibra_append_only'::regproc and not tgisinternal`,
      ),
    );

    expect(guard?.n).toBe(1);
    expect(appendOnly?.n).toBe(27);
  });

  it("REQ-DBIMM-002 the worker's label write (label_url + updated_at) on an APPROVED job is allowed", async () => {
    const job = await seedJob("APPROVED");

    await db.execute(sql`
      UPDATE calibration_job
         SET label_url = 'https://storage.invalid/label.png', updated_at = now()
       WHERE id = ${job.jobId}`);

    const row = firstRow(
      await db.execute(
        sql`select label_url from calibration_job where id = ${job.jobId}`,
      ),
    );
    expect(row?.label_url).toBe("https://storage.invalid/label.png");
  });

  it("REQ-DBIMM-002 the worker's SUPERSEDED watermark refresh (same certificate, status kept) is allowed", async () => {
    const job = await seedJob("SUPERSEDED");

    await db.execute(sql`
      UPDATE calibration_job
         SET status = 'SUPERSEDED',
             certificate_url = certificate_url,
             signature_metadata = signature_metadata,
             signature_verdict = signature_verdict,
             updated_at = now()
       WHERE id = ${job.jobId} AND status = 'SUPERSEDED'`);

    const row = firstRow(
      await db.execute(
        sql`select status from calibration_job where id = ${job.jobId}`,
      ),
    );
    expect(row?.status).toBe("SUPERSEDED");
  });

  it("REQ-DBIMM-001 an approved job's results cannot be rewritten through the worker's connection either", async () => {
    const job = await seedJob("APPROVED");

    await expect(
      db.execute(
        sql`UPDATE calibration_job SET results = '{"value": 1}'::jsonb WHERE id = ${job.jobId}`,
      ),
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining("column results is frozen") },
    });
  });
});
