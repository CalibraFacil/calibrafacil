import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Env } from "@calibra-facil/jobs-core";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";
import { seedIssuableJob } from "../test/integration/seed-certificate";

/**
 * The certificate worker as `calibra_app` (P2-18f): every connection the
 * handlers open is a session of the application role, which the
 * `tenant_isolation` policies bind (migration 0123), and only the one lookup
 * that learns which laboratory a queue message belongs to uses the owner
 * connection (`DATABASE_OWNER_URL`). If any per-job statement ran without
 * naming the laboratory (`calibra.organization_id`), it would read nothing or
 * be refused by WITH CHECK, and the issuance below would not reach APPROVED.
 *
 *   REQ-WRLS-1  a GENERATING_PDF job is issued as calibra_app: status, snapshot, audit row
 *   REQ-WRLS-2  the final failed delivery rejects the job as calibra_app (setJobError)
 *   REQ-WRLS-3  a label is generated for an approved job as calibra_app, its audit row with it
 *   REQ-WRLS-4  another laboratory's job is untouched
 *   REQ-WRLS-5  the job's laboratory is learnt on the owner connection only: without one the
 *               application role finds no job and nothing is written
 *
 * Gotenberg is the only stub (see certificate-issuance.int.spec.ts).
 */

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => undefined),
  notifyAuditPackReady: vi.fn(async () => undefined),
}));

import { processBackgroundJob } from "@calibra-facil/jobs-core";

const GOTENBERG_URL = "http://gotenberg.test";
const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

function stubGotenberg(options: { fail?: boolean } = {}) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    if (!url.startsWith(GOTENBERG_URL)) return realFetch(input, init);
    if (options.fail) return new Response("boom", { status: 500 });
    return new Response(FAKE_PDF_BYTES, { status: 200 });
  });
}

function toRows(result: unknown): unknown[] {
  if (result && typeof result === "object" && "rows" in result) {
    const inner = Reflect.get(result, "rows");
    return Array.isArray(inner) ? inner : [];
  }
  return Array.isArray(result) ? result : [];
}

function field(row: unknown, key: string): unknown {
  return row && typeof row === "object" && key in row
    ? Reflect.get(row, key)
    : undefined;
}

async function jobColumns(jobId: number) {
  const row = toRows(
    await db.execute(
      sql`SELECT status, certificate_url, label_url, rejection_reason
          FROM calibration_job WHERE id = ${jobId}`,
    ),
  )[0];
  return {
    status: String(field(row, "status")),
    certificateUrl: field(row, "certificate_url"),
    labelUrl: field(row, "label_url"),
    rejectionReason: field(row, "rejection_reason"),
  };
}

async function auditActions(jobId: number): Promise<string[]> {
  return toRows(
    await db.execute(
      sql`SELECT action FROM job_audit_log WHERE job_id = ${jobId} ORDER BY id`,
    ),
  ).map((row) => String(field(row, "action")));
}

async function snapshotCount(jobId: number): Promise<number> {
  return toRows(
    await db.execute(
      sql`SELECT 1 FROM issued_certificate_snapshot WHERE job_id = ${jobId}`,
    ),
  ).length;
}

/** The same database, as a session of the application role. */
function applicationRoleUrl(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.searchParams.set("options", "-c role=calibra_app");
  return url.toString();
}

function envAsApplicationRole(options: { withOwnerUrl: boolean }): Env {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error("DATABASE_URL is not set");
  return {
    ...makeTestEnv({ GOTENBERG_URL }),
    DATABASE_URL: applicationRoleUrl(ownerUrl),
    ...(options.withOwnerUrl ? { DATABASE_OWNER_URL: ownerUrl } : {}),
  };
}

async function seedTwoLabs() {
  const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
  const job = await seedIssuableJob({
    organizationId: org.orgId,
    unitId: org.unitId,
    userId: org.userId,
  });
  const otherOrg = await seedOrg({ orgId: "org-2", userId: "user-org-2" });
  const otherJob = await seedIssuableJob({
    organizationId: otherOrg.orgId,
    unitId: otherOrg.unitId,
    userId: otherOrg.userId,
    jobNumber: "CAL-2026-0002",
  });
  return { org, job, otherJob };
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("certificate worker as calibra_app (P2-18f)", () => {
  it("REQ-WRLS-1 [HIGH RISK] a GENERATING_PDF job is issued: APPROVED, one snapshot, one certificate_generated audit row", async () => {
    stubGotenberg();
    const { org, job } = await seedTwoLabs();

    await processBackgroundJob(envAsApplicationRole({ withOwnerUrl: true }), {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    const after = await jobColumns(job.jobId);
    expect(after.status).toBe("APPROVED");
    expect(after.certificateUrl).toBeTruthy();
    expect(await snapshotCount(job.jobId)).toBe(1);
    expect(
      (await auditActions(job.jobId)).filter(
        (action) => action === "certificate_generated",
      ),
    ).toHaveLength(1);
  });

  it("REQ-WRLS-2 [HIGH RISK] a permanent render failure rejects the job with its audit row", async () => {
    stubGotenberg({ fail: true });
    const { org, job } = await seedTwoLabs();

    await expect(
      processBackgroundJob(
        envAsApplicationRole({ withOwnerUrl: true }),
        { type: "CERTIFICATE", jobId: job.jobId, userId: org.userId },
        // The last delivery: the failure is final, the job is REJECTED.
        { attempt: 1, maxAttempts: 1 },
      ),
    ).rejects.toThrow();

    const after = await jobColumns(job.jobId);
    expect(after.status).toBe("REJECTED");
    expect(String(after.rejectionReason)).toContain(
      "Erro ao gerar certificado",
    );
    expect(await auditActions(job.jobId)).toContain("certificate_error");
    expect(await snapshotCount(job.jobId)).toBe(0);
  });

  it("REQ-WRLS-3 a label is generated for an approved job, with its audit row", async () => {
    stubGotenberg();
    const { org, job } = await seedTwoLabs();
    const env = envAsApplicationRole({ withOwnerUrl: true });
    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    await processBackgroundJob(env, {
      type: "LABEL",
      jobId: job.jobId,
      userId: org.userId,
    });

    expect((await jobColumns(job.jobId)).labelUrl).toBeTruthy();
    expect(await auditActions(job.jobId)).toContain("label_generated");
  });

  it("REQ-WRLS-4 another laboratory's job is untouched", async () => {
    stubGotenberg();
    const { org, job, otherJob } = await seedTwoLabs();
    const before = await jobColumns(otherJob.jobId);

    await processBackgroundJob(envAsApplicationRole({ withOwnerUrl: true }), {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    expect(await jobColumns(otherJob.jobId)).toEqual(before);
    expect(await snapshotCount(otherJob.jobId)).toBe(0);
    expect(await auditActions(otherJob.jobId)).toEqual([]);
  });

  it("REQ-WRLS-5 without the owner connection the application role cannot learn the job's laboratory: nothing is written", async () => {
    stubGotenberg();
    const { org, job } = await seedTwoLabs();

    await expect(
      processBackgroundJob(envAsApplicationRole({ withOwnerUrl: false }), {
        type: "CERTIFICATE",
        jobId: job.jobId,
        userId: org.userId,
      }),
    ).rejects.toThrow();

    expect((await jobColumns(job.jobId)).status).toBe("GENERATING_PDF");
    expect(await snapshotCount(job.jobId)).toBe(0);
  });
});
