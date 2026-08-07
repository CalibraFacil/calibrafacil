import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySyncBootstrap,
  applySyncPullResponse,
  applySyncPushResult,
  createLocalAsset,
  createLocalCustomer,
  createLocalServiceOrderDeliveryDocumentDraft,
  createLocalServiceOrderIntake,
  createLocalServiceOrderQuoteDraft,
  countPendingOutbox,
  getLocalDashboardStats,
  getLocalDatabaseDiagnostics,
  getLocalSchemaVersion,
  listPendingOutboxEvents,
  listLocalAssets,
  listLocalCustomers,
  listLocalMethods,
  listLocalServiceOrders,
  LocalDatabaseVersionError,
  markOutboxEventsFailedForRetry,
  listLocalJobs,
  openLocalDatabase,
  resolveSyncConflict,
  saveLocalJobExecution,
  saveLocalServiceOrderExecutionNotes,
  updateLocalAsset,
  updateLocalCustomer,
  upsertLocalJobProjection,
} from "./index";
import { currentLocalDbSchemaVersion } from "./migrations";

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-local-db-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function requiredRow<T>(row: T | undefined): T {
  if (!row) {
    throw new Error("Expected database row");
  }

  return row;
}

function seedCalibrationJobConflict(
  database: ReturnType<typeof openLocalDatabase>,
) {
  const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
  const conflictId =
    "desktop-conflict:calibration_job:job-local:event-conflict";

  database
    .prepare(
      `
INSERT INTO domain_events (
  event_id,
  aggregate_kind,
  aggregate_id,
  aggregate_version,
  event_type,
  payload_json,
  metadata_json,
  actor_user_id,
  device_id,
  occurred_at,
  sync_state
) VALUES (
  'event-conflict',
  'calibration_job',
  'job-local',
  2,
  'submit_local_execution',
  '{"status":"REVIEW","data":{"readings":[]}}',
  '{}',
  'user-1',
  'device-1',
  @now,
  'pending'
)
`,
    )
    .run({ now });

  database
    .prepare(
      `
INSERT INTO outbox (
  id,
  event_id,
  operation,
  payload_json,
  idempotency_key,
  status,
  created_at
) VALUES (
  'outbox:event-conflict',
  'event-conflict',
  'submit_local_execution',
  '{"status":"REVIEW","data":{"readings":[]}}',
  'local:event-conflict',
  'pending',
  @now
)
`,
    )
    .run({ now });

  applySyncPushResult(database, {
    accepted: [],
    rejected: [],
    conflicts: [
      {
        id: conflictId,
        eventId: "event-conflict",
        entityType: "calibration_job",
        entityId: "job-local",
        conflictType: "status_transition",
        status: "open",
        localPayload: {
          status: "REVIEW",
          data: { readings: [] },
        },
        remotePayload: {
          status: "APPROVED",
        },
      },
    ],
    newCursor: "cursor-conflict",
  });

  return conflictId;
}

describe("local database", () => {
  it("runs migrations and records schema version", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    expect(getLocalSchemaVersion(database)).toBe(currentLocalDbSchemaVersion);

    database.close();
  });

  it("summarizes local dashboard stats from SQLite projections", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z");
    const nowIso = now.toISOString();

    database
      .prepare(
        `
INSERT INTO customers (
  id,
  organization_id,
  unit_id,
  name,
  updated_at,
  sync_state
) VALUES ('customer-local', 'org-1', 1, 'Acme Lab', @now, 'synced')
`,
      )
      .run({ now: nowIso });
    database
      .prepare(
        `
INSERT INTO assets (
  id,
  organization_id,
  unit_id,
  customer_id,
  asset_type_id,
  name,
  serial_number,
  tag,
  status,
  updated_at,
  sync_state
) VALUES (
  'asset-local',
  'org-1',
  1,
  'customer-local',
  'asset-type-local',
  'Scale 01',
  'SN-001',
  'TAG-001',
  'ACTIVE',
  @now,
  'synced'
)
`,
      )
      .run({ now: nowIso });
    database
      .prepare(
        `
INSERT INTO services (
  id,
  organization_id,
  name,
  status,
  pulled_at,
  sync_state
) VALUES ('service-local', 'org-1', 'Mass calibration', 'ACTIVE', @now, 'synced')
`,
      )
      .run({ now: nowIso });

    for (const job of [
      {
        id: "job-draft",
        jobId: "CAL-DRAFT",
        status: "DRAFT" as const,
        dueDate: "2026-01-15T15:00:00.000Z",
        createdAt: "2026-01-15T09:00:00.000Z",
      },
      {
        id: "job-review",
        jobId: "CAL-REVIEW",
        status: "REVIEW" as const,
        dueDate: "2026-01-16T15:00:00.000Z",
        createdAt: "2026-01-15T08:00:00.000Z",
      },
      {
        id: "job-overdue",
        jobId: "CAL-OVERDUE",
        status: "IN_PROGRESS" as const,
        dueDate: "2026-01-14T15:00:00.000Z",
        createdAt: "2026-01-15T07:00:00.000Z",
      },
      {
        id: "job-approved",
        jobId: "CAL-APPROVED",
        status: "APPROVED" as const,
        dueDate: null,
        createdAt: "2026-01-13T07:00:00.000Z",
      },
      {
        id: "job-rejected",
        jobId: "CAL-REJECTED",
        status: "REJECTED" as const,
        dueDate: null,
        createdAt: "2026-01-12T07:00:00.000Z",
      },
    ]) {
      upsertLocalJobProjection(database, {
        id: job.id,
        jobId: job.jobId,
        organizationId: "org-1",
        unitId: 1,
        customerId: "customer-local",
        assetId: "asset-local",
        serviceId: "service-local",
        status: job.status,
        dueDate: job.dueDate,
        createdAt: job.createdAt,
        updatedAt: job.createdAt,
      });
    }

    database
      .prepare(
        "UPDATE calibration_jobs SET approved_at = '2026-01-14T12:00:00.000Z' WHERE id = 'job-approved'",
      )
      .run();
    database
      .prepare(
        "UPDATE calibration_jobs SET rejected_at = '2026-01-13T12:00:00.000Z' WHERE id = 'job-rejected'",
      )
      .run();
    database
      .prepare(
        `
INSERT INTO reference_standards (
  id,
  organization_id,
  unit_id,
  name,
  serial_number,
  certificate_number,
  next_calibration_date,
  status,
  snapshot_json,
  pulled_at,
  sync_state
) VALUES
  (
    'standard-expiring',
    'org-1',
    1,
    'Reference Mass',
    'STD-001',
    'CERT-001',
    '2026-01-25T00:00:00.000Z',
    'ACTIVE',
    '{"name":"Reference Mass","serialNumber":"STD-001","certificateNumber":"CERT-001","nextCalibrationDate":"2026-01-25T00:00:00.000Z"}',
    @now,
    'synced'
  ),
  (
    'standard-oot',
    'org-1',
    1,
    'Reference Thermometer',
    'STD-002',
    'CERT-002',
    '2026-04-01T00:00:00.000Z',
    'OUT_OF_TOLERANCE',
    '{"name":"Reference Thermometer","serialNumber":"STD-002","certificateNumber":"CERT-002","nextCalibrationDate":"2026-04-01T00:00:00.000Z"}',
    @now,
    'synced'
  )
`,
      )
      .run({ now: nowIso });

    const stats = getLocalDashboardStats(database, now);

    expect(stats).toMatchObject({
      pendingCalibrations: 3,
      approvedThisMonth: 1,
      rejectedThisMonth: 1,
      approvalRate: 50,
      expiringStandards: 2,
      overdueJobs: 1,
      dueToday: 1,
      dueNextSevenDays: 1,
    });
    expect(stats.reviewQueue).toHaveLength(1);
    expect(stats.reviewQueue[0]?.jobId).toBe("CAL-REVIEW");
    expect(stats.recentJobs.map((job) => job.jobId)).toContain("CAL-DRAFT");
    expect(stats.statusBreakdown).toEqual(
      expect.arrayContaining([
        { status: "DRAFT", count: 1 },
        { status: "REVIEW", count: 1 },
        { status: "APPROVED", count: 1 },
      ]),
    );
    expect(stats.standardsWatchlist.map((standard) => standard.name)).toEqual([
      "Reference Mass",
      "Reference Thermometer",
    ]);
    expect(stats.calibrationTrend).toContainEqual({
      date: "2026-01-14",
      approved: 1,
      rejected: 0,
    });

    database.close();
  });

  it("applies cloud pull projection events after bootstrap", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    applySyncBootstrap(database, {
      serverTime: now,
      user: {
        id: "user-1",
        name: "User One",
        email: "user@example.com",
      },
      organization: {
        id: "org-1",
        type: "LAB",
      },
      activeUnits: [
        {
          id: 1,
          name: "Matriz",
          role: "technician",
        },
      ],
      permissions: {
        role: "technician",
        unitRole: "technician",
        activeUnitId: 1,
        accessibleUnitIds: [1],
        canAccessAllUnits: false,
      },
      featureFlags: {
        offlineApprovals: false,
        offlineCertificatePublication: false,
      },
      syncCursor: "2026-01-15T10:00:00.000Z",
      publishedMethods: [],
      assetTypes: [],
      customers: [],
      assets: [],
      services: [],
      standards: [],
      massCompositionProfiles: [],
      environmentalLimits: [],
      jobs: [],
      serviceOrders: [],
    });

    applySyncPullResponse(database, {
      cursor: "2026-01-15T10:05:00.000Z",
      hasMore: false,
      events: [
        {
          cloudEventId: "cloud:customer:123:2026-01-15T10:05:00.000Z",
          entityType: "customer",
          entityId: 123,
          operation: "upsert",
          occurredAt: "2026-01-15T10:05:00.000Z",
          payload: {
            id: 123,
            name: "Pulled Customer",
            taxId: "12345678000199",
            email: "pull@example.com",
            phone: null,
            address: null,
            compliance: null,
            updatedAt: "2026-01-15T10:05:00.000Z",
          },
        },
      ],
    });

    const customer = requiredRow(
      database
        .prepare<
          [],
          {
            id: string;
            remote_id: number;
            name: string;
            email: string;
            sync_state: string;
          }
        >(
          `
SELECT id, remote_id, name, email, sync_state
FROM customers
WHERE id = 'customer:123'
`,
        )
        .get(),
    );
    const cursor = requiredRow(
      database
        .prepare<
          [],
          { cursor: string | null }
        >("SELECT cursor FROM sync_cursors WHERE scope = 'default'")
        .get(),
    );

    expect(customer).toEqual({
      id: "customer:123",
      remote_id: 123,
      name: "Pulled Customer",
      email: "pull@example.com",
      sync_state: "synced",
    });
    expect(cursor.cursor).toBe("2026-01-15T10:05:00.000Z");

    database.close();
  });

  it("preserves synced method measurement models in local method projections", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
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

    applySyncBootstrap(database, {
      serverTime: now,
      user: {
        id: "user-1",
        name: "User One",
        email: "user@example.com",
      },
      organization: {
        id: "org-1",
        type: "LAB",
      },
      activeUnits: [
        {
          id: 1,
          name: "Matriz",
          role: "technician",
        },
      ],
      permissions: {
        role: "technician",
        unitRole: "technician",
        activeUnitId: 1,
        accessibleUnitIds: [1],
        canAccessAllUnits: false,
      },
      featureFlags: {
        offlineApprovals: false,
        offlineCertificatePublication: false,
      },
      syncCursor: now,
      publishedMethods: [
        {
          id: 321,
          organizationId: "org-1",
          assetTypeId: null,
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
          publishedAt: now,
        },
      ],
      assetTypes: [],
      customers: [],
      assets: [],
      services: [],
      standards: [],
      massCompositionProfiles: [],
      environmentalLimits: [],
      jobs: [],
      serviceOrders: [],
    });

    const methods = listLocalMethods(database, { page: 1, limit: 20 });
    expect(methods.data[0]).toMatchObject({
      id: 321,
      measurementModels,
      compiledMethod: {
        measurementModels,
      },
    });

    database.close();
  });

  it("refuses to open a database with a newer schema version", () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });

    database
      .prepare(
        `
INSERT INTO local_schema_migrations (id, name, applied_at)
VALUES (@id, 'future_schema', @now)
`,
      )
      .run({
        id: currentLocalDbSchemaVersion + 1,
        now: new Date("2026-01-15T10:00:00.000Z").toISOString(),
      });
    database.close();

    expect(() => openLocalDatabase({ filePath: dbPath })).toThrow(
      LocalDatabaseVersionError,
    );
  });

  it("reports active local work that blocks desktop updates", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    database
      .prepare(
        `
INSERT INTO calibration_jobs (
  id,
  job_id,
  organization_id,
  unit_id,
  customer_id,
  asset_id,
  service_id,
  method_snapshot_json,
  asset_snapshot_json,
  status,
  version,
  created_at,
  updated_at,
  sync_state
) VALUES (
  'job-active',
  'LOCAL-2026-0001',
  'org-1',
  1,
  'customer-local',
  'asset-local',
  'service-local',
  '{}',
  '{}',
  'IN_PROGRESS',
  0,
  @now,
  @now,
  'local'
)
`,
      )
      .run({ now });

    database
      .prepare(
        `
INSERT INTO service_orders (
  id,
  service_order_number,
  organization_id,
  unit_id,
  customer_id,
  asset_id,
  intake_type,
  status,
  priority,
  claimed_defect,
  intake_condition,
  delivery_method,
  opened_at,
  updated_at,
  sync_state
) VALUES (
  'service-order-active',
  'LOCAL-OS-0001',
  'org-1',
  1,
  'customer-local',
  'asset-local',
  'counter',
  'calibration_in_progress',
  'normal',
  'Falha informada',
  'Recebido no balcão',
  'pickup_at_lab',
  @now,
  @now,
  'local'
)
`,
      )
      .run({ now });

    expect(getLocalDatabaseDiagnostics(database)).toMatchObject({
      activeCalibrationJobCount: 1,
      activeServiceOrderWorkflowCount: 1,
    });

    database.close();
  });

  it("lists local calibration job projections", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    database
      .prepare(
        `
INSERT INTO customers (
  id,
  organization_id,
  unit_id,
  name,
  updated_at,
  sync_state
) VALUES ('customer-local', 'org-1', 1, 'Acme Lab', @now, 'synced')
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO assets (
  id,
  organization_id,
  unit_id,
  customer_id,
  asset_type_id,
  name,
  serial_number,
  tag,
  status,
  updated_at,
  sync_state
) VALUES (
  'asset-local',
  'org-1',
  1,
  'customer-local',
  'asset-type-local',
  'Scale 01',
  'SN-001',
  'TAG-001',
  'ACTIVE',
  @now,
  'synced'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO services (
  id,
  organization_id,
  name,
  status,
  pulled_at,
  sync_state
) VALUES ('service-local', 'org-1', 'Mass calibration', 'ACTIVE', @now, 'synced')
`,
      )
      .run({ now });

    upsertLocalJobProjection(database, {
      id: "job-local",
      remoteId: 123,
      jobId: "CAL-2026-0001",
      organizationId: "org-1",
      unitId: 1,
      customerId: "customer-local",
      assetId: "asset-local",
      serviceId: "service-local",
      status: "IN_PROGRESS",
      dueDate: "2026-01-20T00:00:00.000Z",
      createdAt: now,
      updatedAt: now,
      syncState: "local",
    });

    expect(
      listLocalJobs(database, {
        page: 1,
        limit: 20,
        query: "Acme",
      }),
    ).toEqual({
      data: [
        {
          id: 123,
          jobId: "CAL-2026-0001",
          customerName: "Acme Lab",
          assetName: "Scale 01",
          serviceName: "Mass calibration",
          technicianName: null,
          status: "IN_PROGRESS",
          dueDate: "2026-01-20T00:00:00.000Z",
          isOverdue: true,
          createdAt: now,
          syncState: "local",
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });

    database.close();
  });

  it("includes remote job IDs in synced job execution outbox payloads", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    database
      .prepare(
        `
INSERT INTO customers (
  id,
  organization_id,
  unit_id,
  name,
  updated_at,
  sync_state
) VALUES ('customer-local', 'org-1', 1, 'Acme Lab', @now, 'synced')
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO asset_types (
  id,
  organization_id,
  name,
  specifications_schema_json,
  pulled_at,
  sync_state
) VALUES ('asset-type-local', 'org-1', 'Balanca', '{}', @now, 'synced')
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO assets (
  id,
  organization_id,
  unit_id,
  customer_id,
  asset_type_id,
  name,
  serial_number,
  tag,
  status,
  updated_at,
  sync_state
) VALUES (
  'asset-local',
  'org-1',
  1,
  'customer-local',
  'asset-type-local',
  'Scale 01',
  'SN-001',
  'TAG-001',
  'ACTIVE',
  @now,
  'synced'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO services (
  id,
  organization_id,
  name,
  status,
  pulled_at,
  sync_state
) VALUES ('service-local', 'org-1', 'Mass calibration', 'ACTIVE', @now, 'synced')
`,
      )
      .run({ now });

    upsertLocalJobProjection(database, {
      id: "job-local",
      remoteId: 123,
      jobId: "CAL-2026-0001",
      organizationId: "org-1",
      unitId: 1,
      customerId: "customer-local",
      assetId: "asset-local",
      serviceId: "service-local",
      methodSnapshotJson: "{}",
      assetSnapshotJson: "{}",
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
      syncState: "synced",
    });

    saveLocalJobExecution(database, {
      routeId: "123",
      data: { indication: "10.03", reference: "10" },
      results: null,
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    const [event] = listPendingOutboxEvents(database);
    expect(event).toMatchObject({
      entityType: "calibration_job",
      entityId: "job-local",
      operation: "save_local_execution",
      payload: {
        remoteId: 123,
        data: { indication: "10.03", reference: "10" },
      },
    });

    database.close();
  });

  // §7.8.2.1(n). Desktop is where deviations actually get noticed — the
  // technician is standing at the instrument — so the value has to survive the
  // local write AND reach the outbox, or it is discarded without a trace.
  it("persists method deviations and pushes them to the outbox", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    upsertLocalJobProjection(database, {
      id: "job-local",
      remoteId: 123,
      jobId: "CAL-2026-0001",
      organizationId: "org-1",
      unitId: 1,
      customerId: "customer-local",
      assetId: "asset-local",
      serviceId: "service-local",
      methodSnapshotJson: "{}",
      assetSnapshotJson: "{}",
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
      syncState: "synced",
    });

    const job = saveLocalJobExecution(database, {
      routeId: "123",
      data: {},
      results: null,
      selectedStandardIds: [],
      actorUserId: "user-1",
      deviceId: "device-1",
      methodDeviations: "Ponto de 500 kg não executado: massa indisponível.",
    });
    if (!job) throw new Error("Expected local job execution to be saved");

    expect(job.methodDeviations).toBe(
      "Ponto de 500 kg não executado: massa indisponível.",
    );
    const [event] = listPendingOutboxEvents(database);
    expect(event?.payload).toMatchObject({
      methodDeviations: "Ponto de 500 kg não executado: massa indisponível.",
    });

    database.close();
  });

  it("freezes full cached reference standard snapshots for local executions", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    const standardSnapshot = {
      id: 999,
      name: "Reference Mass Set",
      kind: "mass_set",
      type: "Massa",
      serialNumber: "STD-999",
      certificateNumber: "CERT-999",
      calibratedBy: "Trace Lab",
      calibrationDate: "2026-01-01T00:00:00.000Z",
      nextCalibrationDate: "2027-01-01T00:00:00.000Z",
      uncertainty: 0.001,
      uncertaintyUnit: "g",
      coverageFactor: 2,
      distribution: "normal",
      drift: 0.0001,
      certifiedValues: [
        {
          nominal: "1 kg",
          authentication: "A",
          value: 1000,
          uncertainty: 0.005,
          unit: "g",
          maxError: 0.01,
          drift: 0.001,
          buoyancy: 0.0002,
          coverageFactor: 2,
          compositionProfile: true,
          profileKey: "1 kg stack",
          profileClass: "M1",
          profileQuantityAvailable: 1,
        },
      ],
      metrologyData: {
        version: 1,
        channels: [],
        massValues: [],
        compositionProfiles: [],
      },
      certificateDocument: {
        documentId: 12,
        r2Key: "standards/cert-999.pdf",
        fileName: "cert-999.pdf",
        fileSize: 1024,
        sha256:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        uploadedAt: "2026-01-02T00:00:00.000Z",
        certificateNumber: "CERT-999",
        calibrationDate: "2026-01-01T00:00:00.000Z",
        nextCalibrationDate: "2027-01-01T00:00:00.000Z",
      },
    };

    database
      .prepare(
        `
INSERT INTO reference_standards (
  id,
  remote_id,
  organization_id,
  unit_id,
  name,
  serial_number,
  certificate_number,
  next_calibration_date,
  status,
  snapshot_json,
  pulled_at,
  sync_state
) VALUES (
  'standard:999',
  999,
  'org-1',
  1,
  'Reference Mass Set',
  'STD-999',
  'CERT-999',
  '2027-01-01T00:00:00.000Z',
  'ACTIVE',
  @snapshotJson,
  @now,
  'synced'
)
`,
      )
      .run({ snapshotJson: JSON.stringify(standardSnapshot), now });

    upsertLocalJobProjection(database, {
      id: "job-local",
      remoteId: 123,
      jobId: "CAL-2026-0001",
      organizationId: "org-1",
      unitId: 1,
      customerId: "customer-local",
      assetId: "asset-local",
      serviceId: "service-local",
      methodSnapshotJson: "{}",
      assetSnapshotJson: "{}",
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
      syncState: "synced",
    });

    const data = {
      composition: {
        kind: "mass_standard_composition",
        items: [
          {
            standardId: 999,
            standardIds: [],
            standardName: "Reference Mass Set",
            certificateNumber: "CERT-999",
            certifiedValueIndex: 0,
            nominal: "1 kg",
            quantity: 1,
            value: 1000,
            uncertainty: 0.005,
            unit: "g",
            coverageFactor: 2,
          },
        ],
      },
    };
    const job = saveLocalJobExecution(database, {
      routeId: "123",
      data,
      results: null,
      selectedStandardIds: [],
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    if (!job) throw new Error("Expected local job execution to be saved");

    expect(job.standardsSnapshot).toEqual([
      expect.objectContaining({
        id: 999,
        name: "Reference Mass Set",
        calibratedBy: "Trace Lab",
        uncertainty: 0.001,
        drift: 0.0001,
        metrologyData: standardSnapshot.metrologyData,
        certificateDocument: standardSnapshot.certificateDocument,
        certifiedValues: [
          expect.objectContaining({
            authentication: "A",
            compositionProfile: true,
            profileKey: "1 kg stack",
            profileClass: "M1",
            profileQuantityAvailable: 1,
          }),
        ],
      }),
    ]);
    const [event] = listPendingOutboxEvents(database);
    expect(event?.payload).toMatchObject({
      standardsSnapshot: job.standardsSnapshot,
    });

    database.close();
  });

  it("writes accepted remote entity IDs back to local job projections", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    database
      .prepare(
        `
INSERT INTO calibration_jobs (
  id,
  remote_id,
  job_id,
  organization_id,
  unit_id,
  customer_id,
  asset_id,
  service_id,
  method_snapshot_json,
  asset_snapshot_json,
  status,
  version,
  created_at,
  updated_at,
  sync_state
) VALUES (
  'job-local',
  NULL,
  'LOCAL-2026-0001',
  'org-1',
  1,
  'customer-local',
  'asset-local',
  'service-local',
  '{}',
  '{}',
  'DRAFT',
  0,
  @now,
  @now,
  'local'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO domain_events (
  event_id,
  aggregate_kind,
  aggregate_id,
  aggregate_version,
  event_type,
  payload_json,
  metadata_json,
  actor_user_id,
  device_id,
  occurred_at,
  sync_state
) VALUES (
  'event:job-local',
  'calibration_job',
  'job-local',
  0,
  'create_local_job_draft',
  '{}',
  '{}',
  'user-1',
  'device-1',
  @now,
  'pending'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO outbox (
  id,
  event_id,
  operation,
  payload_json,
  idempotency_key,
  status,
  created_at
) VALUES (
  'outbox:job-local',
  'event:job-local',
  'create_local_job_draft',
  '{}',
  'local:event:job-local',
  'pending',
  @now
)
`,
      )
      .run({ now });

    applySyncPushResult(database, {
      accepted: [
        {
          eventId: "event:job-local",
          remoteEntityId: 321,
          remoteEntity: {
            jobId: "CAL-2026-0001",
          },
          remoteVersion: 1,
          cloudEventId: "cloud:event:job-local",
        },
      ],
      rejected: [],
      conflicts: [],
      newCursor: "cursor-1",
    });

    const row = requiredRow(
      database
        .prepare<
          [],
          {
            remote_id: number | null;
            job_id: string;
            sync_state: string;
          }
        >(
          `
SELECT remote_id, job_id, sync_state
FROM calibration_jobs
WHERE id = 'job-local'
`,
        )
        .get(),
    );

    expect(row).toEqual({
      remote_id: 321,
      job_id: "CAL-2026-0001",
      sync_state: "synced",
    });

    database.close();
  });

  it("stores sync push conflicts with local and remote payloads", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    seedCalibrationJobConflict(database);

    const conflict = requiredRow(
      database
        .prepare<
          [],
          {
            event_id: string | null;
            local_payload_json: string;
            remote_payload_json: string;
            conflict_type: string;
            status: string;
          }
        >(
          `
SELECT event_id, local_payload_json, remote_payload_json, conflict_type, status
FROM sync_conflicts
WHERE id = 'desktop-conflict:calibration_job:job-local:event-conflict'
`,
        )
        .get(),
    );

    expect({
      eventId: conflict.event_id,
      localPayload: JSON.parse(conflict.local_payload_json),
      remotePayload: JSON.parse(conflict.remote_payload_json),
      conflictType: conflict.conflict_type,
      status: conflict.status,
    }).toEqual({
      eventId: "event-conflict",
      localPayload: {
        status: "REVIEW",
        data: { readings: [] },
      },
      remotePayload: {
        status: "APPROVED",
      },
      conflictType: "status_transition",
      status: "open",
    });

    const outboxRow = requiredRow(
      database
        .prepare<
          [],
          {
            outbox_status: string;
            sync_state: string;
          }
        >(
          `
SELECT outbox.status AS outbox_status, domain_events.sync_state
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE outbox.event_id = 'event-conflict'
`,
        )
        .get(),
    );

    expect(outboxRow).toEqual({
      outbox_status: "conflict",
      sync_state: "conflict",
    });
    expect(
      database.prepare("SELECT cursor FROM sync_cursors").get(),
    ).toMatchObject({
      cursor: "cursor-conflict",
    });

    database.close();
  });

  it("resolves only the selected sync conflict event for the entity", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const conflictId = seedCalibrationJobConflict(database);
    const now = new Date("2026-01-15T10:01:00.000Z").toISOString();

    database
      .prepare(
        `
INSERT INTO domain_events (
  event_id,
  aggregate_kind,
  aggregate_id,
  aggregate_version,
  event_type,
  payload_json,
  metadata_json,
  actor_user_id,
  device_id,
  occurred_at,
  sync_state
) VALUES (
  'event-conflict-2',
  'calibration_job',
  'job-local',
  3,
  'save_local_execution',
  '{"status":"IN_PROGRESS","data":{"readings":[1]}}',
  '{}',
  'user-1',
  'device-1',
  @now,
  'pending'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO outbox (
  id,
  event_id,
  operation,
  payload_json,
  idempotency_key,
  status,
  created_at
) VALUES (
  'outbox:event-conflict-2',
  'event-conflict-2',
  'save_local_execution',
  '{"status":"IN_PROGRESS","data":{"readings":[1]}}',
  'local:event-conflict-2',
  'pending',
  @now
)
`,
      )
      .run({ now });

    applySyncPushResult(database, {
      accepted: [],
      rejected: [],
      conflicts: [
        {
          id: "desktop-conflict:calibration_job:job-local:event-conflict-2",
          eventId: "event-conflict-2",
          entityType: "calibration_job",
          entityId: "job-local",
          conflictType: "status_transition",
          status: "open",
          remotePayload: { status: "APPROVED" },
        },
      ],
    });

    resolveSyncConflict(database, conflictId, "resolved");

    const rows = database
      .prepare<
        [],
        {
          event_id: string;
          outbox_status: string;
          sync_state: string;
        }
      >(
        `
SELECT outbox.event_id, outbox.status AS outbox_status, domain_events.sync_state
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE outbox.event_id IN ('event-conflict', 'event-conflict-2')
ORDER BY outbox.event_id ASC
`,
      )
      .all();

    expect(rows).toEqual([
      {
        event_id: "event-conflict",
        outbox_status: "pending",
        sync_state: "pending",
      },
      {
        event_id: "event-conflict-2",
        outbox_status: "conflict",
        sync_state: "conflict",
      },
    ]);

    database.close();
  });

  it("resolves sync conflicts by retrying the local event", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const conflictId = seedCalibrationJobConflict(database);

    const resolved = resolveSyncConflict(database, conflictId, "resolved");

    expect(resolved).toMatchObject({
      id: conflictId,
      status: "resolved",
      resolvedAt: expect.any(String),
    });
    expect(listPendingOutboxEvents(database)).toHaveLength(1);

    const row = requiredRow(
      database
        .prepare<
          [],
          {
            outbox_status: string;
            last_error: string | null;
            sync_state: string;
          }
        >(
          `
SELECT outbox.status AS outbox_status, outbox.last_error, domain_events.sync_state
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE outbox.event_id = 'event-conflict'
`,
        )
        .get(),
    );

    expect(row).toEqual({
      outbox_status: "pending",
      last_error: null,
      sync_state: "pending",
    });

    database.close();
  });

  it("ignores sync conflicts by closing the local event", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const conflictId = seedCalibrationJobConflict(database);

    const ignored = resolveSyncConflict(database, conflictId, "ignored");

    expect(ignored).toMatchObject({
      id: conflictId,
      status: "ignored",
      resolvedAt: expect.any(String),
    });
    expect(listPendingOutboxEvents(database)).toHaveLength(0);

    const row = requiredRow(
      database
        .prepare<
          [],
          {
            outbox_status: string;
            last_error: string | null;
            sync_state: string;
          }
        >(
          `
SELECT outbox.status AS outbox_status, outbox.last_error, domain_events.sync_state
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE outbox.event_id = 'event-conflict'
`,
        )
        .get(),
    );

    expect(row).toEqual({
      outbox_status: "synced",
      last_error: null,
      sync_state: "synced",
    });

    database.close();
  });

  it("creates a local asset and writes the accepted remote ID back", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    database
      .prepare(
        `
INSERT INTO asset_types (
  id,
  remote_id,
  organization_id,
  name,
  specifications_schema_json,
  pulled_at,
  sync_state
) VALUES (
  'asset-type:10',
  10,
  'org-1',
  'Balanca',
  '{}',
  @now,
  'synced'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO customers (
  id,
  remote_id,
  organization_id,
  unit_id,
  name,
  updated_at,
  sync_state
) VALUES (
  'customer:20',
  20,
  'org-1',
  1,
  'Acme Lab',
  @now,
  'synced'
)
`,
      )
      .run({ now });

    const created = createLocalAsset(database, {
      organizationId: "org-1",
      unitId: 1,
      customerId: 20,
      assetTypeId: 10,
      name: "Balanca 01",
      manufacturer: "Mettler",
      model: "XPE205",
      serialNumber: "SN-001",
      tag: "BAL-001",
      status: "ACTIVE",
      baseMeasurementUnit: "g",
      specifications: { capacity: 220 },
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    expect(created).toMatchObject({
      customerId: 20,
      assetTypeId: 10,
      name: "Balanca 01",
      tag: "BAL-001",
      status: "ACTIVE",
      syncState: "local",
    });
    expect(
      listLocalAssets(database, { page: 1, limit: 20 }).data.find(
        (asset) => asset.tag === "BAL-001",
      )?.syncState,
    ).toBe("local");

    const outboxRow = requiredRow(
      database
        .prepare<
          [],
          {
            event_id: string;
            aggregate_kind: string;
            event_type: string;
          }
        >(
          `
SELECT domain_events.event_id, domain_events.aggregate_kind, domain_events.event_type
FROM domain_events
INNER JOIN outbox ON outbox.event_id = domain_events.event_id
WHERE domain_events.aggregate_kind = 'asset'
LIMIT 1
`,
        )
        .get(),
    );

    expect(outboxRow.aggregate_kind).toBe("asset");
    expect(outboxRow.event_type).toBe("create_local_asset");

    applySyncPushResult(database, {
      accepted: [
        {
          eventId: outboxRow.event_id,
          remoteEntityId: 654,
          remoteEntity: { id: 654, tag: "BAL-001", status: "ACTIVE" },
          remoteVersion: 1,
          cloudEventId: `cloud:${outboxRow.event_id}`,
        },
      ],
      rejected: [],
      conflicts: [],
      newCursor: "cursor-asset",
    });

    const synced = requiredRow(
      database
        .prepare<[], { remote_id: number | null; sync_state: string }>(
          `
SELECT remote_id, sync_state
FROM assets
WHERE tag = 'BAL-001'
`,
        )
        .get(),
    );

    expect(synced).toEqual({
      remote_id: 654,
      sync_state: "synced",
    });

    database.close();
  });

  it("creates a local customer and writes the accepted remote ID back", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    const created = createLocalCustomer(database, {
      organizationId: "org-1",
      unitId: 1,
      name: "Cliente Local",
      taxId: "12345678000199",
      email: "cliente@example.com",
      phone: "(11) 99999-9999",
      address: { city: "Sao Paulo", state: "SP" },
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    expect(created).toMatchObject({
      name: "Cliente Local",
      taxId: "12345678000199",
      email: "cliente@example.com",
      authOrganizationId: null,
      syncState: "local",
    });
    expect(
      listLocalCustomers(database, { page: 1, limit: 20 }).data.find(
        (customer) => customer.name === "Cliente Local",
      )?.syncState,
    ).toBe("local");

    const outboxRow = requiredRow(
      database
        .prepare<
          [],
          {
            event_id: string;
            aggregate_kind: string;
            event_type: string;
          }
        >(
          `
SELECT domain_events.event_id, domain_events.aggregate_kind, domain_events.event_type
FROM domain_events
INNER JOIN outbox ON outbox.event_id = domain_events.event_id
WHERE domain_events.aggregate_kind = 'customer'
LIMIT 1
`,
        )
        .get(),
    );

    expect(outboxRow.aggregate_kind).toBe("customer");
    expect(outboxRow.event_type).toBe("create_local_customer");

    applySyncPushResult(database, {
      accepted: [
        {
          eventId: outboxRow.event_id,
          remoteEntityId: 987,
          remoteEntity: { id: 987, name: "Cliente Local" },
          remoteVersion: 1,
          cloudEventId: `cloud:${outboxRow.event_id}`,
        },
      ],
      rejected: [],
      conflicts: [],
      newCursor: "cursor-customer",
    });

    const synced = requiredRow(
      database
        .prepare<[], { remote_id: number | null; sync_state: string }>(
          `
SELECT remote_id, sync_state
FROM customers
WHERE name = 'Cliente Local'
`,
        )
        .get(),
    );

    expect(synced).toEqual({
      remote_id: 987,
      sync_state: "synced",
    });

    database.close();
  });

  it("omits blank optional customer fields from desktop sync payloads", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    const created = createLocalCustomer(database, {
      organizationId: "org-1",
      unitId: 1,
      name: "Cliente Sem Documento",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    updateLocalCustomer(database, {
      identifier: String(created.id),
      name: "Cliente Sem Documento Atualizado",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    const events = listPendingOutboxEvents(database);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      operation: "create_local_customer",
    });
    expect(events[0]?.payload).toEqual({ name: "Cliente Sem Documento" });
    expect(events[1]).toMatchObject({
      operation: "update_local_customer",
    });
    expect(events[1]?.payload).toEqual({
      name: "Cliente Sem Documento Atualizado",
    });

    database.close();
  });

  it("returns pending sync state for locally updated operational rows", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    database
      .prepare(
        `
INSERT INTO asset_types (
  id,
  remote_id,
  organization_id,
  name,
  specifications_schema_json,
  pulled_at,
  sync_state
) VALUES (
  'asset-type:10',
  10,
  'org-1',
  'Balanca',
  '{}',
  @now,
  'synced'
)
`,
      )
      .run({ now });

    const customer = createLocalCustomer(database, {
      organizationId: "org-1",
      unitId: 1,
      name: "Cliente Offline",
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    const asset = createLocalAsset(database, {
      organizationId: "org-1",
      unitId: 1,
      customerId: customer.id,
      assetTypeId: 10,
      name: "Balanca Offline",
      serialNumber: "SN-OFFLINE",
      tag: "TAG-OFFLINE",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    const updatedCustomer = updateLocalCustomer(database, {
      identifier: String(customer.id),
      name: "Cliente Offline Atualizado",
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    const updatedAsset = updateLocalAsset(database, {
      identifier: String(asset.id),
      name: "Balanca Offline Atualizada",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    expect(updatedCustomer).toMatchObject({
      name: "Cliente Offline Atualizado",
      syncState: "local",
    });
    expect(updatedAsset).toMatchObject({
      name: "Balanca Offline Atualizada",
      syncState: "local",
    });
    expect(
      listLocalCustomers(database, { page: 1, limit: 20 }).data.find(
        (row) => row.id === customer.id,
      )?.syncState,
    ).toBe("local");
    expect(
      listLocalAssets(database, { page: 1, limit: 20 }).data.find(
        (row) => row.id === asset.id,
      )?.syncState,
    ).toBe("local");

    database.close();
  });

  it("preserves local writes and pending outbox after reopening the database", () => {
    const dbPath = createTempDatabasePath();
    const firstConnection = openLocalDatabase({ filePath: dbPath });

    const created = createLocalCustomer(firstConnection, {
      organizationId: "org-1",
      unitId: 1,
      name: "Cliente Persistente",
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    expect(created.syncState).toBe("local");
    expect(countPendingOutbox(firstConnection)).toBe(1);

    firstConnection.close();

    const secondConnection = openLocalDatabase({ filePath: dbPath });

    expect(
      listLocalCustomers(secondConnection, { page: 1, limit: 20 }).data,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Cliente Persistente",
          syncState: "local",
        }),
      ]),
    );
    expect(countPendingOutbox(secondConnection)).toBe(1);
    expect(listPendingOutboxEvents(secondConnection)).toHaveLength(1);

    secondConnection.close();
  });

  it("backs off failed outbox events before retrying them", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    createLocalCustomer(database, {
      organizationId: "org-1",
      unitId: 1,
      name: "Cliente Local",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    const pending = listPendingOutboxEvents(database);
    expect(pending).toHaveLength(1);
    const [pendingEvent] = pending;
    if (!pendingEvent) throw new Error("Expected one pending outbox event");

    markOutboxEventsFailedForRetry(database, [pendingEvent.eventId], "offline");

    expect(countPendingOutbox(database)).toBe(1);
    expect(listPendingOutboxEvents(database)).toHaveLength(0);
    expect(
      listPendingOutboxEvents(database, 50, { includeDeferred: true }),
    ).toHaveLength(1);

    const failed = requiredRow(
      database
        .prepare<
          { eventId: string },
          {
            status: string;
            attempt_count: number;
            last_error: string | null;
            next_attempt_at: string | null;
            sync_state: string;
          }
        >(
          `
SELECT outbox.status, outbox.attempt_count, outbox.last_error, outbox.next_attempt_at, domain_events.sync_state
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE outbox.event_id = @eventId
`,
        )
        .get({ eventId: pendingEvent.eventId }),
    );

    expect(failed).toMatchObject({
      status: "failed",
      attempt_count: 1,
      last_error: "offline",
      sync_state: "failed",
    });
    expect(failed.next_attempt_at).toEqual(expect.any(String));

    database
      .prepare("UPDATE outbox SET next_attempt_at = @nextAttemptAt")
      .run({ nextAttemptAt: "2000-01-01T00:00:00.000Z" });

    expect(listPendingOutboxEvents(database)).toHaveLength(1);

    database.close();
  });

  it("marks accepted certificate draft uploads as synced", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    database
      .prepare(
        `
INSERT INTO calibration_jobs (
  id,
  remote_id,
  job_id,
  organization_id,
  unit_id,
  customer_id,
  asset_id,
  service_id,
  method_snapshot_json,
  asset_snapshot_json,
  status,
  version,
  created_at,
  updated_at,
  sync_state
) VALUES (
  'job-local',
  123,
  'CAL-2026-0001',
  'org-1',
  1,
  'customer-local',
  'asset-local',
  'service-local',
  '{}',
  '{}',
  'REVIEW',
  1,
  @now,
  @now,
  'local'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO certificate_drafts (
  id,
  job_id,
  local_path,
  status,
  metadata_json,
  created_at,
  updated_at,
  sync_state
) VALUES (
  'certificate-draft:local',
  'job-local',
  'certificates/job-local/draft.pdf',
  'pdf_generated',
  '{}',
  @now,
  @now,
  'local'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO domain_events (
  event_id,
  aggregate_kind,
  aggregate_id,
  aggregate_version,
  event_type,
  payload_json,
  metadata_json,
  actor_user_id,
  device_id,
  occurred_at,
  sync_state
) VALUES (
  'event:certificate-draft',
  'certificate_draft',
  'certificate-draft:local',
  1,
  'generate_local_certificate_pdf',
  '{"jobId":"job-local"}',
  '{}',
  'user-1',
  'device-1',
  @now,
  'pending'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO outbox (
  id,
  event_id,
  operation,
  payload_json,
  idempotency_key,
  status,
  created_at
) VALUES (
  'outbox:certificate-draft',
  'event:certificate-draft',
  'generate_local_certificate_pdf',
  '{}',
  'local:event:certificate-draft',
  'pending',
  @now
)
`,
      )
      .run({ now });

    applySyncPushResult(database, {
      accepted: [
        {
          eventId: "event:certificate-draft",
          remoteEntityId: "org/org-1/2026/jobs/CAL-1/desktop.pdf",
          remoteEntity: {
            certificateUrl:
              "https://certificates.calibrafacil.com/org/org-1/2026/jobs/CAL-1/desktop.pdf",
            status: "APPROVED",
          },
          remoteVersion: 2,
          cloudEventId: "cloud:event:certificate-draft",
        },
      ],
      rejected: [],
      conflicts: [],
    });

    const row = requiredRow(
      database
        .prepare<
          [],
          {
            draft_sync_state: string;
            job_status: string;
            certificate_url: string | null;
          }
        >(
          `
SELECT
  certificate_drafts.sync_state AS draft_sync_state,
  calibration_jobs.status AS job_status,
  calibration_jobs.certificate_url AS certificate_url
FROM certificate_drafts
INNER JOIN calibration_jobs ON calibration_jobs.id = certificate_drafts.job_id
WHERE certificate_drafts.id = 'certificate-draft:local'
`,
        )
        .get(),
    );

    expect(row).toEqual({
      draft_sync_state: "synced",
      job_status: "APPROVED",
      certificate_url:
        "https://certificates.calibrafacil.com/org/org-1/2026/jobs/CAL-1/desktop.pdf",
    });

    database.close();
  });

  it("captures service-order intake offline and queues it for sync", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    database
      .prepare(
        `
INSERT INTO asset_types (
  id,
  remote_id,
  organization_id,
  name,
  specifications_schema_json,
  pulled_at,
  sync_state
) VALUES (
  'asset-type:10',
  10,
  'org-1',
  'Balanca',
  '{}',
  @now,
  'synced'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO customers (
  id,
  remote_id,
  organization_id,
  unit_id,
  name,
  updated_at,
  sync_state
) VALUES ('customer:20', 20, 'org-1', 1, 'Acme Lab', @now, 'synced')
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO assets (
  id,
  remote_id,
  organization_id,
  unit_id,
  customer_id,
  asset_type_id,
  name,
  serial_number,
  tag,
  manufacturer,
  model,
  specifications_json,
  status,
  updated_at,
  sync_state
) VALUES (
  'asset:30',
  30,
  'org-1',
  1,
  'customer:20',
  'asset-type:10',
  'Scale 01',
  'SN-001',
  'TAG-001',
  'Acme',
  'Model A',
  '{"capacity":"10 kg","resolution":"0.1 g"}',
  'ACTIVE',
  @now,
  'synced'
)
`,
      )
      .run({ now });

    const serviceOrder = createLocalServiceOrderIntake(database, {
      organizationId: "org-1",
      unitId: 1,
      customerId: 20,
      assetId: 30,
      claimedDefect: "Nao liga",
      intakeCondition: "Recebida sem danos aparentes",
      accessories: "Fonte",
      actorUserId: "user-1",
      deviceId: "device-1",
      assetSnapshot: {
        observedIdentification: "Etiqueta conferida",
        photos: ["attachments/photo-1.jpg"],
      },
    });

    expect(serviceOrder).toMatchObject({
      customerId: 20,
      customerName: "Acme Lab",
      assetId: 30,
      assetName: "Scale 01",
      status: "awaiting_tech_evaluation",
      priority: "normal",
      claimedDefect: "Nao liga",
      accessories: "Fonte",
      syncState: "local",
      assetSnapshot: {
        assetName: "Scale 01",
        capacity: "10 kg",
        resolution: "0.1 g",
        observedIdentification: "Etiqueta conferida",
        photos: ["attachments/photo-1.jpg"],
      },
    });
    expect(serviceOrder?.serviceOrderNumber).toMatch(/^LOCAL-OS-\d{4}-0001$/);

    expect(
      listLocalServiceOrders(database, {
        page: 1,
        limit: 20,
        query: "Acme",
      }).data,
    ).toHaveLength(1);

    const outboxRow = requiredRow(
      database
        .prepare<
          [],
          {
            aggregate_kind: string;
            event_type: string;
            payload_json: string;
          }
        >(
          `
SELECT domain_events.aggregate_kind, domain_events.event_type, domain_events.payload_json
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE outbox.status = 'pending'
`,
        )
        .get(),
    );

    expect(outboxRow.aggregate_kind).toBe("service_order");
    expect(outboxRow.event_type).toBe("create_local_service_order_intake");
    expect(JSON.parse(outboxRow.payload_json)).toMatchObject({
      customerId: 20,
      assetId: 30,
      claimedDefect: "Nao liga",
      intakeCondition: "Recebida sem danos aparentes",
      localServiceOrderNumber: serviceOrder?.serviceOrderNumber,
    });

    database.close();
  });

  it("captures service-order intake for locally created customers and assets", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    database
      .prepare(
        `
INSERT INTO asset_types (
  id,
  remote_id,
  organization_id,
  name,
  specifications_schema_json,
  pulled_at,
  sync_state
) VALUES (
  'asset-type:10',
  10,
  'org-1',
  'Balanca',
  '{}',
  @now,
  'synced'
)
`,
      )
      .run({ now });

    const customer = createLocalCustomer(database, {
      organizationId: "org-1",
      unitId: 1,
      name: "Cliente Offline",
      taxId: "12345678000199",
      email: "offline@example.com",
      phone: "(11) 99999-9999",
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    const asset = createLocalAsset(database, {
      organizationId: "org-1",
      unitId: 1,
      customerId: customer.id,
      assetTypeId: 10,
      name: "Balanca Offline",
      manufacturer: "Acme",
      model: "Model O",
      serialNumber: "SN-OFFLINE",
      tag: "TAG-OFFLINE",
      status: "ACTIVE",
      baseMeasurementUnit: "g",
      specifications: { capacity: "30 kg", resolution: "1 g" },
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    const serviceOrder = createLocalServiceOrderIntake(database, {
      organizationId: "org-1",
      unitId: 1,
      customerId: customer.id,
      assetId: asset.id,
      claimedDefect: "Desvio na indicacao",
      intakeCondition: "Recebida operacional",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    expect(serviceOrder).toMatchObject({
      customerId: customer.id,
      customerName: "Cliente Offline",
      assetId: asset.id,
      assetName: "Balanca Offline",
      claimedDefect: "Desvio na indicacao",
      syncState: "local",
    });

    const outboxRow = requiredRow(
      database
        .prepare<
          [],
          {
            event_type: string;
            payload_json: string;
          }
        >(
          `
SELECT domain_events.event_type, domain_events.payload_json
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE domain_events.aggregate_kind = 'service_order'
  AND outbox.status = 'pending'
LIMIT 1
`,
        )
        .get(),
    );

    expect(outboxRow.event_type).toBe("create_local_service_order_intake");
    expect(JSON.parse(outboxRow.payload_json)).toMatchObject({
      customerId: customer.id,
      assetId: asset.id,
      claimedDefect: "Desvio na indicacao",
    });

    database.close();
  });

  it("captures service-order quote, execution, and delivery document drafts offline", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    database
      .prepare(
        `
INSERT INTO service_orders (
  id,
  remote_id,
  service_order_number,
  organization_id,
  unit_id,
  customer_id,
  asset_id,
  intake_type,
  status,
  priority,
  claimed_defect,
  intake_condition,
  delivery_method,
  opened_at,
  updated_at,
  sync_state
) VALUES (
  'service-order-local',
  987,
  'OS-2026-0007',
  'org-1',
  1,
  'customer:20',
  'asset:30',
  'counter',
  'awaiting_tech_evaluation',
  'normal',
  'Nao liga',
  'Recebida sem danos',
  'pickup_at_lab',
  @now,
  @now,
  'synced'
)
`,
      )
      .run({ now });

    const serviceOrderRouteId = "987";
    const quote = createLocalServiceOrderQuoteDraft(database, {
      routeId: serviceOrderRouteId,
      actorUserId: "user-1",
      deviceId: "device-1",
      clientMessage: "Aguardando aprovacao",
      items: [
        {
          type: "service",
          description: "Reparo",
          quantity: 1,
          unitPriceCents: 15000,
        },
      ],
    });
    const execution = saveLocalServiceOrderExecutionNotes(database, {
      routeId: serviceOrderRouteId,
      actorUserId: "user-1",
      deviceId: "device-1",
      servicePerformed: "Troca da fonte",
      technicalNotes: "Teste de bancada aprovado",
      result: "repaired",
    });
    const document = createLocalServiceOrderDeliveryDocumentDraft(database, {
      routeId: serviceOrderRouteId,
      actorUserId: "user-1",
      deviceId: "device-1",
      clientSignatureData: {
        signerName: "Cliente",
        dataUrl: "data:image/png;base64,abc",
      },
    });

    expect(quote).toMatchObject({
      quoteNumber: "OS-2026-0007/ORC",
      status: "draft",
      totalCents: 15000,
      syncState: "local",
    });
    expect(execution).toMatchObject({
      servicePerformed: "Troca da fonte",
      technicalNotes: "Teste de bancada aprovado",
      result: "repaired",
      syncState: "local",
    });
    expect(document).toMatchObject({
      documentNumber: "OS-2026-0007/ENT",
      version: 1,
      syncState: "local",
    });

    const outboxRows = database
      .prepare<[], { event_type: string }>(
        `
SELECT domain_events.event_type
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
ORDER BY domain_events.event_type ASC
`,
      )
      .all();
    expect(outboxRows.map((row) => row.event_type)).toEqual([
      "create_local_service_order_delivery_document_draft",
      "create_local_service_order_quote_draft",
      "save_local_service_order_execution_notes",
    ]);

    database.close();
  });

  it("writes accepted service-order IDs and numbers back to local intake", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    database
      .prepare(
        `
INSERT INTO service_orders (
  id,
  remote_id,
  service_order_number,
  organization_id,
  unit_id,
  customer_id,
  asset_id,
  intake_type,
  status,
  priority,
  claimed_defect,
  intake_condition,
  delivery_method,
  opened_at,
  updated_at,
  sync_state
) VALUES (
  'service-order-local',
  NULL,
  'LOCAL-OS-2026-0001',
  'org-1',
  1,
  'customer:20',
  'asset:30',
  'counter',
  'awaiting_tech_evaluation',
  'normal',
  'Nao liga',
  'Recebida sem danos',
  'pickup_at_lab',
  @now,
  @now,
  'local'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO domain_events (
  event_id,
  aggregate_kind,
  aggregate_id,
  aggregate_version,
  event_type,
  payload_json,
  metadata_json,
  actor_user_id,
  device_id,
  occurred_at,
  sync_state
) VALUES (
  'event:service-order',
  'service_order',
  'service-order-local',
  0,
  'create_local_service_order_intake',
  '{}',
  '{}',
  'user-1',
  'device-1',
  @now,
  'pending'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO outbox (
  id,
  event_id,
  operation,
  payload_json,
  idempotency_key,
  status,
  created_at
) VALUES (
  'outbox:service-order',
  'event:service-order',
  'create_local_service_order_intake',
  '{}',
  'local:event:service-order',
  'pending',
  @now
)
`,
      )
      .run({ now });

    applySyncPushResult(database, {
      accepted: [
        {
          eventId: "event:service-order",
          remoteEntityId: 987,
          remoteEntity: {
            serviceOrderNumber: "OS-2026-0007",
            status: "awaiting_tech_evaluation",
          },
          remoteVersion: 1,
          cloudEventId: "cloud:event:service-order",
        },
      ],
      rejected: [],
      conflicts: [],
    });

    const row = requiredRow(
      database
        .prepare<
          [],
          {
            remote_id: number | null;
            service_order_number: string;
            status: string;
            sync_state: string;
          }
        >(
          `
SELECT remote_id, service_order_number, status, sync_state
FROM service_orders
WHERE id = 'service-order-local'
`,
        )
        .get(),
    );

    expect(row).toEqual({
      remote_id: 987,
      service_order_number: "OS-2026-0007",
      status: "awaiting_tech_evaluation",
      sync_state: "synced",
    });

    database.close();
  });
});
