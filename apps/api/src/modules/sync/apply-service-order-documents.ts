import {
  serviceOrder,
  serviceOrderDeliveryDocument,
  serviceOrderExecution,
  serviceOrderQuote,
} from "@calibra-facil/db/schema";
import {
  CreateServiceOrderQuoteSchema,
  IssueServiceOrderDeliveryDocumentSchema,
} from "@calibra-facil/schemas";
import { and, desc, eq } from "drizzle-orm";
import { buildUnitScopeCondition } from "../../lib/units";
import { asRecord } from "./helpers";
import {
  recordServiceOrderEvent,
  replaceExecutionItems,
  replaceQuoteItems,
} from "../../lib/service-order-workflow";
import {
  type ApplyDesktopSyncEventInput,
  type ApplyDesktopSyncEventResult,
  buildStaleDesktopBaseConflict,
  detectStaleDesktopBase,
} from "./desktop-event-support";
import {
  findDesktopSyncRemoteEntityId,
  getRemoteServiceOrderIdFromPayload,
  writeDesktopSyncAudit,
} from "./desktop-sync-support";
import { parseSyncDate } from "./snapshot-parsers";
import { DesktopUpdateServiceOrderExecutionSchema } from "./desktop-schemas";

export async function applyCreateLocalServiceOrderQuoteDraft(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const existingRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
    input.o,
  );
  if (existingRemoteEntityId !== null) {
    return { ok: true, remoteEntityId: existingRemoteEntityId };
  }

  const payload = asRecord(input.event.payload);
  const remoteServiceOrderId = await getRemoteServiceOrderIdFromPayload(
    input,
    payload,
  );
  if (typeof remoteServiceOrderId !== "number") {
    return {
      ok: false,
      code: "REMOTE_ENTITY_MAPPING_MISSING",
      reason: "Desktop service-order quote has no synced cloud OS mapping.",
    };
  }

  const parseResult = CreateServiceOrderQuoteSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop service-order quote event is invalid.",
    };
  }

  const [order] = await input.o
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, remoteServiceOrderId),
        eq(serviceOrder.organizationId, input.memberData.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.memberData),
      ),
    )
    .limit(1);
  if (!order) {
    return {
      ok: false,
      code: "REMOTE_ENTITY_NOT_FOUND",
      reason: "Cloud service order for desktop quote was not found.",
    };
  }

  const values = parseResult.data;
  const [latest] = await input.o
    .select({ version: serviceOrderQuote.version })
    .from(serviceOrderQuote)
    .where(eq(serviceOrderQuote.serviceOrderId, order.id))
    .orderBy(desc(serviceOrderQuote.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  // Written on the event's transaction (`input.o`): one atomic unit with the
  // claim and the audit of the event.
  const [created] = await input.o
    .insert(serviceOrderQuote)
    .values({
      organizationId: order.organizationId,
      serviceOrderId: order.id,
      quoteNumber: `${order.serviceOrderNumber}/ORC`,
      version,
      validUntil: parseSyncDate(values.validUntil),
      paymentTerms: values.paymentTerms ?? null,
      deliveryEstimate: values.deliveryEstimate ?? null,
      warrantyTerms: values.warrantyTerms ?? null,
      clientMessage: values.clientMessage ?? null,
      internalNotes: values.internalNotes ?? null,
      createdByUserId: actorUserId,
    })
    .returning();
  if (!created) throw new Error("Falha ao criar orcamento");

  const totals = await replaceQuoteItems(
    {
      organizationId: order.organizationId,
      quoteId: created.id,
      items: values.items.map((item) => ({
        ...item,
        warrantyUntil: parseSyncDate(item.warrantyUntil),
      })),
    },
    input.o,
  );
  await input.o
    .update(serviceOrderQuote)
    .set({
      subtotalServicesCents: totals.subtotalServicesCents,
      subtotalPartsCents: totals.subtotalPartsCents,
      discountCents: totals.discountCents,
      freightCents: totals.freightCents,
      totalCents: totals.totalCents,
    })
    .where(
      and(
        eq(serviceOrderQuote.id, created.id),
        eq(serviceOrderQuote.organizationId, order.organizationId),
      ),
    );
  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId: order.id,
      actorType: "lab_user",
      actorId: actorUserId,
      eventType: "service_order.quote_created",
      metadata: {
        quoteId: created.id,
        version,
        source: "desktop_sync",
      },
    },
    input.o,
  );

  const quote = { ...created, ...totals };

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: quote.id,
    remoteServiceOrderId: order.id,
    remoteQuoteNumber: quote.quoteNumber,
  });

  return {
    ok: true,
    remoteEntityId: quote.id,
    remoteEntity: {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      version: quote.version,
      status: quote.status,
      totalCents: quote.totalCents,
    },
  };
}

export async function applyLocalServiceOrderExecutionNotes(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const payload = asRecord(input.event.payload);
  const remoteServiceOrderId = await getRemoteServiceOrderIdFromPayload(
    input,
    payload,
  );
  if (typeof remoteServiceOrderId !== "number") {
    return {
      ok: false,
      code: "REMOTE_ENTITY_MAPPING_MISSING",
      reason: "Desktop service-order execution has no synced cloud OS mapping.",
    };
  }

  const parseResult =
    DesktopUpdateServiceOrderExecutionSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop service-order execution event is invalid.",
    };
  }

  const [order] = await input.o
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, remoteServiceOrderId),
        eq(serviceOrder.organizationId, input.memberData.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.memberData),
      ),
    )
    .limit(1);
  if (!order) {
    return {
      ok: false,
      code: "REMOTE_ENTITY_NOT_FOUND",
      reason: "Cloud service order for desktop execution was not found.",
    };
  }

  // REL-01 slice 2: refuse to blind-overwrite an execution row that advanced
  // since the desktop pulled its base (REQ-REL-SYNC-201). When no execution row
  // exists yet there is nothing to diverge from (this apply creates it). The
  // base is anchored to the `service_order_executions` row; legacy/null base
  // applies as today (REQ-REL-SYNC-203), equal/unchanged applies
  // (REQ-REL-SYNC-202). Checked before the write transaction so a conflict
  // leaves the row byte-unchanged.
  const [existingExecution] = await input.o
    .select({
      id: serviceOrderExecution.id,
      updatedAt: serviceOrderExecution.updatedAt,
      servicePerformed: serviceOrderExecution.servicePerformed,
      partsUsedSummary: serviceOrderExecution.partsUsedSummary,
      technicalNotes: serviceOrderExecution.technicalNotes,
      calibrationRequiredAfterRepair:
        serviceOrderExecution.calibrationRequiredAfterRepair,
      result: serviceOrderExecution.result,
    })
    .from(serviceOrderExecution)
    .where(eq(serviceOrderExecution.serviceOrderId, order.id))
    .limit(1);
  if (existingExecution) {
    const executionStaleBase = detectStaleDesktopBase({
      baseUpdatedAt: input.event.baseUpdatedAt,
      serverUpdatedAt: existingExecution.updatedAt,
    });
    if (executionStaleBase.diverged) {
      return buildStaleDesktopBaseConflict({
        entity: "service_order_execution",
        id: existingExecution.id,
        serverUpdatedAtIso: executionStaleBase.serverUpdatedAtIso,
        baseUpdatedAt: executionStaleBase.baseUpdatedAt,
        remoteFields: {
          servicePerformed: existingExecution.servicePerformed,
          partsUsedSummary: existingExecution.partsUsedSummary,
          technicalNotes: existingExecution.technicalNotes,
          calibrationRequiredAfterRepair:
            existingExecution.calibrationRequiredAfterRepair,
          result: existingExecution.result,
        },
      });
    }
  }

  const values = parseResult.data;
  // Written on the event's transaction (`input.o`).
  const [existing] = await input.o
    .select()
    .from(serviceOrderExecution)
    .where(
      and(
        eq(serviceOrderExecution.serviceOrderId, order.id),
        eq(serviceOrderExecution.organizationId, order.organizationId),
      ),
    )
    .limit(1);
  const [current] =
    existing !== undefined
      ? [existing]
      : await input.o
          .insert(serviceOrderExecution)
          .values({
            organizationId: order.organizationId,
            serviceOrderId: order.id,
            startedByUserId: actorUserId,
            technicalNotes: values.technicalNotes ?? null,
          })
          .returning();
  if (!current) throw new Error("Falha ao criar execucao");

  if (values.items) {
    await replaceExecutionItems(
      {
        organizationId: order.organizationId,
        executionId: current.id,
        items: values.items.map((item) => ({
          ...item,
          warrantyUntil: parseSyncDate(item.warrantyUntil),
        })),
      },
      input.o,
    );
  }

  const [updated] = await input.o
    .update(serviceOrderExecution)
    .set({
      servicePerformed: values.servicePerformed,
      partsUsedSummary: values.partsUsedSummary,
      technicalNotes: values.technicalNotes,
      calibrationRequiredAfterRepair: values.calibrationRequiredAfterRepair,
      result: values.result,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(serviceOrderExecution.id, current.id),
        eq(serviceOrderExecution.organizationId, order.organizationId),
      ),
    )
    .returning();
  await input.o
    .update(serviceOrder)
    .set({
      status: "repair_in_progress",
      repairStartedAt: order.repairStartedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(serviceOrder.id, order.id));
  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId: order.id,
      actorType: "lab_user",
      actorId: actorUserId,
      eventType: "service_order.repair_started",
      metadata: { source: "desktop_sync", executionId: current.id },
    },
    input.o,
  );

  const execution = updated ?? current;

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: execution.id,
    remoteServiceOrderId: order.id,
  });

  return {
    ok: true,
    remoteEntityId: execution.id,
    remoteEntity: {
      id: execution.id,
      status: "repair_in_progress",
      serviceOrderId: order.id,
      startedAt: execution.startedAt?.toISOString?.() ?? execution.startedAt,
      updatedAt: execution.updatedAt?.toISOString?.() ?? execution.updatedAt,
    },
  };
}

export async function applyCreateLocalServiceOrderDeliveryDocumentDraft(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const existingRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
    input.o,
  );
  if (existingRemoteEntityId !== null) {
    return { ok: true, remoteEntityId: existingRemoteEntityId };
  }

  const payload = asRecord(input.event.payload);
  const remoteServiceOrderId = await getRemoteServiceOrderIdFromPayload(
    input,
    payload,
  );
  if (typeof remoteServiceOrderId !== "number") {
    return {
      ok: false,
      code: "REMOTE_ENTITY_MAPPING_MISSING",
      reason:
        "Desktop service-order delivery document has no synced cloud OS mapping.",
    };
  }

  const parseResult =
    IssueServiceOrderDeliveryDocumentSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop service-order delivery document event is invalid.",
    };
  }

  const [order] = await input.o
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, remoteServiceOrderId),
        eq(serviceOrder.organizationId, input.memberData.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.memberData),
      ),
    )
    .limit(1);
  if (!order) {
    return {
      ok: false,
      code: "REMOTE_ENTITY_NOT_FOUND",
      reason:
        "Cloud service order for desktop delivery document was not found.",
    };
  }

  const values = parseResult.data;
  const [latest] = await input.o
    .select({ version: serviceOrderDeliveryDocument.version })
    .from(serviceOrderDeliveryDocument)
    .where(eq(serviceOrderDeliveryDocument.serviceOrderId, order.id))
    .orderBy(desc(serviceOrderDeliveryDocument.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  const [document] = await input.o
    .insert(serviceOrderDeliveryDocument)
    .values({
      organizationId: order.organizationId,
      serviceOrderId: order.id,
      documentNumber: `${order.serviceOrderNumber}/ENT`,
      version,
      issuedAt: new Date(),
      issuedByUserId: actorUserId,
      technicianSignatureData: values.technicianSignatureData ?? null,
      clientSignatureData: values.clientSignatureData ?? null,
    })
    .returning();
  if (!document) throw new Error("Falha ao criar documento de entrega");

  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId: order.id,
      actorType: "lab_user",
      actorId: actorUserId,
      eventType: "service_order.delivery_document_issued",
      metadata: {
        source: "desktop_sync",
        deliveryDocumentId: document.id,
        version,
      },
    },
    input.o,
  );
  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: document.id,
    remoteServiceOrderId: order.id,
    remoteDocumentNumber: document.documentNumber,
  });

  return {
    ok: true,
    remoteEntityId: document.id,
    remoteEntity: {
      id: document.id,
      documentNumber: document.documentNumber,
      version: document.version,
      issuedAt: document.issuedAt?.toISOString?.() ?? document.issuedAt,
    },
  };
}
