import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncBootstrapResponse } from "@calibra-facil/contracts";
import {
  applySyncBootstrap,
  createLocalCustomer,
  listPendingOutboxEvents,
  openLocalDatabase,
  saveLocalServiceOrderExecutionNotes,
  updateLocalAsset,
  updateLocalCustomer,
} from "./index";

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-anchor-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const CLOUD_UPDATED_AT = "2026-01-15T10:05:00.000Z";
const PULLED_AT = "2026-01-15T11:00:00.000Z";

function buildBootstrap(
  overrides: Partial<SyncBootstrapResponse>,
): SyncBootstrapResponse {
  return {
    serverTime: "2026-01-15T10:00:00.000Z",
    user: { id: "user-1", name: "User One", email: "user@example.com" },
    organization: { id: "org-1", type: "LAB" },
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
    ...overrides,
  };
}

function pullCustomerAndAsset(database: ReturnType<typeof openLocalDatabase>) {
  applySyncBootstrap(
    database,
    buildBootstrap({
      customers: [
        {
          id: 123,
          name: "Pulled Customer",
          taxId: "12345678000199",
          email: "pull@example.com",
          phone: null,
          address: null,
          compliance: null,
          updatedAt: CLOUD_UPDATED_AT,
        },
      ],
      assets: [
        {
          id: 456,
          customerId: 123,
          assetTypeId: 10,
          name: "Pulled Asset",
          serialNumber: "SN-456",
          tag: "TAG-456",
          status: "ACTIVE",
          updatedAt: CLOUD_UPDATED_AT,
        },
      ],
    }),
    PULLED_AT,
  );
}

function readAnchor(
  database: ReturnType<typeof openLocalDatabase>,
  table: string,
  id: string,
) {
  const row = database
    .prepare<
      [string],
      { remote_base_updated_at: string | null; updated_at: string }
    >(`SELECT remote_base_updated_at, updated_at FROM ${table} WHERE id = ?`)
    .get(id);
  return row;
}

describe("sync base-version anchor (REL-01)", () => {
  it("REQ-REL-SYNC-101: stores the cloud updatedAt into remote_base_updated_at at pull time", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    pullCustomerAndAsset(database);

    const customer = readAnchor(database, "customers", "customer:123");
    const asset = readAnchor(database, "assets", "asset:456");

    expect(customer?.remote_base_updated_at).toBe(CLOUD_UPDATED_AT);
    expect(asset?.remote_base_updated_at).toBe(CLOUD_UPDATED_AT);

    database.close();
  });

  it("REQ-REL-SYNC-102: a local edit leaves remote_base_updated_at unchanged", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    pullCustomerAndAsset(database);

    updateLocalCustomer(database, {
      identifier: "customer:123",
      name: "Edited Customer",
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    updateLocalAsset(database, {
      identifier: "asset:456",
      name: "Edited Asset",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    const customer = readAnchor(database, "customers", "customer:123");
    const asset = readAnchor(database, "assets", "asset:456");

    // Anchor survives: still the base the edit was made against.
    expect(customer?.remote_base_updated_at).toBe(CLOUD_UPDATED_AT);
    expect(asset?.remote_base_updated_at).toBe(CLOUD_UPDATED_AT);
    // The edit moved updated_at forward (device clock) but NOT the anchor.
    expect(customer?.updated_at).not.toBe(CLOUD_UPDATED_AT);
    expect(asset?.updated_at).not.toBe(CLOUD_UPDATED_AT);

    database.close();
  });

  it("REQ-REL-SYNC-102: an execution-notes edit leaves the anchor unchanged", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    database
      .prepare(
        `
INSERT INTO service_orders (
  id, remote_id, service_order_number, organization_id, unit_id,
  customer_id, asset_id, intake_type, status, priority,
  claimed_defect, intake_condition, delivery_method, opened_at, updated_at, sync_state
) VALUES (
  'service-order-local', 987, 'OS-2026-0007', 'org-1', 1,
  'customer:20', 'asset:30', 'counter', 'awaiting_tech_evaluation', 'normal',
  'Nao liga', 'Recebida sem danos', 'pickup_at_lab', @now, @now, 'synced'
)
`,
      )
      .run({ now: "2026-01-15T09:00:00.000Z" });

    // First save creates the local execution row (no anchor yet).
    saveLocalServiceOrderExecutionNotes(database, {
      routeId: "987",
      actorUserId: "user-1",
      deviceId: "device-1",
      servicePerformed: "Diagnostico",
    });

    // Simulate a pull anchoring the execution row's base version.
    database
      .prepare(
        `UPDATE service_order_executions SET remote_base_updated_at = @anchor WHERE service_order_id = 'service-order-local'`,
      )
      .run({ anchor: CLOUD_UPDATED_AT });

    // A subsequent local edit must not clobber the anchor.
    saveLocalServiceOrderExecutionNotes(database, {
      routeId: "987",
      actorUserId: "user-1",
      deviceId: "device-1",
      servicePerformed: "Troca da fonte",
      technicalNotes: "Reparo concluido",
    });

    const execution = database
      .prepare<
        [],
        { remote_base_updated_at: string | null }
      >(
        `SELECT remote_base_updated_at FROM service_order_executions WHERE service_order_id = 'service-order-local'`,
      )
      .get();

    expect(execution?.remote_base_updated_at).toBe(CLOUD_UPDATED_AT);

    database.close();
  });

  it("REQ-REL-SYNC-103: outbox update events carry baseUpdatedAt equal to the stored anchor", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    pullCustomerAndAsset(database);

    updateLocalCustomer(database, {
      identifier: "customer:123",
      name: "Edited Customer",
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    updateLocalAsset(database, {
      identifier: "asset:456",
      name: "Edited Asset",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    const events = listPendingOutboxEvents(database);
    const customerEvent = events.find(
      (event) => event.entityType === "customer",
    );
    const assetEvent = events.find((event) => event.entityType === "asset");

    expect(customerEvent?.baseUpdatedAt).toBe(CLOUD_UPDATED_AT);
    expect(assetEvent?.baseUpdatedAt).toBe(CLOUD_UPDATED_AT);

    database.close();
  });

  it("REQ-REL-SYNC-103: emits null baseUpdatedAt for never-pulled (local-only) rows", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    const created = createLocalCustomer(database, {
      organizationId: "org-1",
      unitId: 1,
      name: "Local Customer",
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    updateLocalCustomer(database, {
      identifier: String(created.id),
      name: "Local Customer Edited",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    const events = listPendingOutboxEvents(database);
    for (const event of events) {
      expect(event.baseUpdatedAt).toBeNull();
    }

    database.close();
  });

  it("REQ-REL-SYNC-103: an execution event carries the execution anchor", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    database
      .prepare(
        `
INSERT INTO service_orders (
  id, remote_id, service_order_number, organization_id, unit_id,
  customer_id, asset_id, intake_type, status, priority,
  claimed_defect, intake_condition, delivery_method, opened_at, updated_at, sync_state
) VALUES (
  'service-order-local', 987, 'OS-2026-0007', 'org-1', 1,
  'customer:20', 'asset:30', 'counter', 'awaiting_tech_evaluation', 'normal',
  'Nao liga', 'Recebida sem danos', 'pickup_at_lab', @now, @now, 'synced'
)
`,
      )
      .run({ now: "2026-01-15T09:00:00.000Z" });

    saveLocalServiceOrderExecutionNotes(database, {
      routeId: "987",
      actorUserId: "user-1",
      deviceId: "device-1",
      servicePerformed: "Diagnostico",
    });
    database
      .prepare(
        `UPDATE service_order_executions SET remote_base_updated_at = @anchor WHERE service_order_id = 'service-order-local'`,
      )
      .run({ anchor: CLOUD_UPDATED_AT });

    const events = listPendingOutboxEvents(database);
    const executionEvent = events.find(
      (event) => event.entityType === "service_order_execution",
    );

    expect(executionEvent?.baseUpdatedAt).toBe(CLOUD_UPDATED_AT);

    database.close();
  });
});
