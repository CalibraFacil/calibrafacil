/**
 * standards-recall-in-flight.int.spec.ts: roadmap 2 B5 (REQ-B5-4, REQ-B5-5) [HIGH RISK].
 *
 * A reference-standard recall (ISO/IEC 17025 §6.4, §7.10) used to see only the
 * certificates already issued (APPROVED / SUPERSEDED). The jobs still on the way
 * to a certificate (DRAFT, IN_PROGRESS, REVIEW, GENERATING_PDF) that rely on the
 * standard were invisible: nobody knew an approval was about to put a recalled
 * standard on a new certificate. Through the real routes and middleware, as the
 * application role `calibra_app`:
 *
 *   REQ-B5-4  the recall impact lists the in-flight jobs that use the standard, next
 *             to the issued certificates; and the approval of one of them is refused
 *             while the standard is recalled (the same re-judgement as the approval gate).
 *   REQ-B5-5  cross-laboratory: another laboratory's standard is a 404 and its jobs
 *             never appear in this laboratory's impact.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  jobStandard,
  referenceStandard,
  standardRecall,
} from "@calibra-facil/db/schema";
import { standardsRouter } from "./standards";
import { jobsRouter } from "./jobs";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedStandard } from "../../test/integration/seed";
import {
  seedExtraMember,
  seedJobForOrg,
} from "../../test/integration/tenant-refs";
import { executableMethodSnapshot } from "../../test/integration/executable-method";
import { insertJobs } from "../../test/integration/job-fixtures";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/storage")>();
  return {
    ...actual,
    createR2Client: vi.fn(() => ({ send: vi.fn() })),
    uploadToR2: vi.fn().mockResolvedValue(undefined),
    generatePresignedUrl: vi
      .fn()
      .mockResolvedValue("https://storage.example.test/signed.pdf"),
  };
});

vi.mock("@calibra-facil/notifications", () => ({
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
  notifyNCEscalatedToCapa: vi.fn().mockResolvedValue(undefined),
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyAssetFoundOutOfTolerance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/scope-compliance", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/scope-compliance")>();
  return {
    ...actual,
    classifyJobScopeCompliance: vi.fn(async () => ({
      compliance: null,
      enforcementMode: "warn",
    })),
  };
});

const JSON_HEADERS = { "content-type": "application/json" } as const;

type Impact = {
  data: Array<{ jobId: number; status: string }>;
  inFlight: Array<{
    jobId: number;
    certificateNumber: string;
    status: string;
    performedAt: string | null;
    customer: { id: number; name: string };
  }>;
};

function standards(path: string, method: string, body?: unknown) {
  return standardsRouter.request(path, {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedWorld() {
  const a = await seedOrg({ orgId: "org-a", userId: "user-a", role: "admin" });
  await seedExtraMember({ orgId: "org-a", userId: "user-a2", role: "admin" });
  const b = await seedOrg({ orgId: "org-b", userId: "user-b", role: "admin" });
  const standardA = await seedStandard({
    organizationId: a.orgId,
    unitId: a.unitId,
    createdBy: a.userId,
    name: "Massa padrão A",
  });
  const standardB = await seedStandard({
    organizationId: b.orgId,
    unitId: b.unitId,
    createdBy: b.userId,
    name: "Massa padrão B",
  });
  const refsA = await seedJobForOrg({
    orgId: a.orgId,
    unitId: a.unitId,
    createdBy: a.userId,
  });
  const refsB = await seedJobForOrg({
    orgId: b.orgId,
    unitId: b.unitId,
    createdBy: b.userId,
  });
  const [templateA] = await db
    .select({ customerId: calibrationJob.customerId })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, refsA.jobId));
  const [templateB] = await db
    .select({ customerId: calibrationJob.customerId })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, refsB.jobId));
  if (!templateA || !templateB) throw new Error("template jobs missing");
  return {
    a,
    b,
    standardA,
    standardB,
    refsA: { ...refsA, customerId: templateA.customerId },
    refsB: { ...refsB, customerId: templateB.customerId },
  };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

let counter = 0;
async function jobUsing(
  world: World,
  lab: "a" | "b",
  standardId: number,
  status: typeof calibrationJob.$inferInsert.status,
) {
  counter += 1;
  const org = lab === "a" ? world.a : world.b;
  const refs = lab === "a" ? world.refsA : world.refsB;
  const [row] = await insertJobs({
    jobId: `CAL-RECALL-${counter}`,
    organizationId: org.orgId,
    unitId: org.unitId,
    customerId: refs.customerId,
    assetId: refs.assetId,
    serviceId: refs.serviceId,
    createdBy: org.userId,
    technicianId: org.userId,
    submittedBy: status === "REVIEW" ? org.userId : null,
    performedAt: new Date(),
    status,
    methodSnapshot: executableMethodSnapshot(),
    certificateName: "cert",
    ...(status === "APPROVED" || status === "GENERATING_PDF"
      ? { approvedAt: new Date() }
      : {}),
  });
  if (!row) throw new Error("job insert failed");
  await db.insert(jobStandard).values({
    organizationId: org.orgId,
    jobId: row.id,
    standardId,
    usedAt: new Date(),
  });
  return row.id;
}

describe("standard recall covers in-flight jobs (roadmap 2 B5)", () => {
  let world: World;

  beforeEach(async () => {
    await truncateAll();
    world = await seedWorld();
    loginAs({ userId: world.a.userId, organizationId: world.a.orgId });
  });

  it("REQ-B5-4 [HIGH RISK]: the impact lists the in-flight jobs (DRAFT, IN_PROGRESS, REVIEW, GENERATING_PDF) beside the issued certificates, and nothing else", async () => {
    const approved = await jobUsing(world, "a", world.standardA, "APPROVED");
    const draft = await jobUsing(world, "a", world.standardA, "DRAFT");
    const inProgress = await jobUsing(
      world,
      "a",
      world.standardA,
      "IN_PROGRESS",
    );
    const review = await jobUsing(world, "a", world.standardA, "REVIEW");
    const generating = await jobUsing(
      world,
      "a",
      world.standardA,
      "GENERATING_PDF",
    );
    // Not in flight: closed without a certificate.
    await jobUsing(world, "a", world.standardA, "CANCELED");
    await jobUsing(world, "a", world.standardA, "REJECTED");
    // Another laboratory's job that uses ITS standard.
    const foreign = await jobUsing(world, "b", world.standardB, "REVIEW");

    const flagged = await standards(`/${world.standardA}`, "PUT", {
      status: "OUT_OF_TOLERANCE",
    });
    expect(flagged.status).toBe(200);
    expect(
      await db
        .select({ id: standardRecall.id })
        .from(standardRecall)
        .where(eq(standardRecall.standardId, world.standardA)),
    ).toHaveLength(1);

    const res = await standards(
      `/${world.standardA}/impacted-certificates`,
      "GET",
    );
    expect(res.status).toBe(200);
    const body: Impact = await res.json();

    expect(body.data.map((row) => row.jobId)).toEqual([approved]);
    expect(body.inFlight.map((row) => row.jobId).sort()).toEqual(
      [draft, inProgress, review, generating].sort(),
    );
    expect(body.inFlight.map((row) => row.jobId)).not.toContain(foreign);
    const byId = new Map(body.inFlight.map((row) => [row.jobId, row]));
    expect(byId.get(review)).toMatchObject({
      status: "REVIEW",
      certificateNumber: expect.stringMatching(/^CAL-RECALL-/),
      customer: { name: expect.any(String) },
    });
    expect(byId.get(generating)?.status).toBe("GENERATING_PDF");
  });

  it("REQ-B5-4: a standard no job uses has an empty in-flight list", async () => {
    await jobUsing(world, "a", world.standardA, "REVIEW");
    const [unused] = await db
      .insert(referenceStandard)
      .values({
        organizationId: world.a.orgId,
        unitId: world.a.unitId,
        createdBy: world.a.userId,
        name: "Padrão sem uso",
        kind: "generic_scalar",
        serialNumber: "SN-UNUSED",
        certificateNumber: "CERT-UNUSED",
        calibrationDate: new Date("2026-01-01T00:00:00.000Z"),
        nextCalibrationDate: new Date("2027-01-01T00:00:00.000Z"),
        coverageFactor: 2,
        distribution: "normal",
        status: "ACTIVE",
        referenceValue: 1,
        uncertainty: 0.01,
      })
      .returning({ id: referenceStandard.id });
    if (!unused) throw new Error("standard insert failed");

    const res = await standards(`/${unused.id}/impacted-certificates`, "GET");

    expect(res.status).toBe(200);
    const body: Impact = await res.json();
    expect(body.inFlight).toEqual([]);
  });

  it("REQ-B5-4 [HIGH RISK]: once the standard is recalled, the in-flight REVIEW job is refused at approval and stays in REVIEW", async () => {
    const review = await jobUsing(world, "a", world.standardA, "REVIEW");
    // The standard is on the job's snapshot, as a submit leaves it.
    await db
      .update(calibrationJob)
      .set({
        standardsSnapshot: [
          {
            id: world.standardA,
            name: "Massa padrão A",
            certificateNumber: "CERT-org-a",
            calibrationDate: new Date("2026-01-01T00:00:00.000Z"),
            nextCalibrationDate: new Date("2027-01-01T00:00:00.000Z"),
            uncertainty: 0.05,
            uncertaintyUnit: "g",
            coverageFactor: 2,
            distribution: "normal",
            drift: null,
            certifiedValues: null,
          },
        ],
      })
      .where(eq(calibrationJob.id, review));

    const flagged = await standards(`/${world.standardA}`, "PUT", {
      status: "OUT_OF_TOLERANCE",
    });
    expect(flagged.status).toBe(200);

    loginAs({ userId: "user-a2", organizationId: world.a.orgId });
    const approve = await jobsRouter.request(`/${review}/approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(approve.status).toBe(400);
    const refusal: { code?: string } = await approve.json();
    expect(refusal.code).toBe("standard_inactive");
    const [job] = await db
      .select({
        status: calibrationJob.status,
        approvedBy: calibrationJob.approvedBy,
      })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, review));
    expect(job).toEqual({ status: "REVIEW", approvedBy: null });
  });

  it("REQ-B5-5 [HIGH RISK]: another laboratory's standard is a 404 for this laboratory, and this laboratory's in-flight jobs never reach it", async () => {
    await jobUsing(world, "b", world.standardB, "REVIEW");
    await jobUsing(world, "a", world.standardA, "REVIEW");

    const foreign = await standards(
      `/${world.standardB}/impacted-certificates`,
      "GET",
    );
    expect(foreign.status).toBe(404);

    loginAs({ userId: world.b.userId, organizationId: world.b.orgId });
    const own = await standards(
      `/${world.standardB}/impacted-certificates`,
      "GET",
    );
    expect(own.status).toBe(200);
    const body: Impact = await own.json();
    expect(body.inFlight).toHaveLength(1);
    const ours = await standards(
      `/${world.standardA}/impacted-certificates`,
      "GET",
    );
    expect(ours.status).toBe(404);
  });
});
