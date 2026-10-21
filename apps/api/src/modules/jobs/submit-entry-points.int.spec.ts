/**
 * submit-entry-points.int.spec.ts: submit and execute are ONE policy.
 *
 * Saving the worksheet and submitting a job for review have three entry points:
 * the cloud routes (`POST /jobs/:id/execute|submit`), the public API
 * (`POST /v2/jobs/:id/results|submit`) and the desktop sync apply
 * (`save_local_execution` / `submit_local_execution`). All of them call
 * `executeJob` / `submitJob`. Each rule below runs against EVERY entry point it
 * applies to, against a real Postgres and the real RBAC / API-key / sync
 * middleware (only the better-auth session, the queue and the notifications are
 * faked; the CMC classification is the switch of the scope case).
 *
 *   REQ-SUB-5a  results the client sends are never stored: they are recomputed
 *   REQ-SUB-5b  accredited-scope (CMC) classification flagged identically
 *   REQ-SUB-5c  the assigned technician must hold an active competence
 *   REQ-SUB-5d  a performed date beyond 7 days needs a written reason
 *   REQ-SUB-5e  an expired reference standard is refused
 *   REQ-SUB-5f  saving a REJECTED job keeps it REJECTED (Q18)
 *   REQ-SUB-5g  an illegal transition is refused, nothing written
 *   REQ-SUB-5h  the desktop's payload status is checked, not trusted (Q20)
 *   REQ-SUB-5i  the public API now runs the whole submit policy
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  jobAuditLog,
  personnelCompetence,
  referenceStandard,
  user,
  type JobStatus,
} from "@calibra-facil/db/schema";
import {
  addCalendarDays,
  calendarDateKey,
  labToday,
} from "@calibra-facil/shared";
import { loginAs } from "../../../test/integration/setup";
import { truncateAll } from "../../../test/integration/db";
import { seedApiKey, seedOrg } from "../../../test/integration/seed";
import { seedJobForOrg } from "../../../test/integration/tenant-refs";
import { executableMethodSnapshot } from "../../../test/integration/executable-method";
import { auditActions, jobRow } from "../../../test/integration/job-cas";
import { jobsRouter } from "../../routes/jobs";
import { publicApiV2Router } from "../../routes/public-api-v2";
import { syncRouter } from "../../routes/sync";
import { executeOfficialCompiledSnapshot } from "./official-execution";

const mocks = vi.hoisted(() => {
  const scope: { status: "OUT_OF_SCOPE" | null } = { status: null };
  return { scope };
});

vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
}));

// The CMC classification itself is covered by its own specs; here it is the
// switch that makes every entry point see the same adverse verdict.
vi.mock("../../lib/scope-compliance", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/scope-compliance")>();
  return {
    ...actual,
    classifyJobScopeCompliance: vi.fn(async () =>
      mocks.scope.status
        ? {
            compliance: { status: mocks.scope.status, findings: [] },
            enforcementMode: "warn",
          }
        : { compliance: null, enforcementMode: "warn" },
    ),
  };
});

const JSON_HEADERS = { "content-type": "application/json" };
const ORG = "org-sub";
const TECHNICIAN = "user-sub-tech";
const DAY_MS = 24 * 60 * 60 * 1000;
const DATA = { indication: "10", reference: "9" };

async function seedWorld(options: { status: JobStatus }) {
  const org = await seedOrg({ orgId: ORG, userId: TECHNICIAN, role: "admin" });
  const { jobId, assetId } = await seedJobForOrg({
    orgId: ORG,
    unitId: org.unitId,
    createdBy: TECHNICIAN,
  });
  await db
    .update(calibrationJob)
    .set({
      status: options.status,
      methodSnapshot: executableMethodSnapshot(),
      technicianId: TECHNICIAN,
    })
    .where(eq(calibrationJob.id, jobId));
  const { rawKey } = await seedApiKey({
    organizationId: ORG,
    createdBy: TECHNICIAN,
    scopes: ["jobs:write"],
  });
  const [row] = await db
    .select({ assetTypeId: asset.assetTypeId })
    .from(asset)
    .where(eq(asset.id, assetId));
  return { org, jobId, assetId, assetTypeId: row?.assetTypeId ?? 0, rawKey };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

async function addStandard(world: World, validThrough: Date) {
  const [standard] = await db
    .insert(referenceStandard)
    .values({
      organizationId: ORG,
      unitId: world.org.unitId,
      createdBy: TECHNICIAN,
      name: "Massa Padrao",
      kind: "generic_scalar",
      serialNumber: "SN-STD-SUB",
      certificateNumber: "CERT-SUB",
      calibrationDate: new Date("2025-01-10T15:00:00.000Z"),
      nextCalibrationDate: validThrough,
      coverageFactor: 2,
      distribution: "normal",
      status: "ACTIVE",
      referenceValue: 1,
      uncertainty: 0.01,
    })
    .returning({ id: referenceStandard.id });
  if (!standard) throw new Error("addStandard failed");
  return { id: standard.id, validThrough };
}

// ---------------------------------------------------------------------------
// One call, normalised to one outcome, through each entry point.
// ---------------------------------------------------------------------------

type Call = {
  command: "submit" | "execute";
  data?: Record<string, unknown>;
  /** What the client says the results are. */
  results?: Record<string, unknown>;
  performedAt?: string;
  backdateReason?: string;
  standard?: { id: number; validThrough: Date };
  /** Sync only: the status the desktop's payload claims. */
  claimedStatus?: JobStatus;
};

type Outcome = { ok: true } | { ok: false; code: string };

type EntryPoint = {
  name: "cloud route" | "public API" | "desktop sync";
  run: (world: World, call: Call) => Promise<Outcome>;
};

let sequence = 0;
function nextKey() {
  sequence += 1;
  return `k-${sequence}`;
}

const LOCATION = { type: "lab", addressText: "Laboratório" } as const;

const cloud: EntryPoint = {
  name: "cloud route",
  async run(world, call) {
    loginAs({ userId: TECHNICIAN, organizationId: ORG });
    const res = await jobsRouter.request(`/${world.jobId}/${call.command}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        data: call.data ?? DATA,
        results: call.results,
        performedAt: call.performedAt,
        backdateReason: call.backdateReason,
        selectedStandardIds: call.standard ? [call.standard.id] : undefined,
        ...(call.command === "submit" ? { calibrationLocation: LOCATION } : {}),
      }),
    });
    if (res.status === 200) return { ok: true };
    const body: { code?: string } = await res.json();
    return { ok: false, code: body.code ?? `http_${res.status}` };
  },
};

const publicApi: EntryPoint = {
  name: "public API",
  async run(world, call) {
    const path = call.command === "submit" ? "submit" : "results";
    const res = await publicApiV2Router.request(
      `/jobs/${world.jobId}/${path}`,
      {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          "x-api-key": world.rawKey,
          "idempotency-key": nextKey(),
        },
        body: JSON.stringify({
          data: call.data ?? DATA,
          results: call.results,
          performedAt: call.performedAt,
          ...(call.command === "submit"
            ? { backdateReason: call.backdateReason }
            : {}),
          selectedStandardIds: call.standard ? [call.standard.id] : undefined,
          ...(call.command === "submit"
            ? { calibrationLocation: LOCATION }
            : {}),
        }),
      },
    );
    if (res.status === 200) return { ok: true };
    const body: { error?: { code?: string } } = await res.json();
    return { ok: false, code: body.error?.code ?? `http_${res.status}` };
  },
};

/** The refusal vocabulary the sync apply answers in, as the cloud's codes. */
function syncRefusalCode(rejected: { code: string; reason: string }) {
  if (
    rejected.code === "INVALID_DESKTOP_EVENT_PAYLOAD" &&
    rejected.reason.startsWith("Motivo obrigatório")
  ) {
    return "backdate_reason_required";
  }
  const codes: Record<string, string> = {
    STANDARD_EXPIRED: "standard_expired",
    STANDARD_BACKDATE_REASON_REQUIRED: "standard_backdate_reason_required",
    TECHNICIAN_COMPETENCE_MISSING: "technician_competence_missing",
    STATUS_PAYLOAD_MISMATCH: "job_status_payload_mismatch",
  };
  return codes[rejected.code] ?? rejected.code;
}

const sync: EntryPoint = {
  name: "desktop sync",
  async run(world, call) {
    const current = await jobRow(world.jobId);
    const submit = call.command === "submit";
    const standard = call.standard;
    const standardsSnapshot = standard
      ? [
          {
            id: standard.id,
            name: "Massa Padrao",
            certificateNumber: "CERT-SUB",
            calibrationDate: "2025-01-10T00:00:00.000Z",
            nextCalibrationDate: `${calendarDateKey(standard.validThrough)}T00:00:00.000Z`,
            uncertainty: 0.01,
            uncertaintyUnit: "g",
            coverageFactor: 2,
            distribution: "normal",
            drift: null,
            certifiedValues: null,
          },
        ]
      : undefined;
    // The desktop reports the status its own store moved the job to: the
    // transition table's target for the job it believes it is working on.
    const target: JobStatus =
      call.claimedStatus ??
      (submit
        ? "REVIEW"
        : current.status === "REJECTED"
          ? "REJECTED"
          : "IN_PROGRESS");
    const eventId = nextKey();
    loginAs({ userId: TECHNICIAN, organizationId: ORG });
    const res = await syncRouter.request("/push", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(world.org.unitId),
      },
      body: JSON.stringify({
        deviceId: "device-sub-1",
        clientBatchId: `batch-${eventId}`,
        baseCursor: null,
        events: [
          {
            eventId,
            entityType: "calibration_job",
            entityId: "local-job-sub",
            operation: submit
              ? "submit_local_execution"
              : "save_local_execution",
            payload: {
              remoteId: world.jobId,
              status: target,
              data: call.data ?? DATA,
              results: call.results ?? null,
              ...(call.performedAt ? { performedAt: call.performedAt } : {}),
              ...(call.backdateReason
                ? { backdateReason: call.backdateReason }
                : {}),
              ...(standardsSnapshot ? { standardsSnapshot } : {}),
              ...(submit ? { calibrationLocationSnapshot: LOCATION } : {}),
            },
            occurredAt: new Date().toISOString(),
            actorUserId: TECHNICIAN,
            organizationId: ORG,
            unitId: world.org.unitId,
            idempotencyKey: `idem-${eventId}`,
            localVersion: 0,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body: {
      accepted: Array<{ eventId: string }>;
      rejected: Array<{ eventId: string; code: string; reason: string }>;
      conflicts: Array<{ conflictType: string }>;
    } = await res.json();
    if (body.accepted.length === 1) return { ok: true };
    const rejected = body.rejected[0];
    if (rejected) return { ok: false, code: syncRefusalCode(rejected) };
    // An illegal transition is reported as a reviewable status conflict.
    if (body.conflicts[0]?.conflictType === "status_transition") {
      return {
        ok: false,
        code: submit ? "job_not_submittable" : "job_not_executable",
      };
    }
    throw new Error(`unexpected sync outcome ${JSON.stringify(body)}`);
  },
};

const ENTRY_POINTS = [cloud, publicApi, sync];

async function auditRows(jobId: number) {
  return db
    .select({
      action: jobAuditLog.action,
      performedBy: jobAuditLog.performedBy,
      reason: jobAuditLog.reason,
      changes: jobAuditLog.changes,
    })
    .from(jobAuditLog)
    .where(eq(jobAuditLog.jobId, jobId));
}

/** The job as a refusal must leave it: untouched, no audit row. */
async function expectUntouched(
  world: World,
  before: Awaited<ReturnType<typeof jobRow>>,
) {
  const after = await jobRow(world.jobId);
  expect({ ...after, updatedAt: undefined }).toEqual({
    ...before,
    updatedAt: undefined,
  });
  expect(await auditActions(world.jobId)).toEqual([]);
}

describe.each(ENTRY_POINTS)("submit and execute policy [$name]", (entry) => {
  beforeEach(async () => {
    await truncateAll();
    mocks.scope.status = null;
  });

  it("REQ-SUB-5a [HIGH RISK]: results the client sends are never stored; they are recomputed from the data by the official execution", async () => {
    const world = await seedWorld({ status: "IN_PROGRESS" });
    const stale = { error: "999", staleMarker: true };

    await expect(
      entry.run(world, { command: "submit", results: stale }),
    ).resolves.toEqual({ ok: true });

    const job = await jobRow(world.jobId);
    expect(job.status).toBe("REVIEW");
    expect(job.results).not.toHaveProperty("staleMarker");
    if (!job.assetSnapshot) throw new Error("the job has no asset snapshot");
    const official = executeOfficialCompiledSnapshot({
      methodSnapshot: job.methodSnapshot,
      data: DATA,
      assetSnapshot: job.assetSnapshot,
      standardsSnapshot: job.standardsSnapshot,
      environmentalSnapshot: job.environmentalSnapshot,
      calibrationPhaseSnapshot: job.calibrationPhaseSnapshot,
      requireSuccess: true,
    });
    expect(official.ok).toBe(true);
    if (official.ok) expect(job.results).toEqual(official.results);
  });

  it("REQ-SUB-5a [HIGH RISK]: a save recomputes the results too (the draft stores the official ones, not the client's)", async () => {
    const world = await seedWorld({ status: "DRAFT" });

    await expect(
      entry.run(world, {
        command: "execute",
        results: { error: "999", staleMarker: true },
      }),
    ).resolves.toEqual({ ok: true });

    const job = await jobRow(world.jobId);
    expect(job.status).toBe("IN_PROGRESS");
    expect(job.results).not.toHaveProperty("staleMarker");
    expect(job.results).toHaveProperty("__compiledExecution");
    expect(await auditActions(world.jobId)).toEqual(["execute"]);
  });

  it("REQ-SUB-5b: an out-of-scope point is flagged on the submitted job, never silently dropped", async () => {
    const world = await seedWorld({ status: "IN_PROGRESS" });
    mocks.scope.status = "OUT_OF_SCOPE";

    await expect(entry.run(world, { command: "submit" })).resolves.toEqual({
      ok: true,
    });

    const job = await jobRow(world.jobId);
    expect(job.status).toBe("REVIEW");
    expect(job.scopeComplianceStatus).toBe("OUT_OF_SCOPE");
    const [audit] = await auditRows(world.jobId);
    expect(audit?.reason).toContain("fora do escopo acreditado (CMC)");
  });

  describe("technician competence (REQ-SUB-5c)", () => {
    async function otherTechnicianCompetence(world: World) {
      // The organization keeps competence records (so the gate is on), for a
      // different technician; the job's own technician has none.
      await db.insert(user).values({
        id: "user-sub-other",
        name: "Other",
        email: "other@lab.test",
      });
      await db.insert(personnelCompetence).values({
        organizationId: ORG,
        userId: "user-sub-other",
        assetTypeId: world.assetTypeId,
        scopeDescription: "Outro tecnico",
        status: "ACTIVE",
        requestedBy: TECHNICIAN,
        createdBy: TECHNICIAN,
      });
    }

    it("REQ-SUB-5c [HIGH RISK]: a technician with no competence for the instrument type cannot submit; nothing is written", async () => {
      const world = await seedWorld({ status: "IN_PROGRESS" });
      await otherTechnicianCompetence(world);
      const before = await jobRow(world.jobId);

      await expect(entry.run(world, { command: "submit" })).resolves.toEqual({
        ok: false,
        code: "technician_competence_missing",
      });

      await expectUntouched(world, before);
    });

    it("REQ-SUB-5c [HIGH RISK]: a competence that expired before the work was performed does not count", async () => {
      const world = await seedWorld({ status: "IN_PROGRESS" });
      await db.insert(personnelCompetence).values({
        organizationId: ORG,
        userId: TECHNICIAN,
        assetTypeId: world.assetTypeId,
        scopeDescription: "Vencida",
        status: "ACTIVE",
        expiresAt: new Date(Date.now() - 30 * DAY_MS),
        requestedBy: TECHNICIAN,
        createdBy: TECHNICIAN,
      });
      const before = await jobRow(world.jobId);

      await expect(entry.run(world, { command: "submit" })).resolves.toEqual({
        ok: false,
        code: "technician_competence_missing",
      });

      await expectUntouched(world, before);
    });

    it("REQ-SUB-5c: control: an active competence for the instrument type submits", async () => {
      const world = await seedWorld({ status: "IN_PROGRESS" });
      await db.insert(personnelCompetence).values({
        organizationId: ORG,
        userId: TECHNICIAN,
        assetTypeId: world.assetTypeId,
        scopeDescription: "Ativa",
        status: "ACTIVE",
        requestedBy: TECHNICIAN,
        createdBy: TECHNICIAN,
      });

      await expect(entry.run(world, { command: "submit" })).resolves.toEqual({
        ok: true,
      });
      expect((await jobRow(world.jobId)).status).toBe("REVIEW");
    });
  });

  describe("backdated records (REQ-SUB-5d)", () => {
    const TEN_DAYS_AGO = new Date(Date.now() - 10 * DAY_MS).toISOString();

    it("REQ-SUB-5d [HIGH RISK]: a performed date older than 7 days without a written reason is refused; nothing is written", async () => {
      const world = await seedWorld({ status: "IN_PROGRESS" });
      const before = await jobRow(world.jobId);

      await expect(
        entry.run(world, { command: "submit", performedAt: TEN_DAYS_AGO }),
      ).resolves.toEqual({ ok: false, code: "backdate_reason_required" });

      await expectUntouched(world, before);
    });

    it("REQ-SUB-5d: with a written reason the submit is accepted and the reason is in the audit trail", async () => {
      const world = await seedWorld({ status: "IN_PROGRESS" });

      await expect(
        entry.run(world, {
          command: "submit",
          performedAt: TEN_DAYS_AGO,
          backdateReason: "  Sem sinal no cliente  ",
        }),
      ).resolves.toEqual({ ok: true });

      const job = await jobRow(world.jobId);
      expect(job.performedAt?.toISOString()).toBe(TEN_DAYS_AGO);
      const [audit] = await auditRows(world.jobId);
      expect(audit?.reason).toBe(
        "Registro retroativo (10 dias): Sem sinal no cliente",
      );
    });
  });

  it("REQ-SUB-5e [HIGH RISK]: a standard whose certificate expired before the work is refused; the job is unchanged", async () => {
    const world = await seedWorld({ status: "IN_PROGRESS" });
    const expired = await addStandard(world, addCalendarDays(labToday(), -3));
    const before = await jobRow(world.jobId);

    await expect(
      entry.run(world, { command: "submit", standard: expired }),
    ).resolves.toEqual({ ok: false, code: "standard_expired" });

    await expectUntouched(world, before);
  });

  it("REQ-SUB-5e: a standard valid today is accepted and frozen in the snapshot", async () => {
    const world = await seedWorld({ status: "IN_PROGRESS" });
    const valid = await addStandard(world, addCalendarDays(labToday(), 90));

    await expect(
      entry.run(world, { command: "submit", standard: valid }),
    ).resolves.toEqual({ ok: true });

    const job = await jobRow(world.jobId);
    expect(job.standardsSnapshot?.map((standard) => standard.id)).toEqual([
      valid.id,
    ]);
  });

  it("REQ-SUB-5f [HIGH RISK]: saving results on a REJECTED job keeps it REJECTED (Q18); only a submit moves it on", async () => {
    const world = await seedWorld({ status: "REJECTED" });

    await expect(entry.run(world, { command: "execute" })).resolves.toEqual({
      ok: true,
    });
    expect((await jobRow(world.jobId)).status).toBe("REJECTED");
    expect(await auditActions(world.jobId)).toEqual(["execute"]);

    await expect(entry.run(world, { command: "submit" })).resolves.toEqual({
      ok: true,
    });
    expect((await jobRow(world.jobId)).status).toBe("REVIEW");
  });

  describe.each([
    ["submit", "job_not_submittable"],
    ["execute", "job_not_executable"],
  ] as const)("illegal transitions (REQ-SUB-5g): %s", (command, code) => {
    it.each(["APPROVED", "CANCELED", "GENERATING_PDF"] as const)(
      `REQ-SUB-5g [HIGH RISK]: a job in %s refuses ${command}, nothing is written`,
      async (status) => {
        const world = await seedWorld({ status });
        const before = await jobRow(world.jobId);

        await expect(entry.run(world, { command })).resolves.toEqual({
          ok: false,
          code,
        });

        await expectUntouched(world, before);
      },
    );
  });

  it("REQ-SUB-5i: a submit records who did it and the fingerprints of the official execution it ran", async () => {
    const world = await seedWorld({ status: "IN_PROGRESS" });

    await expect(entry.run(world, { command: "submit" })).resolves.toEqual({
      ok: true,
    });

    const rows = await auditRows(world.jobId);
    expect(rows.map((row) => row.action)).toEqual(["submit"]);
    expect(rows[0]?.performedBy).toBe(TECHNICIAN);
    expect(rows[0]?.changes).toMatchObject({
      status: { old: "IN_PROGRESS", new: "REVIEW" },
      officialExecution: { resultFingerprint: expect.any(String) },
    });
  });
});

describe("desktop sync: the payload status is not trusted (REQ-SUB-5h, Q20)", () => {
  beforeEach(async () => {
    await truncateAll();
    mocks.scope.status = null;
  });

  it("REQ-SUB-5h [HIGH RISK]: a plain save whose payload says REVIEW is refused; the job is unchanged", async () => {
    const world = await seedWorld({ status: "IN_PROGRESS" });
    const before = await jobRow(world.jobId);

    await expect(
      sync.run(world, { command: "execute", claimedStatus: "REVIEW" }),
    ).resolves.toEqual({ ok: false, code: "job_status_payload_mismatch" });

    await expectUntouched(world, before);
  });

  it("REQ-SUB-5h [HIGH RISK]: a save of a job the cloud has since REJECTED cannot move it back to IN_PROGRESS", async () => {
    // The desktop still believes the job is IN_PROGRESS and reports that;
    // the cloud job is REJECTED, where a save keeps it.
    const world = await seedWorld({ status: "REJECTED" });
    const before = await jobRow(world.jobId);

    await expect(
      sync.run(world, { command: "execute", claimedStatus: "IN_PROGRESS" }),
    ).resolves.toEqual({ ok: false, code: "job_status_payload_mismatch" });

    await expectUntouched(world, before);
  });

  it("REQ-SUB-5h: a submit whose payload does not say REVIEW is refused", async () => {
    const world = await seedWorld({ status: "IN_PROGRESS" });
    const before = await jobRow(world.jobId);

    await expect(
      sync.run(world, { command: "submit", claimedStatus: "IN_PROGRESS" }),
    ).resolves.toEqual({ ok: false, code: "job_status_payload_mismatch" });

    await expectUntouched(world, before);
  });

  it("REQ-SUB-5h: control: a payload that agrees with the transition table is applied", async () => {
    const world = await seedWorld({ status: "DRAFT" });

    await expect(
      sync.run(world, { command: "execute", claimedStatus: "IN_PROGRESS" }),
    ).resolves.toEqual({ ok: true });

    expect((await jobRow(world.jobId)).status).toBe("IN_PROGRESS");
  });
});

describe("public API: results and submit run the whole policy (REQ-SUB-5i)", () => {
  beforeEach(async () => {
    await truncateAll();
    mocks.scope.status = null;
  });

  it("REQ-SUB-5i [HIGH RISK]: results the integrator posts for a job whose method cannot be executed are refused, not stored as sent", async () => {
    const world = await seedWorld({ status: "DRAFT" });
    await db
      .update(calibrationJob)
      .set({
        methodSnapshot: {
          methodId: 1,
          methodName: "Sem compilacao",
          methodVersion: 1,
          dataFields: [],
          variableBindings: [],
          formulas: [],
          measurementModels: [],
          validations: [],
          uncertaintyParams: [],
        },
      })
      .where(eq(calibrationJob.id, world.jobId));
    const before = await jobRow(world.jobId);

    await expect(
      publicApi.run(world, {
        command: "execute",
        results: { error: "999" },
      }),
    ).resolves.toEqual({ ok: false, code: "official_execution_failed" });

    await expectUntouched(world, before);
  });

  it("REQ-SUB-5i [HIGH RISK]: a submit without the calibration location is refused, as on the cloud route", async () => {
    const world = await seedWorld({ status: "IN_PROGRESS" });
    const before = await jobRow(world.jobId);

    const res = await publicApiV2Router.request(`/jobs/${world.jobId}/submit`, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        "x-api-key": world.rawKey,
        "idempotency-key": nextKey(),
      },
      body: JSON.stringify({ data: DATA }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "calibration_record_incomplete" },
    });
    await expectUntouched(world, before);
  });

  it("REQ-SUB-5i: the audit row of an API submit names the key as well as its creator", async () => {
    const world = await seedWorld({ status: "IN_PROGRESS" });

    await expect(publicApi.run(world, { command: "submit" })).resolves.toEqual({
      ok: true,
    });

    const [audit] = await db
      .select({
        changes: jobAuditLog.changes,
        performedBy: jobAuditLog.performedBy,
      })
      .from(jobAuditLog)
      .where(
        and(
          eq(jobAuditLog.jobId, world.jobId),
          eq(jobAuditLog.action, "submit"),
        ),
      );
    expect(audit?.performedBy).toBe(TECHNICIAN);
    expect(audit?.changes).toMatchObject({
      channel: "api_key",
      source: "public_api",
      apiKeyId: expect.any(String),
    });
  });
});
