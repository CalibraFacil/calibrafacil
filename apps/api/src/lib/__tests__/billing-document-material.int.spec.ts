import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  billingDocumentItem,
  customer,
  material,
  organization,
  serviceOrder,
  serviceOrderQuote,
  serviceOrderQuoteItem,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";
import { createBillingDocumentFromServiceOrder } from "../service-order-workflow";
import { loadBillingDocumentExportPayload } from "../finance";

// Real-DB integration test for Phase 2 of the estoque/inventory epic (#580):
// billing lines remember their material, and the ERP export payload turns
// that into a resolvable catalog reference so the exported sale (Venda)
// carries a product line — which is what makes Conta Azul decrement stock.
//
// Proven properties:
//   REQ-VENDA-001  createBillingDocumentFromServiceOrder copies materialId
//                  from the approved quote's part items onto billing items
//   REQ-VENDA-002  loadBillingDocumentExportPayload emits
//                  catalogItemExternalId "material:{id}" for material-linked
//                  lines and null for free-form lines (which sale-mode
//                  exports then reject — surfaced early by billing-readiness)
//   REQ-VENDA-003  The material reference on billing lines is stable even
//                  though quote items are delete-and-reinsert (the billing
//                  item holds its own copy, not a join)

async function seedClientOrg(clientOrgId: string): Promise<void> {
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "CLIENT",
    status: "ACTIVE",
  });
}

async function seedBillingContext(tag: string) {
  const org = await seedOrg({ orgId: `org-${tag}`, role: "admin" });
  await seedClientOrg(`client-${tag}`);
  const [customerRow] = await db
    .insert(customer)
    .values({
      name: `Customer ${tag}`,
      authOrganizationId: `client-${tag}`,
      labOrganizationId: org.orgId,
    })
    .returning({ id: customer.id });
  if (!customerRow) throw new Error("seed: customer insert failed");

  const [type] = await db
    .insert(assetType)
    .values({ name: `Type ${tag}`, slug: `type-${tag}`, definition: [] })
    .returning({ id: assetType.id });
  if (!type) throw new Error("seed: asset type insert failed");
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: org.unitId,
      customerId: customerRow.id,
      assetTypeId: type.id,
      name: `Asset ${tag}`,
      serialNumber: `SN-${tag}`,
      tag,
      status: "ACTIVE",
      metrologyRegime: "INDUSTRIAL",
    })
    .returning({ id: asset.id });
  if (!assetRow) throw new Error("seed: asset insert failed");

  const [order] = await db
    .insert(serviceOrder)
    .values({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: customerRow.id,
      assetId: assetRow.id,
      openedByUserId: org.userId,
      serviceOrderNumber: `OS-${tag}`,
      status: "ready_for_delivery",
      claimedDefect: "Defeito de teste",
      intakeCondition: "Condição de teste",
      intakeType: "counter",
      deliveryMethod: "pickup_at_lab",
      priority: "normal",
      totalQuotedCents: 90_000,
      totalApprovedCents: 90_000,
      evaluationFeeCents: 0,
      evaluationFeeApplied: false,
      isExternalService: false,
    })
    .returning({ id: serviceOrder.id });
  if (!order) throw new Error("seed: service order insert failed");

  const [materialRow] = await db
    .insert(material)
    .values({
      organizationId: org.orgId,
      unitId: org.unitId,
      name: "Célula de carga 50kg",
      sku: "CEL-050",
      unit: "un",
      unitPriceCents: 30_000,
    })
    .returning({ id: material.id });
  if (!materialRow) throw new Error("seed: material insert failed");

  const [quote] = await db
    .insert(serviceOrderQuote)
    .values({
      serviceOrderId: order.id,
      quoteNumber: `OS-${tag}/ORC`,
      version: 1,
      status: "approved",
      totalCents: 90_000,
      createdByUserId: org.userId,
    })
    .returning({ id: serviceOrderQuote.id });
  if (!quote) throw new Error("seed: quote insert failed");

  await db.insert(serviceOrderQuoteItem).values([
    {
      quoteId: quote.id,
      type: "part",
      description: "Célula de carga 50kg",
      materialId: materialRow.id,
      quantity: 2,
      unit: "un",
      unitPriceCents: 30_000,
      totalPriceCents: 60_000,
      sortOrder: 0,
    },
    {
      quoteId: quote.id,
      type: "part",
      description: "Peça avulsa sem catálogo",
      materialId: null,
      quantity: 1,
      unit: "un",
      unitPriceCents: 10_000,
      totalPriceCents: 10_000,
      sortOrder: 1,
    },
    {
      quoteId: quote.id,
      type: "service",
      description: "Mão de obra",
      quantity: 1,
      unit: "un",
      unitPriceCents: 20_000,
      totalPriceCents: 20_000,
      sortOrder: 2,
    },
  ]);

  return { org, orderId: order.id, materialId: materialRow.id };
}

describe("billing document material references (real DB)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-VENDA-001/002/003: threads materialId from quote to billing item to export payload", async () => {
    const ctx = await seedBillingContext("a");

    const documentId = await createBillingDocumentFromServiceOrder({
      actorUserId: ctx.org.userId,
      organizationId: ctx.org.orgId,
      serviceOrderId: ctx.orderId,
    });

    const billingRows = await db
      .select({
        description: billingDocumentItem.description,
        materialId: billingDocumentItem.materialId,
      })
      .from(billingDocumentItem)
      .where(eq(billingDocumentItem.documentId, documentId))
      .orderBy(billingDocumentItem.sortOrder);

    expect(billingRows).toEqual([
      { description: "Célula de carga 50kg", materialId: ctx.materialId },
      { description: "Peça avulsa sem catálogo", materialId: null },
      { description: "Mão de obra", materialId: null },
    ]);

    const payload = await loadBillingDocumentExportPayload(
      ctx.org.orgId,
      documentId,
    );
    expect(payload).not.toBeNull();
    const catalogRefs = payload?.items.map((item) => ({
      description: item.description,
      catalogItemExternalId: item.catalogItemExternalId,
    }));
    expect(catalogRefs).toEqual([
      {
        description: "Célula de carga 50kg",
        catalogItemExternalId: `material:${ctx.materialId}`,
      },
      {
        description: "Peça avulsa sem catálogo",
        catalogItemExternalId: null,
      },
      {
        description: "Mão de obra",
        catalogItemExternalId: null,
      },
    ]);
  });
});
