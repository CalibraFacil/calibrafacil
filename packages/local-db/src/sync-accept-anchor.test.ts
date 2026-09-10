import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncBootstrapResponse } from "@calibra-facil/contracts";
import {
  applySyncBootstrap,
  applySyncPushResult,
  listPendingOutboxEvents,
  openLocalDatabase,
  saveLocalServiceOrderExecutionNotes,
  updateLocalAsset,
  updateLocalCustomer,
} from "./index";

// REL-01 slice 3 — when the desktop's pushed asset / customer / OS-execution
// change is ACCEPTED by the cloud, `remote_base_updated_at` must be refreshed to
// the accepted server `updatedAt`. Otherwise a SECOND same-device edit (before
// the next pull) is compared against the STALE pre-push anchor and the server
// reports a false self-conflict.
//
//   REQ-REL-RES-002 [HIGH RISK] accept refreshes the anchor (asset + customer)
//   REQ-REL-RES-002 / REQ-REL-RES-003  same for service_order_execution
//
// RED (pre-slice-3): applyAcceptedRemoteEntity set remote_id/sync_state only and
// never touched remote_base_updated_at, so the anchor stayed at the pre-push
// base (or null for the execution row, which was never anchored on accept).

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-accept-"));
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
// The cloud persisted the accepted change at a NEW updatedAt, strictly after the
// base the desktop edited against.
const ACCEPTED_AT = "2026-01-15T12:30:00.000Z";

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
  column: string,
  id: string,
) {
  return database
    .prepare<
      [string],
      { remote_base_updated_at: string | null }
    >(`SELECT remote_base_updated_at FROM ${table} WHERE ${column} = ?`)
    .get(id);
}

function acceptEvent(
  database: ReturnType<typeof openLocalDatabase>,
  params: { eventId: string; remoteEntityId: number; updatedAt: string },
) {
  applySyncPushResult(database, {
    accepted: [
      {
        eventId: params.eventId,
        remoteEntityId: params.remoteEntityId,
        remoteEntity: {
          id: params.remoteEntityId,
          updatedAt: params.updatedAt,
        },
        remoteVersion: 1,
        cloudEventId: `cloud-${params.eventId}`,
      },
    ],
    rejected: [],
    conflicts: [],
    newCursor: "cursor-accept",
  });
}

describe("sync accept anchor refresh (REL-01 slice 3)", () => {
  it("REQ-REL-RES-002: accepting a pushed asset edit refreshes remote_base_updated_at", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    pullCustomerAndAsset(database);
    updateLocalAsset(database, {
      identifier: "asset:456",
      name: "Edited Asset",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    // Sanity: the anchor is still the pre-push base right after the edit.
    expect(
      readAnchor(database, "assets", "id", "asset:456")?.remote_base_updated_at,
    ).toBe(CLOUD_UPDATED_AT);

    const assetEvent = listPendingOutboxEvents(database).find(
      (event) => event.entityType === "asset",
    );
    if (!assetEvent) throw new Error("expected a pending asset outbox event");

    acceptEvent(database, {
      eventId: assetEvent.eventId,
      remoteEntityId: 456,
      updatedAt: ACCEPTED_AT,
    });

    expect(
      readAnchor(database, "assets", "id", "asset:456")?.remote_base_updated_at,
    ).toBe(ACCEPTED_AT);

    database.close();
  });

  it("REQ-REL-RES-002: accepting a pushed customer edit refreshes remote_base_updated_at", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    pullCustomerAndAsset(database);
    updateLocalCustomer(database, {
      identifier: "customer:123",
      name: "Edited Customer",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    const customerEvent = listPendingOutboxEvents(database).find(
      (event) => event.entityType === "customer",
    );
    if (!customerEvent) throw new Error("expected a pending customer event");

    acceptEvent(database, {
      eventId: customerEvent.eventId,
      remoteEntityId: 123,
      updatedAt: ACCEPTED_AT,
    });

    expect(
      readAnchor(database, "customers", "id", "customer:123")
        ?.remote_base_updated_at,
    ).toBe(ACCEPTED_AT);

    database.close();
  });

  it("REQ-REL-RES-003: accepting a pushed OS-execution edit anchors remote_base_updated_at", () => {
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

    const executionEvent = listPendingOutboxEvents(database).find(
      (event) => event.entityType === "service_order_execution",
    );
    if (!executionEvent) throw new Error("expected a pending execution event");

    // Real-world the execution row is never pulled, so its anchor starts null.
    expect(
      readAnchor(
        database,
        "service_order_executions",
        "id",
        executionEvent.entityId,
      )?.remote_base_updated_at,
    ).toBeNull();

    acceptEvent(database, {
      eventId: executionEvent.eventId,
      remoteEntityId: 555,
      updatedAt: ACCEPTED_AT,
    });

    expect(
      readAnchor(
        database,
        "service_order_executions",
        "id",
        executionEvent.entityId,
      )?.remote_base_updated_at,
    ).toBe(ACCEPTED_AT);

    database.close();
  });
});
