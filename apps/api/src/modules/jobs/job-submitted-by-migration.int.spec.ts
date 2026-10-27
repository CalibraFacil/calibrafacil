/**
 * job-submitted-by-migration.int.spec.ts: migration 0134 (roadmap 2 B5, REQ-B5-1).
 *
 * `calibration_job.submitted_by / submitted_at` are backfilled from the job audit
 * log for the jobs that are not frozen yet. The test database is built from
 * schema.ts (the columns already exist), so the SQL of the migration is run here
 * against rows seeded the way a pre-0134 database holds them: submitted_by NULL.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import { calibrationJob, jobAuditLog } from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";
import {
  seedExtraMember,
  seedJobForOrg,
} from "../../../test/integration/tenant-refs";
import { executableMethodSnapshot } from "../../../test/integration/executable-method";
import { insertJobs } from "../../../test/integration/job-fixtures";

const MIGRATION = new URL(
  "../../../../../packages/db/drizzle/0134_job_submitted_by.sql",
  import.meta.url,
);

async function runMigration() {
  const statements = readFileSync(MIGRATION, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

async function submitter(jobId: number) {
  const [row] = await db
    .select({
      submittedBy: calibrationJob.submittedBy,
      submittedAt: calibrationJob.submittedAt,
    })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId));
  if (!row) throw new Error("job missing");
  return row;
}

describe("migration 0134: submitted_by backfill (roadmap 2 B5)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function world() {
    const org = await seedOrg({ orgId: "org-mig", userId: "u-admin" });
    await seedExtraMember({
      orgId: org.orgId,
      userId: "u-other",
      role: "admin",
    });
    const refs = await seedJobForOrg({
      orgId: org.orgId,
      unitId: org.unitId,
      createdBy: "u-admin",
    });
    const [template] = await db
      .select({ customerId: calibrationJob.customerId })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, refs.jobId));
    if (!template) throw new Error("template missing");
    let n = 0;
    const job = async (status: typeof calibrationJob.$inferInsert.status) => {
      n += 1;
      const [row] = await insertJobs({
        jobId: `CAL-MIG-${n}`,
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: template.customerId,
        assetId: refs.assetId,
        serviceId: refs.serviceId,
        createdBy: "u-admin",
        technicianId: "u-admin",
        status,
        methodSnapshot: executableMethodSnapshot(),
        certificateName: "cert",
      });
      if (!row) throw new Error("job insert failed");
      return row.id;
    };
    const submitAudit = async (
      jobId: number,
      userId: string,
      at: string,
      organizationId = org.orgId,
    ) => {
      await db.insert(jobAuditLog).values({
        organizationId,
        jobId,
        action: "submit",
        performedBy: userId,
        performedAt: new Date(at),
        changes: {},
      });
    };
    return { org, job, submitAudit };
  }

  it("REQ-B5-1 [HIGH RISK]: a job in review gets the actor and time of its LATEST submit; frozen and legacy jobs are left alone", async () => {
    const { org, job, submitAudit } = await world();
    const review = await job("REVIEW");
    const resubmitted = await job("REVIEW");
    const generating = await job("GENERATING_PDF");
    const approved = await job("APPROVED");
    const legacyReview = await job("REVIEW");
    await submitAudit(review, "u-other", "2026-06-01T10:00:00.000Z");
    await submitAudit(resubmitted, "u-admin", "2026-06-01T10:00:00.000Z");
    await submitAudit(resubmitted, "u-other", "2026-06-05T09:30:00.000Z");
    await submitAudit(generating, "u-other", "2026-06-02T08:00:00.000Z");
    await submitAudit(approved, "u-other", "2026-06-03T08:00:00.000Z");
    // legacyReview has no submit audit row at all.
    expect(org.orgId).toBe("org-mig");

    await runMigration();

    expect(await submitter(review)).toEqual({
      submittedBy: "u-other",
      submittedAt: new Date("2026-06-01T10:00:00.000Z"),
    });
    expect(await submitter(resubmitted)).toEqual({
      submittedBy: "u-other",
      submittedAt: new Date("2026-06-05T09:30:00.000Z"),
    });
    expect((await submitter(generating)).submittedBy).toBe("u-other");
    // Approved jobs are frozen records: not rewritten.
    expect(await submitter(approved)).toEqual({
      submittedBy: null,
      submittedAt: null,
    });
    expect(await submitter(legacyReview)).toEqual({
      submittedBy: null,
      submittedAt: null,
    });
  });

  it("REQ-B5-1: an audit row of ANOTHER laboratory with the same job id is never used", async () => {
    const { job, submitAudit } = await world();
    await seedOrg({ orgId: "org-foreign", userId: "u-foreign" });
    const review = await job("REVIEW");
    await submitAudit(
      review,
      "u-foreign",
      "2026-06-01T10:00:00.000Z",
      "org-foreign",
    );

    await runMigration();

    expect((await submitter(review)).submittedBy).toBeNull();
  });

  it("REQ-B5-1: it is idempotent and never overwrites a submitter the application already recorded", async () => {
    const { job, submitAudit } = await world();
    const review = await job("REVIEW");
    await submitAudit(review, "u-other", "2026-06-01T10:00:00.000Z");
    await db
      .update(calibrationJob)
      .set({
        submittedBy: "u-admin",
        submittedAt: new Date("2026-06-09T00:00:00.000Z"),
      })
      .where(eq(calibrationJob.id, review));

    await runMigration();
    await runMigration();

    expect(await submitter(review)).toEqual({
      submittedBy: "u-admin",
      submittedAt: new Date("2026-06-09T00:00:00.000Z"),
    });
  });
});
