import { beforeEach, describe, expect, it } from "vitest";
import { syncRouter } from "./sync";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  organization,
  organizationEventLog,
  serviceOrder,
  serviceOrderExecution,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for REL-01 slice 2 — server-side
// divergence detection in the three blind desktop applies (asset / customer /
// service-order execution notes). Only the better-auth session is mocked; the
// full push chain + the applies run for real against the seeded Postgres.
//
// The desktop emits `baseUpdatedAt` = the cloud row's `updatedAt` captured at
// PULL time (slice 1). If the server row's current `updatedAt` is STRICTLY after
// that base, the cloud advanced since the desktop pulled → the edit is stale and
// MUST NOT overwrite it; the apply returns the existing conflict result shape.
//
//   REQ-REL-SYNC-201 [HIGH RISK] stale base → conflict returned, row unchanged
//   REQ-REL-SYNC-202             equal/unchanged base → update applies
//   REQ-REL-SYNC-203             null/absent base (legacy desktop) → update applies
//
// RED (pre-slice-2): the applies did a blind UPDATE with no base comparison, so
// the stale-base pushes below would be ACCEPTED and silently overwrite the row.

const JSON_HEADERS = { "content-type": "application/json" };

const BASE_AT = "2026-06-01T00:00:00.000Z";
// The cloud row advanced 1 day past the base the desktop edited against.
const SERVER_ADVANCED_AT = new Date("2026-06-02T00:00:00.000Z");

// ─────────────────────────────────────────────────────────────────────────────
// Seed helpers — inline for self-containment; never touch shared files.
// ─────────────────────────────────────────────────────────────────────────────

async function seedClientOrg(clientOrgId: string): Promise<void> {
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

async function seedCustomerRow(params: {
  labOrgId: string;
  clientOrgId: string;
  name: string;
  updatedAt: Date;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);
  const [row] = await db
    .insert(customer)
    .values({
      name: params.name,
      authOrganizationId: params.clientOrgId,
      labOrganizationId: params.labOrgId,
      updatedAt: params.updatedAt,
    })
    .returning({ id: customer.id });
  if (!row) throw new Error("seedCustomerRow: insert failed");
  return row.id;
}

async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name: "Test Instrument", slug, definition: [] })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

async function seedAssetRow(params: {
  unitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
  name: string;
  updatedAt: Date;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: params.customerId,
      assetTypeId: params.assetTypeId,
      name: params.name,
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
      metrologyRegime: "INDUSTRIAL",
      updatedAt: params.updatedAt,
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAssetRow: insert failed");
  return row.id;
}

async function seedServiceOrderRow(params: {
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  openedByUserId: string;
  serviceOrderNumber: string;
}): Promise<number> {
  const [row] = await db
    .insert(serviceOrder)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      assetId: params.assetId,
      openedByUserId: params.openedByUserId,
      serviceOrderNumber: params.serviceOrderNumber,
      status: "awaiting_quote_approval",
      claimedDefect: "Defeito informado",
      intakeCondition: "Condição de entrada",
      intakeType: "counter",
      deliveryMethod: "pickup_at_lab",
      priority: "normal",
      totalQuotedCents: 0,
      totalApprovedCents: 0,
      evaluationFeeCents: 0,
      evaluationFeeApplied: false,
      isExternalService: false,
    })
    .returning({ id: serviceOrder.id });
  if (!row) throw new Error("seedServiceOrderRow: insert failed");
  return row.id;
}

async function seedExecutionRow(params: {
  serviceOrderId: number;
  startedByUserId: string;
  technicalNotes: string;
  updatedAt: Date;
}): Promise<number> {
  const [row] = await db
    .insert(serviceOrderExecution)
    .values({
      serviceOrderId: params.serviceOrderId,
      startedByUserId: params.startedByUserId,
      technicalNotes: params.technicalNotes,
      updatedAt: params.updatedAt,
    })
    .returning({ id: serviceOrderExecution.id });
  if (!row) throw new Error("seedExecutionRow: insert failed");
  return row.id;
}

/**
 * Seed the local→remote mapping the execution apply resolves the service order
 * through (`getRemoteServiceOrderIdFromPayload` → `findDesktopSyncRemoteEntityId`
 * reads `details.remoteEntityId` off an organization_event_log row keyed by the
 * LOCAL id). Asset/customer applies instead accept `remoteId` in the payload, so
 * they don't need this.
 */
async function seedRemoteMapping(params: {
  organizationId: string;
  localEntityId: string;
  remoteEntityId: number;
}): Promise<void> {
  await db.insert(organizationEventLog).values({
    organizationId: params.organizationId,
    action: "desktop_sync.create_local_service_order_intake",
    entityType: "service_order",
    entityId: params.localEntityId,
    details: { remoteEntityId: params.remoteEntityId },
  });
}

function buildSyncEvent(overrides: {
  eventId: string;
  entityType: string;
  entityId: string;
  operation: string;
  payload: Record<string, unknown>;
  organizationId: string;
  unitId: number | null;
  actorUserId: string;
  baseUpdatedAt?: string | null;
}): Record<string, unknown> {
  const event: Record<string, unknown> = {
    eventId: overrides.eventId,
    entityType: overrides.entityType,
    entityId: overrides.entityId,
    operation: overrides.operation,
    payload: overrides.payload,
    occurredAt: new Date().toISOString(),
    actorUserId: overrides.actorUserId,
    organizationId: overrides.organizationId,
    unitId: overrides.unitId,
    idempotencyKey: `idem-${overrides.eventId}`,
    localVersion: 0,
  };
  // Only attach baseUpdatedAt when provided so the "absent base / legacy desktop"
  // case (REQ-REL-SYNC-203) genuinely omits the field.
  if ("baseUpdatedAt" in overrides) {
    event.baseUpdatedAt = overrides.baseUpdatedAt;
  }
  return event;
}

function buildPushBody(events: Record<string, unknown>[]): string {
  return JSON.stringify({
    deviceId: "device-divergence-1",
    clientBatchId: `batch-${Math.random().toString(36).slice(2)}`,
    baseCursor: null,
    events,
  });
}

async function pushEvent(
  event: Record<string, unknown>,
  unitId: number,
): Promise<{ status: number; body: SyncPushResponseBody }> {
  const res = await syncRouter.request("/push", {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-active-unit-id": String(unitId) },
    body: buildPushBody([event]),
  });
  const body: unknown = await res.json();
  if (!isSyncPushResponseBody(body)) {
    throw new Error("Unexpected push response shape");
  }
  return { status: res.status, body };
}

type SyncPushResponseBody = {
  accepted: Array<{ eventId: string }>;
  rejected: Array<{ eventId: string; code: string; reason: string }>;
  conflicts: Array<{
    id: string;
    eventId?: string;
    entityType: string;
    entityId: string;
    conflictType: string;
    status: string;
    localPayload?: unknown;
    remotePayload?: unknown;
  }>;
};

function isSyncPushResponseBody(value: unknown): value is SyncPushResponseBody {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(Reflect.get(value, "accepted")) &&
    Array.isArray(Reflect.get(value, "rejected")) &&
    Array.isArray(Reflect.get(value, "conflicts"))
  );
}

function remotePayloadRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  throw new Error("conflict.remotePayload is not an object");
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe("syncRouter /push — REL-01 slice 2 divergence detection (real DB)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ASSET
  // ───────────────────────────────────────────────────────────────────────────

  it(
    "REQ-REL-SYNC-201: stale-base update_local_asset returns a concurrent_update conflict and leaves the asset byte-unchanged",
    async () => {
      const org = await seedOrg({ orgId: "org-asset-201", role: "admin" });
      const typeId = await seedAssetType("type-asset-201");
      const customerId = await seedCustomerRow({
        labOrgId: org.orgId,
        clientOrgId: "client-asset-201",
        name: "Cliente 201",
        updatedAt: new Date(BASE_AT),
      });
      // The cloud asset advanced to SERVER_ADVANCED_AT, AFTER the base the desktop
      // edited against (BASE_AT).
      const assetId = await seedAssetRow({
        unitId: org.unitId,
        customerId,
        assetTypeId: typeId,
        tag: "TAG-201",
        name: "Nome Nuvem",
        updatedAt: SERVER_ADVANCED_AT,
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const { status, body } = await pushEvent(
        buildSyncEvent({
          eventId: "evt-asset-201",
          entityType: "asset",
          entityId: "local-asset-201",
          operation: "update_local_asset",
          payload: { remoteId: assetId, name: "Nome Desktop (perdido)" },
          organizationId: org.orgId,
          unitId: org.unitId,
          actorUserId: org.userId,
          baseUpdatedAt: BASE_AT,
        }),
        org.unitId,
      );

      expect(status).toBe(200);
      expect(body.accepted).toHaveLength(0);
      expect(body.rejected).toHaveLength(0);
      expect(body.conflicts).toHaveLength(1);

      const conflict = body.conflicts[0];
      expect(conflict?.eventId).toBe("evt-asset-201");
      expect(conflict?.entityType).toBe("asset");
      expect(conflict?.entityId).toBe("local-asset-201");
      expect(conflict?.conflictType).toBe("concurrent_update");
      expect(conflict?.status).toBe("open");
      const remote = remotePayloadRecord(conflict?.remotePayload);
      expect(remote.entity).toBe("asset");
      expect(remote.id).toBe(assetId);
      expect(remote.updatedAt).toBe(SERVER_ADVANCED_AT.toISOString());
      expect(remote.baseUpdatedAt).toBe(BASE_AT);

      // DB-verify: the row is byte-unchanged (name + updatedAt untouched).
      const [row] = await db
        .select({ name: asset.name, updatedAt: asset.updatedAt })
        .from(asset)
        .where(eq(asset.id, assetId))
        .limit(1);
      expect(row?.name).toBe("Nome Nuvem");
      expect(row?.updatedAt?.getTime()).toBe(SERVER_ADVANCED_AT.getTime());
    },
  );

  it(
    "REQ-REL-SYNC-202: equal-base update_local_asset applies (no false conflict)",
    async () => {
      const org = await seedOrg({ orgId: "org-asset-202", role: "admin" });
      const typeId = await seedAssetType("type-asset-202");
      const customerId = await seedCustomerRow({
        labOrgId: org.orgId,
        clientOrgId: "client-asset-202",
        name: "Cliente 202",
        updatedAt: new Date(BASE_AT),
      });
      // Cloud row is STILL at the base the desktop pulled — safe to apply.
      const assetId = await seedAssetRow({
        unitId: org.unitId,
        customerId,
        assetTypeId: typeId,
        tag: "TAG-202",
        name: "Nome Original",
        updatedAt: new Date(BASE_AT),
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const { status, body } = await pushEvent(
        buildSyncEvent({
          eventId: "evt-asset-202",
          entityType: "asset",
          entityId: "local-asset-202",
          operation: "update_local_asset",
          payload: { remoteId: assetId, name: "Nome Aplicado" },
          organizationId: org.orgId,
          unitId: org.unitId,
          actorUserId: org.userId,
          baseUpdatedAt: BASE_AT,
        }),
        org.unitId,
      );

      expect(status).toBe(200);
      expect(body.conflicts).toHaveLength(0);
      expect(body.rejected).toHaveLength(0);
      expect(body.accepted).toHaveLength(1);
      expect(body.accepted[0]?.eventId).toBe("evt-asset-202");

      const [row] = await db
        .select({ name: asset.name, updatedAt: asset.updatedAt })
        .from(asset)
        .where(eq(asset.id, assetId))
        .limit(1);
      expect(row?.name).toBe("Nome Aplicado");
      // Apply bumps updatedAt to now (past the base).
      expect(row?.updatedAt?.getTime()).toBeGreaterThan(
        new Date(BASE_AT).getTime(),
      );
    },
  );

  it(
    "REQ-REL-SYNC-203: absent-base update_local_asset applies exactly as today (legacy desktop)",
    async () => {
      const org = await seedOrg({ orgId: "org-asset-203", role: "admin" });
      const typeId = await seedAssetType("type-asset-203");
      const customerId = await seedCustomerRow({
        labOrgId: org.orgId,
        clientOrgId: "client-asset-203",
        name: "Cliente 203",
        updatedAt: new Date(BASE_AT),
      });
      // Cloud row is well ahead, but a legacy desktop sends NO base → apply anyway.
      const assetId = await seedAssetRow({
        unitId: org.unitId,
        customerId,
        assetTypeId: typeId,
        tag: "TAG-203",
        name: "Nome Nuvem",
        updatedAt: SERVER_ADVANCED_AT,
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const { status, body } = await pushEvent(
        buildSyncEvent({
          eventId: "evt-asset-203",
          entityType: "asset",
          entityId: "local-asset-203",
          operation: "update_local_asset",
          // No baseUpdatedAt key at all → legacy path.
          payload: { remoteId: assetId, name: "Nome Legado" },
          organizationId: org.orgId,
          unitId: org.unitId,
          actorUserId: org.userId,
        }),
        org.unitId,
      );

      expect(status).toBe(200);
      expect(body.conflicts).toHaveLength(0);
      expect(body.rejected).toHaveLength(0);
      expect(body.accepted).toHaveLength(1);

      const [row] = await db
        .select({ name: asset.name })
        .from(asset)
        .where(eq(asset.id, assetId))
        .limit(1);
      expect(row?.name).toBe("Nome Legado");
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CUSTOMER
  // ───────────────────────────────────────────────────────────────────────────

  it(
    "REQ-REL-SYNC-201: stale-base update_local_customer returns a concurrent_update conflict and leaves the customer byte-unchanged",
    async () => {
      const org = await seedOrg({ orgId: "org-cust-201", role: "admin" });
      const customerId = await seedCustomerRow({
        labOrgId: org.orgId,
        clientOrgId: "client-cust-201",
        name: "Razão Social Nuvem",
        updatedAt: SERVER_ADVANCED_AT,
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const { status, body } = await pushEvent(
        buildSyncEvent({
          eventId: "evt-cust-201",
          entityType: "customer",
          entityId: "local-customer-201",
          operation: "update_local_customer",
          payload: { remoteId: customerId, name: "Razão Desktop (perdida)" },
          organizationId: org.orgId,
          unitId: org.unitId,
          actorUserId: org.userId,
          baseUpdatedAt: BASE_AT,
        }),
        org.unitId,
      );

      expect(status).toBe(200);
      expect(body.accepted).toHaveLength(0);
      expect(body.rejected).toHaveLength(0);
      expect(body.conflicts).toHaveLength(1);

      const conflict = body.conflicts[0];
      expect(conflict?.entityType).toBe("customer");
      expect(conflict?.conflictType).toBe("concurrent_update");
      const remote = remotePayloadRecord(conflict?.remotePayload);
      expect(remote.entity).toBe("customer");
      expect(remote.id).toBe(customerId);
      expect(remote.updatedAt).toBe(SERVER_ADVANCED_AT.toISOString());
      expect(remote.baseUpdatedAt).toBe(BASE_AT);

      const [row] = await db
        .select({ name: customer.name, updatedAt: customer.updatedAt })
        .from(customer)
        .where(eq(customer.id, customerId))
        .limit(1);
      expect(row?.name).toBe("Razão Social Nuvem");
      expect(row?.updatedAt?.getTime()).toBe(SERVER_ADVANCED_AT.getTime());
    },
  );

  it(
    "REQ-REL-SYNC-202: equal-base update_local_customer applies (no false conflict)",
    async () => {
      const org = await seedOrg({ orgId: "org-cust-202", role: "admin" });
      const customerId = await seedCustomerRow({
        labOrgId: org.orgId,
        clientOrgId: "client-cust-202",
        name: "Razão Original",
        updatedAt: new Date(BASE_AT),
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const { status, body } = await pushEvent(
        buildSyncEvent({
          eventId: "evt-cust-202",
          entityType: "customer",
          entityId: "local-customer-202",
          operation: "update_local_customer",
          payload: { remoteId: customerId, name: "Razão Aplicada" },
          organizationId: org.orgId,
          unitId: org.unitId,
          actorUserId: org.userId,
          baseUpdatedAt: BASE_AT,
        }),
        org.unitId,
      );

      expect(status).toBe(200);
      expect(body.conflicts).toHaveLength(0);
      expect(body.rejected).toHaveLength(0);
      expect(body.accepted).toHaveLength(1);

      const [row] = await db
        .select({ name: customer.name })
        .from(customer)
        .where(eq(customer.id, customerId))
        .limit(1);
      expect(row?.name).toBe("Razão Aplicada");
    },
  );

  it(
    "REQ-REL-SYNC-203: absent-base update_local_customer applies exactly as today (legacy desktop)",
    async () => {
      const org = await seedOrg({ orgId: "org-cust-203", role: "admin" });
      const customerId = await seedCustomerRow({
        labOrgId: org.orgId,
        clientOrgId: "client-cust-203",
        name: "Razão Nuvem",
        updatedAt: SERVER_ADVANCED_AT,
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const { status, body } = await pushEvent(
        buildSyncEvent({
          eventId: "evt-cust-203",
          entityType: "customer",
          entityId: "local-customer-203",
          operation: "update_local_customer",
          payload: { remoteId: customerId, name: "Razão Legado" },
          organizationId: org.orgId,
          unitId: org.unitId,
          actorUserId: org.userId,
        }),
        org.unitId,
      );

      expect(status).toBe(200);
      expect(body.conflicts).toHaveLength(0);
      expect(body.accepted).toHaveLength(1);

      const [row] = await db
        .select({ name: customer.name })
        .from(customer)
        .where(eq(customer.id, customerId))
        .limit(1);
      expect(row?.name).toBe("Razão Legado");
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // SERVICE-ORDER EXECUTION NOTES
  // (slice 1 never anchors the execution base, so real-world it is always null;
  //  the stale case is exercised with a manually-supplied base per the plan.)
  // ───────────────────────────────────────────────────────────────────────────

  it(
    "REQ-REL-SYNC-201: stale-base save_local_service_order_execution_notes returns a conflict and leaves the execution + OS byte-unchanged",
    async () => {
      const org = await seedOrg({ orgId: "org-exec-201", role: "admin" });
      const typeId = await seedAssetType("type-exec-201");
      const customerId = await seedCustomerRow({
        labOrgId: org.orgId,
        clientOrgId: "client-exec-201",
        name: "Cliente OS 201",
        updatedAt: new Date(BASE_AT),
      });
      const assetId = await seedAssetRow({
        unitId: org.unitId,
        customerId,
        assetTypeId: typeId,
        tag: "TAG-EXEC-201",
        name: "Ativo OS",
        updatedAt: new Date(BASE_AT),
      });
      const orderId = await seedServiceOrderRow({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId,
        assetId,
        openedByUserId: org.userId,
        serviceOrderNumber: "OS-EXEC-201",
      });
      // The execution row advanced past the base the desktop edited against.
      const executionId = await seedExecutionRow({
        serviceOrderId: orderId,
        startedByUserId: org.userId,
        technicalNotes: "Notas Nuvem",
        updatedAt: SERVER_ADVANCED_AT,
      });
      await seedRemoteMapping({
        organizationId: org.orgId,
        localEntityId: "local-so-201",
        remoteEntityId: orderId,
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const { status, body } = await pushEvent(
        buildSyncEvent({
          eventId: "evt-exec-201",
          entityType: "service_order_execution",
          entityId: "local-exec-201",
          operation: "save_local_service_order_execution_notes",
          payload: {
            serviceOrderId: "local-so-201",
            technicalNotes: "Notas Desktop (perdidas)",
          },
          organizationId: org.orgId,
          unitId: org.unitId,
          actorUserId: org.userId,
          baseUpdatedAt: BASE_AT,
        }),
        org.unitId,
      );

      expect(status).toBe(200);
      expect(body.accepted).toHaveLength(0);
      expect(body.rejected).toHaveLength(0);
      expect(body.conflicts).toHaveLength(1);

      const conflict = body.conflicts[0];
      expect(conflict?.entityType).toBe("service_order_execution");
      expect(conflict?.conflictType).toBe("concurrent_update");
      const remote = remotePayloadRecord(conflict?.remotePayload);
      expect(remote.entity).toBe("service_order_execution");
      expect(remote.id).toBe(executionId);
      expect(remote.updatedAt).toBe(SERVER_ADVANCED_AT.toISOString());

      // DB-verify: execution notes untouched…
      const [execRow] = await db
        .select({
          technicalNotes: serviceOrderExecution.technicalNotes,
          updatedAt: serviceOrderExecution.updatedAt,
        })
        .from(serviceOrderExecution)
        .where(eq(serviceOrderExecution.id, executionId))
        .limit(1);
      expect(execRow?.technicalNotes).toBe("Notas Nuvem");
      expect(execRow?.updatedAt?.getTime()).toBe(SERVER_ADVANCED_AT.getTime());

      // …and the OS was NOT flipped to repair_in_progress by the aborted apply.
      const [orderRow] = await db
        .select({ status: serviceOrder.status })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, orderId))
        .limit(1);
      expect(orderRow?.status).toBe("awaiting_quote_approval");
    },
  );

  it(
    "REQ-REL-SYNC-203: absent-base save_local_service_order_execution_notes applies exactly as today (real-world null anchor)",
    async () => {
      const org = await seedOrg({ orgId: "org-exec-203", role: "admin" });
      const typeId = await seedAssetType("type-exec-203");
      const customerId = await seedCustomerRow({
        labOrgId: org.orgId,
        clientOrgId: "client-exec-203",
        name: "Cliente OS 203",
        updatedAt: new Date(BASE_AT),
      });
      const assetId = await seedAssetRow({
        unitId: org.unitId,
        customerId,
        assetTypeId: typeId,
        tag: "TAG-EXEC-203",
        name: "Ativo OS",
        updatedAt: new Date(BASE_AT),
      });
      const orderId = await seedServiceOrderRow({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId,
        assetId,
        openedByUserId: org.userId,
        serviceOrderNumber: "OS-EXEC-203",
      });
      const executionId = await seedExecutionRow({
        serviceOrderId: orderId,
        startedByUserId: org.userId,
        technicalNotes: "Notas Nuvem",
        updatedAt: SERVER_ADVANCED_AT,
      });
      await seedRemoteMapping({
        organizationId: org.orgId,
        localEntityId: "local-so-203",
        remoteEntityId: orderId,
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const { status, body } = await pushEvent(
        buildSyncEvent({
          eventId: "evt-exec-203",
          entityType: "service_order_execution",
          entityId: "local-exec-203",
          operation: "save_local_service_order_execution_notes",
          // No baseUpdatedAt → the real-world always-null anchor path.
          payload: {
            serviceOrderId: "local-so-203",
            technicalNotes: "Notas Legado",
          },
          organizationId: org.orgId,
          unitId: org.unitId,
          actorUserId: org.userId,
        }),
        org.unitId,
      );

      expect(status).toBe(200);
      expect(body.conflicts).toHaveLength(0);
      expect(body.rejected).toHaveLength(0);
      expect(body.accepted).toHaveLength(1);

      const [execRow] = await db
        .select({ technicalNotes: serviceOrderExecution.technicalNotes })
        .from(serviceOrderExecution)
        .where(eq(serviceOrderExecution.id, executionId))
        .limit(1);
      expect(execRow?.technicalNotes).toBe("Notas Legado");
    },
  );
});
