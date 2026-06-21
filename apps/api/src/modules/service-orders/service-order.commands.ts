import { db } from "@calibra-facil/db";
import {
  asset,
  customer,
  serviceOrder,
  serviceOrderAssetSnapshot,
  serviceOrderSettings,
} from "@calibra-facil/db/schema";
import { canTransitionServiceOrderStatus } from "@calibra-facil/shared";
import type {
  CreateServiceOrderSchema,
  UpdateServiceOrderSchema,
  UpdateServiceOrderSettingsSchema,
} from "@calibra-facil/schemas";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { AuthVariables } from "../../middleware/permission";
import {
  createInitialServiceOrderRecords,
  createBillingDocumentFromServiceOrder,
  getOrCreateServiceOrderSettings,
  recordServiceOrderEvent,
} from "../../lib/service-order-workflow";
import { buildUnitScopeCondition } from "../../lib/units";
import { enqueueServiceOrderDocumentJob } from "./service-order.documents";
import { enqueueServiceOrderEmail } from "./email-outbox-payloads";
import type { NovaOsOutboxPayload } from "./email-outbox-payloads";

type ServiceOrderMember = AuthVariables["member"];
type ServiceOrderRow = typeof serviceOrder.$inferSelect;
type CreateServiceOrderInput = z.infer<typeof CreateServiceOrderSchema>;
type UpdateServiceOrderInput = z.infer<typeof UpdateServiceOrderSchema>;
type UpdateServiceOrderSettingsInput = Partial<
  z.infer<typeof UpdateServiceOrderSettingsSchema>
>;

type DateLikeInput = string | null | undefined;

function parseDate(value: DateLikeInput) {
  return value ? new Date(value) : null;
}

export async function createServiceOrder(input: {
  member: ServiceOrderMember;
  actorUserId: string;
  values: CreateServiceOrderInput;
  metadata: {
    ipAddress?: string | null;
    userAgent?: string | null;
  };
}) {
  const unitId = input.member.activeUnitId ?? input.member.accessibleUnitIds[0];
  if (!unitId) return { status: "no_unit" as const };

  const [assetRow] = await db
    .select({
      id: asset.id,
      unitId: asset.unitId,
      customerId: asset.customerId,
      labOrganizationId: customer.labOrganizationId,
    })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .where(eq(asset.id, input.values.assetId))
    .limit(1);

  if (
    !assetRow ||
    assetRow.customerId !== input.values.customerId ||
    assetRow.labOrganizationId !== input.member.organizationId
  ) {
    return { status: "invalid_asset" as const };
  }

  const created = await createInitialServiceOrderRecords({
    organizationId: input.member.organizationId,
    unitId,
    customerId: input.values.customerId,
    assetId: input.values.assetId,
    userId: input.actorUserId,
    assetSnapshot: input.values.assetSnapshot,
    signatureData: input.values.signatureData ?? null,
    ipAddress: input.metadata.ipAddress ?? null,
    userAgent: input.metadata.userAgent ?? null,
    values: {
      clientContactId: input.values.clientContactId ?? null,
      clientContactSnapshot: input.values.clientContactSnapshot ?? null,
      intakeType: input.values.intakeType,
      isExternalService: input.values.isExternalService ?? false,
      sourceServiceOrderId: input.values.sourceServiceOrderId ?? null,
      priority: input.values.priority,
      responsibleTechnicianId: input.values.responsibleTechnicianId ?? null,
      claimedDefect: input.values.claimedDefect,
      intakeCondition: input.values.intakeCondition,
      accessories: input.values.accessories ?? null,
      oldSealNumber: input.values.oldSealNumber ?? null,
      newSealNumber: input.values.newSealNumber ?? null,
      repairedSealNumber: input.values.repairedSealNumber ?? null,
      inmetroRepairSealNumber: input.values.inmetroRepairSealNumber ?? null,
      invoiceRemittanceNumber: input.values.invoiceRemittanceNumber ?? null,
      invoiceRemittanceKey: input.values.invoiceRemittanceKey ?? null,
      invoiceRemittanceIssuedAt: parseDate(
        input.values.invoiceRemittanceIssuedAt,
      ),
      carrierName: input.values.carrierName ?? null,
      carrierDocument: input.values.carrierDocument ?? null,
      thirdPartyName: input.values.thirdPartyName ?? null,
      thirdPartyDocument: input.values.thirdPartyDocument ?? null,
      thirdPartyPhone: input.values.thirdPartyPhone ?? null,
      deliveryMethod: input.values.deliveryMethod,
      internalNotes: input.values.internalNotes ?? null,
      clientVisibleNotes: input.values.clientVisibleNotes ?? null,
      evaluationFeeCents: input.values.evaluationFeeCents,
      warrantyUntil: parseDate(input.values.warrantyUntil),
      warrantyTerms: input.values.warrantyTerms ?? null,
      serviceStartedAt: parseDate(input.values.serviceStartedAt),
    },
  });

  await Promise.all([
    enqueueServiceOrderDocumentJob({
      type: "SERVICE_ORDER_INTAKE_DOCUMENT",
      serviceOrderId: created.id,
      userId: input.actorUserId,
    }),
    enqueueServiceOrderDocumentJob({
      type: "SERVICE_ORDER_TAG",
      serviceOrderId: created.id,
      userId: input.actorUserId,
    }),
  ]);

  // REQ-SOEMAIL-071: enqueue a durable outbox row for the "nova OS" email.
  // Load customer + asset snapshot data first (both belong to the same org —
  // tenant scope is preserved). Enqueue is awaited so the row is persisted
  // before the handler returns; no fire-and-forget.
  // Email delivery happens in the worker drain (not in this request path).
  const [customerRow, snapshotRow] = await Promise.all([
    db
      .select({ name: customer.name, email: customer.email })
      .from(customer)
      .where(
        and(
          eq(customer.id, created.customerId),
          eq(customer.labOrganizationId, created.organizationId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        manufacturer: serviceOrderAssetSnapshot.manufacturer,
        model: serviceOrderAssetSnapshot.model,
        serialNumber: serviceOrderAssetSnapshot.serialNumber,
      })
      .from(serviceOrderAssetSnapshot)
      .where(eq(serviceOrderAssetSnapshot.serviceOrderId, created.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const novaOsPayload = {
    serviceOrderId: created.id,
    serviceOrderNumber: created.serviceOrderNumber,
    organizationId: created.organizationId,
    publicId: created.publicId,
    customerId: created.customerId,
    clientContactSnapshot: created.clientContactSnapshot,
    customerName: customerRow?.name ?? "",
    customerEmail: customerRow?.email ?? null,
    assetManufacturer: snapshotRow?.manufacturer ?? null,
    assetModel: snapshotRow?.model ?? null,
    assetSerialNumber: snapshotRow?.serialNumber ?? null,
    openedAt: created.openedAt.toISOString(),
    claimedDefect: created.claimedDefect,
  } satisfies NovaOsOutboxPayload;

  await enqueueServiceOrderEmail({
    organizationId: created.organizationId,
    unitId: created.unitId,
    serviceOrderId: created.id,
    eventKey: "nova_os",
    targetStatus: created.status ?? "",
    payload: novaOsPayload,
  });

  return { status: "ok" as const, data: created };
}

export async function updateServiceOrderSettings(input: {
  organizationId: string;
  values: UpdateServiceOrderSettingsInput;
}) {
  await getOrCreateServiceOrderSettings(input.organizationId);
  const [updated] = await db
    .update(serviceOrderSettings)
    .set({
      ...input.values,
      updatedAt: new Date(),
    })
    .where(eq(serviceOrderSettings.organizationId, input.organizationId))
    .returning();

  return updated;
}

export async function getServiceOrderSettings(organizationId: string) {
  return getOrCreateServiceOrderSettings(organizationId);
}

export async function updateServiceOrder(input: {
  serviceOrderId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  values: UpdateServiceOrderInput;
  metadata: {
    ipAddress?: string | null;
    userAgent?: string | null;
  };
}) {
  const [existing] = await db
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.member),
      ),
    )
    .limit(1);
  if (!existing) return { status: "not_found" as const };

  if (
    input.values.status &&
    input.values.status !== existing.status &&
    !canTransitionServiceOrderStatus(existing.status, input.values.status)
  ) {
    return { status: "invalid_transition" as const };
  }

  const [updated] = await db
    .update(serviceOrder)
    .set({
      ...input.values,
      // Date fields arrive as ISO strings; convert. Presence-guard so a partial
      // PATCH (e.g. only serviceStartedAt) doesn't null the others.
      invoiceRemittanceIssuedAt:
        "invoiceRemittanceIssuedAt" in input.values
          ? parseDate(input.values.invoiceRemittanceIssuedAt)
          : existing.invoiceRemittanceIssuedAt,
      warrantyUntil:
        "warrantyUntil" in input.values
          ? parseDate(input.values.warrantyUntil)
          : existing.warrantyUntil,
      serviceStartedAt:
        "serviceStartedAt" in input.values
          ? parseDate(input.values.serviceStartedAt)
          : existing.serviceStartedAt,
      updatedAt: new Date(),
    })
    .where(eq(serviceOrder.id, input.serviceOrderId))
    .returning();

  if (input.values.status && input.values.status !== existing.status) {
    await recordServiceOrderEvent({
      organizationId: existing.organizationId,
      unitId: existing.unitId,
      serviceOrderId: existing.id,
      actorType: "lab_user",
      actorId: input.actorUserId,
      eventType: "service_order.status_changed",
      oldValue: { status: existing.status },
      newValue: { status: input.values.status },
      ipAddress: input.metadata.ipAddress ?? null,
      userAgent: input.metadata.userAgent ?? null,
    });
  }

  return { status: "ok" as const, data: updated };
}

export async function updateServiceOrderRepairSeal(input: {
  serviceOrderId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  values: {
    inmetroRepairSealNumber?: string | null;
    inmetroRepairSealIssuedAt?: DateLikeInput;
    inmetroRepairSealAppliedAt?: DateLikeInput;
    inmetroRepairSealNotes?: string | null;
  };
}) {
  const [updated] = await db
    .update(serviceOrder)
    .set({
      inmetroRepairSealNumber: input.values.inmetroRepairSealNumber ?? null,
      inmetroRepairSealIssuedAt: parseDate(
        input.values.inmetroRepairSealIssuedAt,
      ),
      inmetroRepairSealAppliedAt: parseDate(
        input.values.inmetroRepairSealAppliedAt,
      ),
      inmetroRepairSealAppliedByUserId: input.values.inmetroRepairSealAppliedAt
        ? input.actorUserId
        : null,
      inmetroRepairSealNotes: input.values.inmetroRepairSealNotes ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.member),
      ),
    )
    .returning();

  if (!updated) return null;

  await recordServiceOrderEvent({
    organizationId: updated.organizationId,
    unitId: updated.unitId,
    serviceOrderId: input.serviceOrderId,
    actorType: "lab_user",
    actorId: input.actorUserId,
    eventType: "service_order.repair_seal_updated",
    metadata: {
      inmetroRepairSealNumber: input.values.inmetroRepairSealNumber,
    },
  });

  return updated;
}

export async function assignServiceOrderTechnician(input: {
  serviceOrderId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  technicianId: string;
}) {
  const [updated] = await db
    .update(serviceOrder)
    .set({
      responsibleTechnicianId: input.technicianId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.member),
      ),
    )
    .returning();

  if (!updated) return null;

  await recordServiceOrderEvent({
    organizationId: updated.organizationId,
    unitId: updated.unitId,
    serviceOrderId: input.serviceOrderId,
    actorType: "lab_user",
    actorId: input.actorUserId,
    eventType: "service_order.technician_assigned",
    newValue: { technicianId: input.technicianId },
  });

  return updated;
}

export async function deliverServiceOrder(input: {
  serviceOrderId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  values: {
    deliveryMethod: ServiceOrderRow["deliveryMethod"];
    deliveredToName: string;
    deliveredToDocument?: string | null;
    deliveryNotes?: string | null;
    inmetroRepairSealNumber?: string | null;
  };
}) {
  const [updated] = await db
    .update(serviceOrder)
    .set({
      status: "delivered",
      deliveredAt: new Date(),
      deliveryMethod: input.values.deliveryMethod,
      deliveredToName: input.values.deliveredToName,
      deliveredToDocument: input.values.deliveredToDocument ?? null,
      deliveryNotes: input.values.deliveryNotes ?? null,
      inmetroRepairSealNumber:
        input.values.inmetroRepairSealNumber ?? undefined,
    })
    .where(
      and(
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.member),
      ),
    )
    .returning();

  if (!updated) return null;

  await recordServiceOrderEvent({
    organizationId: updated.organizationId,
    unitId: updated.unitId,
    serviceOrderId: input.serviceOrderId,
    actorType: "lab_user",
    actorId: input.actorUserId,
    eventType: "service_order.delivered",
    metadata: { deliveredToName: input.values.deliveredToName },
  });

  return updated;
}

export async function closeServiceOrder(input: {
  serviceOrderId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  values: {
    closingReason: ServiceOrderRow["closingReason"];
    notes?: string | null;
    createBillingDocument?: boolean;
    dueDate?: DateLikeInput;
  };
}) {
  const [updated] = await db
    .update(serviceOrder)
    .set({
      status: "closed",
      closedAt: new Date(),
      closingReason: input.values.closingReason,
      internalNotes: input.values.notes ?? undefined,
    })
    .where(
      and(
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
      ),
    )
    .returning();

  if (!updated) return null;

  if (input.values.createBillingDocument) {
    await createBillingDocumentFromServiceOrder({
      actorUserId: input.actorUserId,
      organizationId: input.member.organizationId,
      serviceOrderId: input.serviceOrderId,
      dueDate: parseDate(input.values.dueDate) ?? undefined,
    });
  }

  await recordServiceOrderEvent({
    organizationId: updated.organizationId,
    unitId: updated.unitId,
    serviceOrderId: input.serviceOrderId,
    actorType: "lab_user",
    actorId: input.actorUserId,
    eventType: "service_order.closed",
    metadata: { closingReason: input.values.closingReason },
  });

  return updated;
}

export async function cancelServiceOrder(input: {
  serviceOrderId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  values: { reason: string };
}) {
  const [updated] = await db
    .update(serviceOrder)
    .set({
      status: "canceled",
      canceledAt: new Date(),
      cancelReason: input.values.reason,
    })
    .where(
      and(
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.member),
      ),
    )
    .returning();

  if (!updated) return null;

  await recordServiceOrderEvent({
    organizationId: updated.organizationId,
    unitId: updated.unitId,
    serviceOrderId: input.serviceOrderId,
    actorType: "lab_user",
    actorId: input.actorUserId,
    eventType: "service_order.canceled",
    metadata: { reason: input.values.reason },
  });

  return updated;
}

export async function reopenServiceOrder(input: {
  serviceOrderId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  values: { reason: string };
}) {
  const [updated] = await db
    .update(serviceOrder)
    .set({
      status: "awaiting_tech_evaluation",
      canceledAt: null,
      closedAt: null,
    })
    .where(
      and(
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.member),
      ),
    )
    .returning();

  if (!updated) return null;

  await recordServiceOrderEvent({
    organizationId: updated.organizationId,
    unitId: updated.unitId,
    serviceOrderId: input.serviceOrderId,
    actorType: "lab_user",
    actorId: input.actorUserId,
    eventType: "service_order.reopened",
    metadata: { reason: input.values.reason },
  });

  return updated;
}
