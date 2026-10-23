/**
 * portal-service-order-actions.int.spec.ts - P2-18a.
 *
 * The OWN-order success paths of the portal service-order endpoints that the
 * cross-tenant spec only exercises as 404s: the financial summary of the
 * customer's own order (REQ-18A-1) and the quote approve / reject decisions.
 * Under `pnpm --filter @calibra-facil/api rls:shadow-report` the same specs run
 * as `calibra_app`, where a read that forgot its organization answers 404.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  billingDocument,
  integrationObjectLink,
  organizationIntegration,
  receivableInstallment,
  serviceOrder,
  serviceOrderEmailOutbox,
  serviceOrderQuote,
} from "@calibra-facil/db/schema";
import { portalServiceOrdersRouter } from "./service-orders";
import { loginAsPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedPortalContext } from "../../test/integration/seed";

const ORIGIN = { origin: "http://localhost" };
const JSON_HEADERS = { ...ORIGIN, "content-type": "application/json" };

async function seedWorld() {
  const ctx = await seedPortalContext({
    labOrgId: "lab-sa",
    clientOrgId: "client-sa",
    portalUserId: "user-sa",
    customerName: "Cliente SA",
  });
  const [type] = await db
    .insert(assetType)
    .values({ name: "Balanca", slug: "balanca-sa", definition: [] })
    .returning({ id: assetType.id });
  if (!type) throw new Error("asset type not seeded");
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      labOrganizationId: ctx.labOrgId,
      assetTypeId: type.id,
      name: "Ativo SA",
      serialNumber: "SN-SA",
      tag: "TAG-SA",
      status: "ACTIVE",
    })
    .returning({ id: asset.id });
  if (!assetRow) throw new Error("asset not seeded");

  const [document] = await db
    .insert(billingDocument)
    .values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      status: "ISSUED",
      exportStatus: "EXPORTED",
      issuedAt: new Date("2026-05-01T12:00:00.000Z"),
      dueDate: new Date("2099-12-31T00:00:00.000Z"),
      currency: "BRL",
      subtotalCents: 25_000,
      discountCents: 0,
      totalCents: 25_000,
      createdBy: ctx.portalUserId,
      updatedBy: ctx.portalUserId,
    })
    .returning({ id: billingDocument.id });
  if (!document) throw new Error("billing document not seeded");
  await db.insert(receivableInstallment).values({
    organizationId: ctx.labOrgId,
    documentId: document.id,
    installmentNumber: 1,
    status: "OPEN",
    dueDate: new Date("2099-12-31T00:00:00.000Z"),
    amountCents: 25_000,
  });

  // A connected, freshly synced financial provider: without it the portal
  // shows nothing about money (the summary is "hidden").
  await db.insert(organizationIntegration).values({
    id: "integration-sa",
    organizationId: ctx.labOrgId,
    type: "financial_erp",
    provider: "conta_azul",
    name: "Conta Azul",
    status: "ACTIVE",
    createdBy: ctx.portalUserId,
  });
  await db.insert(integrationObjectLink).values({
    id: "link-sa",
    integrationId: "integration-sa",
    organizationId: ctx.labOrgId,
    target: "billing_document",
    localEntityId: `billing_document:${document.id}`,
    remoteEntityId: "remote-sale-1",
    lastSyncedAt: new Date(),
  });

  const [order] = await db
    .insert(serviceOrder)
    .values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      serviceOrderNumber: "OS-SA-1",
      customerId: ctx.customerId,
      assetId: assetRow.id,
      openedByUserId: ctx.portalUserId,
      claimedDefect: "Nao liga",
      intakeCondition: "Riscos",
      status: "awaiting_quote_approval",
      billingDocumentId: document.id,
    })
    .returning({ id: serviceOrder.id, publicId: serviceOrder.publicId });
  if (!order) throw new Error("service order not seeded");

  const [quote] = await db
    .insert(serviceOrderQuote)
    .values({
      organizationId: ctx.labOrgId,
      serviceOrderId: order.id,
      quoteNumber: "ORC-SA-1",
      version: 1,
      status: "sent",
      totalCents: 25_000,
      createdByUserId: ctx.portalUserId,
    })
    .returning({ id: serviceOrderQuote.id });
  if (!quote) throw new Error("quote not seeded");

  return { ctx, order, quoteId: quote.id };
}

type World = Awaited<ReturnType<typeof seedWorld>>;
let world: World;

async function request(method: "GET" | "POST", path: string, body?: unknown) {
  const response = await portalServiceOrdersRouter.request(path, {
    method,
    headers: body === undefined ? ORIGIN : JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json: unknown = JSON.parse(text);
  return { status: response.status, text, json };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function quoteStatus(quoteId: number) {
  const [row] = await db
    .select({ status: serviceOrderQuote.status })
    .from(serviceOrderQuote)
    .where(eq(serviceOrderQuote.id, quoteId));
  return row?.status;
}

describe("portal service orders: own-order success paths (P2-18a)", () => {
  beforeEach(async () => {
    await truncateAll();
    world = await seedWorld();
    loginAsPortal({
      userId: world.ctx.portalUserId,
      organizationId: world.ctx.clientOrgId,
    });
  });

  it("REQ-18A-1: GET /:id/financial-summary of the customer's own order is visible with its open installment, not a 404 and not hidden", async () => {
    const result = await request(
      "GET",
      `/${world.order.publicId}/financial-summary`,
    );

    expect(result.status).toBe(200);
    const body = result.json;
    if (!isRecord(body) || !isRecord(body.data)) {
      throw new Error(`unexpected body: ${result.text}`);
    }
    expect(body.data.visible).toBe(true);
    expect(body.data.state).toBe("PAYMENT_PENDING");
    expect(body.data.openAmountCents).toBe(25_000);
    expect(body.data.freshness).toBe("fresh");
  });

  it("REQ-18A-1: the financial summary of an order that is not the customer's own is a 404", async () => {
    const result = await request(
      "GET",
      "/00000000-0000-4000-8000-000000000000/financial-summary",
    );
    expect(result.status).toBe(404);
  });

  it("the customer approves its own sent quote: 200, quote approved, order moves, e-mail queued", async () => {
    const result = await request(
      "POST",
      `/${world.order.publicId}/quotes/${world.quoteId}/approve`,
      { acceptedTerms: true },
    );

    expect(result.status).toBe(200);
    expect(result.json).toEqual({ ok: true });
    expect(await quoteStatus(world.quoteId)).toBe("approved");
    const [order] = await db
      .select({ status: serviceOrder.status })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, world.order.id));
    expect(order?.status).toBe("quote_approved");
    const outbox = await db
      .select({ id: serviceOrderEmailOutbox.id })
      .from(serviceOrderEmailOutbox)
      .where(eq(serviceOrderEmailOutbox.serviceOrderId, world.order.id));
    expect(outbox.length).toBeGreaterThan(0);
  });

  it("the customer rejects its own sent quote: 200, quote rejected with the reason, order moves", async () => {
    const result = await request(
      "POST",
      `/${world.order.publicId}/quotes/${world.quoteId}/reject`,
      { rejectionReason: "Fora do orcamento" },
    );

    expect(result.status).toBe(200);
    expect(result.json).toEqual({ ok: true });
    const [quote] = await db
      .select({
        status: serviceOrderQuote.status,
        reason: serviceOrderQuote.rejectionReason,
      })
      .from(serviceOrderQuote)
      .where(eq(serviceOrderQuote.id, world.quoteId));
    expect(quote).toEqual({ status: "rejected", reason: "Fora do orcamento" });
    const [order] = await db
      .select({ status: serviceOrder.status })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, world.order.id));
    expect(order?.status).toBe("quote_rejected");
  });

  it("a quote that was already decided answers 409 and stays as it was", async () => {
    await request(
      "POST",
      `/${world.order.publicId}/quotes/${world.quoteId}/approve`,
      { acceptedTerms: true },
    );
    const again = await request(
      "POST",
      `/${world.order.publicId}/quotes/${world.quoteId}/reject`,
      { rejectionReason: "Mudei de ideia" },
    );

    expect(again.status).toBe(409);
    expect(await quoteStatus(world.quoteId)).toBe("approved");
  });
});
