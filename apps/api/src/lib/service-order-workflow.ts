import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  billingDocument,
  billingDocumentItem,
  customer,
  financialAuditLog,
  receivableInstallment,
  serviceOrder,
  serviceOrderAssetSnapshot,
  serviceOrderEventLog,
  serviceOrderExecutionItem,
  serviceOrderPublicAccessToken,
  serviceOrderQuote,
  serviceOrderQuoteItem,
  serviceOrderSettings,
} from "@calibra-facil/db/schema";
import type {
  ServiceOrderActorType,
  ServiceOrderEventType,
  ServiceOrderItemType,
} from "@calibra-facil/shared";
import { DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS } from "@calibra-facil/shared";
import { formatSpecificationsForDisplay } from "@calibra-facil/shared";
import { and, eq } from "drizzle-orm";
import {
  DEFAULT_SERVICE_ORDER_NUMBERING_SETTINGS,
  generateServiceOrderNumber,
} from "./service-order-numbering";
import { calculateFinancialDueDate } from "@calibra-facil/shared";
import { generateBillingDocumentNumber } from "./finance";

type ServiceOrderDbExecutor = Pick<
  typeof db,
  "insert" | "select" | "update" | "delete"
>;

export type ServiceOrderEventInput = {
  actorId?: string | null;
  actorType: ServiceOrderActorType;
  eventType: ServiceOrderEventType;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  oldValue?: Record<string, unknown>;
  serviceOrderId: number;
  organizationId: string;
  unitId: number;
  userAgent?: string | null;
};

function toHex(bytes: Uint8Array) {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashServiceOrderToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(digest));
}

export function createServiceOrderPublicToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function calculatePricedItems<
  T extends {
    quantity: number;
    unitPriceCents: number;
    type: ServiceOrderItemType;
  },
>(items: T[]) {
  const normalized = items.map((item, index) => {
    const totalPriceCents = Math.round(item.quantity * item.unitPriceCents);
    return { ...item, totalPriceCents, sortOrder: index };
  });

  const subtotalServicesCents = normalized
    .filter((item) =>
      ["service", "external_service", "other", "evaluation_fee"].includes(
        item.type,
      ),
    )
    .reduce((sum, item) => sum + Math.max(item.totalPriceCents, 0), 0);
  const subtotalPartsCents = normalized
    .filter((item) => item.type === "part")
    .reduce((sum, item) => sum + Math.max(item.totalPriceCents, 0), 0);
  const freightCents = normalized
    .filter((item) => item.type === "freight")
    .reduce((sum, item) => sum + Math.max(item.totalPriceCents, 0), 0);
  const discountCents = Math.abs(
    normalized
      .filter((item) => item.type === "discount")
      .reduce((sum, item) => sum + item.totalPriceCents, 0),
  );
  const totalCents = Math.max(
    normalized.reduce((sum, item) => sum + item.totalPriceCents, 0),
    0,
  );

  return {
    discountCents,
    freightCents,
    items: normalized,
    subtotalPartsCents,
    subtotalServicesCents,
    totalCents,
  };
}

export async function recordServiceOrderEvent(
  event: ServiceOrderEventInput,
  executor: ServiceOrderDbExecutor = db,
) {
  await executor.insert(serviceOrderEventLog).values({
    organizationId: event.organizationId,
    unitId: event.unitId,
    serviceOrderId: event.serviceOrderId,
    actorType: event.actorType,
    actorId: event.actorId ?? null,
    eventType: event.eventType,
    oldValue: event.oldValue ?? null,
    newValue: event.newValue ?? null,
    metadata: event.metadata ?? null,
    ipAddress: event.ipAddress ?? null,
    userAgent: event.userAgent ?? null,
  });
}

export async function getOrCreateServiceOrderSettings(
  organizationId: string,
  executor: ServiceOrderDbExecutor = db,
) {
  const [existing] = await executor
    .select()
    .from(serviceOrderSettings)
    .where(eq(serviceOrderSettings.organizationId, organizationId))
    .limit(1);

  if (existing) return existing;

  const [created] = await executor
    .insert(serviceOrderSettings)
    .values({
      organizationId,
      ...DEFAULT_SERVICE_ORDER_NUMBERING_SETTINGS,
    })
    .onConflictDoNothing({ target: serviceOrderSettings.organizationId })
    .returning();

  if (created) return created;

  const [concurrent] = await executor
    .select()
    .from(serviceOrderSettings)
    .where(eq(serviceOrderSettings.organizationId, organizationId))
    .limit(1);

  if (!concurrent) throw new Error("Falha ao carregar configuracoes de OS");
  return concurrent;
}

export async function buildServiceOrderAssetSnapshot(
  params: {
    assetId: number;
    organizationId: string;
    observedIdentification?: string | null;
    photos?: string[];
  },
  executor: ServiceOrderDbExecutor = db,
) {
  const [row] = await executor
    .select({
      id: asset.id,
      name: asset.name,
      manufacturer: asset.manufacturer,
      model: asset.model,
      serialNumber: asset.serialNumber,
      tag: asset.tag,
      specifications: asset.specifications,
      assetTypeName: assetType.name,
      assetTypeDefinition: assetType.definition,
      customerLabOrganizationId: customer.labOrganizationId,
    })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .leftJoin(assetType, eq(asset.assetTypeId, assetType.id))
    .where(
      and(
        eq(asset.id, params.assetId),
        eq(customer.labOrganizationId, params.organizationId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new Error("Ativo nao encontrado");
  }

  const specifications = row.specifications ?? {};
  const getSpec = (keys: string[]) => {
    for (const key of keys) {
      const value = specifications[key];
      if (value !== null && value !== undefined && value !== "") {
        return String(value);
      }
    }
    return null;
  };

  return {
    assetId: row.id,
    assetName: row.name,
    assetType: row.assetTypeName,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serialNumber,
    patrimonyNumber: row.tag,
    capacity: getSpec(["capacity", "capacidade"]),
    resolution: getSpec(["resolution", "resolucao"]),
    inventoryCode: row.tag,
    clientAssetCode: getSpec(["clientAssetCode", "codigoCliente"]),
    observedIdentification: params.observedIdentification ?? null,
    photos: params.photos ?? [],
    specifications,
    // Freeze the blueprint-driven, printable spec list at intake (ISO: the snapshot
    // captures how the instrument was presented). The printed OS renders this verbatim.
    displaySpecs: formatSpecificationsForDisplay(
      row.assetTypeDefinition,
      specifications,
    ),
  };
}

export async function createInitialServiceOrderRecords(
  params: {
    assetId: number;
    customerId: number;
    organizationId: string;
    unitId: number;
    userId: string;
    values: Omit<
      typeof serviceOrder.$inferInsert,
      | "organizationId"
      | "unitId"
      | "serviceOrderNumber"
      | "customerId"
      | "assetId"
      | "openedByUserId"
    >;
    assetSnapshot?: {
      observedIdentification?: string | null;
      photos?: string[];
    };
    signatureData?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
  executor?: ServiceOrderDbExecutor,
) {
  const run = async (tx: ServiceOrderDbExecutor) => {
    const generatedAt = new Date();
    const identity = await generateServiceOrderNumber(
      {
        organizationId: params.organizationId,
        unitId: params.unitId,
        generatedAt,
      },
      tx,
    );
    const snapshot = await buildServiceOrderAssetSnapshot(
      {
        assetId: params.assetId,
        organizationId: params.organizationId,
        observedIdentification:
          params.assetSnapshot?.observedIdentification ?? null,
        photos: params.assetSnapshot?.photos ?? [],
      },
      tx,
    );

    const [created] = await tx
      .insert(serviceOrder)
      .values({
        ...params.values,
        organizationId: params.organizationId,
        unitId: params.unitId,
        serviceOrderNumber: identity.number,
        customerId: params.customerId,
        assetId: params.assetId,
        openedByUserId: params.userId,
        status:
          params.values.intakeType === "warranty_return"
            ? "warranty_return"
            : "awaiting_tech_evaluation",
        openedAt: generatedAt,
      })
      .returning();

    if (!created) throw new Error("Falha ao criar OS");

    await tx.insert(serviceOrderAssetSnapshot).values({
      serviceOrderId: created.id,
      ...snapshot,
    });

    await recordServiceOrderEvent(
      {
        organizationId: params.organizationId,
        unitId: params.unitId,
        serviceOrderId: created.id,
        actorType: "lab_user",
        actorId: params.userId,
        eventType: "service_order.created",
        newValue: {
          status: created.status,
          serviceOrderNumber: identity.number,
        },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
      tx,
    );

    return created;
  };

  return executor ? run(executor) : db.transaction(run);
}

export async function createPublicServiceOrderAccessToken(params: {
  organizationId: string;
  serviceOrderId: number;
  quoteId?: number | null;
  expiresAt?: Date | null;
}) {
  const token = createServiceOrderPublicToken();
  const tokenHash = await hashServiceOrderToken(token);
  await db.insert(serviceOrderPublicAccessToken).values({
    organizationId: params.organizationId,
    serviceOrderId: params.serviceOrderId,
    quoteId: params.quoteId ?? null,
    tokenHash,
    scope: params.quoteId ? "quote" : "service_order",
    expiresAt: params.expiresAt ?? null,
  });
  return { token, tokenHash };
}

export async function replaceQuoteItems(
  params: {
    quoteId: number;
    items: Array<{
      description: string;
      notes?: string | null;
      quantity: number;
      taxable?: boolean;
      type: ServiceOrderItemType;
      unit: string;
      unitPriceCents: number;
      warrantyCovered?: boolean;
      warrantyTerms?: string | null;
      warrantyUntil?: Date | null;
    }>;
  },
  executor: ServiceOrderDbExecutor = db,
) {
  const calculated = calculatePricedItems(params.items);
  await executor
    .delete(serviceOrderQuoteItem)
    .where(eq(serviceOrderQuoteItem.quoteId, params.quoteId));
  if (calculated.items.length > 0) {
    await executor.insert(serviceOrderQuoteItem).values(
      calculated.items.map((item) => ({
        quoteId: params.quoteId,
        type: item.type,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPriceCents: item.unitPriceCents,
        totalPriceCents: item.totalPriceCents,
        taxable: item.taxable ?? true,
        warrantyCovered: item.warrantyCovered ?? false,
        warrantyTerms: item.warrantyTerms ?? null,
        warrantyUntil: item.warrantyUntil ?? null,
        notes: item.notes ?? null,
        sortOrder: item.sortOrder,
      })),
    );
  }
  return calculated;
}

export async function replaceExecutionItems(
  params: {
    executionId: number;
    items: Array<{
      description: string;
      quantity: number;
      quoteItemId?: number | null;
      technicianId?: string | null;
      type: ServiceOrderItemType;
      unit: string;
      unitCostCents?: number;
      unitPriceCents: number;
    }>;
  },
  executor: ServiceOrderDbExecutor = db,
) {
  const calculated = calculatePricedItems(params.items);
  await executor
    .delete(serviceOrderExecutionItem)
    .where(eq(serviceOrderExecutionItem.executionId, params.executionId));
  if (calculated.items.length > 0) {
    await executor.insert(serviceOrderExecutionItem).values(
      calculated.items.map((item) => ({
        executionId: params.executionId,
        quoteItemId: item.quoteItemId ?? null,
        type: item.type,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitCostCents: item.unitCostCents ?? 0,
        unitPriceCents: item.unitPriceCents,
        totalPriceCents: item.totalPriceCents,
        technicianId: item.technicianId ?? null,
        sortOrder: item.sortOrder,
      })),
    );
  }
  return calculated;
}

export async function createBillingDocumentFromServiceOrder(params: {
  actorUserId: string;
  dueDate?: Date;
  organizationId: string;
  serviceOrderId: number;
}) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(serviceOrder)
      .where(
        and(
          eq(serviceOrder.id, params.serviceOrderId),
          eq(serviceOrder.organizationId, params.organizationId),
        ),
      )
      .limit(1);

    if (!order) throw new Error("OS nao encontrada");
    if (order.billingDocumentId) return order.billingDocumentId;

    const [approvedQuote] = await tx
      .select()
      .from(serviceOrderQuote)
      .where(
        and(
          eq(serviceOrderQuote.serviceOrderId, order.id),
          eq(serviceOrderQuote.status, "approved"),
        ),
      )
      .limit(1);

    const quoteItems = approvedQuote
      ? await tx
          .select()
          .from(serviceOrderQuoteItem)
          .where(eq(serviceOrderQuoteItem.quoteId, approvedQuote.id))
      : [];

    const subtotalCents =
      approvedQuote?.totalCents ??
      (order.evaluationFeeApplied ? order.evaluationFeeCents : 0);
    const dueDate =
      params.dueDate ??
      calculateFinancialDueDate(
        new Date(),
        DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
      );

    const [document] = await tx
      .insert(billingDocument)
      .values({
        organizationId: order.organizationId,
        customerId: order.customerId,
        unitId: order.unitId,
        dueDate,
        currency: "BRL",
        subtotalCents,
        discountCents: 0,
        totalCents: subtotalCents,
        notes: `Documento financeiro gerado a partir da OS ${order.serviceOrderNumber}`,
        createdBy: params.actorUserId,
        updatedBy: params.actorUserId,
      })
      .returning();

    if (!document) throw new Error("Falha ao criar documento financeiro");

    const documentNumber = await generateBillingDocumentNumber(
      order.organizationId,
      tx,
    );

    await tx
      .update(billingDocument)
      .set({ documentNumber })
      .where(eq(billingDocument.id, document.id));

    const billingItems =
      quoteItems.length > 0
        ? quoteItems.map((item, index) => ({
            documentId: document.id,
            serviceOrderId: order.id,
            description: item.description,
            quantity: Math.max(Math.round(item.quantity), 1),
            unitPriceCents: item.unitPriceCents,
            totalCents: item.totalPriceCents,
            sortOrder: index,
          }))
        : [
            {
              documentId: document.id,
              serviceOrderId: order.id,
              description: `Taxa de avaliacao - ${order.serviceOrderNumber}`,
              quantity: 1,
              unitPriceCents: order.evaluationFeeCents,
              totalCents: order.evaluationFeeCents,
              sortOrder: 0,
            },
          ];

    await tx.insert(billingDocumentItem).values(billingItems);
    await tx.insert(receivableInstallment).values({
      documentId: document.id,
      installmentNumber: 1,
      dueDate,
      amountCents: subtotalCents,
      currency: "BRL",
    });
    await tx.insert(financialAuditLog).values({
      organizationId: order.organizationId,
      entityType: "document",
      entityId: String(document.id),
      action: "create_from_service_order",
      changes: {
        serviceOrderId: order.id,
        serviceOrderNumber: order.serviceOrderNumber,
      },
      performedBy: params.actorUserId,
    });
    await tx
      .update(serviceOrder)
      .set({ billingDocumentId: document.id })
      .where(eq(serviceOrder.id, order.id));

    return document.id;
  });
}
