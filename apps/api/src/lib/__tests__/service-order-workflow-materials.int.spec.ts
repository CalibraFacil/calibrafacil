import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  material,
  organization,
  serviceOrder,
  serviceOrderExecution,
  serviceOrderExecutionItem,
  serviceOrderQuote,
  serviceOrderQuoteItem,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";
import {
  replaceExecutionItems,
  replaceQuoteItems,
} from "../service-order-workflow";

// Real-DB integration test for the material-reference tenant boundary in
// replaceQuoteItems / replaceExecutionItems.
//
// A line item may carry `materialId` (catalog reference). The workflow
// functions must only persist ids that belong to the caller's organization;
// anything else (cross-tenant id, nonexistent id) is dropped to null so the
// item degrades to a free-form line — quoting is never blocked, and a foreign
// key into another lab's catalog can never be stored.
//
// Proven properties:
//   REQ-MATREF-001  Same-org materialId is persisted on quote items
//   REQ-MATREF-002  Cross-tenant materialId is dropped to null (quote items)
//   REQ-MATREF-003  Nonexistent materialId is dropped to null (quote items)
//   REQ-MATREF-004  Same behavior on execution items (kept vs dropped)

// ---------------------------------------------------------------------------
// Inline domain seed helpers — NOT in shared seed.ts (parallel makers must not
// conflict with that file).
// ---------------------------------------------------------------------------

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

async function seedCustomerRow(params: {
  labOrganizationId: string;
  clientOrgId: string;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);
  const [row] = await db
    .insert(customer)
    .values({
      name: `Customer ${params.clientOrgId}`,
      authOrganizationId: params.clientOrgId,
      labOrganizationId: params.labOrganizationId,
    })
    .returning({ id: customer.id });
  if (!row) throw new Error("seedCustomerRow: insert failed");
  return row.id;
}

async function seedAssetRow(params: {
  unitId: number;
  customerId: number;
  tag: string;
}): Promise<number> {
  const [type] = await db
    .insert(assetType)
    .values({
      name: `Type ${params.tag}`,
      slug: `type-${params.tag}`,
      definition: [],
    })
    .returning({ id: assetType.id });
  if (!type) throw new Error("seedAssetRow: asset type insert failed");
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: params.customerId,
      assetTypeId: type.id,
      name: `Asset ${params.tag}`,
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
      metrologyRegime: "INDUSTRIAL",
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAssetRow: insert failed");
  return row.id;
}

/** Seed org → customer → asset → service order → quote + execution rows. */
async function seedQuoteContext(tag: string) {
  const org = await seedOrg({ orgId: `org-${tag}`, role: "admin" });
  const customerId = await seedCustomerRow({
    labOrganizationId: org.orgId,
    clientOrgId: `client-${tag}`,
  });
  const assetId = await seedAssetRow({
    unitId: org.unitId,
    customerId,
    tag,
  });
  const [order] = await db
    .insert(serviceOrder)
    .values({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId,
      assetId,
      openedByUserId: org.userId,
      serviceOrderNumber: `OS-${tag}`,
      status: "awaiting_quote_approval",
      claimedDefect: "Defeito de teste",
      intakeCondition: "Condição de teste",
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
  if (!order) throw new Error("seedQuoteContext: service order insert failed");

  const [quote] = await db
    .insert(serviceOrderQuote)
    .values({
      serviceOrderId: order.id,
      quoteNumber: `OS-${tag}/ORC`,
      version: 1,
      createdByUserId: org.userId,
    })
    .returning({ id: serviceOrderQuote.id });
  if (!quote) throw new Error("seedQuoteContext: quote insert failed");

  const [execution] = await db
    .insert(serviceOrderExecution)
    .values({
      serviceOrderId: order.id,
      startedByUserId: org.userId,
    })
    .returning({ id: serviceOrderExecution.id });
  if (!execution) throw new Error("seedQuoteContext: execution insert failed");

  return { org, quoteId: quote.id, executionId: execution.id };
}

async function seedMaterialRow(params: {
  organizationId: string;
  unitId: number;
  name: string;
}): Promise<number> {
  const [row] = await db
    .insert(material)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: params.name,
      unit: "un",
    })
    .returning({ id: material.id });
  if (!row) throw new Error("seedMaterialRow: insert failed");
  return row.id;
}

function partItem(materialId: number | null | undefined, description: string) {
  return {
    type: "part" as const,
    description,
    materialId,
    quantity: 1,
    unit: "un",
    unitPriceCents: 10_000,
  };
}

describe("replaceQuoteItems / replaceExecutionItems — material tenant boundary (real DB)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-MATREF-001/002/003: keeps same-org materialId, drops cross-tenant and nonexistent ids on quote items", async () => {
    const ctxA = await seedQuoteContext("a");
    const ctxB = await seedQuoteContext("b");
    const ownMaterialId = await seedMaterialRow({
      organizationId: ctxA.org.orgId,
      unitId: ctxA.org.unitId,
      name: "Material do próprio laboratório",
    });
    const foreignMaterialId = await seedMaterialRow({
      organizationId: ctxB.org.orgId,
      unitId: ctxB.org.unitId,
      name: "Material de outro laboratório",
    });

    await replaceQuoteItems({
      organizationId: ctxA.org.orgId,
      quoteId: ctxA.quoteId,
      items: [
        partItem(ownMaterialId, "peça própria"),
        partItem(foreignMaterialId, "peça de outro tenant"),
        partItem(999_999, "peça inexistente"),
        partItem(null, "peça livre"),
      ],
    });

    const rows = await db
      .select({
        description: serviceOrderQuoteItem.description,
        materialId: serviceOrderQuoteItem.materialId,
      })
      .from(serviceOrderQuoteItem)
      .where(eq(serviceOrderQuoteItem.quoteId, ctxA.quoteId))
      .orderBy(serviceOrderQuoteItem.sortOrder);

    expect(rows).toEqual([
      { description: "peça própria", materialId: ownMaterialId },
      { description: "peça de outro tenant", materialId: null },
      { description: "peça inexistente", materialId: null },
      { description: "peça livre", materialId: null },
    ]);
  });

  it("REQ-MATREF-004: same boundary on execution items", async () => {
    const ctxA = await seedQuoteContext("a");
    const ctxB = await seedQuoteContext("b");
    const ownMaterialId = await seedMaterialRow({
      organizationId: ctxA.org.orgId,
      unitId: ctxA.org.unitId,
      name: "Material próprio",
    });
    const foreignMaterialId = await seedMaterialRow({
      organizationId: ctxB.org.orgId,
      unitId: ctxB.org.unitId,
      name: "Material alheio",
    });

    await replaceExecutionItems({
      organizationId: ctxA.org.orgId,
      executionId: ctxA.executionId,
      items: [
        { ...partItem(ownMaterialId, "peça própria"), unitCostCents: 4_000 },
        { ...partItem(foreignMaterialId, "peça alheia"), unitCostCents: 5_000 },
      ],
    });

    const rows = await db
      .select({
        description: serviceOrderExecutionItem.description,
        materialId: serviceOrderExecutionItem.materialId,
      })
      .from(serviceOrderExecutionItem)
      .where(eq(serviceOrderExecutionItem.executionId, ctxA.executionId))
      .orderBy(serviceOrderExecutionItem.sortOrder);

    expect(rows).toEqual([
      { description: "peça própria", materialId: ownMaterialId },
      { description: "peça alheia", materialId: null },
    ]);
  });
});
