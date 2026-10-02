import { beforeEach, describe, expect, it } from "vitest";
import {
  publicServiceOrderAccessRouter,
  serviceOrdersRouter,
} from "./service-orders";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  organization,
  serviceOrder,
  serviceOrderPublicAccessToken,
  serviceOrderQuote,
} from "@calibra-facil/db/schema";
import type { ServiceOrderQuoteStatus } from "@calibra-facil/shared";
import { eq, sql } from "drizzle-orm";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import {
  PUBLIC_TOKEN_DEFAULT_TTL_DAYS,
  PUBLIC_TOKEN_VALIDITY_GRACE_DAYS,
  createPublicServiceOrderAccessToken,
} from "../lib/service-order-workflow";
import {
  approveServiceOrderQuoteByPortalUser,
  rejectServiceOrderQuoteByPortalUser,
} from "../modules/service-orders/service-order.quotes";

// Public quote-access token lifecycle — spec quote-approval-public-access
// (issue #785), mini-spec A. Real DB, real routers, no session mock for the
// public router (the token IS the credential).
//
// REQ-QPUB-001  default expiry: validUntil + 7d, else sentAt + 30d; explicit wins
// REQ-QPUB-003  decision (any path) revokes every token of that quote [HIGH RISK]
// REQ-QPUB-004  sending a new quote version revokes earlier quotes' tokens
// REQ-QPUB-005  expired/superseded token → GET 404, generic body, no data
// REQ-QPUB-006  decided token → GET 410 "orcamento_respondido", no data
// REQ-QPUB-007  expired/revoked token → POST approve/reject rejected, no mutation [HIGH RISK]
// REQ-QPUB-033  non-approvable quote status → POST 409, no mutation [HIGH RISK]

const JSON_HEADERS = { "content-type": "application/json" };
// Deployed handlers always receive the runtime env (`app.fetch(req, env)`),
// but Hono's `request()` only passes one when given, and the send route
// builds the customer's portal link from it.
const RUNTIME_ENV = { PORTAL_APP_URL: "https://portal.example.test" };
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Domain seed helpers — inline for self-containment; never touch shared files.
// ---------------------------------------------------------------------------

async function seedClientOrg(clientOrgId: string): Promise<void> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client Org ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: now,
    type: "CLIENT",
    status: "ACTIVE",
  });
}

async function seedCustomer(params: {
  labOrganizationId: string;
  clientOrgId: string;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);
  const [row] = await db
    .insert(customer)
    .values({
      name: `Customer of ${params.labOrganizationId}`,
      email: "cliente@example.com",
      authOrganizationId: params.clientOrgId,
      labOrganizationId: params.labOrganizationId,
    })
    .returning({ id: customer.id });
  if (!row) throw new Error("seedCustomer: insert failed");
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

async function seedAsset(params: {
  unitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: params.customerId,
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${params.customerId})`,
      assetTypeId: params.assetTypeId,
      name: "Test Asset",
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
      metrologyRegime: "INDUSTRIAL",
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

async function seedServiceOrder(params: {
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  openedByUserId: string;
  serviceOrderNumber: string;
  status?: (typeof serviceOrder.$inferInsert)["status"];
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
      status: params.status ?? "awaiting_quote_approval",
      claimedDefect: "Test defect",
      intakeCondition: "Test condition",
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
  if (!row) throw new Error("seedServiceOrder: insert failed");
  return row.id;
}

async function seedQuote(params: {
  serviceOrderId: number;
  createdByUserId: string;
  serviceOrderNumber: string;
  status?: ServiceOrderQuoteStatus;
  version?: number;
  totalCents?: number;
  validUntil?: Date | null;
}): Promise<number> {
  const [row] = await db
    .insert(serviceOrderQuote)
    .values({
      serviceOrderId: params.serviceOrderId,
      quoteNumber: `${params.serviceOrderNumber}/ORC`,
      version: params.version ?? 1,
      status: params.status ?? "sent",
      totalCents: params.totalCents ?? 10000,
      validUntil: params.validUntil ?? null,
      createdByUserId: params.createdByUserId,
    })
    .returning({ id: serviceOrderQuote.id });
  if (!row) throw new Error("seedQuote: insert failed");
  return row.id;
}

/** Full lab world: org + customer + OS + quote. */
async function seedWorld(tag: string, quoteStatus: ServiceOrderQuoteStatus) {
  const org = await seedOrg({ orgId: `org-${tag}`, role: "admin" });
  const typeId = await seedAssetType(`type-${tag}`);
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    clientOrgId: `client-${tag}`,
  });
  const assetId = await seedAsset({
    unitId: org.unitId,
    customerId,
    assetTypeId: typeId,
    tag: `tag-${tag}`,
  });
  const serviceOrderId = await seedServiceOrder({
    organizationId: org.orgId,
    unitId: org.unitId,
    customerId,
    assetId,
    openedByUserId: org.userId,
    serviceOrderNumber: `OS-${tag}`,
  });
  const quoteId = await seedQuote({
    serviceOrderId,
    createdByUserId: org.userId,
    serviceOrderNumber: `OS-${tag}`,
    status: quoteStatus,
  });
  return { org, customerId, assetId, serviceOrderId, quoteId };
}

async function mintToken(params: {
  organizationId: string;
  serviceOrderId: number;
  quoteId: number;
  expiresAt?: Date | null;
}) {
  return createPublicServiceOrderAccessToken(params);
}

async function tokenRows(quoteId: number) {
  return db
    .select()
    .from(serviceOrderPublicAccessToken)
    .where(eq(serviceOrderPublicAccessToken.quoteId, quoteId));
}

async function quoteRow(quoteId: number) {
  const [row] = await db
    .select()
    .from(serviceOrderQuote)
    .where(eq(serviceOrderQuote.id, quoteId))
    .limit(1);
  if (!row) throw new Error("quoteRow: not found");
  return row;
}

const APPROVE_MANUALLY_BODY = JSON.stringify({
  approvedByName: "Cliente Teste",
  manualApprovalEvidenceType: "phone",
  manualApprovalEvidenceText: "Aprovado por telefone.",
});

describe("public quote-access token lifecycle (real DB)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ==========================================================================
  // REQ-QPUB-001 — default expiry on send
  // ==========================================================================

  it("REQ-QPUB-001: send without expiresAt defaults to quote.validUntil + 7 days", async () => {
    const world = await seedWorld("exp1", "draft");
    const validUntil = new Date("2026-08-01T00:00:00.000Z");
    await db
      .update(serviceOrderQuote)
      .set({ validUntil })
      .where(eq(serviceOrderQuote.id, world.quoteId));
    loginAs({ userId: world.org.userId, organizationId: world.org.orgId });

    const res = await serviceOrdersRouter.request(
      `/${world.serviceOrderId}/quotes/${world.quoteId}/send`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
      RUNTIME_ENV,
    );
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toMatchObject({
      publicUrl: expect.stringMatching(
        /^https:\/\/portal\.example\.test\/service-order-access\//,
      ),
    });

    const [token] = await tokenRows(world.quoteId);
    expect(token?.expiresAt?.getTime()).toBe(
      validUntil.getTime() + PUBLIC_TOKEN_VALIDITY_GRACE_DAYS * DAY_MS,
    );
  });

  it("REQ-QPUB-001: send without expiresAt and without validUntil defaults to ~30 days from send", async () => {
    const world = await seedWorld("exp2", "draft");
    loginAs({ userId: world.org.userId, organizationId: world.org.orgId });

    const before = Date.now();
    const res = await serviceOrdersRouter.request(
      `/${world.serviceOrderId}/quotes/${world.quoteId}/send`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
      RUNTIME_ENV,
    );
    const after = Date.now();
    expect(res.status).toBe(200);

    const [token] = await tokenRows(world.quoteId);
    const expiresAt = token?.expiresAt?.getTime() ?? 0;
    expect(expiresAt).toBeGreaterThanOrEqual(
      before + PUBLIC_TOKEN_DEFAULT_TTL_DAYS * DAY_MS,
    );
    expect(expiresAt).toBeLessThanOrEqual(
      after + PUBLIC_TOKEN_DEFAULT_TTL_DAYS * DAY_MS,
    );
  });

  it("REQ-QPUB-001: an explicit expiresAt from the lab wins over the default", async () => {
    const world = await seedWorld("exp3", "draft");
    loginAs({ userId: world.org.userId, organizationId: world.org.orgId });
    const explicit = "2026-12-24T00:00:00.000Z";

    const res = await serviceOrdersRouter.request(
      `/${world.serviceOrderId}/quotes/${world.quoteId}/send`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ expiresAt: explicit }),
      },
      RUNTIME_ENV,
    );
    expect(res.status).toBe(200);

    const [token] = await tokenRows(world.quoteId);
    expect(token?.expiresAt?.toISOString()).toBe(explicit);
  });

  // ==========================================================================
  // REQ-QPUB-003 — decision revokes every token of the quote, on every path
  // ==========================================================================

  it("REQ-QPUB-003 [HIGH RISK]: public-token approve revokes ALL tokens of the quote (incl. siblings)", async () => {
    const world = await seedWorld("dec1", "sent");
    const grant = await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });
    const sibling = await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });

    const res = await publicServiceOrderAccessRouter.request(
      `/${grant.token}/approve-quote`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
    );
    expect(res.status).toBe(200);

    const rows = await tokenRows(world.quoteId);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.revokedAt).not.toBeNull();
      expect(row.revokedReason).toBe("decided");
    }
    expect((await quoteRow(world.quoteId)).status).toBe("approved");
    void sibling;
  });

  it("REQ-QPUB-003 [HIGH RISK]: public-token reject revokes the quote's tokens", async () => {
    const world = await seedWorld("dec2", "sent");
    const grant = await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });

    const res = await publicServiceOrderAccessRouter.request(
      `/${grant.token}/reject-quote`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ rejectionReason: "Muito caro" }),
      },
    );
    expect(res.status).toBe(200);

    const [row] = await tokenRows(world.quoteId);
    expect(row?.revokedReason).toBe("decided");
    expect((await quoteRow(world.quoteId)).status).toBe("rejected");
  });

  it("REQ-QPUB-003 [HIGH RISK]: manual lab approval revokes the quote's tokens", async () => {
    const world = await seedWorld("dec3", "sent");
    await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });
    loginAs({ userId: world.org.userId, organizationId: world.org.orgId });

    const res = await serviceOrdersRouter.request(
      `/${world.serviceOrderId}/quotes/${world.quoteId}/approve-manually`,
      { method: "POST", headers: JSON_HEADERS, body: APPROVE_MANUALLY_BODY },
    );
    expect(res.status).toBe(200);

    const [row] = await tokenRows(world.quoteId);
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revokedReason).toBe("decided");
  });

  it("REQ-QPUB-003 [HIGH RISK]: manual lab rejection revokes the quote's tokens", async () => {
    const world = await seedWorld("dec4", "sent");
    await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });
    loginAs({ userId: world.org.userId, organizationId: world.org.orgId });

    const res = await serviceOrdersRouter.request(
      `/${world.serviceOrderId}/quotes/${world.quoteId}/reject-manually`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ rejectionReason: "Cliente recusou." }),
      },
    );
    expect(res.status).toBe(200);

    const [row] = await tokenRows(world.quoteId);
    expect(row?.revokedReason).toBe("decided");
  });

  it("REQ-QPUB-003 [HIGH RISK]: portal-user approval revokes the quote's tokens", async () => {
    const world = await seedWorld("dec5", "sent");
    await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });

    const result = await approveServiceOrderQuoteByPortalUser({
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
      authOrganizationId: "client-dec5",
      actorUserId: world.org.userId,
      metadata: {},
    });
    expect(result.status).toBe("ok");

    const [row] = await tokenRows(world.quoteId);
    expect(row?.revokedReason).toBe("decided");
  });

  it("REQ-QPUB-003 [HIGH RISK]: portal-user rejection revokes the quote's tokens", async () => {
    const world = await seedWorld("dec6", "sent");
    await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });

    const result = await rejectServiceOrderQuoteByPortalUser({
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
      authOrganizationId: "client-dec6",
      actorUserId: world.org.userId,
      values: { rejectionReason: "Não aprovado" },
      metadata: {},
    });
    expect(result.status).toBe("ok");

    const [row] = await tokenRows(world.quoteId);
    expect(row?.revokedReason).toBe("decided");
  });

  // ==========================================================================
  // REQ-QPUB-004 — a new quote version supersedes earlier quotes' tokens
  // ==========================================================================

  it("REQ-QPUB-004: sending quote v2 revokes v1's live tokens as 'superseded' and leaves v2's live", async () => {
    const world = await seedWorld("sup1", "sent");
    const v1Token = await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });
    const v2QuoteId = await seedQuote({
      serviceOrderId: world.serviceOrderId,
      createdByUserId: world.org.userId,
      serviceOrderNumber: "OS-sup1",
      status: "draft",
      version: 2,
    });
    loginAs({ userId: world.org.userId, organizationId: world.org.orgId });

    const res = await serviceOrdersRouter.request(
      `/${world.serviceOrderId}/quotes/${v2QuoteId}/send`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
      RUNTIME_ENV,
    );
    expect(res.status).toBe(200);

    const [v1Row] = await tokenRows(world.quoteId);
    expect(v1Row?.revokedAt).not.toBeNull();
    expect(v1Row?.revokedReason).toBe("superseded");

    const [v2Row] = await tokenRows(v2QuoteId);
    expect(v2Row?.revokedAt).toBeNull();

    // The superseded v1 link is now a generic dead link (REQ-QPUB-005).
    const view = await publicServiceOrderAccessRouter.request(
      `/${v1Token.token}`,
    );
    expect(view.status).toBe(404);
  });

  // ==========================================================================
  // REQ-QPUB-005 / REQ-QPUB-006 — dead-link responses
  // ==========================================================================

  it("REQ-QPUB-005: an expired token answers 404 with a generic body and no order data", async () => {
    const world = await seedWorld("exp404", "sent");
    const grant = await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const res = await publicServiceOrderAccessRouter.request(`/${grant.token}`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Link invalido ou expirado" });
    expect(JSON.stringify(body)).not.toContain("OS-exp404");
  });

  it("REQ-QPUB-006: a decided token answers 410 'orcamento_respondido' with no quote data", async () => {
    const world = await seedWorld("gone1", "sent");
    const grant = await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });

    const approve = await publicServiceOrderAccessRouter.request(
      `/${grant.token}/approve-quote`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
    );
    expect(approve.status).toBe(200);

    const view = await publicServiceOrderAccessRouter.request(
      `/${grant.token}`,
    );
    expect(view.status).toBe(410);
    const body = await view.json();
    expect(body).toEqual({ error: "orcamento_respondido" });
    const text = JSON.stringify(body);
    expect(text).not.toContain("OS-gone1");
    expect(text).not.toContain("totalCents");
  });

  // ==========================================================================
  // REQ-QPUB-007 / REQ-QPUB-033 — dead or decided credentials cannot mutate
  // ==========================================================================

  it("REQ-QPUB-007 [HIGH RISK]: an expired token cannot approve — 404 and the quote stays 'sent'", async () => {
    const world = await seedWorld("mut1", "sent");
    const grant = await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const res = await publicServiceOrderAccessRouter.request(
      `/${grant.token}/approve-quote`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
    );
    expect(res.status).toBe(404);
    expect((await quoteRow(world.quoteId)).status).toBe("sent");
  });

  it("REQ-QPUB-007 [HIGH RISK]: a revoked token cannot reject — 404 and the quote stays 'sent'", async () => {
    const world = await seedWorld("mut2", "sent");
    const grant = await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });
    await db
      .update(serviceOrderPublicAccessToken)
      .set({ revokedAt: new Date(), revokedReason: "superseded" })
      .where(eq(serviceOrderPublicAccessToken.quoteId, world.quoteId));

    const res = await publicServiceOrderAccessRouter.request(
      `/${grant.token}/reject-quote`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ rejectionReason: "n/a" }),
      },
    );
    expect(res.status).toBe(404);
    expect((await quoteRow(world.quoteId)).status).toBe("sent");
  });

  it("REQ-QPUB-033 [HIGH RISK]: a live token on an already-approved quote answers 409 without mutation", async () => {
    const world = await seedWorld("mut3", "approved");
    const grant = await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });

    const res = await publicServiceOrderAccessRouter.request(
      `/${grant.token}/approve-quote`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
    );
    expect(res.status).toBe(409);
    expect((await quoteRow(world.quoteId)).status).toBe("approved");
  });

  it("public responses carry no-store + noindex headers", async () => {
    const world = await seedWorld("hdr1", "sent");
    const grant = await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });

    const res = await publicServiceOrderAccessRouter.request(`/${grant.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });

  // ==========================================================================
  // Mini-spec D — public view correctness (REQ-QPUB-030/031/032)
  // ==========================================================================

  it("REQ-QPUB-030: a quote-scoped token views ITS quote, not a newer version's pricing", async () => {
    const world = await seedWorld("pin1", "sent");
    const v2QuoteId = await seedQuote({
      serviceOrderId: world.serviceOrderId,
      createdByUserId: world.org.userId,
      serviceOrderNumber: "OS-pin1",
      status: "sent",
      version: 2,
      totalCents: 99999,
    });
    const v1Grant = await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });

    const res = await publicServiceOrderAccessRouter.request(
      `/${v1Grant.token}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.quotes).toHaveLength(1);
    expect(body.data.quotes[0].id).toBe(world.quoteId);
    expect(body.data.quotes[0].totalCents).toBe(10000);
    expect(JSON.stringify(body)).not.toContain("99999");
    void v2QuoteId;
  });

  it("REQ-QPUB-031 [HIGH RISK]: the public view carries nothing from another tenant", async () => {
    const worldA = await seedWorld("tenA", "sent");
    const worldB = await seedWorld("tenB", "sent");
    const grantA = await mintToken({
      organizationId: worldA.org.orgId,
      serviceOrderId: worldA.serviceOrderId,
      quoteId: worldA.quoteId,
    });

    const res = await publicServiceOrderAccessRouter.request(
      `/${grantA.token}`,
    );
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("OS-tenA");
    expect(text).not.toContain("OS-tenB");
    expect(text).not.toContain(worldB.org.orgId);
  });

  it("REQ-QPUB-032 [HIGH RISK]: the public view exposes only the client-visible projection (no internalNotes)", async () => {
    const world = await seedWorld("proj1", "sent");
    await db
      .update(serviceOrder)
      .set({ internalNotes: "SEGREDO-INTERNO-DO-LAB" })
      .where(eq(serviceOrder.id, world.serviceOrderId));
    const grant = await mintToken({
      organizationId: world.org.orgId,
      serviceOrderId: world.serviceOrderId,
      quoteId: world.quoteId,
    });

    const res = await publicServiceOrderAccessRouter.request(`/${grant.token}`);
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("internalNotes");
    expect(text).not.toContain("SEGREDO-INTERNO-DO-LAB");
  });
});
