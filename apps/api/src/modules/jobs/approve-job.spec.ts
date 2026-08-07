/**
 * Unit coverage for the approve-job command — the four ISO/IEC 17025 release
 * gates and the transition side effects, exercised without the HTTP pipeline
 * or a database. Before the extraction these paths were reachable only
 * through full route integration specs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  state,
  mockCheckSignatory,
  mockBuildVerdict,
  mockAdvanceDates,
  mockEnqueueBackgroundJob,
  mockNotifyJobApproved,
  mockCreateOotEvent,
  mockFindServiceOrders,
  mockTriggerAutomaticSend,
  mockIssuanceAvailable,
} = vi.hoisted(() => {
  const state: {
    jobRows: unknown[];
    memberRows: unknown[];
    updateReturning: unknown[];
    updateCalls: Array<Record<string, unknown>>;
    insertCalls: Array<Record<string, unknown>>;
  } = {
    jobRows: [],
    memberRows: [],
    updateReturning: [],
    updateCalls: [],
    insertCalls: [],
  };

  return {
    state,
    mockCheckSignatory: vi.fn(async () => ({ ok: true })),
    mockBuildVerdict: vi.fn(() => ({
      conformity: "CONFORMING",
      margins: null,
    })),
    mockAdvanceDates: vi.fn(async () => undefined),
    mockEnqueueBackgroundJob: vi.fn(async () => undefined),
    mockNotifyJobApproved: vi.fn(async () => undefined),
    mockCreateOotEvent: vi.fn(async () => undefined),
    mockFindServiceOrders: vi.fn(async () => []),
    mockTriggerAutomaticSend: vi.fn(async () => undefined),
    // Issuance is disabled in production while the certificate layout is
    // redesigned (#865), so approveJob can never reach "approved" for real.
    // Default the mock to available so the approval-effect assertions below
    // — audit log, enqueue, OOT event, date advance — keep running instead of
    // going dark until Phase 3.
    mockIssuanceAvailable: vi.fn(() => true),
  };
});

vi.mock("@calibra-facil/db", () => {
  function awaitableUpdate(values: Record<string, unknown>) {
    state.updateCalls.push(values);
    // Drizzle's update builder is awaitable directly AND exposes .returning();
    // a real promise carrying the extra method mirrors that without hand-rolling
    // a thenable.
    return {
      where: () =>
        Object.assign(Promise.resolve(undefined), {
          returning: async () => state.updateReturning,
        }),
    };
  }

  return {
    db: {
      select: (projection?: unknown) => ({
        from: () => ({
          where: () => ({
            limit: async () =>
              projection === undefined ? state.jobRows : state.memberRows,
          }),
        }),
      }),
      update: () => ({ set: awaitableUpdate }),
      insert: () => ({
        values: async (values: Record<string, unknown>) => {
          state.insertCalls.push(values);
        },
      }),
    },
  };
});

vi.mock("../../lib/signatory", () => ({
  checkApproverIsAuthorizedSignatory: mockCheckSignatory,
}));
vi.mock("../../lib/as-found-reliability-verdict", () => ({
  buildAsFoundReliabilityVerdict: mockBuildVerdict,
}));
vi.mock("../../lib/asset-calibration-advance", () => ({
  advanceAssetCalibrationDatesOnApproval: mockAdvanceDates,
}));
vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: mockEnqueueBackgroundJob,
}));
vi.mock("@calibra-facil/notifications", () => ({
  notifyJobApproved: mockNotifyJobApproved,
}));
vi.mock("../../lib/asset-oot-events", () => ({
  createAssetOotEventForApprovedJob: mockCreateOotEvent,
}));
vi.mock("../../lib/automatic-send", () => ({
  findServiceOrdersForCalibrationJob: mockFindServiceOrders,
  triggerAutomaticSendForMilestone: mockTriggerAutomaticSend,
}));
vi.mock("../../lib/units", () => ({
  buildUnitScopeCondition: () => undefined,
}));
vi.mock("../../lib/certificate-issuance-availability", () => ({
  isCertificateIssuanceAvailable: mockIssuanceAvailable,
}));

import { approveJob } from "./approve-job";

type Member = Parameters<typeof approveJob>[0]["member"];

function testMember(): Member {
  const value: unknown = {
    organizationId: "org-1",
    activeUnitId: 1,
    accessibleUnitIds: [1],
    role: "admin",
  };
  // oxlint-disable-next-line typescript/consistent-type-assertions -- tests build the minimal member scope the command reads.
  return value as Member;
}

function reviewJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    status: "REVIEW",
    organizationId: "org-1",
    unitId: 1,
    technicianId: "tech-1",
    createdBy: "creator-1",
    assetId: 55,
    customerId: 9,
    performedAt: new Date("2026-06-10T00:00:00Z"),
    results: {},
    environmentalSnapshot: null,
    ...overrides,
  };
}

function callApprove(values: Record<string, unknown> = {}) {
  return approveJob({
    jobId: 10,
    member: testMember(),
    approverId: "approver-1",
    // oxlint-disable-next-line typescript/consistent-type-assertions -- schema input narrowed for the paths under test.
    values: values as Parameters<typeof approveJob>[0]["values"],
    metadata: { ipAddress: "10.0.0.1" },
    sendServiceOrdersToFinance: async () => [],
  });
}

beforeEach(() => {
  state.jobRows = [];
  state.memberRows = [];
  state.updateReturning = [];
  state.updateCalls = [];
  state.insertCalls = [];
  vi.clearAllMocks();
  mockCheckSignatory.mockResolvedValue({ ok: true });
  mockBuildVerdict.mockReturnValue({ conformity: "CONFORMING", margins: null });
  mockFindServiceOrders.mockResolvedValue([]);
});

describe("approveJob gates", () => {
  it("returns not_found when the job is not visible in scope", async () => {
    await expect(callApprove()).resolves.toEqual({ status: "not_found" });
  });

  it("only approves from REVIEW", async () => {
    state.jobRows = [reviewJob({ status: "DRAFT" })];
    await expect(callApprove()).resolves.toEqual({
      status: "invalid_status",
      currentStatus: "DRAFT",
    });
    expect(state.updateCalls).toHaveLength(0);
  });

  it("blocks self-approval when an eligible alternate approver exists (§6.2.4)", async () => {
    state.jobRows = [reviewJob({ technicianId: "approver-1" })];
    state.memberRows = [{ id: "member-2" }];
    await expect(callApprove()).resolves.toEqual({
      status: "self_approval_blocked",
    });
    expect(state.updateCalls).toHaveLength(0);
    expect(mockEnqueueBackgroundJob).not.toHaveBeenCalled();
  });

  it("also blocks the job creator, not just the technician", async () => {
    state.jobRows = [reviewJob({ createdBy: "approver-1" })];
    state.memberRows = [{ id: "member-2" }];
    await expect(callApprove()).resolves.toEqual({
      status: "self_approval_blocked",
    });
  });

  it("exempts a solo lab: self-approval proceeds when no alternate exists", async () => {
    state.jobRows = [reviewJob({ technicianId: "approver-1" })];
    state.memberRows = [];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    const result = await callApprove();
    expect(result.status).toBe("approved");
    expect(state.updateCalls[0]?.status).toBe("GENERATING_PDF");
  });

  it("blocks approvers outside the signatory roster scope (§6.2.6)", async () => {
    state.jobRows = [reviewJob()];
    mockCheckSignatory.mockResolvedValue({ ok: false });
    await expect(callApprove()).resolves.toEqual({
      status: "not_authorized_signatory",
    });
    expect(state.updateCalls).toHaveLength(0);
  });

  // #865: this is the real production behaviour right now — nothing can
  // render a certificate, so the job must not leave REVIEW. Without this the
  // worker would fail afterwards and strand it in GENERATING_PDF.
  it("blocks approval while certificate issuance is unavailable", async () => {
    state.jobRows = [reviewJob()];
    mockIssuanceAvailable.mockReturnValueOnce(false);
    await expect(callApprove()).resolves.toEqual({
      status: "certificate_issuance_unavailable",
    });
    expect(state.updateCalls).toHaveLength(0);
  });

  it("does not freeze any certificate-template link onto the job", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    const result = await callApprove();
    expect(result.status).toBe("approved");
    const transition = state.updateCalls.find(
      (call) => call.status === "GENERATING_PDF",
    );
    // The per-method template link is gone; approval must not resurrect it.
    expect(transition).not.toHaveProperty("certificateTemplateId");
    expect(transition).not.toHaveProperty("certificateTemplateSnapshot");
  });

  it("requires a justification when environmental conditions were out of limits", async () => {
    const environmentalSnapshot = {
      withinLimits: false,
      outOfLimitsJustification: null,
      temperature: 30,
    };
    state.jobRows = [reviewJob({ environmentalSnapshot })];
    const result = await callApprove();
    expect(result.status).toBe("environmental_justification_required");
    expect(state.updateCalls).toHaveLength(0);
  });

  it("persists the provided environmental justification before transitioning", async () => {
    const environmentalSnapshot = {
      withinLimits: false,
      outOfLimitsJustification: null,
      temperature: 30,
    };
    state.jobRows = [reviewJob({ environmentalSnapshot })];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    const result = await callApprove({
      environmentalJustification: "Estufa em manutenção",
    });
    expect(result.status).toBe("approved");
    const snapshotUpdate = state.updateCalls[0]?.environmentalSnapshot;
    expect(snapshotUpdate).toMatchObject({
      outOfLimitsJustification: "Estufa em manutenção",
    });
  });
});

describe("approveJob transition effects", () => {
  it("stamps the approver, audits and enqueues certificate generation", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];

    const result = await callApprove({ reason: "OK" });

    expect(result.status).toBe("approved");
    expect(state.updateCalls[0]).toMatchObject({
      status: "GENERATING_PDF",
      approvedBy: "approver-1",
    });
    expect(state.insertCalls[0]).toMatchObject({
      jobId: 10,
      action: "approve",
      performedBy: "approver-1",
      ipAddress: "10.0.0.1",
      reason: "OK",
    });
    expect(mockAdvanceDates).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 55, source: "job_approval" }),
    );
    expect(mockEnqueueBackgroundJob).toHaveBeenCalledWith({
      jobId: 10,
      userId: "approver-1",
    });
    expect(mockNotifyJobApproved).toHaveBeenCalledWith(10, "approver-1");
    expect(mockCreateOotEvent).not.toHaveBeenCalled();
  });

  it("raises a customer-facing OOT event when the as-found verdict is non-conforming", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    mockBuildVerdict.mockReturnValue({
      conformity: "NON_CONFORMING",
      margins: null,
    });

    await callApprove();

    expect(mockCreateOotEvent).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 10, assetId: 55, customerId: 9 }),
    );
  });
});
