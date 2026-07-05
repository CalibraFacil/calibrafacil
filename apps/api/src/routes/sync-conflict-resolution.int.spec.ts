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
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration for REL-01 slice 3 — the "fill the remote side
// of the diff" fix (FIX 1). When a concurrent_update conflict is registered for
// asset / customer / OS-execution, `conflict.remotePayload` must now carry the
// CURRENT CLOUD ROW's diff-relevant fields so the desktop conflicts UI renders
// real cloud values instead of "—".
//
//   REQ-REL-RES-001 [HIGH RISK] remotePayload carries the cloud diff fields
//   REQ-REL-RES-003             service_order_execution divergence is detectable
//
// RED (pre-slice-3): buildStaleDesktopBaseConflict returned only
// { entity, id, updatedAt, baseUpdatedAt } — every domain field was absent.

const JSON_HEADERS = { "content-type": "application/json" };

const BASE_AT = "2026-06-01T00:00:00.000Z";
const SERVER_ADVANCED_AT = new Date("2026-06-02T00:00:00.000Z");

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
  taxId: string;
  email: string;
  phone: string;
  updatedAt: Date;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);
  const [row] = await db
    .insert(customer)
    .values({
      name: params.name,
      taxId: params.taxId,
      email: params.email,
      phone: params.phone,
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
  labOrgId: string;
  unitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
  name: string;
  serialNumber: string;
  manufacturer: string;
  model: string;
  updatedAt: Date;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      labOrganizationId: params.labOrgId,
      unitId: params.unitId,
      customerId: params.customerId,
      assetTypeId: params.assetTypeId,
      name: params.name,
      serialNumber: params.serialNumber,
      manufacturer: params.manufacturer,
      model: params.model,
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
  servicePerformed: string;
  partsUsedSummary: string;
  technicalNotes: string;
  calibrationRequiredAfterRepair: boolean;
  updatedAt: Date;
}): Promise<number> {
  const [row] = await db
    .insert(serviceOrderExecution)
    .values({
      serviceOrderId: params.serviceOrderId,
      startedByUserId: params.startedByUserId,
      servicePerformed: params.servicePerformed,
      partsUsedSummary: params.partsUsedSummary,
      technicalNotes: params.technicalNotes,
      calibrationRequiredAfterRepair: params.calibrationRequiredAfterRepair,
      result: "repaired",
      updatedAt: params.updatedAt,
    })
    .returning({ id: serviceOrderExecution.id });
  if (!row) throw new Error("seedExecutionRow: insert failed");
  return row.id;
}

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
  baseUpdatedAt: string;
}): Record<string, unknown> {
  return {
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
    baseUpdatedAt: overrides.baseUpdatedAt,
  };
}

async function pushEvent(
  event: Record<string, unknown>,
  unitId: number,
): Promise<SyncPushResponseBody> {
  const res = await syncRouter.request("/push", {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-active-unit-id": String(unitId) },
    body: JSON.stringify({
      deviceId: "device-resolution-1",
      clientBatchId: `batch-${Math.random().toString(36).slice(2)}`,
      baseCursor: null,
      events: [event],
    }),
  });
  const body: unknown = await res.json();
  if (!isSyncPushResponseBody(body)) {
    throw new Error("Unexpected push response shape");
  }
  return body;
}

type SyncPushResponseBody = {
  accepted: Array<{ eventId: string }>;
  rejected: Array<{ eventId: string; code: string; reason: string }>;
  conflicts: Array<{
    entityType: string;
    conflictType: string;
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

describe("syncRouter /push — REL-01 slice 3 remote-diff fill (real DB)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-REL-RES-001: a stale-base asset conflict carries the cloud asset's diff fields", async () => {
    const org = await seedOrg({ orgId: "org-res-asset", role: "admin" });
    const typeId = await seedAssetType("type-res-asset");
    const customerId = await seedCustomerRow({
      labOrgId: org.orgId,
      clientOrgId: "client-res-asset",
      name: "Cliente RES",
      taxId: "11222333000181",
      email: "cliente@res.test",
      phone: "5551999990000",
      updatedAt: new Date(BASE_AT),
    });
    const assetId = await seedAssetRow({
      labOrgId: org.orgId,
      unitId: org.unitId,
      customerId,
      assetTypeId: typeId,
      tag: "TAG-RES",
      name: "Nome Nuvem",
      serialNumber: "SN-NUVEM",
      manufacturer: "Fabricante Nuvem",
      model: "Modelo Nuvem",
      updatedAt: SERVER_ADVANCED_AT,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const body = await pushEvent(
      buildSyncEvent({
        eventId: "evt-res-asset",
        entityType: "asset",
        entityId: "local-res-asset",
        operation: "update_local_asset",
        payload: { remoteId: assetId, name: "Nome Desktop (perdido)" },
        organizationId: org.orgId,
        unitId: org.unitId,
        actorUserId: org.userId,
        baseUpdatedAt: BASE_AT,
      }),
      org.unitId,
    );

    expect(body.conflicts).toHaveLength(1);
    const remote = remotePayloadRecord(body.conflicts[0]?.remotePayload);
    expect(remote.name).toBe("Nome Nuvem");
    expect(remote.tag).toBe("TAG-RES");
    expect(remote.serialNumber).toBe("SN-NUVEM");
    expect(remote.manufacturer).toBe("Fabricante Nuvem");
    expect(remote.model).toBe("Modelo Nuvem");
    expect(remote.status).toBe("ACTIVE");
  });

  it("REQ-REL-RES-001: a stale-base customer conflict carries the cloud customer's diff fields", async () => {
    const org = await seedOrg({ orgId: "org-res-cust", role: "admin" });
    const customerId = await seedCustomerRow({
      labOrgId: org.orgId,
      clientOrgId: "client-res-cust",
      name: "Razão Social Nuvem",
      taxId: "99888777000166",
      email: "nuvem@cliente.test",
      phone: "5551988887777",
      updatedAt: SERVER_ADVANCED_AT,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const body = await pushEvent(
      buildSyncEvent({
        eventId: "evt-res-cust",
        entityType: "customer",
        entityId: "local-res-cust",
        operation: "update_local_customer",
        payload: { remoteId: customerId, name: "Razão Desktop (perdida)" },
        organizationId: org.orgId,
        unitId: org.unitId,
        actorUserId: org.userId,
        baseUpdatedAt: BASE_AT,
      }),
      org.unitId,
    );

    expect(body.conflicts).toHaveLength(1);
    const remote = remotePayloadRecord(body.conflicts[0]?.remotePayload);
    expect(remote.name).toBe("Razão Social Nuvem");
    expect(remote.taxId).toBe("99888777000166");
    expect(remote.email).toBe("nuvem@cliente.test");
    expect(remote.phone).toBe("5551988887777");
  });

  it("REQ-REL-RES-003: a stale-base OS-execution conflict is detectable and carries the cloud execution's diff fields", async () => {
    const org = await seedOrg({ orgId: "org-res-exec", role: "admin" });
    const typeId = await seedAssetType("type-res-exec");
    const customerId = await seedCustomerRow({
      labOrgId: org.orgId,
      clientOrgId: "client-res-exec",
      name: "Cliente OS RES",
      taxId: "12312312000199",
      email: "os@cliente.test",
      phone: "5551977776666",
      updatedAt: new Date(BASE_AT),
    });
    const assetId = await seedAssetRow({
      labOrgId: org.orgId,
      unitId: org.unitId,
      customerId,
      assetTypeId: typeId,
      tag: "TAG-RES-EXEC",
      name: "Ativo OS",
      serialNumber: "SN-OS",
      manufacturer: "Fab OS",
      model: "Mod OS",
      updatedAt: new Date(BASE_AT),
    });
    const orderId = await seedServiceOrderRow({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId,
      assetId,
      openedByUserId: org.userId,
      serviceOrderNumber: "OS-RES-EXEC",
    });
    const executionId = await seedExecutionRow({
      serviceOrderId: orderId,
      startedByUserId: org.userId,
      servicePerformed: "Serviço Nuvem",
      partsUsedSummary: "Peças Nuvem",
      technicalNotes: "Notas Nuvem",
      calibrationRequiredAfterRepair: true,
      updatedAt: SERVER_ADVANCED_AT,
    });
    await seedRemoteMapping({
      organizationId: org.orgId,
      localEntityId: "local-so-res",
      remoteEntityId: orderId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const body = await pushEvent(
      buildSyncEvent({
        eventId: "evt-res-exec",
        entityType: "service_order_execution",
        entityId: "local-exec-res",
        operation: "save_local_service_order_execution_notes",
        payload: {
          serviceOrderId: "local-so-res",
          technicalNotes: "Notas Desktop (perdidas)",
        },
        organizationId: org.orgId,
        unitId: org.unitId,
        actorUserId: org.userId,
        baseUpdatedAt: BASE_AT,
      }),
      org.unitId,
    );

    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]?.entityType).toBe("service_order_execution");
    expect(body.conflicts[0]?.conflictType).toBe("concurrent_update");
    const remote = remotePayloadRecord(body.conflicts[0]?.remotePayload);
    expect(remote.entity).toBe("service_order_execution");
    expect(remote.id).toBe(executionId);
    expect(remote.servicePerformed).toBe("Serviço Nuvem");
    expect(remote.partsUsedSummary).toBe("Peças Nuvem");
    expect(remote.technicalNotes).toBe("Notas Nuvem");
    expect(remote.calibrationRequiredAfterRepair).toBe(true);
    expect(remote.result).toBe("repaired");
  });
});
