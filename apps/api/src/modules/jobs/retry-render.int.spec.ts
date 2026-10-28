/**
 * retry-render.int.spec.ts: a failed certificate render is its own state
 * (roadmap 2 C5), against a real Postgres (the transition guard of migration
 * 0139 included).
 *
 *   REQ-C5-RF-1  retryRender: RENDER_FAILED -> GENERATING_PDF, the failure
 *                cleared from the job and kept in the `render_retried` audit row,
 *                the render dispatched again
 *   REQ-C5-RF-2  in queue mode the render row commits with the status change
 *   REQ-C5-RF-3  only a RENDER_FAILED job may be retried; a refusal writes nothing
 *   REQ-C5-RF-4  rejectJob takes a RENDER_FAILED job back to rework (REJECTED)
 *   REQ-C5-RF-5  the database guard refuses the old GENERATING_PDF -> REJECTED
 *                move and accepts GENERATING_PDF -> RENDER_FAILED
 */

import { setJobStatus } from "../../../test/integration/job-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import {
  appQueueJob,
  calibrationJob,
  type JobStatus,
} from "@calibra-facil/db/schema";
import { JobStatusSchema } from "@calibra-facil/schemas";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";
import { seedJobForOrg } from "../../../test/integration/tenant-refs";
import { auditActions, jobRow } from "../../../test/integration/job-cas";
import { enqueueBackgroundJob } from "../../lib/background-jobs";
import type { JobLifecycleActor } from "./job-actor";
import { rejectJob } from "./reject-job";
import { retryRender } from "./retry-render";

vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

const ORG = "org-c5rf";
const USER = "user-c5rf-admin";
const RENDER_ERROR = "Erro ao gerar certificado: Gotenberg indisponível";

const actor: JobLifecycleActor = {
  kind: "user",
  userId: USER,
  ipAddress: "203.0.113.7",
};

async function seedJob(status: JobStatus) {
  const org = await seedOrg({ orgId: ORG, userId: USER, role: "admin" });
  const { jobId } = await seedJobForOrg({
    orgId: ORG,
    unitId: org.unitId,
    createdBy: USER,
  });
  await setJobStatus(jobId, status);
  if (status === "RENDER_FAILED") {
    await db
      .update(calibrationJob)
      .set({
        rejectionReason: RENDER_ERROR,
        rejectedBy: USER,
        rejectedAt: new Date(),
      })
      .where(eq(calibrationJob.id, jobId));
  }
  return jobId;
}

const retry = (jobId: number) =>
  retryRender({ actor, jobId, organizationId: ORG, unitScope: null });

beforeEach(async () => {
  await truncateAll();
  vi.mocked(enqueueBackgroundJob).mockClear();
  vi.stubEnv("BACKGROUND_JOBS_MODE", "local");
  vi.stubEnv("DOCUMENT_WORKER_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("retryRender (roadmap 2 C5)", () => {
  it("REQ-C5-RF-1: RENDER_FAILED -> GENERATING_PDF, failure cleared from the job and kept in the audit row, render dispatched", async () => {
    const jobId = await seedJob("RENDER_FAILED");

    const result = await retry(jobId);

    expect(result.status).toBe("ok");
    const after = await jobRow(jobId);
    expect(after.status).toBe("GENERATING_PDF");
    expect(after.rejectionReason).toBeNull();
    expect(after.rejectedBy).toBeNull();
    expect(after.rejectedAt).toBeNull();
    expect((await auditActions(jobId)).at(-1)).toBe("render_retried");
    expect(enqueueBackgroundJob).toHaveBeenCalledWith({ jobId, userId: USER });
  });

  it("REQ-C5-RF-2: in queue mode the render row commits with the status change", async () => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
    const jobId = await seedJob("RENDER_FAILED");

    expect((await retry(jobId)).status).toBe("ok");

    const rows = await db.select().from(appQueueJob);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("CERTIFICATE");
    expect(rows[0]?.payload).toMatchObject({ jobId, userId: USER });
    expect(enqueueBackgroundJob).not.toHaveBeenCalled();
  });

  it.each(
    JobStatusSchema.options.filter((status) => status !== "RENDER_FAILED"),
  )(
    "REQ-C5-RF-3: a %s job is not retried and nothing is written",
    async (status) => {
      const jobId = await seedJob(status);
      const before = await auditActions(jobId);

      const result = await retry(jobId);

      expect(result.status).toBe("illegal_transition");
      expect((await jobRow(jobId)).status).toBe(status);
      expect(await auditActions(jobId)).toEqual(before);
      expect(enqueueBackgroundJob).not.toHaveBeenCalled();
    },
  );

  it("REQ-C5-RF-3: a job of another laboratory is not found", async () => {
    const jobId = await seedJob("RENDER_FAILED");

    const result = await retryRender({
      actor,
      jobId,
      organizationId: "org-c5rf-other",
      unitScope: null,
    });

    expect(result.status).toBe("not_found");
    expect((await jobRow(jobId)).status).toBe("RENDER_FAILED");
  });
});

describe("a failed render back to rework (roadmap 2 C5)", () => {
  it("REQ-C5-RF-4: rejectJob moves RENDER_FAILED -> REJECTED with the reviewer's reason", async () => {
    const jobId = await seedJob("RENDER_FAILED");

    const result = await rejectJob({
      actor,
      jobId,
      organizationId: ORG,
      unitScope: null,
      reason: "Faixa do método incorreta",
    });

    expect(result.status).toBe("ok");
    const after = await jobRow(jobId);
    expect(after.status).toBe("REJECTED");
    expect(after.rejectionReason).toBe("Faixa do método incorreta");
  });
});

describe("the transition guard of migration 0139", () => {
  it("REQ-C5-RF-5: refuses GENERATING_PDF -> REJECTED and accepts GENERATING_PDF -> RENDER_FAILED", async () => {
    const jobId = await seedJob("GENERATING_PDF");

    await expect(
      db
        .update(calibrationJob)
        .set({ status: "REJECTED" })
        .where(eq(calibrationJob.id, jobId)),
    ).rejects.toThrow();
    expect((await jobRow(jobId)).status).toBe("GENERATING_PDF");

    await db
      .update(calibrationJob)
      .set({ status: "RENDER_FAILED" })
      .where(eq(calibrationJob.id, jobId));
    expect((await jobRow(jobId)).status).toBe("RENDER_FAILED");
  });
});
