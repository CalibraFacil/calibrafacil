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
  mockJudgeStandards,
  mockBuildVerdict,
  mockAdvanceDates,
  mockEnqueueBackgroundJob,
  mockRecordOotEvent,
  mockWithdrawOotEvent,
  mockRevertAdvance,
  mockFindServiceOrders,
  mockTriggerAutomaticSend,
  mockLockJob,
  mockFreezeInput,
  mockDiscardInput,
  mockPrefetchImages,
  mockFindImageKeys,
  ImagesChangedError,
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
    mockCheckSignatory: vi.fn(
      async (_params?: unknown): Promise<{ ok: boolean; reason?: string }> => ({
        ok: true,
      }),
    ),
    mockJudgeStandards: vi.fn(
      async (_input?: unknown, _reader?: unknown): Promise<unknown> => ({
        ok: true,
        standardIds: [],
      }),
    ),
    mockBuildVerdict: vi.fn(() => ({
      conformity: "CONFORMING",
      margins: null,
    })),
    // The pure database effects run in the approval's own transaction (B2):
    // the date advance returns what it changed (null: nothing), the OOT event
    // its id (null: it already existed).
    mockAdvanceDates: vi.fn(async (): Promise<unknown> => null),
    mockEnqueueBackgroundJob: vi.fn(async () => undefined),
    mockRecordOotEvent: vi.fn(
      async (): Promise<{ eventId: number } | null> => ({ eventId: 77 }),
    ),
    mockWithdrawOotEvent: vi.fn(async () => undefined),
    mockRevertAdvance: vi.fn(async () => undefined),
    mockFindServiceOrders: vi.fn(async () => []),
    mockTriggerAutomaticSend: vi.fn(async () => undefined),
    // The frozen certificate input reads the lab, customer, asset and approver
    // rows and writes `certificate_input`; it is covered against a real Postgres
    // by certificate-input.int.spec.ts. Here only the command's wiring of it is
    // asserted: the lock decides concurrency, the freeze runs after the status
    // write, and its hash reaches the audit row.
    mockLockJob: vi.fn(async () => true),
    mockFreezeInput: vi.fn(async () => ({
      sha256: "f".repeat(64),
      input: {},
    })),
    mockDiscardInput: vi.fn(async () => undefined),
    // The keys are read in the read transaction; the images themselves are read
    // from object storage after it ends and BEFORE the write transaction.
    mockFindImageKeys: vi.fn(async () => ({
      logoKey: "logo/key.png",
      signatureKey: null,
    })),
    mockPrefetchImages: vi.fn(async () => ({ logo: null, signature: null })),
    ImagesChangedError: class ImagesChangedError extends Error {},
    // Issuance is disabled in production while the certificate layout is
    // redesigned (#865), so approveJob can never reach "approved" for real.
    // Default the mock to available so the approval-effect assertions below
    // — audit log, enqueue, OOT event, date advance — keep running instead of
    // going dark until Phase 3.
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

  const mockDb = {
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
    // The approval transition + audit row run in one transaction; the
    // harness runs the callback against the same recording db.
    transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(mockDb),
  };

  return { db: mockDb };
});

// The org-bound handle and the organization-naming transaction run the
// command's callbacks against the same recording db (row-level security is
// proven against a real Postgres in approval-entry-points.int.spec.ts).
vi.mock("../../lib/org-db", async () => {
  const { db } = await import("@calibra-facil/db");
  return {
    orgDb: () => ({
      transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(db),
    }),
  };
});
vi.mock("../../lib/org-transaction", async () => {
  const { db } = await import("@calibra-facil/db");
  return {
    orgTransactionWithExecutor: async <T>(
      _organizationId: string,
      run: (o: unknown, tx: unknown) => Promise<T>,
    ) => run(db, db),
  };
});

vi.mock("../../lib/signatory", () => ({
  checkApproverIsAuthorizedSignatory: mockCheckSignatory,
}));
// The standards judgement itself is covered by its own specs and against a real
// Postgres (approval-sod-gates.int.spec.ts); here only the command's wiring of it.
vi.mock("./standards-judgement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./standards-judgement")>();
  return { ...actual, judgeSnapshotStandards: mockJudgeStandards };
});
vi.mock("../../lib/as-found-reliability-verdict", () => ({
  buildAsFoundReliabilityVerdict: mockBuildVerdict,
}));
vi.mock("../../lib/asset-calibration-advance", () => ({
  advanceAssetCalibrationDates: mockAdvanceDates,
  revertAssetCalibrationAdvance: mockRevertAdvance,
}));
vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: mockEnqueueBackgroundJob,
}));
vi.mock("../../lib/asset-oot-events", () => ({
  recordAssetOotEvent: mockRecordOotEvent,
  withdrawAssetOotEvent: mockWithdrawOotEvent,
}));
vi.mock("../../lib/automatic-send", () => ({
  findServiceOrdersForCalibrationJob: mockFindServiceOrders,
  triggerAutomaticSendForMilestone: mockTriggerAutomaticSend,
}));
vi.mock("../../lib/units", () => ({
  buildUnitScopeCondition: () => undefined,
}));
vi.mock("@calibra-facil/db/certificate-input", () => ({
  lockJobForApproval: mockLockJob,
  freezeCertificateInput: mockFreezeInput,
  discardUnreleasedCertificateInput: mockDiscardInput,
  findCertificateImageKeys: mockFindImageKeys,
  readCertificateImages: mockPrefetchImages,
  CertificateImagesChangedError: ImagesChangedError,
}));
vi.mock("../../lib/certificate-input-images", () => ({
  readCertificateImage: vi.fn(async () => null),
}));

import { approveJob } from "./approve-job";

type UserCommand = Extract<
  Parameters<typeof approveJob>[0],
  { actor: { kind: "user" } }
>;
type Member = UserCommand["actor"]["member"];

function testMember(): Member {
  const value: unknown = {
    organizationId: "org-1",
    activeUnitId: 1,
    accessibleUnitIds: [1],
    userId: "approver-1",
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
    actor: { kind: "user", member: testMember() },
    // oxlint-disable-next-line typescript/consistent-type-assertions -- schema input narrowed for the paths under test.
    values: values as UserCommand["values"],
    metadata: { ipAddress: "10.0.0.1" },
    completion: {
      kind: "generate_certificate_pdf",
      sendServiceOrdersToFinance: async () => [],
    },
  });
}

beforeEach(() => {
  state.jobRows = [];
  state.memberRows = [];
  state.updateReturning = [];
  state.updateCalls = [];
  state.insertCalls = [];
  vi.clearAllMocks();
  mockAdvanceDates.mockResolvedValue(null);
  mockRecordOotEvent.mockResolvedValue({ eventId: 77 });
  mockCheckSignatory.mockResolvedValue({ ok: true });
  mockJudgeStandards.mockResolvedValue({ ok: true, standardIds: [] });
  mockBuildVerdict.mockReturnValue({ conformity: "CONFORMING", margins: null });
  mockFindServiceOrders.mockResolvedValue([]);
  mockLockJob.mockResolvedValue(true);
  mockFreezeInput.mockResolvedValue({ sha256: "f".repeat(64), input: {} });
  mockPrefetchImages.mockResolvedValue({ logo: null, signature: null });
  mockFindImageKeys.mockResolvedValue({
    logoKey: "logo/key.png",
    signatureKey: null,
  });
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

describe("approveJob roadmap 2 B5 gates", () => {
  const STANDARD = {
    id: 7,
    name: "Massa padrão",
    certificateNumber: "C-1",
    calibrationDate: new Date("2026-01-01T00:00:00Z"),
    nextCalibrationDate: new Date("2027-01-01T00:00:00Z"),
    uncertainty: 0.01,
    uncertaintyUnit: "g",
    coverageFactor: 2,
    distribution: "normal",
    drift: null,
    certifiedValues: null,
  };

  it("REQ-B5-1: blocks the member who submitted the job even when another member is the technician and creator", async () => {
    state.jobRows = [reviewJob({ submittedBy: "approver-1" })];
    state.memberRows = [{ id: "member-2" }];
    await expect(callApprove()).resolves.toEqual({
      status: "self_approval_blocked",
    });
    expect(state.updateCalls).toHaveLength(0);
    expect(mockEnqueueBackgroundJob).not.toHaveBeenCalled();
  });

  it("REQ-B5-1: a job with no recorded submitter (legacy) is judged on the technician and creator only", async () => {
    state.jobRows = [reviewJob({ submittedBy: null })];
    state.memberRows = [];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    expect((await callApprove()).status).toBe("approved");
  });

  it("REQ-B5-1: the approval never writes the submitter", async () => {
    state.jobRows = [reviewJob({ submittedBy: "someone-else" })];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    await callApprove();
    expect(state.updateCalls[0]).not.toHaveProperty("submittedBy");
  });

  it("REQ-B5-2: an accredited laboratory has no solo exemption: the submitter is blocked", async () => {
    state.jobRows = [reviewJob({ submittedBy: "approver-1" })];
    // The organization row (accredited); no other member row can approve.
    state.memberRows = [{ accreditationActive: true }];
    await expect(callApprove()).resolves.toEqual({
      status: "self_approval_blocked",
    });
    expect(mockCheckSignatory).not.toHaveBeenCalled();
  });

  it("REQ-B5-2: an accredited laboratory makes the signatory roster mandatory; an empty one refuses", async () => {
    state.jobRows = [reviewJob()];
    state.memberRows = [{ accreditationActive: true }];
    mockCheckSignatory.mockResolvedValue({ ok: false, reason: "empty_roster" });
    await expect(callApprove()).resolves.toEqual({
      status: "signatory_roster_empty",
    });
    expect(mockCheckSignatory.mock.calls[0]?.[0]).toMatchObject({
      mandatory: true,
    });
    expect(state.updateCalls).toHaveLength(0);
  });

  it("REQ-B5-2: a laboratory that is not accredited does not make the roster mandatory", async () => {
    state.jobRows = [reviewJob()];
    state.memberRows = [];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    await callApprove();
    expect(mockCheckSignatory.mock.calls[0]?.[0]).toMatchObject({
      mandatory: false,
    });
  });

  it("REQ-B5-3: re-judges the standards of the snapshot on the performed date, in this laboratory", async () => {
    const performedAt = new Date("2026-06-10T00:00:00Z");
    state.jobRows = [reviewJob({ standardsSnapshot: [STANDARD], performedAt })];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    mockJudgeStandards.mockResolvedValue({ ok: true, standardIds: [7] });
    expect((await callApprove()).status).toBe("approved");
    expect(mockJudgeStandards).toHaveBeenCalledWith(
      expect.objectContaining({
        standardIds: [7],
        organizationId: "org-1",
        performedAt,
        mode: "cloud",
        requireBackdateReason: false,
        lifecycleStatusesAfterTheWorkAreFine: true,
      }),
      expect.anything(),
    );
  });

  it("REQ-B5-3: a refused standard stops the approval before anything is written or dispatched", async () => {
    state.jobRows = [reviewJob({ standardsSnapshot: [STANDARD] })];
    const refusal = {
      ok: false,
      code: "standard_inactive",
      standardIds: [7],
      standardNames: ["Massa padrão"],
    };
    mockJudgeStandards.mockResolvedValue(refusal);
    await expect(callApprove()).resolves.toEqual({
      status: "standards_refused",
      refusal,
    });
    expect(state.updateCalls).toHaveLength(0);
    expect(state.insertCalls).toHaveLength(0);
    expect(mockLockJob).not.toHaveBeenCalled();
    expect(mockEnqueueBackgroundJob).not.toHaveBeenCalled();
  });

  it("REQ-B5-3: a job with no standards is not judged", async () => {
    state.jobRows = [reviewJob({ standardsSnapshot: [] })];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    expect((await callApprove()).status).toBe("approved");
    expect(mockJudgeStandards).not.toHaveBeenCalled();
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
    // B2: the date advance runs INSIDE the approval transaction (on its handle),
    // never as a post-commit follow-up.
    expect(mockAdvanceDates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assetId: 55, source: "job_approval" }),
    );
    expect(mockEnqueueBackgroundJob).toHaveBeenCalledWith({
      jobId: 10,
      userId: "approver-1",
    });
    // The technician notification is a staged queue job, not an in-process call.
    expect(mockEnqueueBackgroundJob).toHaveBeenCalledWith({
      type: "JOB_APPROVED_NOTIFICATION",
      jobId: 10,
      userId: "approver-1",
    });
    expect(mockRecordOotEvent).not.toHaveBeenCalled();
    expect(mockEnqueueBackgroundJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "ASSET_OOT_NOTIFICATION" }),
    );
  });

  it("raises a customer-facing OOT event when the as-found verdict is non-conforming", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    mockBuildVerdict.mockReturnValue({
      conformity: "NON_CONFORMING",
      margins: null,
    });

    await callApprove();

    // The event is written in the approval transaction; its customer alert is a
    // staged queue job that names the event.
    expect(mockRecordOotEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobId: 10, assetId: 55, customerId: 9 }),
    );
    expect(mockEnqueueBackgroundJob).toHaveBeenCalledWith({
      type: "ASSET_OOT_NOTIFICATION",
      eventId: 77,
      organizationId: "org-1",
      userId: "approver-1",
    });
  });

  it("stages no customer alert when the event already exists (a re-approval after a rejection cycle)", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    mockBuildVerdict.mockReturnValue({
      conformity: "NON_CONFORMING",
      margins: null,
    });
    mockRecordOotEvent.mockResolvedValue(null);

    await callApprove();

    expect(mockEnqueueBackgroundJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "ASSET_OOT_NOTIFICATION" }),
    );
  });

  it("a failing OOT-event or date-advance write fails the approval: nothing is dispatched after it", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    mockBuildVerdict.mockReturnValue({
      conformity: "NON_CONFORMING",
      margins: null,
    });
    mockRecordOotEvent.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(callApprove()).rejects.toThrow("audit insert failed");
    expect(mockEnqueueBackgroundJob).not.toHaveBeenCalled();

    mockAdvanceDates.mockRejectedValueOnce(new Error("asset audit failed"));
    await expect(callApprove()).rejects.toThrow("asset audit failed");
    expect(mockEnqueueBackgroundJob).not.toHaveBeenCalled();
  });

  it("an approval reverted because the certificate job could not be dispatched takes its OOT event and date advance with it", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    mockBuildVerdict.mockReturnValue({
      conformity: "NON_CONFORMING",
      margins: null,
    });
    const applied = { assetId: 55, next: { lastCalibrationDate: new Date() } };
    mockAdvanceDates.mockResolvedValue(applied);
    // The certificate job is the first dispatch: it fails.
    mockEnqueueBackgroundJob.mockRejectedValueOnce(new Error("queue down"));

    await expect(callApprove()).resolves.toEqual({ status: "dispatch_failed" });

    expect(mockWithdrawOotEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: 77, jobId: 10 }),
    );
    expect(mockRevertAdvance).toHaveBeenCalledWith(
      expect.anything(),
      applied,
      expect.objectContaining({ performedBy: "approver-1" }),
    );
    // No notification is dispatched for an approval that was reverted.
    expect(mockEnqueueBackgroundJob).toHaveBeenCalledTimes(1);
  });
});

describe("approveJob actor, role gate and compare-and-set", () => {
  function callAs(
    memberOverrides: Record<string, unknown>,
    actorKind: "user" | "api_key" = "user",
  ) {
    const base: unknown = { ...testMember(), ...memberOverrides };
    // oxlint-disable-next-line typescript/consistent-type-assertions -- tests build the minimal member scope the command reads.
    const member = base as Member;
    return approveJob({
      jobId: 10,
      actor:
        actorKind === "user"
          ? { kind: "user", member }
          : {
              kind: "api_key",
              apiKey: { id: "key-1", name: "ERP", keyPrefix: "cf_live_ab" },
              member,
            },
      values: {},
      metadata: {},
      completion: {
        kind: "generate_certificate_pdf",
        sendServiceOrdersToFinance: async () => [],
      },
    });
  }

  it.each([
    ["technician", null],
    ["operator", null],
    ["member", null],
    ["member", "technician"],
  ])(
    "refuses role %s (unitRole %s): it cannot approve in the in_review state",
    async (role, unitRole) => {
      state.jobRows = [reviewJob()];
      await expect(callAs({ role, unitRole })).resolves.toEqual({
        status: "role_not_permitted",
      });
      expect(state.updateCalls).toHaveLength(0);
      expect(state.insertCalls).toHaveLength(0);
    },
  );

  it.each([
    ["admin", null],
    ["owner", null],
    ["member", "unit_admin"],
  ])("allows role %s (unitRole %s)", async (role, unitRole) => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    const result = await callAs({ role, unitRole });
    expect(result.status).toBe("approved");
  });

  it("refuses an API key whose creator is no longer a member, reading nothing", async () => {
    state.jobRows = [reviewJob()];
    const result = await approveJob({
      jobId: 10,
      actor: {
        kind: "api_key",
        apiKey: { id: "key-1", name: "ERP", keyPrefix: "cf_live_ab" },
        member: null,
      },
      values: {},
      metadata: {},
      completion: {
        kind: "generate_certificate_pdf",
        sendServiceOrdersToFinance: async () => [],
      },
    });
    expect(result).toEqual({ status: "approval_requires_signatory" });
    expect(state.updateCalls).toHaveLength(0);
  });

  it("an API-key approval runs the same gates against its creator (self-approval)", async () => {
    state.jobRows = [reviewJob({ technicianId: "approver-1" })];
    state.memberRows = [{ id: "member-2" }];
    await expect(callAs({}, "api_key")).resolves.toEqual({
      status: "self_approval_blocked",
    });
  });

  it("records the key next to the creator in the audit row", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    await callAs({}, "api_key");
    expect(state.insertCalls[0]).toMatchObject({
      performedBy: "approver-1",
      changes: {
        approvedVia: {
          channel: "api_key",
          apiKeyId: "key-1",
          apiKeyName: "ERP",
          apiKeyPrefix: "cf_live_ab",
        },
      },
    });
  });

  it("returns concurrent_approval and writes no audit row when the compare-and-set matches nothing", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [];
    await expect(callAs({})).resolves.toEqual({
      status: "concurrent_approval",
    });
    expect(state.insertCalls).toHaveLength(0);
    expect(mockEnqueueBackgroundJob).not.toHaveBeenCalled();
    expect(mockRecordOotEvent).not.toHaveBeenCalled();
    expect(mockAdvanceDates).not.toHaveBeenCalled();
  });
});

describe("approveJob freezes the certificate input (REQ-CIN-1)", () => {
  it("REQ-CIN-1: freezes the row the approval just wrote and records its sha256 on the approve audit row", async () => {
    state.jobRows = [reviewJob()];
    const written = reviewJob({ status: "GENERATING_PDF" });
    state.updateReturning = [written];

    await callApprove({ reason: "OK" });

    expect(mockLockJob).toHaveBeenCalledWith(expect.anything(), {
      jobId: 10,
      organizationId: "org-1",
      status: "REVIEW",
    });
    expect(mockFreezeInput).toHaveBeenCalledTimes(1);
    expect(mockFreezeInput.mock.calls[0]?.[1]).toBe(written);
    // frozen with the images that were read before the transaction
    expect(mockFreezeInput.mock.calls[0]?.[2]).toBe(
      await mockPrefetchImages.mock.results[0]?.value,
    );
    expect(state.insertCalls[0]).toMatchObject({
      action: "approve",
      changes: { certificateInputSha256: "f".repeat(64) },
    });
  });

  it("REQ-CIN-1: a lost lock (concurrent approval) writes nothing and freezes nothing", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    mockLockJob.mockResolvedValue(false);

    await expect(callApprove()).resolves.toEqual({
      status: "concurrent_approval",
    });

    expect(state.updateCalls).toHaveLength(0);
    expect(mockFreezeInput).not.toHaveBeenCalled();
    expect(state.insertCalls).toHaveLength(0);
  });

  it("REQ-CIN-1: a failing freeze aborts the approval: no audit row, nothing enqueued", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    mockFreezeInput.mockRejectedValue(new Error("storage unavailable"));

    await expect(callApprove()).rejects.toThrow("storage unavailable");

    expect(state.insertCalls).toHaveLength(0);
    expect(mockEnqueueBackgroundJob).not.toHaveBeenCalled();
  });

  it("REQ-CIN-1 [HIGH RISK]: the images are read from storage before the transaction takes the job lock, for this organization and approver", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];

    await callApprove();

    expect(mockFindImageKeys).toHaveBeenCalledTimes(1);
    expect(mockFindImageKeys.mock.calls[0]?.[1]).toEqual({
      organizationId: "org-1",
      approverId: "approver-1",
    });
    expect(mockPrefetchImages).toHaveBeenCalledTimes(1);
    expect(mockPrefetchImages.mock.calls[0]?.[0]).toEqual({
      logoKey: "logo/key.png",
      signatureKey: null,
    });
    expect(mockPrefetchImages.mock.invocationCallOrder[0]).toBeLessThan(
      mockLockJob.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("REQ-CIN-1: a storage failure while reading the images aborts before anything is written or locked", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    mockPrefetchImages.mockRejectedValue(new Error("storage down"));

    await expect(callApprove()).rejects.toThrow("storage down");

    expect(mockLockJob).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
    expect(state.insertCalls).toHaveLength(0);
    expect(mockEnqueueBackgroundJob).not.toHaveBeenCalled();
  });

  it("REQ-CIN-1 [HIGH RISK]: images that no longer match the rows under the lock (the lab changed its logo) are a retryable conflict, nothing enqueued", async () => {
    state.jobRows = [reviewJob()];
    state.updateReturning = [reviewJob({ status: "GENERATING_PDF" })];
    mockFreezeInput.mockRejectedValue(new ImagesChangedError("logo"));

    await expect(callApprove()).resolves.toEqual({
      status: "concurrent_approval",
    });

    expect(mockEnqueueBackgroundJob).not.toHaveBeenCalled();
    expect(mockRecordOotEvent).not.toHaveBeenCalled();
    expect(mockAdvanceDates).not.toHaveBeenCalled();
  });
});
