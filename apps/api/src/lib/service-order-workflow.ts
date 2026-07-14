import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  billingDocument,
  billingDocumentItem,
  customer,
  financialAuditLog,
  material,
  receivableInstallment,
  serviceOrder,
  serviceOrderAssetSnapshot,
  serviceOrderEmailOutbox,
  serviceOrderEventLog,
  serviceOrderExecutionItem,
  serviceOrderPublicAccessToken,
  serviceOrderQuote,
  serviceOrderQuoteItem,
  serviceOrderSettings,
} from "@calibra-facil/db/schema";
import type { ServiceOrderTokenRevokedReason } from "@calibra-facil/db/schema";
import { getStatusEmailDescriptor } from "../modules/service-orders/status-email-map";
import type {
  ServiceOrderActorType,
  ServiceOrderEventType,
  ServiceOrderItemType,
} from "@calibra-facil/shared";
import { DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS } from "@calibra-facil/shared";
import { formatSpecificationsForDisplay } from "@calibra-facil/shared";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
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
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

// ---------------------------------------------------------------------------
// Approval code (spec quote-approval-public-access, mini-spec B)
// ---------------------------------------------------------------------------

/**
 * REQ-QPUB-010: unambiguous uppercase alphabet — no 0/O, 1/I/L — so a code
 * read from a printed quote or over the phone can't be mistranscribed.
 */
export const APPROVAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const APPROVAL_CODE_LENGTH = 8;

/**
 * Generate an approval code with rejection sampling: only bytes below the
 * largest multiple of the alphabet size (248 = 8 × 31) are accepted, so every
 * character is uniformly likely (no modulo bias).
 */
export function createServiceOrderApprovalCode(): string {
  const limit =
    Math.floor(256 / APPROVAL_CODE_ALPHABET.length) *
    APPROVAL_CODE_ALPHABET.length;
  const chars: string[] = [];
  while (chars.length < APPROVAL_CODE_LENGTH) {
    const bytes = new Uint8Array(APPROVAL_CODE_LENGTH * 2);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      chars.push(
        APPROVAL_CODE_ALPHABET.charAt(byte % APPROVAL_CODE_ALPHABET.length),
      );
      if (chars.length === APPROVAL_CODE_LENGTH) break;
    }
  }
  return chars.join("");
}

/**
 * Uppercase and strip whitespace/hyphens so "k7wm 3p9a" and "K7WM-3P9A"
 * redeem the same code the email carried.
 */
export function normalizeApprovalCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

/**
 * REQ-QPUB-011 [HIGH RISK]: codes are low-entropy by design, so they are
 * stored as HMAC-SHA-256 keyed by a server-side pepper — a database dump
 * alone is not enough to brute-force them offline. Web Crypto keeps this
 * portable across Bun and workers (same style as hashServiceOrderToken).
 */
export async function hashServiceOrderApprovalCode(
  code: string,
  pepper: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(code),
  );
  return toHex(new Uint8Array(signature));
}

/**
 * Pepper for approval-code HMACs. Enforced in production by
 * requiredProductionEnv (runtime-env.ts); the dev fallback keeps local
 * `pnpm dev` working without extra setup. Rotating the pepper orphans all
 * outstanding codes (acceptable — codes die with the decision/expiry anyway).
 */
export function resolveApprovalCodePepper(): string {
  const configured = process.env.QUOTE_APPROVAL_CODE_PEPPER?.trim();
  if (configured) return configured;
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("QUOTE_APPROVAL_CODE_PEPPER is required");
  }
  return "dev-approval-code-pepper";
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Grace window past the quote's validUntil before the access link dies. */
export const PUBLIC_TOKEN_VALIDITY_GRACE_DAYS = 7;
/** Fallback lifetime from send when the quote has no validUntil. */
export const PUBLIC_TOKEN_DEFAULT_TTL_DAYS = 30;

/**
 * REQ-QPUB-001: default expiry for a public quote-access token when the lab
 * supplied none — quote validUntil + 7 days, else sentAt + 30 days.
 */
export function computeDefaultPublicTokenExpiry(params: {
  validUntil: Date | null;
  sentAt: Date;
}): Date {
  if (params.validUntil) {
    return new Date(
      params.validUntil.getTime() + PUBLIC_TOKEN_VALIDITY_GRACE_DAYS * DAY_MS,
    );
  }
  return new Date(
    params.sentAt.getTime() + PUBLIC_TOKEN_DEFAULT_TTL_DAYS * DAY_MS,
  );
}

/**
 * REQ-QPUB-003 [HIGH RISK]: once a quote is approved or rejected (by ANY
 * path), every public access token pointing at it stops granting access.
 * Runs inside the caller's decision transaction. The organizationId predicate
 * is defense-in-depth on top of the callers' org-scoped lookups.
 */
export async function revokeActiveTokensForQuote(
  executor: ServiceOrderDbExecutor,
  params: {
    organizationId: string;
    quoteId: number;
    reason: ServiceOrderTokenRevokedReason;
  },
): Promise<void> {
  await executor
    .update(serviceOrderPublicAccessToken)
    .set({ revokedAt: new Date(), revokedReason: params.reason })
    .where(
      and(
        eq(serviceOrderPublicAccessToken.quoteId, params.quoteId),
        eq(serviceOrderPublicAccessToken.organizationId, params.organizationId),
        isNull(serviceOrderPublicAccessToken.revokedAt),
      ),
    );
}

/**
 * REQ-QPUB-004: sending a new quote version kills the live tokens of the
 * service order's earlier quotes. Tokens with a NULL quoteId (pure
 * service_order scope) are not "of an earlier quote" and stay live.
 */
export async function revokeSupersededServiceOrderTokens(
  executor: ServiceOrderDbExecutor,
  params: {
    organizationId: string;
    serviceOrderId: number;
    currentQuoteId: number;
  },
): Promise<void> {
  await executor
    .update(serviceOrderPublicAccessToken)
    .set({ revokedAt: new Date(), revokedReason: "superseded" })
    .where(
      and(
        eq(serviceOrderPublicAccessToken.serviceOrderId, params.serviceOrderId),
        eq(serviceOrderPublicAccessToken.organizationId, params.organizationId),
        isNull(serviceOrderPublicAccessToken.revokedAt),
        isNotNull(serviceOrderPublicAccessToken.quoteId),
        ne(serviceOrderPublicAccessToken.quoteId, params.currentQuoteId),
      ),
    );
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

  // Transactional outbox: if this event represents a status change to a status
  // that triggers a customer email, insert an outbox row using the SAME executor
  // (so a transaction rollback also rolls back the outbox insert — no orphaned
  // emails). The actual email is sent by the worker (mini-spec E2).
  const newStatus =
    event.newValue !== undefined &&
    event.newValue !== null &&
    typeof event.newValue === "object" &&
    "status" in event.newValue &&
    typeof event.newValue.status === "string"
      ? event.newValue.status
      : null;

  const oldStatus =
    event.oldValue !== undefined &&
    event.oldValue !== null &&
    typeof event.oldValue === "object" &&
    "status" in event.oldValue &&
    typeof event.oldValue.status === "string"
      ? event.oldValue.status
      : null;

  // Only enqueue when the status is actually changing and lands on a trigger status.
  if (newStatus !== null && newStatus !== oldStatus) {
    const descriptor = getStatusEmailDescriptor(newStatus);
    if (descriptor !== undefined) {
      await executor
        .insert(serviceOrderEmailOutbox)
        .values({
          organizationId: event.organizationId,
          unitId: event.unitId ?? null,
          serviceOrderId: event.serviceOrderId,
          eventKey: descriptor.eventKey,
          targetStatus: newStatus,
          payload: {
            status: newStatus,
            serviceOrderId: event.serviceOrderId,
            organizationId: event.organizationId,
          } satisfies Record<string, unknown>,
          attempts: 0,
        })
        .onConflictDoNothing({
          target: [
            serviceOrderEmailOutbox.serviceOrderId,
            serviceOrderEmailOutbox.eventKey,
          ],
        });
    }
  }
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
  /**
   * REQ-QPUB-010: also mint a human-typeable approval code on this grant.
   * Only the grant minted at quote send carries a code; redemption-minted
   * sibling tokens and service_order-scoped grants leave codeHash NULL.
   */
  withApprovalCode?: boolean;
}) {
  const token = createServiceOrderPublicToken();
  const tokenHash = await hashServiceOrderToken(token);
  const code = params.withApprovalCode
    ? createServiceOrderApprovalCode()
    : null;
  const codeHash = code
    ? await hashServiceOrderApprovalCode(code, resolveApprovalCodePepper())
    : null;
  await db.insert(serviceOrderPublicAccessToken).values({
    organizationId: params.organizationId,
    serviceOrderId: params.serviceOrderId,
    quoteId: params.quoteId ?? null,
    tokenHash,
    codeHash,
    scope: params.quoteId ? "quote" : "service_order",
    expiresAt: params.expiresAt ?? null,
  });
  return { token, tokenHash, code };
}

/**
 * Tenant boundary for material-catalog references on line items: returns the
 * subset of `materialId`s that actually belong to `organizationId`. Ids that
 * don't (cross-tenant, deleted or garbage) are dropped by the callers so the
 * item degrades to a free-form line instead of storing a foreign reference.
 */
async function resolveValidMaterialIds(
  organizationId: string,
  items: ReadonlyArray<{ materialId?: number | null }>,
  executor: ServiceOrderDbExecutor,
): Promise<Set<number>> {
  const ids = [
    ...new Set(
      items
        .map((item) => item.materialId)
        .filter((value): value is number => typeof value === "number"),
    ),
  ];
  if (ids.length === 0) return new Set();
  const rows = await executor
    .select({ id: material.id })
    .from(material)
    .where(
      and(
        eq(material.organizationId, organizationId),
        inArray(material.id, ids),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

export async function replaceQuoteItems(
  params: {
    organizationId: string;
    quoteId: number;
    items: Array<{
      description: string;
      materialId?: number | null;
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
  const validMaterialIds = await resolveValidMaterialIds(
    params.organizationId,
    params.items,
    executor,
  );
  await executor
    .delete(serviceOrderQuoteItem)
    .where(eq(serviceOrderQuoteItem.quoteId, params.quoteId));
  if (calculated.items.length > 0) {
    await executor.insert(serviceOrderQuoteItem).values(
      calculated.items.map((item) => ({
        quoteId: params.quoteId,
        type: item.type,
        description: item.description,
        materialId:
          typeof item.materialId === "number" &&
          validMaterialIds.has(item.materialId)
            ? item.materialId
            : null,
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
    organizationId: string;
    executionId: number;
    items: Array<{
      description: string;
      materialId?: number | null;
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
  const validMaterialIds = await resolveValidMaterialIds(
    params.organizationId,
    params.items,
    executor,
  );
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
        materialId:
          typeof item.materialId === "number" &&
          validMaterialIds.has(item.materialId)
            ? item.materialId
            : null,
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
            materialId: item.materialId ?? null,
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
