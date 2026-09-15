import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  serviceOrder,
  serviceOrderAssetSnapshot,
  serviceOrderDeliveryDocument,
  serviceOrderExecution,
  serviceOrderIntakeDocument,
  serviceOrderQuote,
  serviceOrderQuoteItem,
  serviceOrderSettings,
  serviceOrderTag,
} from "@calibra-facil/db/schema";

// Seed helpers SPECIFIC to the worker's SERVICE_ORDER document handlers
// (processServiceOrderIntakeDocument / Tag / Quote / DeliveryReceipt). These read
// a service_order + its customer + asset (and a frozen asset snapshot) + the lab
// organization, render an HTML document, push the PDF to R2, and write the
// resulting pdf_r2_key (plus issued_at/printed_at + the acting user) back onto the
// relevant document/tag/quote row. We DO NOT touch the shared seed.ts — these
// helpers live alongside it and reuse the same drizzle singleton. Use `seedOrg`
// from seed.ts for the org/unit/user, then call seedServiceOrder here.

const EPOCH = new Date("2026-01-01T00:00:00.000Z");

export type SeededServiceOrder = {
  serviceOrderId: number;
  serviceOrderNumber: string;
  customerId: number;
  assetId: number;
  customerName: string;
  assetName: string;
};

/**
 * Seed one service_order for an org, with the customer + asset + asset snapshot
 * the document handlers read. Distinct customerName / assetName / serviceOrderNumber
 * per call let a tenant-scope test assert org-A's data renders and org-B's never
 * does. `openedAt` is fixed to EPOCH so the year/month partition in the R2 key is
 * deterministic (2026/01).
 */
export async function seedServiceOrder(params: {
  organizationId: string;
  unitId: number;
  userId: string;
  serviceOrderNumber: string;
  customerName: string;
  assetName: string;
  /** Lab-controlled intake terms surfaced on the printed intake doc. */
  intakeTerms?: string;
}): Promise<SeededServiceOrder> {
  const [customerRow] = await db
    .insert(customer)
    .values({
      name: params.customerName,
      taxId: "98765432000155",
      phone: "+55 11 4002-8922",
      email: `${params.serviceOrderNumber.toLowerCase()}@cliente.test`,
      authOrganizationId: params.organizationId,
      labOrganizationId: params.organizationId,
      createdAt: EPOCH,
    })
    .returning();
  if (!customerRow) throw new Error("seedServiceOrder: customer insert failed");

  const [assetTypeRow] = await db
    .insert(assetType)
    .values({
      name: `Tipo ${params.serviceOrderNumber}`,
      slug: `tipo-${params.serviceOrderNumber.toLowerCase()}`,
      definition: [],
      createdAt: EPOCH,
    })
    .returning();
  if (!assetTypeRow)
    throw new Error("seedServiceOrder: assetType insert failed");

  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: customerRow.id,
      // SEC-03b (#638): asset carries its lab org (== the seeded customer's).
      labOrganizationId: params.organizationId,
      assetTypeId: assetTypeRow.id,
      name: params.assetName,
      serialNumber: `SN-${params.serviceOrderNumber}`,
      tag: `TAG-${params.serviceOrderNumber}`,
      manufacturer: "Fabricante Teste",
      model: "MOD-200",
      createdAt: EPOCH,
    })
    .returning();
  if (!assetRow) throw new Error("seedServiceOrder: asset insert failed");

  const [orderRow] = await db
    .insert(serviceOrder)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      serviceOrderNumber: params.serviceOrderNumber,
      customerId: customerRow.id,
      assetId: assetRow.id,
      openedByUserId: params.userId,
      claimedDefect: "Não liga",
      intakeCondition: "Riscos na carcaça",
      openedAt: EPOCH,
      createdAt: EPOCH,
    })
    .returning();
  if (!orderRow)
    throw new Error("seedServiceOrder: service_order insert failed");

  await db.insert(serviceOrderAssetSnapshot).values({
    serviceOrderId: orderRow.id,
    assetId: assetRow.id,
    assetName: params.assetName,
    assetType: assetTypeRow.name,
    manufacturer: "Fabricante Teste",
    model: "MOD-200",
    serialNumber: `SN-${params.serviceOrderNumber}`,
    patrimonyNumber: `PAT-${params.serviceOrderNumber}`,
    createdAt: EPOCH,
  });

  if (params.intakeTerms !== undefined) {
    await db.insert(serviceOrderSettings).values({
      organizationId: params.organizationId,
      defaultIntakeTerms: params.intakeTerms,
    });
  }

  return {
    serviceOrderId: orderRow.id,
    serviceOrderNumber: params.serviceOrderNumber,
    customerId: customerRow.id,
    assetId: assetRow.id,
    customerName: params.customerName,
    assetName: params.assetName,
  };
}

/**
 * Pre-create a service_order_intake_document row (no pdf yet) so the INTAKE
 * handler takes the UPDATE branch (sets pdf_r2_key + issued_at + issued_by).
 */
export async function seedIntakeDocument(params: {
  serviceOrderId: number;
  serviceOrderNumber: string;
}): Promise<{ documentId: number }> {
  const [row] = await db
    .insert(serviceOrderIntakeDocument)
    .values({
      serviceOrderId: params.serviceOrderId,
      documentNumber: `${params.serviceOrderNumber}/REC`,
      version: 1,
      type: "combined",
      createdAt: EPOCH,
    })
    .returning();
  if (!row) throw new Error("seedIntakeDocument: insert failed");
  return { documentId: row.id };
}

/**
 * Pre-create a service_order_tag row (no pdf yet) so the TAG handler takes the
 * UPDATE branch (sets pdf_r2_key + printed_at + printed_by).
 */
export async function seedTag(params: {
  serviceOrderId: number;
  serviceOrderNumber: string;
}): Promise<{ tagId: number; tagNumber: string }> {
  const tagNumber = `${params.serviceOrderNumber}-TAG`;
  const [row] = await db
    .insert(serviceOrderTag)
    .values({
      serviceOrderId: params.serviceOrderId,
      tagNumber,
      createdAt: EPOCH,
    })
    .returning();
  if (!row) throw new Error("seedTag: insert failed");
  return { tagId: row.id, tagNumber };
}

/**
 * Pre-create a service_order_quote (+ one part item + one service item) row (no
 * pdf yet) so the QUOTE handler renders + sets pdf_r2_key on it.
 */
export async function seedQuote(params: {
  serviceOrderId: number;
  serviceOrderNumber: string;
  userId: string;
}): Promise<{ quoteId: number; quoteNumber: string }> {
  const quoteNumber = `${params.serviceOrderNumber}-ORC`;
  const [row] = await db
    .insert(serviceOrderQuote)
    .values({
      serviceOrderId: params.serviceOrderId,
      quoteNumber,
      version: 1,
      status: "draft",
      subtotalServicesCents: 10000,
      subtotalPartsCents: 5000,
      totalCents: 15000,
      paymentTerms: "À vista",
      createdByUserId: params.userId,
      createdAt: EPOCH,
    })
    .returning();
  if (!row) throw new Error("seedQuote: insert failed");

  await db.insert(serviceOrderQuoteItem).values([
    {
      quoteId: row.id,
      type: "service",
      description: "Mão de obra de reparo",
      quantity: 1,
      unit: "un",
      unitPriceCents: 10000,
      totalPriceCents: 10000,
      sortOrder: 0,
      createdAt: EPOCH,
    },
    {
      quoteId: row.id,
      type: "part",
      description: "Peça de reposição",
      quantity: 1,
      unit: "un",
      unitPriceCents: 5000,
      totalPriceCents: 5000,
      sortOrder: 1,
      createdAt: EPOCH,
    },
  ]);

  return { quoteId: row.id, quoteNumber };
}

/**
 * Pre-create a service_order_delivery_document row (no pdf yet) + a finished
 * execution so the DELIVERY handler renders + sets pdf_r2_key + issued_at +
 * issued_by on the document.
 */
export async function seedDeliveryDocument(params: {
  serviceOrderId: number;
  serviceOrderNumber: string;
  userId: string;
}): Promise<{ documentId: number; documentNumber: string }> {
  const documentNumber = `${params.serviceOrderNumber}-ENT`;
  const [row] = await db
    .insert(serviceOrderDeliveryDocument)
    .values({
      serviceOrderId: params.serviceOrderId,
      documentNumber,
      version: 1,
      createdAt: EPOCH,
    })
    .returning();
  if (!row) throw new Error("seedDeliveryDocument: insert failed");

  await db.insert(serviceOrderExecution).values({
    serviceOrderId: params.serviceOrderId,
    startedByUserId: params.userId,
    finishedAt: EPOCH,
    finishedByUserId: params.userId,
    servicePerformed: "Reparo concluído",
    result: "repaired",
    createdAt: EPOCH,
  });

  return { documentId: row.id, documentNumber };
}
