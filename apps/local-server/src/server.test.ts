import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileMethodDraft } from "@calibra-facil/method-definition";
import {
  applySyncBootstrap,
  openLocalDatabase,
  upsertLocalJobProjection,
} from "@calibra-facil/local-db";
import { createLocalServer } from "./server";
import { createMethodDefinitionEngine } from "./method-engine";
import type { LocalServerConfig } from "./bootstrap";

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "calibra-local-server-"),
  );
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createConfig(dbPath: string): LocalServerConfig {
  return {
    host: "127.0.0.1",
    port: 4317,
    appVersion: "test",
    localServerVersion: "test",
    dbPath,
    storageRoot: path.join(path.dirname(dbPath), "files"),
    deviceId: "device-test",
    tenantId: null,
    organizationId: "org-1",
    unitId: 1,
    userId: "user-1",
    syncEnabled: true,
    bootstrapToken: null,
    cloudApiUrl: null,
    cloudAuthToken: null,
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
  };
}

describe("local server", () => {
  it("uses synced tenant context for local writes after packaged startup", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const config = {
      ...createConfig(dbPath),
      organizationId: null,
      unitId: null,
      userId: null,
    };
    const app = createLocalServer(config, database);

    applySyncBootstrap(database, {
      serverTime: "2026-01-15T10:00:00.000Z",
      user: {
        id: "user-synced",
        name: "Synced User",
        email: "user@example.com",
      },
      organization: {
        id: "org-synced",
        type: "LAB",
      },
      activeUnits: [{ id: 42, name: "Matriz", role: "technician" }],
      permissions: {
        role: "technician",
        unitRole: "technician",
        activeUnitId: 42,
        accessibleUnitIds: [42],
        canAccessAllUnits: false,
      },
      featureFlags: {
        offlineApprovals: false,
        offlineCertificatePublication: false,
      },
      syncCursor: "cursor-after-bootstrap",
      publishedMethods: [],
      assetTypes: [],
      customers: [],
      assets: [],
      services: [],
      standards: [],
      environmentalLimits: [],
      jobs: [],
      serviceOrders: [],
    });

    const environmentResponse = await app.request(
      "/.well-known/calibra/local-environment",
    );
    await expect(environmentResponse.json()).resolves.toMatchObject({
      organizationId: "org-synced",
      unitId: 42,
      userId: "user-synced",
    });

    const response = await app.request("/api/customers", {
      method: "POST",
      body: JSON.stringify({
        name: "Cliente Offline",
        taxId: "12345678000199",
        email: "offline@example.com",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      name: "Cliente Offline",
      syncState: "local",
    });

    const row = database
      .prepare(
        `
SELECT organization_id, unit_id
FROM customers
WHERE name = 'Cliente Offline'
`,
      )
      .get() as { organization_id: string; unit_id: number } | undefined;

    expect(row).toEqual({ organization_id: "org-synced", unit_id: 42 });
  });

  it("serves local jobs from SQLite projections", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    const app = createLocalServer(createConfig(dbPath), database);

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
  remote_id,
  organization_id,
  name,
  pulled_at,
  sync_state
) VALUES ('asset-type-local', 456, 'org-1', 'Balance', @now, 'synced')
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
  status,
  updated_at,
  sync_state
) VALUES (
  'asset-local',
  789,
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
      createdAt: now,
      updatedAt: now,
    });

    const response = await app.request("/api/jobs?page=1&limit=20&query=Acme");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 123,
          jobId: "CAL-2026-0001",
          customerName: "Acme Lab",
          assetName: "Scale 01",
          serviceName: "Mass calibration",
          status: "IN_PROGRESS",
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

  it("serves service catalog detail and published method options locally", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    const app = createLocalServer(createConfig(dbPath), database);

    database
      .prepare(
        `
INSERT INTO asset_types (
  id,
  remote_id,
  organization_id,
  name,
  pulled_at,
  sync_state
) VALUES ('asset-type:456', 456, 'org-1', 'Balance', @now, 'synced')
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO published_methods (
  id,
  remote_id,
  organization_id,
  asset_type_id,
  name,
  version,
  method_fingerprint,
  engine_version,
  engine_options_fingerprint,
  normalized_method_json,
  compiled_method_json,
  publication_evidence_json,
  pulled_at
) VALUES (
  'method:321',
  321,
  'org-1',
  'asset-type:456',
  'Mass error',
  2,
  'fingerprint',
  'engine',
  'options',
  '{}',
  '{}',
  '{}',
  @now
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO services (
  id,
  remote_id,
  organization_id,
  asset_type_id,
  name,
  description,
  method_id,
  status,
  pulled_at,
  sync_state
) VALUES (
  'service:654',
  654,
  'org-1',
  'asset-type:456',
  'Mass calibration',
  'Traceable mass service',
  'method:321',
  'ACTIVE',
  @now,
  'synced'
)
`,
      )
      .run({ now });

    const serviceResponse = await app.request("/api/services/mass-calibration");
    expect(serviceResponse.status).toBe(200);
    await expect(serviceResponse.json()).resolves.toMatchObject({
      id: 654,
      name: "Mass calibration",
      description: "Traceable mass service",
      methodId: 321,
      methodName: "Mass error",
      methodVersion: 2,
      methodStatus: "PUBLISHED",
      assetTypeId: 456,
      assetTypeName: "Balance",
      isActive: true,
    });

    const auditResponse = await app.request(
      "/api/services/mass-calibration/audit-log",
    );
    expect(auditResponse.status).toBe(200);
    await expect(auditResponse.json()).resolves.toEqual({ data: [] });

    const methodsResponse = await app.request(
      "/api/methods?status=PUBLISHED&limit=100",
    );
    expect(methodsResponse.status).toBe(200);
    await expect(methodsResponse.json()).resolves.toMatchObject({
      data: [
        {
          id: 321,
          name: "Mass error",
          version: 2,
          status: "PUBLISHED",
          assetTypeId: 456,
          assetTypeName: "Balance",
          dataFields: [],
          formulas: [],
        },
      ],
    });

    const methodDetailResponse = await app.request(
      "/api/methods/mass-error-v2",
    );
    expect(methodDetailResponse.status).toBe(200);
    await expect(methodDetailResponse.json()).resolves.toMatchObject({
      id: 321,
      name: "Mass error",
      version: 2,
      status: "PUBLISHED",
      assetTypeId: 456,
      assetTypeName: "Balance",
      compiledMethod: {},
      methodFingerprint: "fingerprint",
      methodEngine: {
        version: "engine",
        optionsFingerprint: "options",
      },
    });

    const methodAuditResponse = await app.request(
      "/api/methods/mass-error-v2/audit",
    );
    expect(methodAuditResponse.status).toBe(200);
    await expect(methodAuditResponse.json()).resolves.toEqual({ data: [] });

    const methodWriteResponse = await app.request("/api/methods/321/archive", {
      method: "POST",
    });
    expect(methodWriteResponse.status).toBe(409);

    const writeResponse = await app.request("/api/services/654", {
      method: "PUT",
      body: JSON.stringify({ isActive: false }),
    });
    expect(writeResponse.status).toBe(409);

    database.close();
  });

  it("serves reference standards from local snapshots", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    const app = createLocalServer(createConfig(dbPath), database);

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
  'standard:111',
  111,
  'org-1',
  1,
  'Reference weight',
  'STD-001',
  'CERT-001',
  '2027-01-15T00:00:00.000Z',
  'ACTIVE',
  @snapshotJson,
  @now,
  'synced'
)
`,
      )
      .run({
        now,
        snapshotJson: JSON.stringify({
          id: 111,
          name: "Reference weight",
          type: "Mass",
          serialNumber: "STD-001",
          manufacturer: "Weights Co",
          model: "M1",
          certificateNumber: "CERT-001",
          calibratedBy: "Accredited Lab",
          calibrationDate: "2026-01-15T00:00:00.000Z",
          nextCalibrationDate: "2027-01-15T00:00:00.000Z",
          referenceValue: 100,
          uncertainty: 0.01,
          uncertaintyUnit: "g",
          coverageFactor: 2,
          distribution: "normal",
          drift: null,
          certifiedValues: null,
          status: "ACTIVE",
          createdAt: now,
          updatedAt: now,
        }),
      });

    const listResponse = await app.request(
      "/api/standards?page=1&limit=20&status=ACTIVE&query=STD-001",
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      data: [
        {
          id: 111,
          name: "Reference weight",
          serialNumber: "STD-001",
          certificateNumber: "CERT-001",
          referenceValue: 100,
          uncertainty: 0.01,
          uncertaintyUnit: "g",
          status: "ACTIVE",
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
      },
    });

    const detailResponse = await app.request("/api/standards/std-001");
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      id: 111,
      name: "Reference weight",
      type: "Mass",
      manufacturer: "Weights Co",
      model: "M1",
      calibratedBy: "Accredited Lab",
      coverageFactor: 2,
      distribution: "normal",
    });

    const auditResponse = await app.request("/api/standards/std-001/audit-log");
    expect(auditResponse.status).toBe(200);
    await expect(auditResponse.json()).resolves.toEqual({ data: [] });

    const writeResponse = await app.request("/api/standards/111", {
      method: "PUT",
      body: JSON.stringify({ status: "INACTIVE" }),
    });
    expect(writeResponse.status).toBe(409);

    database.close();
  });

  it("serves local customers and assets from SQLite projections", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    const app = createLocalServer(
      {
        ...createConfig(dbPath),
        cloudApiUrl: "https://api.example.test",
        cloudAuthToken: "cloud-token",
      },
      database,
      {
        fetch: async (input, init) => {
          const url = String(input);
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer cloud-token",
          );

          if (url === "https://api.example.test/api/sync/push") {
            expect(init?.method).toBe("POST");
            const body = JSON.parse(String(init?.body)) as {
              clientBatchId: string;
              events: Array<{
                eventId: string;
                operation: string;
                localVersion: number;
              }>;
            };

            return Response.json({
              accepted: body.events.map((event) => ({
                eventId: event.eventId,
                remoteEntityId:
                  event.operation === "create_local_job_draft"
                    ? 12345
                    : undefined,
                remoteEntity:
                  event.operation === "create_local_job_draft"
                    ? { jobId: "CAL-2026-0001", status: "DRAFT" }
                    : undefined,
                remoteVersion: event.localVersion + 1,
                cloudEventId: `cloud:${event.eventId}`,
              })),
              rejected: [],
              conflicts: [],
              newCursor: `cursor:${body.clientBatchId}`,
            });
          }

          if (url === "https://api.example.test/api/sync/certificate-pdfs") {
            expect(init?.method).toBe("POST");
            expect(init?.body).toBeInstanceOf(FormData);
            const formData = init?.body as FormData;
            const eventId = formData.get("eventId");
            const localVersion = Number(formData.get("localVersion"));
            const file = formData.get("file");
            expect(eventId).toEqual(expect.any(String));
            expect(file).toBeInstanceOf(File);

            return Response.json({
              accepted: [
                {
                  eventId,
                  remoteEntityId: "org/org-1/2026/jobs/CAL-1/desktop.pdf",
                  remoteEntity: {
                    jobId: "CAL-2026-0001",
                    status: "APPROVED",
                    certificateUrl:
                      "https://certificates.calibrafacil.com/org/org-1/2026/jobs/CAL-1/desktop.pdf",
                    portalVisible: true,
                  },
                  remoteVersion: localVersion + 1,
                  cloudEventId: `cloud:${eventId}`,
                },
              ],
              rejected: [],
              conflicts: [],
            });
          }

          if (url.startsWith("https://api.example.test/api/sync/pull")) {
            expect(init?.method).toBe("GET");
            return Response.json({
              cursor: "cursor-after-pull",
              hasMore: false,
              events: [],
            });
          }

          expect(url).toBe("https://api.example.test/api/sync/bootstrap");
          return Response.json({
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
            syncCursor: "cursor-after-bootstrap",
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
          });
        },
      },
    );

    database
      .prepare(
        `
INSERT INTO customers (
  id,
  remote_id,
  organization_id,
  unit_id,
  name,
  tax_id,
  email,
  updated_at,
  sync_state
) VALUES (
  'customer-local',
  123,
  'org-1',
  1,
  'Acme Lab',
  '12345678000199',
  'lab@example.com',
  @now,
  'synced'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO asset_types (
  id,
  remote_id,
  organization_id,
  name,
  pulled_at,
  sync_state
) VALUES ('asset-type-local', 456, 'org-1', 'Balance', @now, 'synced')
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
  status,
  updated_at,
  sync_state
) VALUES (
  'asset-local',
  789,
  'org-1',
  1,
  'customer-local',
  'asset-type-local',
  'Scale 01',
  'SN-001',
  'TAG-001',
  'Acme Instruments',
  'A-100',
  'ACTIVE',
  @now,
  'synced'
)
`,
      )
      .run({ now });

    const customersResponse = await app.request(
      "/api/customers?page=1&limit=20&query=Acme",
    );
    expect(customersResponse.status).toBe(200);
    await expect(customersResponse.json()).resolves.toMatchObject({
      data: [
        {
          id: 123,
          name: "Acme Lab",
          taxId: "12345678000199",
          email: "lab@example.com",
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });

    const customerDetailResponse = await app.request(
      "/api/customers/12345678000199",
    );
    expect(customerDetailResponse.status).toBe(200);
    await expect(customerDetailResponse.json()).resolves.toMatchObject({
      id: 123,
      name: "Acme Lab",
      taxId: "12345678000199",
      email: "lab@example.com",
      phone: null,
      financialSummary: {
        openDocumentsCount: 0,
        overdueDocumentsCount: 0,
        openBalanceCents: 0,
        overdueBalanceCents: 0,
        overdueBalanceFlag: false,
      },
    });

    const createCustomerResponse = await app.request("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Beta Lab",
        taxId: "98765432000100",
        email: "beta@example.com",
        phone: "(11) 98888-7777",
        address: { city: "Sao Paulo", state: "SP" },
      }),
    });
    expect(createCustomerResponse.status).toBe(201);
    await expect(createCustomerResponse.json()).resolves.toMatchObject({
      id: expect.any(Number),
      name: "Beta Lab",
      taxId: "98765432000100",
      email: "beta@example.com",
    });

    const customerOutbox = database
      .prepare(
        `
SELECT domain_events.aggregate_kind, domain_events.event_type
FROM domain_events
INNER JOIN outbox ON outbox.event_id = domain_events.event_id
WHERE domain_events.aggregate_kind = 'customer'
LIMIT 1
`,
      )
      .get() as { aggregate_kind: string; event_type: string };
    expect(customerOutbox).toEqual({
      aggregate_kind: "customer",
      event_type: "create_local_customer",
    });

    const updateCustomerResponse = await app.request(
      "/api/customers/12345678000199",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Acme Lab Ltda",
          email: "ops@example.com",
          phone: "(11) 97777-6666",
          address: { city: "Sao Paulo", state: "SP" },
        }),
      },
    );
    expect(updateCustomerResponse.status).toBe(200);
    await expect(updateCustomerResponse.json()).resolves.toMatchObject({
      id: 123,
      name: "Acme Lab Ltda",
      email: "ops@example.com",
      phone: "(11) 97777-6666",
      address: { city: "Sao Paulo", state: "SP" },
    });

    const updateCustomerOutbox = database
      .prepare(
        `
SELECT domain_events.aggregate_kind, domain_events.event_type
FROM domain_events
INNER JOIN outbox ON outbox.event_id = domain_events.event_id
WHERE domain_events.aggregate_kind = 'customer'
  AND domain_events.event_type = 'update_local_customer'
LIMIT 1
`,
      )
      .get() as { aggregate_kind: string; event_type: string };
    expect(updateCustomerOutbox).toEqual({
      aggregate_kind: "customer",
      event_type: "update_local_customer",
    });

    const complianceResponse = await app.request(
      "/api/customers/12345678000199/compliance",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          compliance: {
            qualificationStatus: "qualified",
            qualityRequirementsAcknowledged: true,
            notes: "Aprovado offline",
          },
          reason: "Qualificacao documental conferida",
        }),
      },
    );
    expect(complianceResponse.status).toBe(200);
    await expect(complianceResponse.json()).resolves.toMatchObject({
      id: 123,
      compliance: {
        qualificationStatus: "qualified",
        qualityRequirementsAcknowledged: true,
        notes: "Aprovado offline",
        qualityRequirementsAcknowledgedAt: expect.any(String),
      },
    });

    const complianceOutbox = database
      .prepare(
        `
SELECT domain_events.aggregate_kind, domain_events.event_type
FROM domain_events
INNER JOIN outbox ON outbox.event_id = domain_events.event_id
WHERE domain_events.aggregate_kind = 'customer'
  AND domain_events.event_type = 'update_local_customer_compliance'
LIMIT 1
`,
      )
      .get() as { aggregate_kind: string; event_type: string };
    expect(complianceOutbox).toEqual({
      aggregate_kind: "customer",
      event_type: "update_local_customer_compliance",
    });

    const customerAuditResponse = await app.request(
      "/api/customers/12345678000199/audit-log?page=1&limit=50",
    );
    expect(customerAuditResponse.status).toBe(200);
    await expect(customerAuditResponse.json()).resolves.toMatchObject({
      data: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    });

    const membersResponse = await app.request(
      "/api/customers/12345678000199/members",
    );
    expect(membersResponse.status).toBe(200);
    await expect(membersResponse.json()).resolves.toEqual([]);

    const invitationsResponse = await app.request(
      "/api/customers/12345678000199/invitations",
    );
    expect(invitationsResponse.status).toBe(200);
    await expect(invitationsResponse.json()).resolves.toEqual([]);

    const inviteResponse = await app.request(
      "/api/customers/12345678000199/invitations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "portal@example.com", role: "viewer" }),
      },
    );
    expect(inviteResponse.status).toBe(409);

    const assetsResponse = await app.request(
      "/api/assets?page=1&limit=20&query=TAG",
    );
    expect(assetsResponse.status).toBe(200);
    await expect(assetsResponse.json()).resolves.toMatchObject({
      data: [
        {
          id: 789,
          customerId: 123,
          customerName: "Acme Lab Ltda",
          assetTypeId: 456,
          assetTypeName: "Balance",
          name: "Scale 01",
          serialNumber: "SN-001",
          tag: "TAG-001",
          status: "ACTIVE",
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });

    const assetDetailResponse = await app.request("/api/assets/tag-001");
    expect(assetDetailResponse.status).toBe(200);
    await expect(assetDetailResponse.json()).resolves.toMatchObject({
      id: 789,
      customerId: 123,
      customerName: "Acme Lab Ltda",
      customerTaxId: "12345678000199",
      assetTypeId: 456,
      assetTypeName: "Balance",
      name: "Scale 01",
      manufacturer: "Acme Instruments",
      model: "A-100",
      serialNumber: "SN-001",
      tag: "TAG-001",
      status: "ACTIVE",
    });

    const updateAssetResponse = await app.request("/api/assets/tag-001", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Scale 01 Updated",
        manufacturer: "Acme Instruments",
        model: "A-101",
        serialNumber: "SN-001",
        tag: "TAG-001A",
        status: "MAINTENANCE",
        lastCalibrationDate: "2026-01-01T00:00:00.000Z",
        nextCalibrationDate: "2027-01-01T00:00:00.000Z",
        comments: "Atualizado offline",
        specifications: { capacity: 220 },
      }),
    });
    expect(updateAssetResponse.status).toBe(200);
    await expect(updateAssetResponse.json()).resolves.toMatchObject({
      id: 789,
      name: "Scale 01 Updated",
      model: "A-101",
      tag: "TAG-001A",
      status: "MAINTENANCE",
      lastCalibrationDate: "2026-01-01T00:00:00.000Z",
      nextCalibrationDate: "2027-01-01T00:00:00.000Z",
      comments: "Atualizado offline",
    });

    const updateAssetOutbox = database
      .prepare(
        `
SELECT domain_events.aggregate_kind, domain_events.event_type
FROM domain_events
INNER JOIN outbox ON outbox.event_id = domain_events.event_id
WHERE domain_events.aggregate_kind = 'asset'
  AND domain_events.event_type = 'update_local_asset'
LIMIT 1
`,
      )
      .get() as { aggregate_kind: string; event_type: string };
    expect(updateAssetOutbox).toEqual({
      aggregate_kind: "asset",
      event_type: "update_local_asset",
    });

    const assetAuditLogResponse = await app.request(
      "/api/assets/tag-001a/audit-log",
    );
    expect(assetAuditLogResponse.status).toBe(200);
    await expect(assetAuditLogResponse.json()).resolves.toEqual({ data: [] });

    const createAssetResponse = await app.request("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: 123,
        assetTypeId: 456,
        name: "Scale 02",
        manufacturer: "Acme Instruments",
        model: "A-200",
        serialNumber: "SN-002",
        tag: "TAG-002",
        status: "ACTIVE",
        baseMeasurementUnit: "g",
        specifications: { capacity: 220 },
      }),
    });
    expect(createAssetResponse.status).toBe(201);
    await expect(createAssetResponse.json()).resolves.toMatchObject({
      id: expect.any(Number),
      customerId: 123,
      assetTypeId: 456,
      name: "Scale 02",
      serialNumber: "SN-002",
      tag: "TAG-002",
      status: "ACTIVE",
    });

    const assetOutbox = database
      .prepare(
        `
SELECT domain_events.aggregate_kind, domain_events.event_type
FROM domain_events
INNER JOIN outbox ON outbox.event_id = domain_events.event_id
WHERE domain_events.aggregate_kind = 'asset'
  AND domain_events.event_type = 'create_local_asset'
LIMIT 1
`,
      )
      .get() as { aggregate_kind: string; event_type: string };
    expect(assetOutbox).toEqual({
      aggregate_kind: "asset",
      event_type: "create_local_asset",
    });

    const assetTypesResponse = await app.request("/api/asset-types");
    expect(assetTypesResponse.status).toBe(200);
    await expect(assetTypesResponse.json()).resolves.toMatchObject({
      data: [
        {
          id: 456,
          name: "Balance",
          definition: [],
        },
      ],
    });

    const servicesResponse = await app.request(
      "/api/services?page=1&limit=20&assetTypeId=456&isActive=true",
    );
    expect(servicesResponse.status).toBe(200);
    await expect(servicesResponse.json()).resolves.toMatchObject({
      data: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
      },
    });

    const techniciansResponse = await app.request("/api/jobs/technicians/list");
    expect(techniciansResponse.status).toBe(200);
    await expect(techniciansResponse.json()).resolves.toEqual({ data: [] });

    database.close();
  });

  it("captures service-order intake locally and syncs the official OS number", async () => {
    const dbPath = createTempDatabasePath();
    let database = openLocalDatabase({ filePath: dbPath });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    const config = {
      ...createConfig(dbPath),
      cloudApiUrl: "https://api.example.test",
      cloudAuthToken: "cloud-token",
    };
    const syncOptions = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer cloud-token",
        );

        if (url === "https://api.example.test/api/sync/push") {
          expect(init?.method).toBe("POST");
          const body = JSON.parse(String(init?.body)) as {
            clientBatchId: string;
            events: Array<{
              eventId: string;
              operation: string;
              localVersion: number;
            }>;
          };

          return Response.json({
            accepted: body.events.map((event) => ({
              eventId: event.eventId,
              remoteEntityId:
                event.operation === "create_local_service_order_intake"
                  ? 555
                  : event.operation === "create_local_service_order_quote_draft"
                    ? 556
                    : event.operation ===
                        "save_local_service_order_execution_notes"
                      ? 557
                      : event.operation ===
                          "create_local_service_order_delivery_document_draft"
                        ? 558
                        : undefined,
              remoteEntity:
                event.operation === "create_local_service_order_intake"
                  ? {
                      serviceOrderNumber: "OS-2026-0009",
                      status: "awaiting_tech_evaluation",
                    }
                  : event.operation === "create_local_service_order_quote_draft"
                    ? {
                        quoteNumber: "OS-2026-0009/ORC",
                        status: "draft",
                        totalCents: 15000,
                      }
                    : event.operation ===
                        "save_local_service_order_execution_notes"
                      ? {
                          status: "repair_in_progress",
                        }
                      : event.operation ===
                          "create_local_service_order_delivery_document_draft"
                        ? {
                            documentNumber: "OS-2026-0009/ENT",
                            issuedAt: now,
                          }
                        : undefined,
              remoteVersion: event.localVersion + 1,
              cloudEventId: `cloud:${event.eventId}`,
            })),
            rejected: [],
            conflicts: [],
            newCursor: `cursor:${body.clientBatchId}`,
          });
        }

        if (url.startsWith("https://api.example.test/api/sync/pull")) {
          expect(init?.method).toBe("GET");
          return Response.json({
            cursor: "cursor-after-pull",
            hasMore: false,
            events: [],
          });
        }

        expect(url).toBe("https://api.example.test/api/sync/bootstrap");
        return Response.json({
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
          syncCursor: "cursor-after-bootstrap",
          publishedMethods: [],
          assetTypes: [],
          customers: [],
          assets: [],
          services: [],
          standards: [],
          environmentalLimits: [],
          jobs: [],
          serviceOrders: [],
        });
      },
    };
    let app = createLocalServer(config, database, syncOptions);

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
) VALUES ('customer:123', 123, 'org-1', 1, 'Acme Lab', @now, 'synced')
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO asset_types (
  id,
  remote_id,
  organization_id,
  name,
  pulled_at,
  sync_state
) VALUES ('asset-type:456', 456, 'org-1', 'Balance', @now, 'synced')
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
  'asset:789',
  789,
  'org-1',
  1,
  'customer:123',
  'asset-type:456',
  'Scale 01',
  'SN-001',
  'TAG-001',
  'Acme Instruments',
  'A-100',
  '{"capacity":"10 kg"}',
  'ACTIVE',
  @now,
  'synced'
)
`,
      )
      .run({ now });

    const createResponse = await app.request("/api/service-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId: 123,
        assetId: 789,
        claimedDefect: "Nao liga",
        intakeCondition: "Recebida com fonte",
        accessories: "Fonte",
        assetSnapshot: {
          observedIdentification: "Etiqueta conferida",
          photos: [],
        },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const created = (await createResponse.json()) as {
      data: { id: number; serviceOrderNumber: string };
    };
    expect(createResponse.status, JSON.stringify(created)).toBe(201);
    expect(created.data.serviceOrderNumber).toMatch(/^LOCAL-OS-/);

    const quoteResponse = await app.request(
      `/api/service-orders/${created.data.id}/quotes`,
      {
        method: "POST",
        body: JSON.stringify({
          clientMessage: "Aguardando aprovacao",
          items: [
            {
              type: "service",
              description: "Reparo",
              quantity: 1,
              unit: "un",
              unitPriceCents: 15000,
            },
          ],
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(quoteResponse.status, await quoteResponse.text()).toBe(201);

    const executionResponse = await app.request(
      `/api/service-orders/${created.data.id}/execution`,
      {
        method: "PATCH",
        body: JSON.stringify({
          servicePerformed: "Troca da fonte",
          technicalNotes: "Teste de bancada aprovado",
          result: "repaired",
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(executionResponse.status, await executionResponse.text()).toBe(200);

    const deliveryDocumentResponse = await app.request(
      `/api/service-orders/${created.data.id}/delivery-document`,
      {
        method: "POST",
        body: JSON.stringify({
          clientSignatureData: {
            signerName: "Cliente",
            dataUrl: "data:image/png;base64,abc",
          },
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(
      deliveryDocumentResponse.status,
      await deliveryDocumentResponse.text(),
    ).toBe(201);

    const listResponse = await app.request("/api/service-orders?query=Acme");
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      data: [
        {
          customerName: "Acme Lab",
          assetName: "Scale 01",
          status: "repair_in_progress",
          syncState: "local",
        },
      ],
    });

    const intakeAttachmentForm = new FormData();
    intakeAttachmentForm.set("entityType", "service_order");
    intakeAttachmentForm.set("entityId", String(created.data.id));
    intakeAttachmentForm.set(
      "file",
      new File(["intake photo"], "intake.txt", {
        type: "text/plain",
      }),
    );
    const intakeAttachmentResponse = await app.request("/api/attachments", {
      method: "POST",
      body: intakeAttachmentForm,
    });
    const intakeAttachment = (await intakeAttachmentResponse.json()) as {
      id: string;
      fileUrl: string;
      uploadStatus: string;
    };
    expect(
      intakeAttachmentResponse.status,
      JSON.stringify(intakeAttachment),
    ).toBe(201);
    expect(intakeAttachment.uploadStatus).toBe("pending");

    database.close();
    database = openLocalDatabase({ filePath: dbPath });
    app = createLocalServer(config, database, syncOptions);

    const reopenedListResponse = await app.request(
      "/api/service-orders?query=Acme",
    );
    expect(reopenedListResponse.status).toBe(200);
    await expect(reopenedListResponse.json()).resolves.toMatchObject({
      data: [
        {
          customerName: "Acme Lab",
          assetName: "Scale 01",
          status: "repair_in_progress",
          syncState: "local",
        },
      ],
    });

    const reopenedDetailResponse = await app.request(
      `/api/service-orders/${created.data.id}`,
    );
    expect(reopenedDetailResponse.status).toBe(200);
    await expect(reopenedDetailResponse.json()).resolves.toMatchObject({
      data: {
        serviceOrderNumber: created.data.serviceOrderNumber,
        claimedDefect: "Nao liga",
        intakeCondition: "Recebida com fonte",
        syncState: "local",
      },
    });

    const reopenedAttachmentListResponse = await app.request(
      `/api/attachments?entityType=service_order&entityId=${created.data.id}`,
    );
    expect(reopenedAttachmentListResponse.status).toBe(200);
    await expect(reopenedAttachmentListResponse.json()).resolves.toMatchObject({
      data: [
        {
          id: intakeAttachment.id,
          uploadStatus: "pending",
        },
      ],
    });

    const reopenedAttachmentFileResponse = await app.request(
      intakeAttachment.fileUrl,
    );
    expect(reopenedAttachmentFileResponse.status).toBe(200);
    await expect(reopenedAttachmentFileResponse.text()).resolves.toBe(
      "intake photo",
    );

    const syncResponse = await app.request("/api/local/sync/start", {
      method: "POST",
    });
    const syncBody = await syncResponse.text();
    expect(syncResponse.status, syncBody).toBe(200);

    const synced = database
      .prepare(
        `
SELECT remote_id, service_order_number, sync_state
FROM service_orders
WHERE service_order_number = 'OS-2026-0009'
`,
      )
      .get() as {
      remote_id: number | null;
      service_order_number: string;
      sync_state: string;
    };
    expect(synced).toEqual({
      remote_id: 555,
      service_order_number: "OS-2026-0009",
      sync_state: "synced",
    });
    const syncedWorkflow = database
      .prepare(
        `
SELECT
  (SELECT remote_id FROM service_order_quotes LIMIT 1) AS quote_remote_id,
  (SELECT remote_id FROM service_order_executions LIMIT 1) AS execution_remote_id,
  (SELECT remote_id FROM service_order_delivery_documents LIMIT 1) AS document_remote_id
`,
      )
      .get() as {
      quote_remote_id: number | null;
      execution_remote_id: number | null;
      document_remote_id: number | null;
    };
    expect(syncedWorkflow).toEqual({
      quote_remote_id: 556,
      execution_remote_id: 557,
      document_remote_id: 558,
    });

    database.close();
  });

  it("serves the offline session snapshot captured during sync bootstrap", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const app = createLocalServer(createConfig(dbPath), database);

    applySyncBootstrap(
      database,
      {
        serverTime: "2026-01-15T10:00:00.000Z",
        user: {
          id: "user-1",
          name: "Tecnico Local",
          email: "tecnico@example.test",
        },
        organization: {
          id: "org-1",
          type: "laboratory",
        },
        activeUnits: [
          {
            id: 1,
            name: "Matriz",
            role: "technician",
          },
        ],
        permissions: {
          role: "member",
          unitRole: "technician",
          activeUnitId: 1,
          accessibleUnitIds: [1],
          canAccessAllUnits: false,
        },
        featureFlags: {
          offlineApprovals: false,
          offlineCertificatePublication: false,
        },
        syncCursor: "cursor-session",
        publishedMethods: [],
        assetTypes: [],
        customers: [],
        assets: [],
        services: [],
        standards: [],
        environmentalLimits: [],
        jobs: [],
        serviceOrders: [],
      },
      "2026-01-15T10:01:00.000Z",
    );

    const response = await app.request("/api/local/session");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        user: {
          id: "user-1",
          name: "Tecnico Local",
          email: "tecnico@example.test",
        },
        organization: {
          id: "org-1",
          type: "laboratory",
        },
        permissions: {
          activeUnitId: 1,
          accessibleUnitIds: [1],
        },
        syncCursor: "cursor-session",
      },
    });
    const statusResponse = await app.request("/api/local/sync/status");
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toMatchObject({
      lastSyncedAt: "2026-01-15T10:01:00.000Z",
    });

    database.close();
  });

  it("requires the bootstrap token when local API auth is enabled", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const app = createLocalServer(
      {
        ...createConfig(dbPath),
        bootstrapToken: "local-test-token",
      },
      database,
    );

    const unauthorized = await app.request("/api/local/app-info");
    expect(unauthorized.status).toBe(401);

    const readiness = await app.request(
      "/.well-known/calibra/local-environment",
    );
    expect(readiness.status).toBe(200);
    await expect(readiness.json()).resolves.toMatchObject({
      dbSchemaVersion: 5,
      deviceId: "device-test",
      httpBaseUrl: "http://127.0.0.1:4317",
      localApiToken: null,
      syncEnabled: true,
      syncState: "idle",
    });

    const authorized = await app.request("/api/local/app-info", {
      headers: {
        Authorization: "Bearer local-test-token",
      },
    });
    expect(authorized.status).toBe(200);

    const diagnostics = await app.request("/api/local/diagnostics", {
      headers: {
        Authorization: "Bearer local-test-token",
      },
    });
    expect(diagnostics.status).toBe(200);
    await expect(diagnostics.json()).resolves.toMatchObject({
      runtime: {
        desktopRunId: "desktop-test-run",
        localServerRunId: "local-server-test-run",
      },
      sync: {
        state: "idle",
        activeRunId: null,
        lastRunId: null,
        lastError: null,
      },
      database: {
        schemaVersion: 5,
        integrity: {
          ok: true,
          messages: ["ok"],
        },
        pendingOutboxCount: 0,
        conflictCount: 0,
        activeCalibrationJobCount: 0,
        activeServiceOrderWorkflowCount: 0,
      },
    });

    database.close();
  });

  it("sends the desktop cloud proxy token during initial sync", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);

      expect(headers.get("x-calibra-desktop-cloud-proxy-token")).toBe(
        "proxy-token",
      );

      if (url.startsWith("https://api.example.test/api/sync/pull")) {
        return Response.json({
          cursor: "cursor-after-pull",
          hasMore: false,
          events: [],
        });
      }

      expect(url).toBe("https://api.example.test/api/sync/bootstrap");
      return Response.json({
        serverTime: now,
        user: {
          id: "user-1",
          name: "User One",
          email: "user@example.test",
        },
        organization: {
          id: "org-1",
          type: "LAB",
        },
        activeUnits: [{ id: 1, name: "Matriz", role: "technician" }],
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
        syncCursor: "cursor-after-bootstrap",
        publishedMethods: [],
        assetTypes: [],
        customers: [],
        assets: [],
        services: [],
        standards: [],
        environmentalLimits: [],
        jobs: [],
        serviceOrders: [],
      });
    });
    const app = createLocalServer(
      {
        ...createConfig(dbPath),
        cloudApiUrl: "https://api.example.test",
        cloudProxyToken: "proxy-token",
      },
      database,
      { fetch: fetchMock as typeof fetch },
    );

    const response = await app.request("/api/local/sync/start", {
      method: "POST",
    });

    expect(response.status, await response.text()).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    database.close();
  });

  it("lists and resolves local sync conflicts", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    const app = createLocalServer(createConfig(dbPath), database);

    database
      .prepare(
        `
INSERT INTO sync_conflicts (
  id,
  entity_type,
  entity_id,
  local_payload_json,
  remote_payload_json,
  conflict_type,
  status,
  created_at
) VALUES (
  'conflict:job:1',
  'job',
  'job-local',
  '{"status":"REVIEW"}',
  '{"status":"APPROVED"}',
  'status_transition',
  'open',
  @now
)
`,
      )
      .run({ now });

    const listResponse = await app.request("/api/local/sync/conflicts");
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      total: 1,
      data: [
        {
          id: "conflict:job:1",
          entityType: "job",
          entityId: "job-local",
          conflictType: "status_transition",
          status: "open",
          localPayload: { status: "REVIEW" },
          remotePayload: { status: "APPROVED" },
          resolvedAt: null,
        },
      ],
    });

    const resolveResponse = await app.request(
      "/api/local/sync/conflicts/conflict:job:1/resolve",
      {
        method: "POST",
        body: JSON.stringify({ status: "resolved" }),
      },
    );
    expect(resolveResponse.status).toBe(200);
    await expect(resolveResponse.json()).resolves.toMatchObject({
      data: {
        id: "conflict:job:1",
        status: "resolved",
      },
      syncStatus: {
        conflictCount: 0,
      },
      cloudResolution: {
        state: "skipped",
      },
    });

    const openResponse = await app.request("/api/local/sync/conflicts");
    await expect(openResponse.json()).resolves.toMatchObject({
      total: 0,
      data: [],
    });

    database.close();
  });

  it("records resolved local sync conflicts with the configured cloud API", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const app = createLocalServer(
      {
        ...createConfig(dbPath),
        cloudApiUrl: "https://api.example.test",
        cloudAuthToken: "cloud-token",
      },
      database,
      {
        fetch: async (input, init) => {
          fetchCalls.push({ url: String(input), init });
          expect(String(input)).toBe(
            "https://api.example.test/api/sync/conflicts/conflict%3Ajob%3A1/resolve",
          );
          expect(init?.method).toBe("POST");
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer cloud-token",
          );
          expect(await new Request("https://local.test", init).json()).toEqual({
            status: "ignored",
          });

          return Response.json({
            data: {
              id: "conflict:job:1",
              status: "ignored",
              resolvedAt: "2026-01-15T10:05:00.000Z",
            },
          });
        },
      },
    );

    database
      .prepare(
        `
INSERT INTO sync_conflicts (
  id,
  entity_type,
  entity_id,
  local_payload_json,
  remote_payload_json,
  conflict_type,
  status,
  created_at
) VALUES (
  'conflict:job:1',
  'job',
  'job-local',
  '{"status":"REVIEW"}',
  '{"status":"APPROVED"}',
  'status_transition',
  'open',
  @now
)
`,
      )
      .run({ now });

    const response = await app.request(
      "/api/local/sync/conflicts/conflict:job:1/resolve",
      {
        method: "POST",
        body: JSON.stringify({ status: "ignored" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: "conflict:job:1",
        status: "ignored",
      },
      cloudResolution: {
        state: "recorded",
        resolvedAt: "2026-01-15T10:05:00.000Z",
      },
    });
    expect(fetchCalls).toHaveLength(1);

    database.close();
  });

  it("runs initial sync from the configured cloud API", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const app = createLocalServer(
      {
        ...createConfig(dbPath),
        cloudApiUrl: "https://api.example.test",
        cloudAuthToken: "cloud-token",
      },
      database,
      {
        fetch: async (input, init) => {
          const url = String(input);
          if (url.startsWith("https://api.example.test/api/sync/pull")) {
            expect(init?.method).toBe("GET");
            expect(new Headers(init?.headers).get("authorization")).toBe(
              "Bearer cloud-token",
            );

            return Response.json({
              cursor: "cursor-after-pull",
              hasMore: false,
              events: [],
            });
          }

          expect(url).toBe("https://api.example.test/api/sync/bootstrap");
          expect(init?.method).toBe("POST");
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer cloud-token",
          );

          return Response.json({
            serverTime: "2026-01-15T10:00:00.000Z",
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
            syncCursor: "cursor-1",
            publishedMethods: [],
            assetTypes: [],
            customers: [
              {
                id: 123,
                name: "Synced Customer",
                taxId: "12345678000199",
                email: "sync@example.com",
                phone: null,
                address: null,
                compliance: null,
                updatedAt: "2026-01-15T10:00:00.000Z",
              },
            ],
            assets: [],
            services: [],
            standards: [
              {
                id: 456,
                organizationId: "org-1",
                unitId: 1,
                name: "Laboratório Exemplo - Peso padrão 20 kg",
                type: "Mass",
                serialNumber: "EXEMPLO-20KG",
                manufacturer: "Pesos Exemplo",
                model: "M1",
                certificateNumber: "CERT-EXEMPLO-20KG",
                calibratedBy: "Laboratório RBC",
                calibrationDate: "2026-01-15T00:00:00.000Z",
                nextCalibrationDate: "2027-01-15T00:00:00.000Z",
                referenceValue: 20,
                uncertainty: 0.001,
                uncertaintyUnit: "kg",
                coverageFactor: 2,
                distribution: "normal",
                drift: null,
                certifiedValues: null,
                status: "ACTIVE",
                createdAt: "2026-01-15T10:00:00.000Z",
                updatedAt: "2026-01-15T10:00:00.000Z",
              },
            ],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          });
        },
      },
    );

    const syncResponse = await app.request("/api/local/sync/start", {
      method: "POST",
    });
    const syncBody = await syncResponse.text();
    expect(syncResponse.status, syncBody).toBe(200);

    const customersResponse = await app.request("/api/customers?limit=20");
    await expect(customersResponse.json()).resolves.toMatchObject({
      data: [
        {
          id: 123,
          name: "Synced Customer",
          taxId: "12345678000199",
          email: "sync@example.com",
        },
      ],
    });

    const standardsResponse = await app.request(
      "/api/standards?limit=20&query=EXEMPLO-20KG",
    );
    await expect(standardsResponse.json()).resolves.toMatchObject({
      data: [
        {
          id: 456,
          name: "Laboratório Exemplo - Peso padrão 20 kg",
          serialNumber: "EXEMPLO-20KG",
          certificateNumber: "CERT-EXEMPLO-20KG",
          referenceValue: 20,
          uncertainty: 0.001,
          uncertaintyUnit: "kg",
          status: "ACTIVE",
        },
      ],
    });

    const statusResponse = await app.request("/api/local/sync/status");
    await expect(statusResponse.json()).resolves.toMatchObject({
      state: "idle",
      lastSyncedAt: expect.any(String),
    });

    database.close();
  });

  it("creates and executes a durable local calibration draft", async () => {
    const dbPath = createTempDatabasePath();
    let database = openLocalDatabase({ filePath: dbPath });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    const config = {
      ...createConfig(dbPath),
      cloudApiUrl: "https://api.example.test",
      cloudAuthToken: "cloud-token",
    };
    const syncOptions = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer cloud-token",
        );

        if (url === "https://api.example.test/api/sync/push") {
          expect(init?.method).toBe("POST");
          const body = JSON.parse(String(init?.body)) as {
            clientBatchId: string;
            events: Array<{
              eventId: string;
              operation: string;
              localVersion: number;
            }>;
          };

          return Response.json({
            accepted: body.events.map((event) => ({
              eventId: event.eventId,
              remoteEntityId:
                event.operation === "create_local_job_draft"
                  ? 12345
                  : undefined,
              remoteEntity:
                event.operation === "create_local_job_draft"
                  ? { jobId: "CAL-2026-0001", status: "DRAFT" }
                  : undefined,
              remoteVersion: event.localVersion + 1,
              cloudEventId: `cloud:${event.eventId}`,
            })),
            rejected: [],
            conflicts: [],
            newCursor: `cursor:${body.clientBatchId}`,
          });
        }

        if (url === "https://api.example.test/api/sync/certificate-pdfs") {
          expect(init?.method).toBe("POST");
          expect(init?.body).toBeInstanceOf(FormData);
          const formData = init?.body as FormData;
          const eventId = formData.get("eventId");
          const localVersion = Number(formData.get("localVersion"));
          const file = formData.get("file");
          expect(eventId).toEqual(expect.any(String));
          expect(file).toBeInstanceOf(File);

          return Response.json({
            accepted: [
              {
                eventId,
                remoteEntityId: "org/org-1/2026/jobs/CAL-1/desktop.pdf",
                remoteEntity: {
                  jobId: "CAL-2026-0001",
                  status: "APPROVED",
                  certificateUrl:
                    "https://certificates.calibrafacil.com/org/org-1/2026/jobs/CAL-1/desktop.pdf",
                  portalVisible: true,
                },
                remoteVersion: localVersion + 1,
                cloudEventId: `cloud:${eventId}`,
              },
            ],
            rejected: [],
            conflicts: [],
          });
        }

        if (url.startsWith("https://api.example.test/api/sync/pull")) {
          expect(init?.method).toBe("GET");
          return Response.json({
            cursor: "cursor-after-pull",
            hasMore: false,
            events: [],
          });
        }

        expect(url).toBe("https://api.example.test/api/sync/bootstrap");
        return Response.json({
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
          syncCursor: "cursor-after-bootstrap",
          publishedMethods: [],
          assetTypes: [],
          customers: [],
          assets: [],
          services: [],
          standards: [],
          environmentalLimits: [],
          jobs: [],
        });
      },
    };
    let app = createLocalServer(config, database, syncOptions);
    const compiledMethod = compileLocalTestMethod();

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
) VALUES ('customer:123', 123, 'org-1', 1, 'Acme Lab', @now, 'synced')
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO asset_types (
  id,
  remote_id,
  organization_id,
  name,
  pulled_at,
  sync_state
) VALUES ('asset-type:456', 456, 'org-1', 'Balance', @now, 'synced')
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
  status,
  updated_at,
  sync_state
) VALUES (
  'asset:789',
  789,
  'org-1',
  1,
  'customer:123',
  'asset-type:456',
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
INSERT INTO published_methods (
  id,
  remote_id,
  organization_id,
  asset_type_id,
  name,
  version,
  method_fingerprint,
  engine_version,
  engine_options_fingerprint,
  normalized_method_json,
  compiled_method_json,
  publication_evidence_json,
  pulled_at
) VALUES (
  'method:321',
  321,
  'org-1',
  'asset-type:456',
  'Mass error',
  1,
  @methodFingerprint,
  @engineVersion,
  @engineOptionsFingerprint,
  @normalizedMethodJson,
  @compiledMethodJson,
  '{}',
  @now
)
`,
      )
      .run({
        methodFingerprint: compiledMethod.methodFingerprint,
        engineVersion: compiledMethod.engine.version,
        engineOptionsFingerprint: compiledMethod.engine.optionsFingerprint,
        normalizedMethodJson: JSON.stringify({
          dataFields: [
            { kind: "scalar", key: "indication", label: "Indication" },
            { kind: "scalar", key: "reference", label: "Reference" },
          ],
          variableBindings: [],
          formulas: [
            {
              key: "error",
              label: "Error",
              expression: "indication - reference",
              outputUnit: "g",
            },
          ],
          measurementModels: [
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
          ],
          validations: [],
          uncertaintyParams: [],
          certificateContent: null,
        }),
        compiledMethodJson: JSON.stringify(compiledMethod),
        now,
      });
    database
      .prepare(
        `
INSERT INTO services (
  id,
  remote_id,
  organization_id,
  asset_type_id,
  name,
  method_id,
  status,
  pulled_at,
  sync_state
) VALUES (
  'service:654',
  654,
  'org-1',
  'asset-type:456',
  'Mass calibration',
  'method:321',
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
  'Reference Mass',
  'STD-999',
  'CERT-999',
  '2027-01-15T00:00:00.000Z',
  'ACTIVE',
  '{"name":"Reference Mass","serialNumber":"STD-999","certificateNumber":"CERT-999"}',
  @now,
  'synced'
)
`,
      )
      .run({ now });
    database
      .prepare(
        `
INSERT INTO environmental_limits (
  id,
  remote_id,
  organization_id,
  unit_id,
  name,
  limits_json,
  pulled_at,
  sync_state
) VALUES (
  'environmental-limit:50',
  50,
  'org-1',
  1,
  'Balance lab limits',
  '{"id":50,"unitId":1,"assetTypeId":456,"temperatureMin":18,"temperatureMax":22,"humidityMin":40,"humidityMax":60,"pressureMin":1000,"pressureMax":1020}',
  @now,
  'synced'
)
`,
      )
      .run({ now });

    const limitsResponse = await app.request(
      "/api/environmental-limits/effective/456?unitId=1",
    );
    await expect(limitsResponse.json()).resolves.toMatchObject({
      source: "local",
      limits: {
        assetTypeId: 456,
        temperatureMin: 18,
        humidityMin: 40,
        pressureMin: 1000,
      },
    });

    const createResponse = await app.request("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ assetId: 789, serviceId: 654 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      id: number;
      jobId: string;
    };
    expect(created.jobId).toMatch(/^LOCAL-/);

    const executeResponse = await app.request(
      `/api/jobs/${created.id}/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          data: { indication: "10.03", reference: "10" },
          selectedStandardIds: [999],
          environment: {
            temperature: 20,
            humidity: 50,
            pressure: 1013,
          },
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(executeResponse.status).toBe(200);

    const submitResponse = await app.request(`/api/jobs/${created.id}/submit`, {
      method: "POST",
      body: JSON.stringify({
        data: { indication: "10.03", reference: "10" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(submitResponse.status).toBe(200);

    const detailResponse = await app.request(`/api/jobs/${created.id}`);
    await expect(detailResponse.json()).resolves.toMatchObject({
      status: "REVIEW",
      customerId: 123,
      customerName: "Acme Lab",
      assetId: 789,
      assetName: "Scale 01",
      assetSerialNumber: "SN-001",
      assetTypeId: 456,
      serviceId: 654,
      serviceName: "Mass calibration",
      submittedAt: expect.any(String),
      syncState: "local",
      results: {
        error: expect.anything(),
        __compiledExecution: {
          methodFingerprint: compiledMethod.methodFingerprint,
        },
      },
      methodSnapshot: {
        measurementModels: [
          {
            key: "mass_uncertainty",
          },
        ],
      },
    });

    const draftResponse = await app.request(
      `/api/jobs/${created.id}/certificate-draft`,
      { method: "POST" },
    );
    const draftBody = (await draftResponse.json()) as {
      id: string;
      localPath: string;
      contentType: string;
      fileUrl: string;
    };
    expect(draftResponse.status, JSON.stringify(draftBody)).toBe(201);
    expect(draftBody).toMatchObject({
      contentType: "text/html",
      draftKind: "local_certificate_draft",
      published: false,
      fileUrl: `/api/jobs/${created.id}/certificate-draft/file`,
    });
    expect(draftBody.localPath).toMatch(/^certificates\/.+\.html$/);

    const draftFileResponse = await app.request(draftBody.fileUrl);
    expect(draftFileResponse.status).toBe(200);
    expect(draftFileResponse.headers.get("content-type")).toContain(
      "text/html",
    );
    const draftHtml = await draftFileResponse.text();
    expect(draftHtml).toContain("<!DOCTYPE html>");
    expect(draftHtml).toContain("Rascunho local");
    expect(draftHtml).toContain("Pendente de sincronização");
    expect(draftHtml).toContain("Não publicado");
    expect(draftHtml).toContain(created.jobId);

    database
      .prepare(
        "UPDATE certificate_drafts SET local_path = '../../outside.html' WHERE id = @id",
      )
      .run({ id: draftBody.id });
    const unsafeDraftFileResponse = await app.request(draftBody.fileUrl);
    expect(unsafeDraftFileResponse.status).toBe(400);
    database
      .prepare(
        "UPDATE certificate_drafts SET local_path = @path WHERE id = @id",
      )
      .run({ id: draftBody.id, path: draftBody.localPath });

    const pdfResponse = await app.request(
      `/api/jobs/${created.id}/certificate-draft/${encodeURIComponent(
        draftBody.id,
      )}/pdf`,
      {
        method: "POST",
        body: new Blob(["%PDF-1.7 local draft"], {
          type: "application/pdf",
        }),
      },
    );
    const pdfBody = (await pdfResponse.json()) as {
      id: string;
      status: string;
      metadata: {
        pdfPath?: string;
        pdfContentHash?: string;
        pdfSizeBytes?: number;
        pdfContentType?: string;
      };
    };
    expect(pdfResponse.status, JSON.stringify(pdfBody)).toBe(200);
    expect(pdfBody).toMatchObject({
      id: draftBody.id,
      status: "pdf_generated",
      draftKind: "local_certificate_draft",
      published: false,
      metadata: {
        pdfContentType: "application/pdf",
        pdfSizeBytes: "%PDF-1.7 local draft".length,
      },
    });
    expect(pdfBody.metadata.pdfPath).toMatch(/^certificates\/.+\.pdf$/);
    expect(pdfBody.metadata.pdfContentHash).toMatch(/^[a-f0-9]{64}$/);

    const attachmentForm = new FormData();
    attachmentForm.set("entityType", "calibration_job");
    attachmentForm.set("entityId", String(created.id));
    attachmentForm.set(
      "file",
      new File(["measurement evidence"], "evidence.txt", {
        type: "text/plain",
      }),
    );
    const attachmentResponse = await app.request("/api/attachments", {
      method: "POST",
      body: attachmentForm,
    });
    const attachmentBody = (await attachmentResponse.json()) as {
      id: string;
      entityType: string;
      entityId: string;
      localPath: string;
      contentHash: string;
      mimeType: string;
      sizeBytes: number;
      uploadStatus: string;
      fileUrl: string;
    };
    expect(attachmentResponse.status, JSON.stringify(attachmentBody)).toBe(201);
    expect(attachmentBody).toMatchObject({
      entityType: "calibration_job",
      entityId: String(created.id),
      mimeType: "text/plain",
      sizeBytes: "measurement evidence".length,
      uploadStatus: "pending",
      fileUrl: `/api/attachments/${encodeURIComponent(attachmentBody.id)}`,
    });
    expect(attachmentBody.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const attachmentListResponse = await app.request(
      `/api/attachments?entityType=calibration_job&entityId=${created.id}`,
    );
    expect(attachmentListResponse.status).toBe(200);
    await expect(attachmentListResponse.json()).resolves.toMatchObject({
      data: [
        {
          id: attachmentBody.id,
          entityType: "calibration_job",
          uploadStatus: "pending",
        },
      ],
    });

    const attachmentFileResponse = await app.request(attachmentBody.fileUrl);
    expect(attachmentFileResponse.status).toBe(200);
    expect(attachmentFileResponse.headers.get("content-type")).toContain(
      "text/plain",
    );
    await expect(attachmentFileResponse.text()).resolves.toBe(
      "measurement evidence",
    );

    database
      .prepare(
        "UPDATE attachments SET local_path = '../../outside.txt' WHERE id = @id",
      )
      .run({ id: attachmentBody.id });
    const unsafeAttachmentFileResponse = await app.request(
      attachmentBody.fileUrl,
    );
    expect(unsafeAttachmentFileResponse.status).toBe(400);
    database
      .prepare("UPDATE attachments SET local_path = @path WHERE id = @id")
      .run({ id: attachmentBody.id, path: attachmentBody.localPath });

    database.close();
    database = openLocalDatabase({ filePath: dbPath });
    app = createLocalServer(config, database, syncOptions);

    const reopenedDetailResponse = await app.request(`/api/jobs/${created.id}`);
    expect(reopenedDetailResponse.status).toBe(200);
    await expect(reopenedDetailResponse.json()).resolves.toMatchObject({
      status: "REVIEW",
      data: { indication: "10.03", reference: "10" },
      results: {
        error: expect.anything(),
        __compiledExecution: {
          methodFingerprint: compiledMethod.methodFingerprint,
        },
      },
      environmentalSnapshot: {
        temperature: 20,
        humidity: 50,
        pressure: 1013,
        withinLimits: true,
        limits: {
          temperature: { min: 18, max: 22 },
          humidity: { min: 40, max: 60 },
          pressure: { min: 1000, max: 1020 },
        },
      },
      standardsSnapshot: [
        {
          id: 999,
          name: "Reference Mass",
          certificateNumber: "CERT-999",
          nextCalibrationDate: "2027-01-15T00:00:00.000Z",
        },
      ],
      localCertificatePath: expect.stringMatching(/^certificates\/.+\.pdf$/),
      syncState: "local",
    });

    const reopenedDraftFileResponse = await app.request(draftBody.fileUrl);
    expect(reopenedDraftFileResponse.status).toBe(200);
    const reopenedDraftHtml = await reopenedDraftFileResponse.text();
    expect(reopenedDraftHtml).toContain("Rascunho local");
    expect(reopenedDraftHtml).toContain("Pendente de sincronização");
    expect(reopenedDraftHtml).toContain("Não publicado");

    const reopenedAttachmentListResponse = await app.request(
      `/api/attachments?entityType=calibration_job&entityId=${created.id}`,
    );
    expect(reopenedAttachmentListResponse.status).toBe(200);
    await expect(reopenedAttachmentListResponse.json()).resolves.toMatchObject({
      data: [
        {
          id: attachmentBody.id,
          uploadStatus: "pending",
        },
      ],
    });

    const reopenedAttachmentFileResponse = await app.request(
      attachmentBody.fileUrl,
    );
    expect(reopenedAttachmentFileResponse.status).toBe(200);
    await expect(reopenedAttachmentFileResponse.text()).resolves.toBe(
      "measurement evidence",
    );

    const audit = database
      .prepare("SELECT COUNT(*) AS total FROM local_audit_log")
      .get() as { total: number };
    const outbox = database
      .prepare("SELECT COUNT(*) AS total FROM outbox")
      .get() as { total: number };
    expect(audit.total).toBeGreaterThanOrEqual(3);
    expect(outbox.total).toBeGreaterThanOrEqual(3);

    const syncResponse = await app.request("/api/local/sync/start", {
      method: "POST",
    });
    const syncBody = await syncResponse.text();
    expect(syncResponse.status, syncBody).toBe(200);
    const pendingOutbox = database
      .prepare(
        `
SELECT COUNT(*) AS total
FROM outbox
WHERE status != 'synced'
`,
      )
      .get() as { total: number };
    expect(pendingOutbox.total).toBe(0);
    const syncedCertificate = database
      .prepare(
        `
SELECT
  calibration_jobs.job_id,
  calibration_jobs.status,
  calibration_jobs.certificate_url,
  certificate_drafts.sync_state AS draft_sync_state
FROM calibration_jobs
INNER JOIN certificate_drafts ON certificate_drafts.job_id = calibration_jobs.id
WHERE certificate_drafts.id = @draftId
`,
      )
      .get({ draftId: draftBody.id }) as {
      job_id: string;
      status: string;
      certificate_url: string | null;
      draft_sync_state: string;
    };
    expect(syncedCertificate).toEqual({
      job_id: "CAL-2026-0001",
      status: "APPROVED",
      certificate_url:
        "https://certificates.calibrafacil.com/org/org-1/2026/jobs/CAL-1/desktop.pdf",
      draft_sync_state: "synced",
    });

    database.close();
  });
});

function compileLocalTestMethod() {
  const engine = createMethodDefinitionEngine();
  const result = compileMethodDraft(
    {
      id: "mass_error",
      version: 1,
      status: "published",
      name: "Mass error",
      inputs: [
        {
          kind: "scalar",
          key: "indication",
          label: "Indication",
          required: true,
        },
        {
          kind: "scalar",
          key: "reference",
          label: "Reference",
          required: true,
        },
      ],
      formulas: [
        {
          key: "error",
          label: "Error",
          expression: "indication - reference",
          outputKind: "error",
          required: true,
        },
      ],
      measurementModels: [],
      acceptanceCriteria: [],
      previewScenarios: [
        {
          key: "nominal",
          label: "Nominal",
          inputs: { indication: "10.03", reference: "10" },
          expected: { formulas: { error: "0.03" } },
        },
      ],
    },
    {
      engine,
      engineMetadata: {
        packageName: "@calibra-facil/math-engine",
        version: "local-test",
        optionsFingerprint: "local-test-options",
      },
      requirePublishable: true,
    },
  );

  if (!result.ok) {
    throw new Error(
      result.diagnostics[0]?.message ?? "Failed to compile method",
    );
  }

  return result.method;
}
