import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  asset,
  customer,
  serviceOrder,
  serviceOrderAssetSnapshot,
  serviceOrderEventLog,
  serviceOrderSettings,
} from "@calibra-facil/db/schema";
import { isServiceOrderStatus } from "@calibra-facil/shared";
import {
  SERVICE_ORDER_MACHINE,
  canSetServiceOrderStatus,
} from "@calibra-facil/schemas/machines";
import type {
  CreateServiceOrderSchema,
  UpdateServiceOrderSchema,
  UpdateServiceOrderSettingsSchema,
} from "@calibra-facil/schemas";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { OrgContext } from "../../lib/org-context";
import { orgDb } from "../../lib/org-db";
import {
  createInitialServiceOrderRecords,
  createBillingDocumentFromServiceOrder,
  getOrCreateServiceOrderSettings,
  recordServiceOrderEvent,
} from "../../lib/service-order-workflow";
import { buildUnitScopeCondition } from "../../lib/units";
import {
  isAssignableTechnician,
  serviceOrderBelongsToOrganization,
} from "../../lib/tenant-refs";
import { conflict, invalid } from "../../lib/domain-errors";
import { requireScopedServiceOrder } from "./service-order.queries";
import {
  serviceOrderInvalidTransition,
  serviceOrderNotFound,
  serviceOrderSourceRefused,
  serviceOrderTechnicianRefused,
} from "./service-order-errors";
import type { ServiceOrderScope } from "./service-order-scope";
import { enqueueServiceOrderEmail } from "./email-outbox-payloads";
import type { NovaOsOutboxPayload } from "./email-outbox-payloads";

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

/**
 * Ids the request body points the OS at — the responsible technician and the
 * source (warranty / repair origin) OS — must belong to the caller's
 * organization. Cross-tenant ids are refused with the same status as unknown
 * ids so the answer is not an existence oracle.
 */
async function requireServiceOrderRefs(
  o: OrgDb,
  params: {
    organizationId: string;
    unitId: number | null;
    responsibleTechnicianId?: string | null;
    sourceServiceOrderId?: number | null;
  },
) {
  if (
    params.responsibleTechnicianId &&
    !(await isAssignableTechnician(
      {
        organizationId: params.organizationId,
        userId: params.responsibleTechnicianId,
        unitId: params.unitId,
      },
      o,
    ))
  ) {
    throw serviceOrderTechnicianRefused();
  }
  if (
    params.sourceServiceOrderId &&
    !(await serviceOrderBelongsToOrganization(
      params.organizationId,
      params.sourceServiceOrderId,
      o,
    ))
  ) {
    throw serviceOrderSourceRefused();
  }
}

/**
 * Opens an order: the lookups, the order with its asset snapshot and creation
 * event, the durable "nova OS" e-mail outbox row (REQ-SOEMAIL-071) and the two
 * document jobs it owes (intake document, tag) commit together.
 */
export async function createServiceOrder(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  values: CreateServiceOrderInput,
) {
  const unitId = scope.activeUnitId ?? scope.accessibleUnitIds[0];
  if (!unitId) throw invalid("unit_not_found", "Nenhuma unidade ativa");

  const [assetRow] = await ctx.o
    .select({
      id: asset.id,
      unitId: asset.unitId,
      customerId: asset.customerId,
      labOrganizationId: customer.labOrganizationId,
    })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .where(eq(asset.id, values.assetId))
    .limit(1);

  if (
    !assetRow ||
    assetRow.customerId !== values.customerId ||
    assetRow.labOrganizationId !== ctx.org ||
    // Unit scope: the OS snapshots the asset's data, so a unit-scoped member
    // must not open one for an asset that lives in a unit they cannot access.
    !scope.accessibleUnitIds.includes(assetRow.unitId)
  ) {
    throw invalid(
      "service_order_invalid_asset",
      "Ativo ou cliente invalido para esta OS",
    );
  }

  await requireServiceOrderRefs(ctx.o, {
    organizationId: ctx.org,
    unitId,
    responsibleTechnicianId: values.responsibleTechnicianId,
    sourceServiceOrderId: values.sourceServiceOrderId,
  });

  const created = await createInitialServiceOrderRecords(
    {
      organizationId: ctx.org,
      unitId,
      customerId: values.customerId,
      assetId: values.assetId,
      userId: ctx.actor.userId,
      assetSnapshot: values.assetSnapshot,
      signatureData: values.signatureData ?? null,
      ipAddress: ctx.actor.ipAddress,
      userAgent: ctx.actor.userAgent ?? null,
      values: {
        clientContactId: values.clientContactId ?? null,
        clientContactSnapshot: values.clientContactSnapshot ?? null,
        intakeType: values.intakeType,
        isExternalService: values.isExternalService ?? false,
        sourceServiceOrderId: values.sourceServiceOrderId ?? null,
        priority: values.priority,
        responsibleTechnicianId: values.responsibleTechnicianId ?? null,
        claimedDefect: values.claimedDefect,
        intakeCondition: values.intakeCondition,
        accessories: values.accessories ?? null,
        removedSealingMarkNumber: values.removedSealingMarkNumber ?? null,
        affixedSealingMarkNumber: values.affixedSealingMarkNumber ?? null,
        inmetroRepairMarkNumber: values.inmetroRepairMarkNumber ?? null,
        invoiceRemittanceNumber: values.invoiceRemittanceNumber ?? null,
        invoiceRemittanceKey: values.invoiceRemittanceKey ?? null,
        invoiceRemittanceIssuedAt: parseDate(values.invoiceRemittanceIssuedAt),
        carrierName: values.carrierName ?? null,
        carrierDocument: values.carrierDocument ?? null,
        thirdPartyName: values.thirdPartyName ?? null,
        thirdPartyDocument: values.thirdPartyDocument ?? null,
        thirdPartyPhone: values.thirdPartyPhone ?? null,
        deliveryMethod: values.deliveryMethod,
        internalNotes: values.internalNotes ?? null,
        clientVisibleNotes: values.clientVisibleNotes ?? null,
        evaluationFeeCents: values.evaluationFeeCents,
        warrantyUntil: parseDate(values.warrantyUntil),
        warrantyTerms: values.warrantyTerms ?? null,
        serviceStartedAt: parseDate(values.serviceStartedAt),
      },
    },
    ctx.o,
  );

  // REQ-SOEMAIL-071: enqueue a durable outbox row for the "nova OS" email.
  // Load customer + asset snapshot data first (both belong to the same org —
  // tenant scope is preserved). Email delivery happens in the worker drain
  // (not in this request path).
  const [customerRow, snapshotRow] = await Promise.all([
    ctx.o
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
    ctx.o
      .select({
        manufacturer: serviceOrderAssetSnapshot.manufacturer,
        model: serviceOrderAssetSnapshot.model,
        serialNumber: serviceOrderAssetSnapshot.serialNumber,
      })
      .from(serviceOrderAssetSnapshot)
      .where(
        and(
          eq(serviceOrderAssetSnapshot.serviceOrderId, created.id),
          eq(serviceOrderAssetSnapshot.organizationId, created.organizationId),
        ),
      )
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

  await enqueueServiceOrderEmail(
    {
      organizationId: created.organizationId,
      unitId: created.unitId,
      serviceOrderId: created.id,
      eventKey: "nova_os",
      targetStatus: created.status ?? "",
      payload: novaOsPayload,
    },
    ctx.o,
  );

  // The jobs render the order this transaction wrote: they are staged with it.
  await ctx.emit({
    type: "SERVICE_ORDER_INTAKE_DOCUMENT",
    serviceOrderId: created.id,
    userId: ctx.actor.userId,
  });
  await ctx.emit({
    type: "SERVICE_ORDER_TAG",
    serviceOrderId: created.id,
    userId: ctx.actor.userId,
  });

  return created;
}

export async function updateServiceOrderSettings(
  ctx: OrgContext,
  values: UpdateServiceOrderSettingsInput,
) {
  await getOrCreateServiceOrderSettings(ctx.org, ctx.o);
  const [updated] = await ctx.o
    .update(serviceOrderSettings)
    .set({
      ...values,
      updatedAt: new Date(),
    })
    .where(eq(serviceOrderSettings.organizationId, ctx.org))
    .returning();

  return updated;
}

/** The laboratory's settings, created with the defaults on first read. */
export async function getServiceOrderSettings(organizationId: string) {
  return orgDb(organizationId).transaction((o) =>
    getOrCreateServiceOrderSettings(organizationId, o),
  );
}

export async function updateServiceOrder(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  values: UpdateServiceOrderInput,
) {
  const [existing] = await ctx.o
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
      ),
    )
    .limit(1);
  if (!existing) throw serviceOrderNotFound();

  await requireServiceOrderRefs(ctx.o, {
    organizationId: ctx.org,
    unitId: existing.unitId,
    responsibleTechnicianId:
      values.responsibleTechnicianId === existing.responsibleTechnicianId
        ? undefined
        : values.responsibleTechnicianId,
    sourceServiceOrderId:
      values.sourceServiceOrderId === existing.sourceServiceOrderId
        ? undefined
        : values.sourceServiceOrderId,
  });

  const statusChange =
    values.status && values.status !== existing.status ? values.status : null;
  if (
    statusChange &&
    !canSetServiceOrderStatus(existing.status, statusChange)
  ) {
    throw serviceOrderInvalidTransition();
  }

  const [updated] = await ctx.o
    .update(serviceOrder)
    .set({
      ...values,
      // Date fields arrive as ISO strings; convert. Presence-guard so a partial
      // PATCH (e.g. only serviceStartedAt) doesn't null the others.
      invoiceRemittanceIssuedAt:
        "invoiceRemittanceIssuedAt" in values
          ? parseDate(values.invoiceRemittanceIssuedAt)
          : existing.invoiceRemittanceIssuedAt,
      warrantyUntil:
        "warrantyUntil" in values
          ? parseDate(values.warrantyUntil)
          : existing.warrantyUntil,
      serviceStartedAt:
        "serviceStartedAt" in values
          ? parseDate(values.serviceStartedAt)
          : existing.serviceStartedAt,
      updatedAt: new Date(),
    })
    // Defense-in-depth (SEC-08): repeat the tenant scope already proven by the
    // SELECT above so the final UPDATE stays org/unit-scoped even if a future
    // refactor drops the guarding read. Reuses the same in-scope member values.
    // A status change is a compare-and-set on the status it was checked from.
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
        statusChange ? eq(serviceOrder.status, existing.status) : undefined,
      ),
    )
    .returning();

  if (!updated) throw serviceOrderInvalidTransition();

  if (statusChange) {
    await recordServiceOrderEvent(
      {
        organizationId: existing.organizationId,
        unitId: existing.unitId,
        serviceOrderId: existing.id,
        actorType: "lab_user",
        actorId: ctx.actor.userId,
        eventType: "service_order.status_changed",
        oldValue: { status: existing.status },
        newValue: { status: values.status },
        ipAddress: ctx.actor.ipAddress,
        userAgent: ctx.actor.userAgent ?? null,
      },
      ctx.o,
    );
  }

  return updated;
}

export async function updateServiceOrderRepairMark(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  values: {
    inmetroRepairMarkNumber?: string | null;
    inmetroRepairMarkIssuedAt?: DateLikeInput;
    inmetroRepairMarkAppliedAt?: DateLikeInput;
    inmetroRepairMarkNotes?: string | null;
  },
) {
  const [updated] = await ctx.o
    .update(serviceOrder)
    .set({
      inmetroRepairMarkNumber: values.inmetroRepairMarkNumber ?? null,
      inmetroRepairMarkIssuedAt: parseDate(values.inmetroRepairMarkIssuedAt),
      inmetroRepairMarkAppliedAt: parseDate(values.inmetroRepairMarkAppliedAt),
      inmetroRepairMarkAppliedByUserId: values.inmetroRepairMarkAppliedAt
        ? ctx.actor.userId
        : null,
      inmetroRepairMarkNotes: values.inmetroRepairMarkNotes ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
      ),
    )
    .returning();

  if (!updated) throw serviceOrderNotFound();

  await recordServiceOrderEvent(
    {
      organizationId: updated.organizationId,
      unitId: updated.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.repair_mark_updated",
      metadata: {
        inmetroRepairMarkNumber: values.inmetroRepairMarkNumber,
      },
    },
    ctx.o,
  );

  return updated;
}

export async function assignServiceOrderTechnician(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  technicianId: string,
) {
  const order = await requireScopedServiceOrder(serviceOrderId, scope, ctx.o);

  if (
    !(await isAssignableTechnician(
      {
        organizationId: ctx.org,
        userId: technicianId,
        unitId: order.unitId,
      },
      ctx.o,
    ))
  ) {
    throw serviceOrderTechnicianRefused();
  }

  const [updated] = await ctx.o
    .update(serviceOrder)
    .set({
      responsibleTechnicianId: technicianId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
      ),
    )
    .returning();

  if (!updated) throw serviceOrderNotFound();

  await recordServiceOrderEvent(
    {
      organizationId: updated.organizationId,
      unitId: updated.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.technician_assigned",
      newValue: { technicianId },
    },
    ctx.o,
  );

  return updated;
}

export async function deliverServiceOrder(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  values: {
    deliveryMethod: ServiceOrderRow["deliveryMethod"];
    deliveredToName: string;
    deliveredToDocument?: string | null;
    deliveryNotes?: string | null;
    inmetroRepairMarkNumber?: string | null;
  },
) {
  // `deliver` in SERVICE_ORDER_MACHINE: only an order ready for pickup is
  // delivered. Re-delivering an already-delivered OS stays a no-op rather than
  // an error.
  const order = await requireScopedServiceOrder(serviceOrderId, scope, ctx.o);
  if (
    order.status !== "delivered" &&
    !SERVICE_ORDER_MACHINE.canTransition(order.status, "deliver")
  ) {
    throw serviceOrderInvalidTransition();
  }

  const [updated] = await ctx.o
    .update(serviceOrder)
    .set({
      status: "delivered",
      deliveredAt: new Date(),
      deliveryMethod: values.deliveryMethod,
      deliveredToName: values.deliveredToName,
      deliveredToDocument: values.deliveredToDocument ?? null,
      deliveryNotes: values.deliveryNotes ?? null,
      inmetroRepairMarkNumber: values.inmetroRepairMarkNumber ?? undefined,
    })
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
        eq(serviceOrder.status, order.status),
      ),
    )
    .returning();

  if (!updated) throw serviceOrderInvalidTransition();

  await recordServiceOrderEvent(
    {
      organizationId: updated.organizationId,
      unitId: updated.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.delivered",
      metadata: { deliveredToName: values.deliveredToName },
    },
    ctx.o,
  );

  return updated;
}

export async function closeServiceOrder(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  values: {
    closingReason: ServiceOrderRow["closingReason"];
    notes?: string | null;
    createBillingDocument?: boolean;
    dueDate?: DateLikeInput;
  },
) {
  const order = await requireScopedServiceOrder(serviceOrderId, scope, ctx.o);
  // A repeat close (retry, double submit) is a no-op, NOT a second closure
  // event. Writing one would record oldValue.status === "closed", and reopen
  // reads the newest closure event — so the order would "reopen" to closed
  // instead of the status it actually held before.
  if (order.status === "closed") return order;
  if (!SERVICE_ORDER_MACHINE.canTransition(order.status, "close")) {
    throw serviceOrderInvalidTransition();
  }

  const [updated] = await ctx.o
    .update(serviceOrder)
    .set({
      status: "closed",
      closedAt: new Date(),
      closingReason: values.closingReason,
      internalNotes: values.notes ?? undefined,
    })
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        // Was missing here while deliver/cancel had it: without the unit scope
        // a member scoped to one unit could close another unit's OS.
        buildUnitScopeCondition(serviceOrder.unitId, scope),
        eq(serviceOrder.status, order.status),
      ),
    )
    .returning();

  if (!updated) throw serviceOrderInvalidTransition();

  // The billing document and the closure event follow the status change in the
  // same transaction: a billing failure now rolls the close back instead of
  // leaving a closed order that no retry would bill (a repeat close is a no-op).
  if (values.createBillingDocument) {
    await createBillingDocumentFromServiceOrder(ctx, {
      serviceOrderId,
      dueDate: parseDate(values.dueDate) ?? undefined,
    });
  }

  await recordServiceOrderEvent(
    {
      organizationId: updated.organizationId,
      unitId: updated.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.closed",
      metadata: { closingReason: values.closingReason },
      // The status the order is leaving. "Reabrir OS" reads this back so a
      // mis-click can be undone to where the order actually was, instead of
      // restarting the whole funnel.
      oldValue: { status: order.status },
      newValue: { status: "closed" },
    },
    ctx.o,
  );

  return updated;
}

export async function cancelServiceOrder(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  values: { reason: string },
) {
  const order = await requireScopedServiceOrder(serviceOrderId, scope, ctx.o);
  // Same as close: a repeated cancel must not overwrite the remembered
  // pre-cancellation status with "canceled".
  if (order.status === "canceled") return order;
  if (!SERVICE_ORDER_MACHINE.canTransition(order.status, "cancel")) {
    throw serviceOrderInvalidTransition();
  }

  const [updated] = await ctx.o
    .update(serviceOrder)
    .set({
      status: "canceled",
      canceledAt: new Date(),
      cancelReason: values.reason,
    })
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
        eq(serviceOrder.status, order.status),
      ),
    )
    .returning();

  if (!updated) throw serviceOrderInvalidTransition();

  await recordServiceOrderEvent(
    {
      organizationId: updated.organizationId,
      unitId: updated.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.canceled",
      metadata: { reason: values.reason },
      oldValue: { status: order.status },
      newValue: { status: "canceled" },
    },
    ctx.o,
  );

  return updated;
}

/**
 * The status an order was in when it was closed or canceled, read back from the
 * event log rather than a column: `recordServiceOrderEvent` already writes
 * oldValue for exactly this kind of question, and the log is the audit trail a
 * reopen has to answer to anyway.
 *
 * Returns null for orders closed before that value was recorded, or when the
 * remembered status is no longer one the app knows.
 */
async function readStatusBeforeClose(
  o: OrgDb,
  serviceOrderId: number,
  organizationId: string,
) {
  const [lastClosure] = await o
    .select({ oldValue: serviceOrderEventLog.oldValue })
    .from(serviceOrderEventLog)
    .where(
      and(
        eq(serviceOrderEventLog.serviceOrderId, serviceOrderId),
        eq(serviceOrderEventLog.organizationId, organizationId),
        inArray(serviceOrderEventLog.eventType, [
          "service_order.closed",
          "service_order.canceled",
        ]),
      ),
    )
    .orderBy(desc(serviceOrderEventLog.createdAt))
    .limit(1);

  const recorded = lastClosure?.oldValue;
  if (typeof recorded !== "object" || recorded === null) return null;

  const status = Reflect.get(recorded, "status");
  return isServiceOrderStatus(status) ? status : null;
}

export async function reopenServiceOrder(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  values: { reason: string },
) {
  const order = await requireScopedServiceOrder(serviceOrderId, scope, ctx.o);
  // Reopening only makes sense for an order that is actually finished. Without
  // this the endpoint reset ANY order — including one mid-repair — back to
  // awaiting_tech_evaluation.
  if (!SERVICE_ORDER_MACHINE.canTransition(order.status, "reopen")) {
    throw conflict(
      "status_transition_conflict",
      "Apenas uma OS encerrada ou cancelada pode ser reaberta",
    );
  }

  // Back to where it was; awaiting_tech_evaluation when nothing was recorded
  // (orders closed before this was tracked) or the recorded stage is not one
  // `reopen` returns to from here.
  const remembered = await readStatusBeforeClose(
    ctx.o,
    serviceOrderId,
    order.organizationId,
  );
  const restoredStatus =
    remembered &&
    SERVICE_ORDER_MACHINE.canTransition(order.status, "reopen", remembered)
      ? remembered
      : "awaiting_tech_evaluation";

  const [updated] = await ctx.o
    .update(serviceOrder)
    .set({
      status: restoredStatus,
      canceledAt: null,
      closedAt: null,
    })
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
        eq(serviceOrder.status, order.status),
      ),
    )
    .returning();

  // The compare-and-set lost: the order left the status it was checked from.
  if (!updated) {
    throw conflict(
      "status_transition_conflict",
      "Apenas uma OS encerrada ou cancelada pode ser reaberta",
    );
  }

  await recordServiceOrderEvent(
    {
      organizationId: updated.organizationId,
      unitId: updated.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.reopened",
      metadata: { reason: values.reason },
      oldValue: { status: order.status },
      newValue: { status: restoredStatus },
    },
    ctx.o,
  );

  return updated;
}
