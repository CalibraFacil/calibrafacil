import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  syncAckResponseSchema,
  syncAttachmentCompleteUploadResponseSchema,
  syncAttachmentDownloadResponseSchema,
  syncAttachmentInitUploadResponseSchema,
  syncBootstrapResponseSchema,
  syncConflictResolutionResponseSchema,
  syncPushResponseSchema,
} from "@calibra-facil/contracts";
import { syncRouter } from "./sync";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];

  function createQuery() {
    const rows = selectResults.shift() ?? [];
    let query: Promise<unknown[]> & {
      from: ReturnType<typeof vi.fn>;
      innerJoin: ReturnType<typeof vi.fn>;
      leftJoin: ReturnType<typeof vi.fn>;
      where: ReturnType<typeof vi.fn>;
      orderBy: ReturnType<typeof vi.fn>;
      limit: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      values: ReturnType<typeof vi.fn>;
      returning: ReturnType<typeof vi.fn>;
    };
    query = Object.assign(Promise.resolve(rows), {
      from: vi.fn(() => query),
      innerJoin: vi.fn(() => query),
      leftJoin: vi.fn(() => query),
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      set: vi.fn(() => query),
      values: vi.fn(() => query),
      returning: vi.fn(() => Promise.resolve(rows)),
    });

    return query;
  }

  return {
    selectResults,
    createR2Client: vi.fn(() => ({ send: vi.fn() })),
    generatePresignedUploadUrl: vi.fn(
      async (
        _client: unknown,
        _bucket: string,
        objectKey: string,
        _contentType: string,
      ) => `https://uploads.example.test/${encodeURIComponent(objectKey)}`,
    ),
    generatePresignedUrl: vi.fn(
      async (_client: unknown, _bucket: string, objectKey: string) =>
        `https://downloads.example.test/${encodeURIComponent(objectKey)}`,
    ),
    uploadToR2: vi.fn(async () => undefined),
    db: {
      select: vi.fn(() => createQuery()),
      insert: vi.fn(() => createQuery()),
      update: vi.fn(() => createQuery()),
    },
    withLabPermission: vi.fn(() => [
      async (
        c: {
          set: (key: string, value: unknown) => void;
        },
        next: () => Promise<void>,
      ) => {
        c.set("session", {
          user: {
            id: "user-1",
            name: "Ada Lovelace",
            email: "ada@example.test",
          },
        });
        c.set("member", {
          id: "member-1",
          role: "admin",
          organizationId: "org-1",
          organizationType: "laboratory",
          userId: "user-1",
          activeUnitId: 10,
          activeUnitName: "Main Lab",
          accessibleUnitIds: [10, 11],
          accessibleUnits: [
            {
              id: 10,
              name: "Main Lab",
              role: "technical_manager",
            },
          ],
          selectedUnitScope: "unit",
          canAccessAllUnits: false,
          unitRole: "technical_manager",
        });
        await next();
      },
    ]),
  };
});

vi.mock("@calibra-facil/db", () => ({
  db: mocks.db,
}));

vi.mock("../middleware/permission", () => ({
  withLabPermission: mocks.withLabPermission,
}));

vi.mock("../lib/storage", () => ({
  createR2Client: mocks.createR2Client,
  generatePresignedUploadUrl: mocks.generatePresignedUploadUrl,
  generatePresignedUrl: mocks.generatePresignedUrl,
  uploadToR2: mocks.uploadToR2,
}));

vi.mock("@calibra-facil/math-engine", () => ({
  normalizeEngineOptions: (options: Record<string, unknown> = {}) =>
    Object.freeze({
      ...options,
      engineVersion: "engine-test",
    }),
  createCalculationEngine: (options: Record<string, unknown> = {}) => {
    if ("engineVersion" in options) {
      throw new Error("Object contains an unsupported field.");
    }

    return {
      evaluateFormula: () => {
        throw new Error("Formula evaluation is not expected in this test.");
      },
      evaluateMeasurementModel: () => {
        throw new Error(
          "Measurement model evaluation is not expected in this test.",
        );
      },
    };
  },
}));

function createApp() {
  return new Hono().route("/api/sync", syncRouter);
}

const testR2Env = {
  R2_ACCOUNT_ID: "account-1",
  R2_ACCESS_KEY_ID: "access-key-1",
  R2_SECRET_ACCESS_KEY: "secret-key-1",
  R2_BUCKET_NAME: "sync-attachments",
};

function syncEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    eventId: "evt-1",
    entityType: "asset",
    entityId: "local-asset-1",
    operation: "create_local_asset",
    payload: {},
    occurredAt: "2026-05-09T12:00:00.000Z",
    actorUserId: "local",
    organizationId: "org-1",
    unitId: 10,
    idempotencyKey: "idem-1",
    localVersion: 0,
    ...overrides,
  };
}

function attachmentUploadRequest(
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    deviceId: "desktop-1",
    eventId: "evt-attachment-1",
    entityType: "asset",
    entityId: "local-asset-1",
    fileName: "calibration-photo.jpg",
    contentHash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    mimeType: "image/jpeg",
    sizeBytes: 4096,
    ...overrides,
  };
}

function certificatePdfUploadFormData(
  overrides: Partial<Record<string, string | number | null>> = {},
) {
  const content = new Uint8Array([37, 80, 68, 70]);
  const formData = new FormData();
  const fields = {
    eventId: "evt-certificate-pdf-1",
    entityId: "local-certificate-draft-1",
    operation: "generate_local_certificate_pdf",
    idempotencyKey: "idem-certificate-pdf-1",
    localVersion: 3,
    occurredAt: "2026-05-09T12:00:00.000Z",
    actorUserId: "user-1",
    organizationId: "org-1",
    unitId: 10,
    localJobId: "local-job-1",
    draftId: "draft-1",
    contentHash:
      "315d429b7714cedb6ad04ac31240145257692630457f3c88253c5beceac76027",
    sizeBytes: content.byteLength,
    ...overrides,
  };

  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) {
      formData.set(key, String(value));
    }
  }

  formData.set(
    "file",
    new File([content], "desktop-draft.pdf", { type: "application/pdf" }),
  );

  return formData;
}

describe("syncRouter", () => {
  beforeEach(() => {
    mocks.selectResults.length = 0;
    vi.clearAllMocks();
  });

  it("returns a bootstrap snapshot scoped to the authenticated member", async () => {
    const response = await createApp().request("/api/sync/bootstrap", {
      method: "POST",
    });
    const body = syncBootstrapResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.user).toEqual({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.test",
    });
    expect(body.organization).toEqual({
      id: "org-1",
      type: "laboratory",
    });
    expect(body.permissions).toMatchObject({
      role: "admin",
      activeUnitId: 10,
      accessibleUnitIds: [10, 11],
      canAccessAllUnits: false,
    });
    expect(body.featureFlags).toEqual({
      offlineApprovals: false,
      offlineCertificatePublication: false,
    });
    expect(body.publishedMethods).toEqual([]);
    expect(mocks.db.select).toHaveBeenCalledTimes(9);
  });

  it("includes measurement models in synced published methods", async () => {
    const measurementModels = [
      {
        key: "mass_uncertainty",
        label: "Mass uncertainty",
        measurand: "error",
        expression: "error",
        quantities: [
          {
            symbol: "error",
            source: { kind: "formula", key: "error" },
            uncertainty: {
              kind: "direct_standard_uncertainty",
              standardUncertainty: "0.01",
            },
          },
        ],
      },
    ];
    mocks.selectResults.push(
      [
        {
          id: 1,
          organizationId: "org-1",
          assetTypeId: 10,
          name: "Mass calibration",
          version: 1,
          dataFields: [],
          variableBindings: [],
          formulas: [],
          measurementModels,
          validations: [],
          uncertaintyParams: [],
          certificateContent: null,
          methodFingerprint: "method-v1",
          methodEngine: {
            version: "engine-1",
            optionsFingerprint: "options-1",
          },
          compiledMethod: {
            methodFingerprint: "method-v1",
            measurementModels,
          },
          publicationEvidence: null,
          publishedAt: "2026-05-10T12:00:00.000Z",
        },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    );

    const response = await createApp().request("/api/sync/bootstrap", {
      method: "POST",
    });
    const body = syncBootstrapResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.publishedMethods[0]).toMatchObject({
      id: 1,
      measurementModels,
      compiledMethod: {
        measurementModels,
      },
    });
  });

  it("rejects pushed events outside the active organization or accessible units", async () => {
    const response = await createApp().request("/api/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "desktop-1",
        clientBatchId: "batch-1",
        baseCursor: "cursor-before",
        events: [
          syncEvent({
            eventId: "evt-org-mismatch",
            organizationId: "other-org",
          }),
          syncEvent({
            eventId: "evt-unit-mismatch",
            unitId: 999,
          }),
        ],
      }),
    });
    const body = syncPushResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.accepted).toEqual([]);
    expect(body.conflicts).toEqual([]);
    expect(body.newCursor).toBe("cursor-before");
    expect(body.rejected).toEqual([
      {
        eventId: "evt-org-mismatch",
        code: "ORGANIZATION_SCOPE_MISMATCH",
        reason: "Sync event organization does not match active organization.",
      },
      {
        eventId: "evt-unit-mismatch",
        code: "UNIT_SCOPE_MISMATCH",
        reason: "Sync event unit is not accessible to this member.",
      },
    ]);
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("acknowledges an already-applied pushed event without reapplying it", async () => {
    mocks.selectResults.push([
      {
        details: {
          eventId: "evt-duplicate",
          remoteEntityId: 123,
          remoteEntity: {
            id: 123,
          },
        },
      },
    ]);

    const response = await createApp().request("/api/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "desktop-1",
        clientBatchId: "batch-duplicate",
        baseCursor: null,
        events: [
          syncEvent({
            eventId: "evt-duplicate",
            localVersion: 7,
          }),
        ],
      }),
    });
    const body = syncPushResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.rejected).toEqual([]);
    expect(body.accepted).toEqual([
      {
        eventId: "evt-duplicate",
        remoteEntityId: 123,
        remoteEntity: {
          id: 123,
        },
        remoteVersion: 8,
        cloudEventId: "cloud:evt-duplicate",
      },
    ]);
    expect(body.newCursor).toBe("cursor:batch-duplicate:1");
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("returns reviewable conflicts for invalid remote job status transitions", async () => {
    mocks.selectResults.push(
      [],
      [
        {
          details: {
            remoteEntityId: 42,
          },
        },
      ],
      [
        {
          id: 42,
          jobId: "CAL-2026-0042",
          status: "APPROVED",
          updatedAt: new Date("2026-05-09T12:30:00.000Z"),
        },
      ],
    );

    const response = await createApp().request("/api/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "desktop-1",
        clientBatchId: "batch-conflict",
        baseCursor: "cursor-before",
        events: [
          syncEvent({
            eventId: "evt-conflict",
            entityType: "calibration_job",
            entityId: "local-job-1",
            operation: "submit_local_execution",
            payload: {
              status: "REVIEW",
              data: { readings: [] },
            },
          }),
        ],
      }),
    });
    const body = syncPushResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([]);
    expect(body.conflicts).toEqual([
      {
        id: "desktop-conflict:calibration_job:local-job-1:evt-conflict",
        eventId: "evt-conflict",
        entityType: "calibration_job",
        entityId: "local-job-1",
        conflictType: "status_transition",
        status: "open",
        localPayload: {
          status: "REVIEW",
          data: { readings: [] },
        },
        remotePayload: {
          id: 42,
          jobId: "CAL-2026-0042",
          status: "APPROVED",
          updatedAt: "2026-05-09T12:30:00.000Z",
        },
      },
    ]);
    expect(body.newCursor).toBe("cursor:batch-conflict:0:1");
  });

  it("rejects offline execution when selected standards are no longer active in cloud", async () => {
    mocks.selectResults.push(
      [],
      [
        {
          details: {
            remoteEntityId: 42,
          },
        },
      ],
      [
        {
          id: 42,
          jobId: "CAL-2026-0042",
          status: "IN_PROGRESS",
          updatedAt: new Date("2026-05-09T12:30:00.000Z"),
          standardsSnapshot: null,
          environmentalSnapshot: null,
        },
      ],
      [
        {
          id: 100,
          name: "M1 1 kg",
          status: "INACTIVE",
          nextCalibrationDate: new Date("2027-01-01T00:00:00.000Z"),
        },
      ],
    );

    const response = await createApp().request("/api/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "desktop-1",
        clientBatchId: "batch-standards",
        baseCursor: "cursor-before",
        events: [
          syncEvent({
            eventId: "evt-standard-inactive",
            entityType: "calibration_job",
            entityId: "local-job-1",
            operation: "submit_local_execution",
            payload: {
              status: "REVIEW",
              data: { readings: [] },
              standardsSnapshot: [
                {
                  id: 100,
                  name: "M1 1 kg",
                  certificateNumber: "CERT-100",
                  nextCalibrationDate: "2027-01-01T00:00:00.000Z",
                },
              ],
            },
          }),
        ],
      }),
    });
    const body = syncPushResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.accepted).toEqual([]);
    expect(body.conflicts).toEqual([]);
    expect(body.rejected).toEqual([
      {
        eventId: "evt-standard-inactive",
        code: "STANDARD_NOT_ACTIVE",
        reason: "Desktop execution references inactive standards: M1 1 kg.",
      },
    ]);
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("rejects offline execution when the compiled method fingerprint no longer matches the job snapshot", async () => {
    mocks.selectResults.push(
      [],
      [
        {
          details: {
            remoteEntityId: 42,
          },
        },
      ],
      [
        {
          id: 42,
          jobId: "CAL-2026-0042",
          status: "IN_PROGRESS",
          updatedAt: new Date("2026-05-09T12:30:00.000Z"),
          methodSnapshot: {
            methodFingerprint: "method-v1",
            engineVersion: "engine-1",
            engineOptionsFingerprint: "options-1",
            normalizedMethodJson: "{}",
            dataFields: [],
            compiledMethod: {
              status: "compiled",
              methodFingerprint: "method-v2",
              engine: {
                version: "engine-1",
                optionsFingerprint: "options-1",
              },
              normalizedMethodJson: "{}",
              inputs: [],
              formulas: [],
              measurementModels: [],
              acceptanceCriteria: [],
            },
          },
          assetSnapshot: {
            id: 10,
            specifications: {},
          },
          standardsSnapshot: null,
          environmentalSnapshot: null,
        },
      ],
    );

    const response = await createApp().request("/api/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "desktop-1",
        clientBatchId: "batch-method-fingerprint",
        baseCursor: "cursor-before",
        events: [
          syncEvent({
            eventId: "evt-method-fingerprint",
            entityType: "calibration_job",
            entityId: "local-job-1",
            operation: "submit_local_execution",
            payload: {
              status: "REVIEW",
              data: { readings: [] },
            },
          }),
        ],
      }),
    });
    const body = syncPushResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.accepted).toEqual([]);
    expect(body.conflicts).toEqual([]);
    expect(body.rejected).toEqual([
      {
        eventId: "evt-method-fingerprint",
        code: "COMPILED_METHOD_SNAPSHOT_INVALID",
        reason: "Compiled method snapshot does not match job metadata.",
      },
    ]);
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("accepts saved desktop executions with a valid compiled method snapshot", async () => {
    const compiledMethod = {
      methodId: "method-1",
      methodVersion: 1,
      status: "compiled",
      coreVersion: "0.1.0",
      methodFingerprint: "method-v1",
      normalizedMethodJson: "{}",
      engine: {
        packageName: "@calibra-facil/math-engine",
        version: "engine-1",
        optionsFingerprint: "options-1",
      },
      inputs: [],
      formulas: [],
      measurementModels: [],
      acceptanceCriteria: [],
      diagnostics: [],
    };

    mocks.selectResults.push(
      [],
      [
        {
          details: {
            remoteEntityId: 42,
          },
        },
      ],
      [
        {
          id: 42,
          jobId: "CAL-2026-0042",
          status: "IN_PROGRESS",
          updatedAt: new Date("2026-05-09T12:30:00.000Z"),
          performedAt: null,
          data: null,
          results: null,
          methodSnapshot: {
            methodFingerprint: "method-v1",
            engineVersion: "engine-1",
            engineOptionsFingerprint: "options-1",
            normalizedMethodJson: "{}",
            dataFields: [],
            compiledMethod,
          },
          assetSnapshot: {
            id: 10,
            specifications: {},
          },
          standardsSnapshot: null,
          environmentalSnapshot: null,
        },
      ],
      [
        {
          id: 42,
          jobId: "CAL-2026-0042",
          status: "IN_PROGRESS",
          performedAt: null,
        },
      ],
    );

    const response = await createApp().request("/api/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "desktop-1",
        clientBatchId: "batch-valid-execution",
        baseCursor: "cursor-before",
        events: [
          syncEvent({
            eventId: "evt-valid-execution",
            entityType: "calibration_job",
            entityId: "local-job-1",
            operation: "save_local_execution",
            payload: {
              status: "IN_PROGRESS",
              data: {},
              results: null,
            },
          }),
        ],
      }),
    });
    const body = syncPushResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.rejected).toEqual([]);
    expect(body.conflicts).toEqual([]);
    expect(body.accepted).toEqual([
      {
        eventId: "evt-valid-execution",
        remoteEntityId: 42,
        remoteEntity: {
          id: 42,
          jobId: "CAL-2026-0042",
          status: "IN_PROGRESS",
          performedAt: null,
        },
        remoteVersion: 1,
        cloudEventId: "cloud:evt-valid-execution",
      },
    ]);
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
    expect(mocks.db.insert).toHaveBeenCalledTimes(2);
  });

  it("acknowledges pull cursors through the sync ack endpoint", async () => {
    const response = await createApp().request("/api/sync/ack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "desktop-1",
        cursor: "2026-05-09T12:00:00.000Z",
        appliedCloudEventIds: ["cloud:asset:1"],
      }),
    });
    const body = syncAckResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      cursor: "2026-05-09T12:00:00.000Z",
    });
    expect(Date.parse(body.acknowledgedAt)).not.toBeNaN();
  });

  it("records cloud conflict resolutions for desktop sync review", async () => {
    const response = await createApp().request(
      "/api/sync/conflicts/desktop-conflict:calibration_job:local-job-1:evt-conflict/resolve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "ignored" }),
      },
    );
    const body = syncConflictResolutionResponseSchema.parse(
      await response.json(),
    );

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "desktop-conflict:calibration_job:local-job-1:evt-conflict",
      status: "ignored",
    });
    expect(Date.parse(body.data.resolvedAt)).not.toBeNaN();
    expect(mocks.db.insert).toHaveBeenCalledTimes(1);
    const insertQuery = mocks.db.insert.mock.results[0]?.value;
    expect(insertQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        unitId: 10,
        actorUserId: "user-1",
        actorMemberId: "member-1",
        action: "sync.conflict_resolved",
        entityType: "sync_conflict",
        entityId: "desktop-conflict:calibration_job:local-job-1:evt-conflict",
        details: expect.objectContaining({
          conflictId:
            "desktop-conflict:calibration_job:local-job-1:evt-conflict",
          status: "ignored",
        }),
      }),
    );
  });

  it("rejects desktop certificate PDF upload before the local job has synced", async () => {
    mocks.selectResults.push([], []);

    const response = await createApp().request(
      "/api/sync/certificate-pdfs",
      {
        method: "POST",
        body: certificatePdfUploadFormData(),
      },
      testR2Env,
    );
    const body = syncPushResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.accepted).toEqual([]);
    expect(body.conflicts).toEqual([]);
    expect(body.rejected).toEqual([
      {
        eventId: "evt-certificate-pdf-1",
        code: "REMOTE_ENTITY_MAPPING_MISSING",
        reason: "Desktop certificate PDF upload has no synced cloud job.",
      },
    ]);
    expect(mocks.uploadToR2).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("rejects desktop certificate PDF upload when the cloud job is not publishable", async () => {
    mocks.selectResults.push(
      [],
      [
        {
          details: {
            remoteEntityId: 42,
          },
        },
      ],
      [
        {
          id: 42,
          jobId: "CAL-2026-0042",
          status: "APPROVED",
          certificateUrl: null,
          unitId: 10,
        },
      ],
    );

    const response = await createApp().request(
      "/api/sync/certificate-pdfs",
      {
        method: "POST",
        body: certificatePdfUploadFormData(),
      },
      testR2Env,
    );
    const body = syncPushResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.accepted).toEqual([]);
    expect(body.conflicts).toEqual([]);
    expect(body.rejected).toEqual([
      {
        eventId: "evt-certificate-pdf-1",
        code: "INVALID_STATUS_TRANSITION",
        reason:
          "Cannot publish desktop certificate PDF for job with status APPROVED.",
      },
    ]);
    expect(mocks.uploadToR2).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("creates signed upload URLs for offline sync attachments", async () => {
    const requestBody = attachmentUploadRequest();
    const response = await createApp().request(
      "/api/sync/attachments/init-upload",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      },
      testR2Env,
    );
    const body = syncAttachmentInitUploadResponseSchema.parse(
      await response.json(),
    );

    expect(response.status).toBe(200);
    expect(body.objectKey).toMatch(
      /^org\/org-1\/sync-attachments\/asset\/local-asset-1\/aaaaaaaaaaaaaaaa-evt-attachment-1\.jpg$/,
    );
    expect(body.attachmentId).toBe(
      Buffer.from(body.objectKey, "utf8").toString("base64url"),
    );
    expect(body.uploadUrl).toBe(
      `https://uploads.example.test/${encodeURIComponent(body.objectKey)}`,
    );
    expect(body.headers).toEqual({ "content-type": "image/jpeg" });
    expect(mocks.generatePresignedUploadUrl).toHaveBeenCalledWith(
      expect.anything(),
      "sync-attachments",
      body.objectKey,
      "image/jpeg",
      900,
    );
  });

  it("confirms completed offline sync attachment uploads", async () => {
    const uploadResponse = await createApp().request(
      "/api/sync/attachments/init-upload",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attachmentUploadRequest()),
      },
      testR2Env,
    );
    const upload = syncAttachmentInitUploadResponseSchema.parse(
      await uploadResponse.json(),
    );

    const response = await createApp().request(
      "/api/sync/attachments/complete-upload",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...attachmentUploadRequest(),
          attachmentId: upload.attachmentId,
          objectKey: upload.objectKey,
        }),
      },
      testR2Env,
    );
    const body = syncAttachmentCompleteUploadResponseSchema.parse(
      await response.json(),
    );

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      attachmentId: upload.attachmentId,
      objectKey: upload.objectKey,
    });
    expect(Date.parse(body.completedAt)).not.toBeNaN();
  });

  it("rejects completed attachment uploads when the id and object key differ", async () => {
    const uploadResponse = await createApp().request(
      "/api/sync/attachments/init-upload",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attachmentUploadRequest()),
      },
      testR2Env,
    );
    const upload = syncAttachmentInitUploadResponseSchema.parse(
      await uploadResponse.json(),
    );

    const response = await createApp().request(
      "/api/sync/attachments/complete-upload",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...attachmentUploadRequest(),
          attachmentId: upload.attachmentId,
          objectKey: `${upload.objectKey}.different`,
        }),
      },
      testR2Env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Attachment id does not match object key.",
    });
  });

  it("creates signed download URLs for offline sync attachments", async () => {
    const uploadResponse = await createApp().request(
      "/api/sync/attachments/init-upload",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attachmentUploadRequest()),
      },
      testR2Env,
    );
    const upload = syncAttachmentInitUploadResponseSchema.parse(
      await uploadResponse.json(),
    );

    const response = await createApp().request(
      `/api/sync/attachments/${upload.attachmentId}/download`,
      {},
      testR2Env,
    );
    const body = syncAttachmentDownloadResponseSchema.parse(
      await response.json(),
    );

    expect(response.status).toBe(200);
    expect(body).toEqual({
      attachmentId: upload.attachmentId,
      objectKey: upload.objectKey,
      downloadUrl: `https://downloads.example.test/${encodeURIComponent(
        upload.objectKey,
      )}`,
      expiresInSeconds: 900,
    });
    expect(mocks.generatePresignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      "sync-attachments",
      upload.objectKey,
      900,
    );
  });
});
