/**
 * approval-entry-points.int.spec.ts — the approval policy is ONE policy.
 *
 * Calibration approval has two entry points: the cloud route
 * (`POST /jobs/:id/approve`) and the public API (`POST /v2/jobs/:id/approve`,
 * `PATCH /v2/jobs/:id`). Both go through `approveJob`, whose only completion is
 * the cloud one (the worker renders and signs the PDF). The desktop certificate
 * publish (`POST /sync/certificate-pdfs`, client-rendered bytes) was removed:
 * approval and certificates are online-only. Each rule below is asserted
 * against EVERY entry point it applies to, against a real Postgres and the
 * real RBAC middleware (only the better-auth session, R2 and the
 * queue/notification side effects are faked).
 *
 *   REQ-APPROVAL-001  separation of duties (self-approval refused) — also the key creator
 *   REQ-APPROVAL-002  authorized-signatory roster
 *   REQ-APPROVAL-003  accredited scope (CMC) enforce mode
 *   REQ-APPROVAL-004  environmental justification
 *   REQ-APPROVAL-005  second approval refused, single audit row
 *   REQ-APPROVAL-006  concurrent approvals: exactly one wins; CAS loss writes nothing
 *   REQ-P01-1         POST /sync/certificate-pdfs no longer exists (404, nothing uploaded)
 *   REQ-P01-2         a desktop certificate-publish event is refused with a precise sync code
 *   REQ-P01-4         no client-supplied bytes can set calibration_job.certificate_url
 *   REQ-APPROVAL-008  public API: the key's CREATOR is the approver (role, roster, audit trail records the key)
 *   REQ-APPROVAL-009  public API PATCH cannot move a job into an approval-side status
 */

import { insertJobs } from "../../../test/integration/job-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import {
  appQueueJob,
  asset,
  assetAuditLog,
  assetOotAuditLog,
  assetOotEvent,
  assetType,
  authorizedSignatory,
  calibrationJob,
  customer,
  customerAuditLog,
  jobAuditLog,
  member,
  organization,
  organizationApiKey,
  organizationEventLog,
  service,
  user,
} from "@calibra-facil/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { loginPerRequestHeader } from "../../../test/integration/setup";
import { truncateAll } from "../../../test/integration/db";
import { outsideApplication } from "../../../test/integration/app-role-mode";
import { seedOrg } from "../../../test/integration/seed";
import { createApiKeySecret } from "../../lib/api-keys";
import { jobsRouter } from "../../routes/jobs";
import { syncRouter } from "../../routes/sync";
import { publicApiV2Router } from "../../routes/public-api-v2";
import { approveJob } from "./approve-job";

const mocks = vi.hoisted(() => {
  const scope: {
    adverse: boolean;
    /** Runs after the policy read and before the write: a concurrent actor. */
    hook: (() => Promise<void>) | null;
  } = { adverse: false, hook: null };
  return {
    uploadToR2: vi.fn(async () => undefined),
    enqueue: vi.fn(),
    scope,
  };
});

vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: mocks.enqueue,
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
  notifyAssetFoundOutOfTolerance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage")>();
  return {
    ...actual,
    createR2Client: () => ({ send: vi.fn() }),
    uploadToR2: mocks.uploadToR2,
  };
});

// The CMC classification itself is covered by its own specs; here it is the
// switch that makes every entry point see an enforced, adverse verdict.
vi.mock("../../lib/scope-compliance", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/scope-compliance")>();
  return {
    ...actual,
    classifyJobScopeCompliance: vi.fn(async () => {
      await mocks.scope.hook?.();
      return mocks.scope.adverse
        ? {
            compliance: {
              status: "OUT_OF_SCOPE",
              findings: [],
            },
            enforcementMode: "enforce",
          }
        : { compliance: null, enforcementMode: "warn" };
    }),
  };
});

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * The concurrent reviewer of a lost compare-and-set: another actor, on its own
 * connection and outside the application under test (under the RLS shadow
 * report a request runs as `calibra_app`; the other actor must not).
 */
function concurrentReviewerRejects(jobId: number): Promise<void> {
  return outsideApplication(async () => {
    await db
      .update(calibrationJob)
      .set({ status: "REJECTED" })
      .where(eq(calibrationJob.id, jobId));
  });
}
const R2_ENV = {
  R2_ACCOUNT_ID: "account-1",
  R2_ACCESS_KEY_ID: "access-key-1",
  R2_SECRET_ACCESS_KEY: "secret-key-1",
  R2_BUCKET_NAME: "documents",
};
const PDF_BYTES = new Uint8Array([37, 80, 68, 70]);
const PDF_HASH =
  "315d429b7714cedb6ad04ac31240145257692630457f3c88253c5beceac76027";

// ---------------------------------------------------------------------------
// Fixture: org-a with two admins. `maker` executed/created the job; `checker`
// is the distinct approver. A `technician` member exists to prove role gating.
// ---------------------------------------------------------------------------

const ORG = "org-a";
const MAKER = "user-maker";
const CHECKER = "user-checker";

async function addMember(
  userId: string,
  role: "admin" | "technician" | "owner",
) {
  await db.insert(user).values({
    id: userId,
    name: userId,
    email: `${userId}@lab.test`,
  });
  await db.insert(member).values({
    id: `member-${userId}`,
    organizationId: ORG,
    userId,
    role,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

async function seedFixture() {
  const org = await seedOrg({ orgId: ORG, userId: MAKER, role: "admin" });
  await addMember(CHECKER, "admin");

  await db.insert(organization).values({
    id: "client-a",
    name: "Client A",
    slug: "client-a",
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const [cust] = await db
    .insert(customer)
    .values({
      name: "Customer A",
      labOrganizationId: ORG,
      authOrganizationId: "client-a",
    })
    .returning({ id: customer.id });
  const [type] = await db
    .insert(assetType)
    .values({ name: "AT", slug: "at-a", definition: [] })
    .returning({ id: assetType.id });
  if (!cust || !type) throw new Error("seed failed");
  const [ast] = await db
    .insert(asset)
    .values({
      unitId: org.unitId,
      customerId: cust.id,
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${cust.id})`,
      assetTypeId: type.id,
      name: "Instrument",
      serialNumber: "SN-1",
      tag: "TAG-1",
    })
    .returning({ id: asset.id });
  const [svc] = await db
    .insert(service)
    .values({
      organizationId: ORG,
      unitId: org.unitId,
      name: "Service",
      isActive: true,
    })
    .returning({ id: service.id });
  if (!ast || !svc) throw new Error("seed failed");

  return {
    unitId: org.unitId,
    customerId: cust.id,
    assetId: ast.id,
    assetTypeId: type.id,
    serviceId: svc.id,
  };
}

async function seedReviewJob(
  fixture: Fixture,
  overrides: Partial<typeof calibrationJob.$inferInsert> = {},
): Promise<number> {
  const [row] = await insertJobs({
    jobId: `CAL-2026-${Math.floor(Math.random() * 1e6)}`,
    organizationId: ORG,
    unitId: fixture.unitId,
    customerId: fixture.customerId,
    assetId: fixture.assetId,
    serviceId: fixture.serviceId,
    createdBy: MAKER,
    technicianId: MAKER,
    status: "REVIEW",
    methodSnapshot: {
      methodId: 1,
      methodName: "Test Method",
      methodVersion: 1,
      dataFields: [],
      variableBindings: [],
      formulas: [],
      measurementModels: [],
      validations: [],
      uncertaintyParams: [],
    },
    certificateName: "cert",
    ...overrides,
  });
  if (!row) throw new Error("seedReviewJob failed");
  return row.id;
}

async function readJob(id: number) {
  const [row] = await db
    .select({
      status: calibrationJob.status,
      approvedBy: calibrationJob.approvedBy,
      approvedAt: calibrationJob.approvedAt,
      certificateUrl: calibrationJob.certificateUrl,
      scopeOverrideJustification: calibrationJob.scopeOverrideJustification,
      scopeComplianceStatus: calibrationJob.scopeComplianceStatus,
      rejectedBy: calibrationJob.rejectedBy,
      rejectedAt: calibrationJob.rejectedAt,
      rejectionReason: calibrationJob.rejectionReason,
    })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, id));
  if (!row) throw new Error("job vanished");
  return row;
}

async function releaseAuditRows(id: number) {
  const rows = await db
    .select({
      action: jobAuditLog.action,
      performedBy: jobAuditLog.performedBy,
    })
    .from(jobAuditLog)
    .where(eq(jobAuditLog.jobId, id));
  return rows.filter((row) => row.action === "approve");
}

// ---------------------------------------------------------------------------
// Entry points normalised to one outcome so every rule runs against each.
// ---------------------------------------------------------------------------

type Outcome = { approved: true } | { approved: false; code: string };

type EntryPoint = {
  name: "cloud route" | "public API";
  approve: (jobId: number, userId: string) => Promise<Outcome>;
  /** status a successful release leaves the job in */
  approvedStatus: "GENERATING_PDF";
};

const cloud: EntryPoint = {
  name: "cloud route",
  approvedStatus: "GENERATING_PDF",
  async approve(jobId, userId) {
    loginPerRequestHeader(ORG);
    const res = await jobsRouter.request(`/${jobId}/approve`, {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-test-user-id": userId },
      body: JSON.stringify({}),
    });
    if (res.status === 200) return { approved: true };
    const body: {
      code?: string;
      environmentalSnapshot?: unknown;
      error?: string;
    } = await res.json();
    if (body.code) return { approved: false, code: body.code };
    if (body.environmentalSnapshot !== undefined) {
      return { approved: false, code: "ENVIRONMENTAL_JUSTIFICATION_REQUIRED" };
    }
    return { approved: false, code: "INVALID_STATUS" };
  },
};

/** Seed an API key CREATED BY `userId` and return its raw secret. */
async function seedKeyFor(
  userId: string,
  overrides: Partial<typeof organizationApiKey.$inferInsert> = {},
) {
  const secret = createApiKeySecret();
  const id = `key-${userId}-${Math.random().toString(36).slice(2)}`;
  await db.insert(organizationApiKey).values({
    id,
    organizationId: ORG,
    name: `Key of ${userId}`,
    keyPrefix: secret.keyPrefix,
    keyHash: secret.keyHash,
    scopes: ["jobs:read", "jobs:write"],
    createdBy: userId,
    ...overrides,
  });
  return { id, rawKey: secret.key, prefix: secret.keyPrefix };
}

function publicRequest(
  rawKey: string,
  path: string,
  method: string,
  body: unknown,
) {
  return publicApiV2Router.request(path, {
    method,
    headers: {
      ...JSON_HEADERS,
      "x-api-key": rawKey,
      "idempotency-key": `idem-${Math.random().toString(36).slice(2)}`,
    },
    body: JSON.stringify(body),
  });
}

// The accountable person for a public-API approval is the key's creator, so
// "userId" below is whoever created the key used for the call.
const publicApi: EntryPoint = {
  name: "public API",
  approvedStatus: "GENERATING_PDF",
  async approve(jobId, userId) {
    const key = await seedKeyFor(userId);
    const res = await publicRequest(
      key.rawKey,
      `/jobs/${jobId}/approve`,
      "POST",
      {},
    );
    if (res.status === 200) return { approved: true };
    const body: { error: { code: string } } = await res.json();
    // The public API reports roster/role refusals under one code.
    const codes: Record<string, string> = {
      approval_requires_signatory: "APPROVER_NOT_AUTHORIZED_SIGNATORY",
      self_approval_blocked: "SELF_APPROVAL_BLOCKED",
      scope_violation: "SCOPE_VIOLATION",
      environmental_justification_required:
        "ENVIRONMENTAL_JUSTIFICATION_REQUIRED",
    };
    return {
      approved: false,
      code: codes[body.error.code] ?? body.error.code,
    };
  },
};

// ---------------------------------------------------------------------------

describe("approval policy — one policy across every entry point", () => {
  let fixture: Fixture;
  let entryPoints: EntryPoint[];

  beforeEach(async () => {
    await truncateAll();
    mocks.uploadToR2.mockClear();
    mocks.enqueue.mockReset();
    mocks.enqueue.mockResolvedValue({ messageId: "test-noop" });
    mocks.scope.adverse = false;
    mocks.scope.hook = null;
    fixture = await seedFixture();
    entryPoints = [cloud, publicApi];
  });

  // Not parametrized by `it.each` over a table built at import time: the
  // fixture (unit id) exists only after the per-test seed.
  function eachEntryPoint(
    title: string,
    run: (entry: EntryPoint) => Promise<void>,
  ) {
    for (const name of ["cloud route", "public API"] as const) {
      it(`${title} [${name}]`, async () => {
        const entry = entryPoints.find((candidate) => candidate.name === name);
        if (!entry) throw new Error(`unknown entry point ${name}`);
        await run(entry);
      });
    }
  }

  eachEntryPoint(
    "baseline: a distinct admin approves a REVIEW job and is the recorded approver",
    async (entry) => {
      const jobId = await seedReviewJob(fixture);

      await expect(entry.approve(jobId, CHECKER)).resolves.toEqual({
        approved: true,
      });

      const job = await readJob(jobId);
      expect(job.status).toBe(entry.approvedStatus);
      expect(job.approvedBy).toBe(CHECKER);
      expect(await releaseAuditRows(jobId)).toHaveLength(1);
    },
  );

  eachEntryPoint(
    "REQ-APPROVAL-001: the executing technician cannot approve their own work when another approver exists",
    async (entry) => {
      const jobId = await seedReviewJob(fixture);

      await expect(entry.approve(jobId, MAKER)).resolves.toEqual({
        approved: false,
        code: "SELF_APPROVAL_BLOCKED",
      });

      expect(await readJob(jobId)).toMatchObject({
        status: "REVIEW",
        approvedBy: null,
      });
      expect(await releaseAuditRows(jobId)).toHaveLength(0);
      expect(mocks.uploadToR2).not.toHaveBeenCalled();
    },
  );

  eachEntryPoint(
    "REQ-APPROVAL-001: the job creator cannot approve either",
    async (entry) => {
      const jobId = await seedReviewJob(fixture, {
        technicianId: CHECKER,
        createdBy: MAKER,
      });

      await expect(entry.approve(jobId, MAKER)).resolves.toEqual({
        approved: false,
        code: "SELF_APPROVAL_BLOCKED",
      });
      expect((await readJob(jobId)).status).toBe("REVIEW");
    },
  );

  eachEntryPoint(
    "REQ-APPROVAL-002: an approver outside the signatory roster is refused",
    async (entry) => {
      // The org keeps a roster, and only MAKER is on it.
      await db.insert(authorizedSignatory).values({
        organizationId: ORG,
        userId: MAKER,
        assetTypeId: null,
        status: "ACTIVE",
        authorizedBy: MAKER,
      });
      const jobId = await seedReviewJob(fixture);

      await expect(entry.approve(jobId, CHECKER)).resolves.toEqual({
        approved: false,
        code: "APPROVER_NOT_AUTHORIZED_SIGNATORY",
      });

      expect((await readJob(jobId)).status).toBe("REVIEW");
      expect(await releaseAuditRows(jobId)).toHaveLength(0);
      expect(mocks.uploadToR2).not.toHaveBeenCalled();
    },
  );

  eachEntryPoint(
    "REQ-APPROVAL-003: an enforced accredited-scope violation blocks the release",
    async (entry) => {
      mocks.scope.adverse = true;
      const jobId = await seedReviewJob(fixture);

      await expect(entry.approve(jobId, CHECKER)).resolves.toEqual({
        approved: false,
        code: "SCOPE_VIOLATION",
      });

      expect((await readJob(jobId)).status).toBe("REVIEW");
      expect(await releaseAuditRows(jobId)).toHaveLength(0);
      expect(mocks.uploadToR2).not.toHaveBeenCalled();
    },
  );

  eachEntryPoint(
    "REQ-APPROVAL-004: out-of-limits environment without a justification blocks the release",
    async (entry) => {
      const jobId = await seedReviewJob(fixture, {
        environmentalSnapshot: {
          withinLimits: false,
          outOfLimitsJustification: null,
        },
      });

      await expect(entry.approve(jobId, CHECKER)).resolves.toEqual({
        approved: false,
        code: "ENVIRONMENTAL_JUSTIFICATION_REQUIRED",
      });

      expect((await readJob(jobId)).status).toBe("REVIEW");
      expect(mocks.uploadToR2).not.toHaveBeenCalled();
    },
  );

  eachEntryPoint(
    "REQ-APPROVAL-005: a second approval is refused and leaves exactly one audit row",
    async (entry) => {
      const jobId = await seedReviewJob(fixture);
      await expect(entry.approve(jobId, CHECKER)).resolves.toEqual({
        approved: true,
      });

      const second = await entry.approve(jobId, CHECKER);

      expect(second.approved).toBe(false);
      expect(await releaseAuditRows(jobId)).toHaveLength(1);
      expect((await readJob(jobId)).approvedBy).toBe(CHECKER);
    },
  );

  eachEntryPoint(
    "REQ-APPROVAL-006: two distinct approvers racing release the job exactly once, and the single audit row names the winner",
    async (entry) => {
      const jobId = await seedReviewJob(fixture);
      const rival = "user-checker-2";
      await addMember(rival, "admin");

      // Each request resolves its own session (x-test-user-id), so these are
      // two different users genuinely in flight at once.
      const approvers = [CHECKER, rival];
      const outcomes = await Promise.all(
        approvers.map((userId) => entry.approve(jobId, userId)),
      );

      const winners = approvers.filter(
        (_userId, index) => outcomes[index]?.approved === true,
      );
      expect(winners).toHaveLength(1);
      const [winner] = winners;
      const audit = await releaseAuditRows(jobId);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.performedBy).toBe(winner);
      const job = await readJob(jobId);
      expect(job.status).toBe(entry.approvedStatus);
      expect(job.approvedBy).toBe(winner);
    },
  );

  it("REQ-APPROVAL-006: the write is compare-and-set — a job that left REVIEW after the read is not overwritten, and no audit row is written", async () => {
    const jobId = await seedReviewJob(fixture);
    const [checker] = await db
      .select()
      .from(member)
      .where(and(eq(member.userId, CHECKER), eq(member.organizationId, ORG)));
    if (!checker) throw new Error("checker missing");

    // The hook runs after the policy read and before the transition: it plays
    // the part of a concurrent reviewer who rejects the job in that window.
    mocks.scope.hook = () => concurrentReviewerRejects(jobId);

    const result = await approveJob({
      jobId,
      actor: {
        kind: "user",
        member: {
          id: checker.id,
          role: "admin",
          organizationId: ORG,
          organizationType: "LAB",
          userId: CHECKER,
          activeUnitId: fixture.unitId,
          activeUnitName: "Matriz",
          accessibleUnitIds: [fixture.unitId],
          accessibleUnits: [],
          selectedUnitScope: "all",
          canAccessAllUnits: true,
          unitRole: null,
        },
      },
      values: {},
      metadata: {},
      completion: {
        kind: "generate_certificate_pdf",
        sendServiceOrdersToFinance: async () => [],
      },
    });

    expect(result).toEqual({ status: "concurrent_approval" });
    expect(await readJob(jobId)).toMatchObject({
      status: "REJECTED",
      approvedBy: null,
      certificateUrl: null,
    });
    expect(await releaseAuditRows(jobId)).toHaveLength(0);
  });

  it("REQ-APPROVAL-006: the cloud route maps a lost compare-and-set to 409 APPROVAL_CONFLICT", async () => {
    const jobId = await seedReviewJob(fixture);
    // A concurrent reviewer rejects the job between the policy read and the write.
    mocks.scope.hook = () => concurrentReviewerRejects(jobId);

    loginPerRequestHeader(ORG);
    const res = await jobsRouter.request(`/${jobId}/approve`, {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-test-user-id": CHECKER },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body.code).toBe("APPROVAL_CONFLICT");
    expect(await readJob(jobId)).toMatchObject({
      status: "REJECTED",
      approvedBy: null,
    });
    expect(await releaseAuditRows(jobId)).toHaveLength(0);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("REQ-APPROVAL-006: the public API maps a lost compare-and-set to 409 approval_conflict", async () => {
    const jobId = await seedReviewJob(fixture);
    const key = await seedKeyFor(CHECKER);
    mocks.scope.hook = () => concurrentReviewerRejects(jobId);

    const res = await publicRequest(
      key.rawKey,
      `/jobs/${jobId}/approve`,
      "POST",
      {},
    );

    expect(res.status).toBe(409);
    const body: { error: { code: string } } = await res.json();
    expect(body.error.code).toBe("approval_conflict");
    expect(await releaseAuditRows(jobId)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // dispatch (outbox / compensation)
  // -------------------------------------------------------------------------

  it.each(["cloud route", "public API"] as const)(
    "REQ-APPROVAL-011: when dispatching the certificate job fails the approval is reverted to REVIEW with an audit note [%s]",
    async (name) => {
      const entry = entryPoints.find((candidate) => candidate.name === name);
      if (!entry) throw new Error("entry point missing");
      const jobId = await seedReviewJob(fixture);
      mocks.enqueue.mockRejectedValueOnce(new Error("queue down"));

      await expect(entry.approve(jobId, CHECKER)).resolves.toMatchObject({
        approved: false,
      });

      expect(await readJob(jobId)).toMatchObject({
        status: "REVIEW",
        approvedBy: null,
        approvedAt: null,
      });
      const actions = (
        await db
          .select({ action: jobAuditLog.action, reason: jobAuditLog.reason })
          .from(jobAuditLog)
          .where(eq(jobAuditLog.jobId, jobId))
      ).map((row) => row.action);
      expect(actions).toEqual(
        expect.arrayContaining(["approve", "approve_reverted"]),
      );

      // Nothing is stranded: the same approval can simply be retried.
      await expect(entry.approve(jobId, CHECKER)).resolves.toEqual({
        approved: true,
      });
      expect((await readJob(jobId)).status).toBe("GENERATING_PDF");
    },
  );

  describe("with the database queue (BACKGROUND_JOBS_MODE=queue)", () => {
    beforeEach(() => {
      vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
      vi.stubEnv("DOCUMENT_WORKER_URL", "");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("REQ-APPROVAL-011: the queue row is committed with the approval, not dispatched separately", async () => {
      const jobId = await seedReviewJob(fixture);

      await expect(cloud.approve(jobId, CHECKER)).resolves.toEqual({
        approved: true,
      });

      // The certificate job and the approval notification are rows of the queue,
      // committed with the approval (B2: the notification is an outbox job too).
      const rows = await db.select().from(appQueueJob).orderBy(appQueueJob.id);
      expect(rows.map((row) => row.type)).toEqual([
        "CERTIFICATE",
        "JOB_APPROVED_NOTIFICATION",
      ]);
      expect(rows.every((row) => row.status === "PENDING")).toBe(true);
      expect(rows[0]?.payload).toMatchObject({ jobId, userId: CHECKER });
      expect(rows[1]?.payload).toMatchObject({
        type: "JOB_APPROVED_NOTIFICATION",
        jobId,
        userId: CHECKER,
      });
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it("REQ-APPROVAL-011: a refused approval and a lost race queue nothing; racing approvers queue exactly one row", async () => {
      const refused = await seedReviewJob(fixture);
      await expect(cloud.approve(refused, MAKER)).resolves.toMatchObject({
        approved: false,
      });
      expect(await db.select().from(appQueueJob)).toHaveLength(0);

      const raced = await seedReviewJob(fixture, { technicianId: null });
      await addMember("user-checker-2", "admin");
      await Promise.all([
        cloud.approve(raced, CHECKER),
        cloud.approve(raced, "user-checker-2"),
      ]);
      // Exactly one approval won: one certificate row and one notification row.
      const queued = await db.select().from(appQueueJob);
      expect(queued.filter((row) => row.type === "CERTIFICATE")).toHaveLength(
        1,
      );
      expect(
        queued.filter((row) => row.type === "JOB_APPROVED_NOTIFICATION"),
      ).toHaveLength(1);
    });

    it("REQ-APPROVAL-011: if the queue insert fails the whole approval rolls back (job stays REVIEW, no audit row)", async () => {
      const jobId = await seedReviewJob(fixture);
      await db.execute(
        sql`alter table app_queue_job rename to app_queue_job_x`,
      );
      try {
        loginPerRequestHeader(ORG);
        const res = await jobsRouter.request(`/${jobId}/approve`, {
          method: "POST",
          headers: { ...JSON_HEADERS, "x-test-user-id": CHECKER },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(500);
      } finally {
        await db.execute(
          sql`alter table app_queue_job_x rename to app_queue_job`,
        );
      }

      expect(await readJob(jobId)).toMatchObject({
        status: "REVIEW",
        approvedBy: null,
      });
      expect(await releaseAuditRows(jobId)).toHaveLength(0);
    });
  });

  it("REQ-APPROVAL-012: approving a previously rejected, resubmitted job clears the stale rejection", async () => {
    const jobId = await seedReviewJob(fixture, {
      rejectedBy: MAKER,
      rejectedAt: new Date("2026-02-01T00:00:00.000Z"),
      rejectionReason: "Rever incerteza",
      technicianId: null,
    });

    await expect(cloud.approve(jobId, CHECKER)).resolves.toEqual({
      approved: true,
    });

    expect(await readJob(jobId)).toMatchObject({
      status: "GENERATING_PDF",
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    });
  });

  // -------------------------------------------------------------------------
  // REQ-APR-008: non-approval sync events record the session user too
  // -------------------------------------------------------------------------

  async function pushEvent(
    userId: string,
    event: Record<string, unknown>,
  ): Promise<{
    accepted: unknown[];
    rejected: Array<{ code: string; reason: string }>;
  }> {
    loginPerRequestHeader(ORG);
    const res = await syncRouter.request(
      "/push",
      {
        method: "POST",
        headers: { ...JSON_HEADERS, "x-test-user-id": userId },
        body: JSON.stringify({
          deviceId: "device-1",
          clientBatchId: `batch-${Math.random().toString(36).slice(2)}`,
          baseCursor: null,
          events: [
            {
              eventId: `evt-${Math.random().toString(36).slice(2)}`,
              idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
              occurredAt: new Date().toISOString(),
              localVersion: 0,
              organizationId: ORG,
              unitId: fixture.unitId,
              ...event,
            },
          ],
        }),
      },
      R2_ENV,
    );
    return res.json();
  }

  it("REQ-APR-008: a synced asset update is audited as the session user; the claimed actor is metadata only", async () => {
    const body = await pushEvent(CHECKER, {
      entityType: "asset",
      entityId: "local-asset-1",
      operation: "update_local_asset",
      actorUserId: MAKER,
      payload: { remoteId: fixture.assetId, comments: "Ajustado offline" },
    });

    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    const audits = await db
      .select({ performedBy: assetAuditLog.performedBy })
      .from(assetAuditLog)
      .where(eq(assetAuditLog.assetId, fixture.assetId));
    expect(audits.map((row) => row.performedBy)).toEqual([CHECKER]);

    const [event] = await db
      .select()
      .from(organizationEventLog)
      .where(
        eq(organizationEventLog.action, "desktop_sync.update_local_asset"),
      );
    expect(event?.actorUserId).toBe(CHECKER);
    expect(event?.details).toMatchObject({ claimedActorUserId: MAKER });
  });

  it("REQ-APR-008: a synced customer update is audited as the session user; claimed actor kept as metadata; 'local' adds none", async () => {
    const [cust] = await db.select({ id: customer.id }).from(customer);
    if (!cust) throw new Error("customer missing");

    const claimed = await pushEvent(CHECKER, {
      entityType: "customer",
      entityId: "local-customer-1",
      operation: "update_local_customer",
      actorUserId: MAKER,
      payload: { remoteId: cust.id, name: "Renamed by desktop" },
    });
    expect(claimed.accepted).toHaveLength(1);

    const local = await pushEvent(CHECKER, {
      entityType: "customer",
      entityId: "local-customer-1",
      operation: "update_local_customer",
      actorUserId: "local",
      payload: { remoteId: cust.id, name: "Renamed again" },
    });
    expect(local.accepted).toHaveLength(1);

    const audits = await db
      .select({ performedBy: customerAuditLog.performedBy })
      .from(customerAuditLog);
    expect(audits.map((row) => row.performedBy)).toEqual([CHECKER, CHECKER]);

    const events = await db
      .select({ details: organizationEventLog.details })
      .from(organizationEventLog)
      .where(
        and(
          eq(organizationEventLog.action, "desktop_sync.update_local_customer"),
        ),
      );
    expect(events).toHaveLength(2);
    expect(
      events.filter((row) => JSON.stringify(row.details).includes(MAKER)),
    ).toHaveLength(1);
    expect(
      events.filter((row) =>
        JSON.stringify(row.details).includes("claimedActorUserId"),
      ),
    ).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // REQ-P01: the desktop certificate publish path no longer exists
  // -------------------------------------------------------------------------

  function legacyCertificateForm(jobId: number) {
    const form = new FormData();
    const fields: Record<string, string> = {
      eventId: "evt-legacy-publish",
      entityId: "local-draft-legacy",
      operation: "generate_local_certificate_pdf",
      idempotencyKey: "idem-legacy-publish",
      localVersion: "1",
      occurredAt: "2026-05-09T12:00:00.000Z",
      actorUserId: CHECKER,
      organizationId: ORG,
      unitId: String(fixture.unitId),
      localJobId: "local-job-1",
      remoteJobId: String(jobId),
      draftId: "draft-legacy",
      contentHash: PDF_HASH,
      sizeBytes: String(PDF_BYTES.byteLength),
    };
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set(
      "file",
      new File([PDF_BYTES], "draft.pdf", { type: "application/pdf" }),
    );
    return form;
  }

  it.each(["POST", "GET", "PUT", "PATCH", "DELETE"])(
    "REQ-P01-1: %s /sync/certificate-pdfs is 404 for an approver, and no client bytes are stored or published",
    async (method) => {
      const jobId = await seedReviewJob(fixture);
      loginPerRequestHeader(ORG);

      const res = await syncRouter.request(
        "/certificate-pdfs",
        {
          method,
          headers: { "x-test-user-id": CHECKER },
          ...(method === "GET" ? {} : { body: legacyCertificateForm(jobId) }),
        },
        R2_ENV,
      );

      expect(res.status).toBe(404);
      expect(mocks.uploadToR2).not.toHaveBeenCalled();
      expect(await readJob(jobId)).toMatchObject({
        status: "REVIEW",
        approvedBy: null,
        certificateUrl: null,
      });
      expect(await releaseAuditRows(jobId)).toHaveLength(0);
    },
  );

  it("REQ-P01-2: a queued generate_local_certificate_pdf event is refused with a precise code, never published", async () => {
    const jobId = await seedReviewJob(fixture);

    const body = await pushEvent(CHECKER, {
      entityType: "certificate_draft",
      entityId: "local-draft-legacy",
      operation: "generate_local_certificate_pdf",
      actorUserId: CHECKER,
      payload: {
        jobId: "local-job-1",
        remoteJobId: jobId,
        draftId: "draft-legacy",
        contentHash: PDF_HASH,
        sizeBytes: PDF_BYTES.byteLength,
      },
    });

    expect(body.accepted).toHaveLength(0);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]?.code).toBe(
      "OFFLINE_CERTIFICATE_PUBLICATION_NOT_SUPPORTED",
    );
    expect(mocks.uploadToR2).not.toHaveBeenCalled();
    expect(await readJob(jobId)).toMatchObject({
      status: "REVIEW",
      approvedBy: null,
      certificateUrl: null,
    });
    expect(await releaseAuditRows(jobId)).toHaveLength(0);
  });

  it("REQ-P01-4: approving through every remaining entry point never sets certificate_url (only the worker does, from its own render)", async () => {
    for (const entry of entryPoints) {
      const jobId = await seedReviewJob(fixture);
      await expect(entry.approve(jobId, CHECKER)).resolves.toEqual({
        approved: true,
      });
      expect(await readJob(jobId)).toMatchObject({
        status: "GENERATING_PDF",
        certificateUrl: null,
      });
    }
    expect(mocks.uploadToR2).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

describe("approval policy — public API (key creator is the approver)", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll();
    mocks.uploadToR2.mockClear();
    mocks.enqueue.mockReset();
    mocks.enqueue.mockResolvedValue({ messageId: "test-noop" });
    mocks.scope.adverse = false;
    mocks.scope.hook = null;
    fixture = await seedFixture();
  });

  it("REQ-APPROVAL-008: an approval through a key records the creator as approver and the key in the audit row", async () => {
    const jobId = await seedReviewJob(fixture);
    const key = await seedKeyFor(CHECKER, { name: "ERP integration" });

    const res = await publicRequest(
      key.rawKey,
      `/jobs/${jobId}/approve`,
      "POST",
      { reason: "ok" },
    );

    expect(res.status).toBe(200);
    expect(await readJob(jobId)).toMatchObject({
      status: "GENERATING_PDF",
      approvedBy: CHECKER,
    });
    const [audit] = await db
      .select()
      .from(jobAuditLog)
      .where(
        and(eq(jobAuditLog.jobId, jobId), eq(jobAuditLog.action, "approve")),
      );
    expect(audit?.performedBy).toBe(CHECKER);
    expect(audit?.changes).toMatchObject({
      approvedVia: {
        channel: "api_key",
        apiKeyId: key.id,
        apiKeyName: "ERP integration",
        apiKeyPrefix: key.prefix,
      },
    });
  });

  it("REQ-APPROVAL-008: a key whose creator is (now) a technician is refused before it can approve", async () => {
    await addMember("user-tech", "technician");
    const jobId = await seedReviewJob(fixture);
    const key = await seedKeyFor("user-tech");

    const res = await publicRequest(
      key.rawKey,
      `/jobs/${jobId}/approve`,
      "POST",
      {},
    );

    // Roadmap 2 D3: a key acts for its creator's LIVE role, and only an owner or
    // admin may hold one, so the key is refused at authentication (401), before
    // the approval rule (which would answer 403 approval_requires_signatory).
    expect(res.status).toBe(401);
    expect(await readJob(jobId)).toMatchObject({
      status: "REVIEW",
      approvedBy: null,
    });
    expect(await releaseAuditRows(jobId)).toHaveLength(0);
  });

  it("REQ-APPROVAL-008: a key whose creator left the organization cannot approve", async () => {
    await addMember("user-gone", "admin");
    const key = await seedKeyFor("user-gone");
    await db.delete(member).where(eq(member.userId, "user-gone"));
    const jobId = await seedReviewJob(fixture);

    const res = await publicRequest(
      key.rawKey,
      `/jobs/${jobId}/approve`,
      "POST",
      {},
    );

    // Refused at authentication since roadmap 2 D3 (the creator's live role).
    expect(res.status).toBe(401);
    expect((await readJob(jobId)).status).toBe("REVIEW");
  });

  it("REQ-APPROVAL-008: a revoked key is refused by auth (401) and the job is untouched", async () => {
    const jobId = await seedReviewJob(fixture);
    const key = await seedKeyFor(CHECKER, { revokedAt: new Date() });

    const res = await publicRequest(
      key.rawKey,
      `/jobs/${jobId}/approve`,
      "POST",
      {},
    );

    expect(res.status).toBe(401);
    expect((await readJob(jobId)).status).toBe("REVIEW");
  });

  it("REQ-APPROVAL-008: a key without the jobs:write scope is refused 403", async () => {
    const jobId = await seedReviewJob(fixture);
    const key = await seedKeyFor(CHECKER, { scopes: ["jobs:read"] });

    const res = await publicRequest(
      key.rawKey,
      `/jobs/${jobId}/approve`,
      "POST",
      {},
    );

    expect(res.status).toBe(403);
    expect((await readJob(jobId)).status).toBe("REVIEW");
  });

  it.each(["APPROVED", "GENERATING_PDF", "SUPERSEDED", "REVIEW"])(
    "REQ-APPROVAL-009: PATCH /jobs/:id cannot set status %s (use the approve endpoint); the job is untouched",
    async (status) => {
      const jobId = await seedReviewJob(fixture, { status: "IN_PROGRESS" });
      const key = await seedKeyFor(CHECKER);

      const res = await publicRequest(key.rawKey, `/jobs/${jobId}`, "PATCH", {
        status,
      });

      expect(res.status).toBe(400);
      expect((await readJob(jobId)).status).toBe("IN_PROGRESS");
      expect(await releaseAuditRows(jobId)).toHaveLength(0);
    },
  );

  it("REQ-APPROVAL-009: PATCH /jobs/:id still edits the plain fields", async () => {
    const jobId = await seedReviewJob(fixture, { status: "IN_PROGRESS" });
    const key = await seedKeyFor(CHECKER);

    const res = await publicRequest(key.rawKey, `/jobs/${jobId}`, "PATCH", {
      technicianId: CHECKER,
    });

    expect(res.status).toBe(200);
    const [row] = await db
      .select({
        technicianId: calibrationJob.technicianId,
        status: calibrationJob.status,
      })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, jobId));
    expect(row).toEqual({ technicianId: CHECKER, status: "IN_PROGRESS" });
  });
});

// ---------------------------------------------------------------------------
// Roadmap 2 B2 (supersedes the retry model of Q39): the pure database effects
// of an approval (the asset calibration-date advance, the asset out-of-tolerance
// event, each with its audit row) are written in the approval's OWN transaction,
// and the notifications are staged as queue jobs in it. "Never lost, never
// without audit" is now met by atomicity: an approval cannot commit without
// them, and they cannot exist without the approval.
// ---------------------------------------------------------------------------

/**
 * Makes every insert into `table` fail for its first `failures` attempts (a
 * trigger on a SEQUENCE: nextval is not rolled back with the failed
 * transaction, so "fail once" really is once). Returns the cleanup.
 */
async function failInsertsInto(
  table: string,
  failures: number,
): Promise<() => Promise<void>> {
  await db.execute(sql.raw(`CREATE SEQUENCE followup_fail_seq`));
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION followup_fail() RETURNS trigger AS $$
    BEGIN
      IF nextval('followup_fail_seq') <= ${failures} THEN
        RAISE EXCEPTION 'followup_test: ${table} insert forced to fail';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`),
  );
  await db.execute(
    sql.raw(`CREATE TRIGGER followup_fail BEFORE INSERT ON ${table}
      FOR EACH ROW EXECUTE FUNCTION followup_fail()`),
  );
  return async () => {
    await db.execute(
      sql.raw(`DROP TRIGGER IF EXISTS followup_fail ON ${table}`),
    );
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS followup_fail()`));
    await db.execute(sql.raw(`DROP SEQUENCE IF EXISTS followup_fail_seq`));
  };
}

async function assetDates(assetId: number) {
  const [row] = await db
    .select({
      last: asset.lastCalibrationDate,
      next: asset.nextCalibrationDate,
    })
    .from(asset)
    .where(eq(asset.id, assetId));
  const audits = await db
    .select({ action: assetAuditLog.action, changes: assetAuditLog.changes })
    .from(assetAuditLog)
    .where(eq(assetAuditLog.assetId, assetId));
  const sources = audits.map((entry) =>
    typeof entry.changes === "object" && entry.changes !== null
      ? Reflect.get(entry.changes, "source")
      : undefined,
  );
  return { last: row?.last ?? null, next: row?.next ?? null, sources };
}

async function ootRows(jobId: number) {
  const events = await db
    .select({ id: assetOotEvent.id })
    .from(assetOotEvent)
    .where(eq(assetOotEvent.jobId, jobId));
  const audits = await db
    .select({ action: assetOotAuditLog.action })
    .from(assetOotAuditLog);
  return { events, audits: audits.map((entry) => entry.action) };
}

/** A REVIEW job whose as-found verdict derives to NON_CONFORMING. */
function nonConformingJob(fixture: Fixture) {
  return seedReviewJob(fixture, {
    results: { margem_conformidade_antes: [0.2, -0.1] },
    performedAt: new Date("2026-03-01T10:00:00.000Z"),
  });
}

async function approveRaw(jobId: number) {
  loginPerRequestHeader(ORG);
  return jobsRouter.request(`/${jobId}/approve`, {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-test-user-id": CHECKER },
    body: JSON.stringify({}),
  });
}

describe("post-approval effects are atomic with the approval (roadmap 2 B2, Q39)", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll();
    mocks.enqueue.mockReset();
    mocks.enqueue.mockResolvedValue({ messageId: "test-noop" });
    mocks.scope.adverse = false;
    mocks.scope.hook = null;
    fixture = await seedFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("B2 [HIGH RISK]: a normal approval of a non-conforming job writes the OOT event, the date advance and their audit rows with it", async () => {
    const jobId = await nonConformingJob(fixture);

    await expect(cloud.approve(jobId, CHECKER)).resolves.toEqual({
      approved: true,
    });

    expect((await readJob(jobId)).status).toBe("GENERATING_PDF");
    const oot = await ootRows(jobId);
    expect(oot.events).toHaveLength(1);
    expect(oot.audits).toEqual(["create"]);
    const dates = await assetDates(fixture.assetId);
    expect(dates.last).not.toBeNull();
    expect(dates.sources).toEqual(["job_approval"]);
    // In-process dispatch: the certificate job, then the two notifications.
    const types = mocks.enqueue.mock.calls.map(([message]) => message.type);
    expect(types).toEqual([
      undefined,
      "JOB_APPROVED_NOTIFICATION",
      "ASSET_OOT_NOTIFICATION",
    ]);
    expect(mocks.enqueue.mock.calls[2]?.[0]).toMatchObject({
      eventId: oot.events[0]?.id,
      organizationId: ORG,
      userId: CHECKER,
    });
  });

  it("B2: a conforming approval writes the date advance but no OOT event and no customer alert", async () => {
    const jobId = await seedReviewJob(fixture, {
      results: { margem_conformidade_antes: [0.2, 0.1] },
    });

    await expect(cloud.approve(jobId, CHECKER)).resolves.toEqual({
      approved: true,
    });

    expect((await ootRows(jobId)).events).toEqual([]);
    expect((await assetDates(fixture.assetId)).sources).toEqual([
      "job_approval",
    ]);
    const types = mocks.enqueue.mock.calls.map(([message]) => message.type);
    expect(types).not.toContain("ASSET_OOT_NOTIFICATION");
  });

  it.each([
    ["asset_oot_audit_log", "the OOT event's audit row"],
    ["asset_audit_log", "the asset date advance's audit row"],
  ])(
    "B2 [HIGH RISK]: a forced failure on %s (%s) rolls the WHOLE approval back: nothing committed, nothing staged, the job still in REVIEW",
    async (table) => {
      const jobId = await nonConformingJob(fixture);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
      vi.stubEnv("DOCUMENT_WORKER_URL", "");
      const restore = await failInsertsInto(table, 1_000_000);
      try {
        expect((await approveRaw(jobId)).status).toBe(500);
      } finally {
        await restore();
        vi.unstubAllEnvs();
        errors.mockRestore();
      }

      expect(await readJob(jobId)).toMatchObject({
        status: "REVIEW",
        approvedBy: null,
        approvedAt: null,
      });
      expect(await releaseAuditRows(jobId)).toHaveLength(0);
      expect(await ootRows(jobId)).toEqual({ events: [], audits: [] });
      const dates = await assetDates(fixture.assetId);
      expect(dates.last).toBeNull();
      expect(dates.sources).toEqual([]);
      // The outbox rows roll back too: not even the certificate job was queued.
      expect(await db.select().from(appQueueJob)).toEqual([]);
      expect(mocks.enqueue).not.toHaveBeenCalled();
    },
  );

  it("B2: a rolled-back approval can simply be retried: the effects are written once, by the approval that commits", async () => {
    const jobId = await nonConformingJob(fixture);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const restore = await failInsertsInto("asset_oot_audit_log", 1);
    try {
      expect((await approveRaw(jobId)).status).toBe(500);
    } finally {
      await restore();
      errors.mockRestore();
    }

    await expect(cloud.approve(jobId, CHECKER)).resolves.toEqual({
      approved: true,
    });

    expect((await ootRows(jobId)).events).toHaveLength(1);
    expect((await assetDates(fixture.assetId)).sources).toEqual([
      "job_approval",
    ]);
  });

  it("B2: an approval reverted for a failed certificate dispatch takes its OOT event and date advance with it (append-only audit says why)", async () => {
    const jobId = await nonConformingJob(fixture);
    mocks.enqueue.mockRejectedValueOnce(new Error("queue down"));

    await expect(cloud.approve(jobId, CHECKER)).resolves.toMatchObject({
      approved: false,
    });

    expect((await readJob(jobId)).status).toBe("REVIEW");
    const oot = await ootRows(jobId);
    expect(oot.events).toEqual([]);
    // The audit trail is append-only: the create entry stays, the withdrawal is added.
    expect(oot.audits).toEqual(["create", "withdraw"]);
    const dates = await assetDates(fixture.assetId);
    expect(dates.last).toBeNull();
    expect(dates.sources).toEqual(["job_approval", "job_approval_reverted"]);
    // Only the certificate dispatch was attempted: no notification for a reverted approval.
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);

    // The same approval retried leaves the effects in place, once.
    await expect(cloud.approve(jobId, CHECKER)).resolves.toEqual({
      approved: true,
    });
    expect((await ootRows(jobId)).events).toHaveLength(1);
    expect((await assetDates(fixture.assetId)).last).not.toBeNull();
  });

  describe("with the database queue (BACKGROUND_JOBS_MODE=queue)", () => {
    beforeEach(() => {
      vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
      vi.stubEnv("DOCUMENT_WORKER_URL", "");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("B2: the notifications are queue rows committed with the approval: the technician notification and the customer OOT alert naming the event", async () => {
      const jobId = await nonConformingJob(fixture);

      await expect(cloud.approve(jobId, CHECKER)).resolves.toEqual({
        approved: true,
      });

      const oot = await ootRows(jobId);
      const rows = await db.select().from(appQueueJob).orderBy(appQueueJob.id);
      expect(rows.map((row) => row.type)).toEqual([
        "CERTIFICATE",
        "JOB_APPROVED_NOTIFICATION",
        "ASSET_OOT_NOTIFICATION",
      ]);
      expect(rows[2]?.payload).toEqual({
        type: "ASSET_OOT_NOTIFICATION",
        eventId: oot.events[0]?.id,
        organizationId: ORG,
        userId: CHECKER,
      });
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it("B2: a refused approval stages no notification", async () => {
      const jobId = await nonConformingJob(fixture);

      await expect(cloud.approve(jobId, MAKER)).resolves.toMatchObject({
        approved: false,
      });

      expect(await db.select().from(appQueueJob)).toEqual([]);
      expect(await ootRows(jobId)).toEqual({ events: [], audits: [] });
    });
  });
});
