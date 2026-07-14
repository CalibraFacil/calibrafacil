import { beforeEach, describe, expect, it } from "vitest";
import { publicServiceOrderAccessRouter } from "./service-orders";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  organization,
  publicCodeRedeemThrottle,
  serviceOrder,
  serviceOrderEventLog,
  serviceOrderPublicAccessToken,
  serviceOrderQuote,
} from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { createPublicServiceOrderAccessToken } from "../lib/service-order-workflow";

// Public approval-code redemption — spec quote-approval-public-access
// (issue #785), mini-spec B. Real DB; no session (the code IS the credential).
//
// REQ-QPUB-012  valid live code → 200 with a tokenized access URL that works
// REQ-QPUB-013  every miss → the SAME generic 404 (no existence oracle)
// REQ-QPUB-014  >10 failures per IP per window → 429, durable counter [HIGH RISK]
// REQ-QPUB-015  successful redemption → service_order.public_code_redeemed event

const JSON_HEADERS = { "content-type": "application/json" };

function redeemRequest(code: string, ip = "203.0.113.7") {
  return publicServiceOrderAccessRouter.request("/redeem-code", {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-forwarded-for": ip },
    body: JSON.stringify({ code }),
  });
}

// ---------------------------------------------------------------------------
// Domain seed helpers — inline for self-containment; never touch shared files.
// ---------------------------------------------------------------------------

async function seedClientOrg(clientOrgId: string): Promise<void> {
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client Org ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
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

async function seedWorld(tag: string) {
  const org = await seedOrg({ orgId: `org-${tag}`, role: "admin" });
  const [type] = await db
    .insert(assetType)
    .values({ name: "Test Instrument", slug: `type-${tag}`, definition: [] })
    .returning({ id: assetType.id });
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    clientOrgId: `client-${tag}`,
  });
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: org.unitId,
      customerId,
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${customerId})`,
      assetTypeId: type?.id ?? 0,
      name: "Test Asset",
      serialNumber: `SN-${tag}`,
      tag: `tag-${tag}`,
      status: "ACTIVE",
      metrologyRegime: "INDUSTRIAL",
    })
    .returning({ id: asset.id });
  const [so] = await db
    .insert(serviceOrder)
    .values({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId,
      assetId: assetRow?.id ?? 0,
      openedByUserId: org.userId,
      serviceOrderNumber: `OS-${tag}`,
      status: "awaiting_quote_approval",
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
  const serviceOrderId = so?.id ?? 0;
  const [quote] = await db
    .insert(serviceOrderQuote)
    .values({
      serviceOrderId,
      quoteNumber: `OS-${tag}/ORC`,
      version: 1,
      status: "sent",
      totalCents: 10000,
      createdByUserId: org.userId,
    })
    .returning({ id: serviceOrderQuote.id });
  return { org, customerId, serviceOrderId, quoteId: quote?.id ?? 0 };
}

/** Mint the send-time grant WITH a code (the real mint path). */
async function mintCodedGrant(world: {
  org: { orgId: string };
  serviceOrderId: number;
  quoteId: number;
}) {
  const grant = await createPublicServiceOrderAccessToken({
    organizationId: world.org.orgId,
    serviceOrderId: world.serviceOrderId,
    quoteId: world.quoteId,
    withApprovalCode: true,
  });
  if (!grant.code) throw new Error("mintCodedGrant: no code minted");
  return { token: grant.token, code: grant.code };
}

describe("public approval-code redemption (real DB)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-QPUB-012: a valid code redeems to a tokenized URL whose token resolves via GET /:token", async () => {
    const world = await seedWorld("redeem1");
    const grant = await mintCodedGrant(world);

    const res = await redeemRequest(grant.code);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.accessUrl).toContain(
      `/service-order-access/${body.data.token}`,
    );
    // The minted sibling is a fresh credential, not the emailed link token.
    expect(body.data.token).not.toBe(grant.token);

    const view = await publicServiceOrderAccessRouter.request(
      `/${body.data.token}`,
    );
    expect(view.status).toBe(200);
  });

  it("REQ-QPUB-012: redemption tolerates lowercase, spaces and hyphens", async () => {
    const world = await seedWorld("redeem2");
    const grant = await mintCodedGrant(world);
    const sloppy = `${grant.code.slice(0, 4).toLowerCase()}-${grant.code.slice(4)} `;

    const res = await redeemRequest(sloppy);
    expect(res.status).toBe(200);
  });

  it("REQ-QPUB-013: wrong, malformed, and revoked/expired codes all answer the SAME generic 404", async () => {
    const world = await seedWorld("redeem3");
    const grant = await mintCodedGrant(world);
    await db
      .update(serviceOrderPublicAccessToken)
      .set({ revokedAt: new Date(), revokedReason: "decided" })
      .where(eq(serviceOrderPublicAccessToken.quoteId, world.quoteId));

    const bodies: unknown[] = [];
    const statuses: number[] = [];
    for (const attempt of ["AAAAAAAA", "not-a-code!!", grant.code]) {
      const res = await redeemRequest(attempt);
      statuses.push(res.status);
      bodies.push(await res.json());
    }
    expect(statuses).toEqual([404, 404, 404]);
    expect(bodies[0]).toEqual({ error: "codigo_invalido" });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it("REQ-QPUB-014 [HIGH RISK]: the 11th attempt from one IP inside the window answers 429 — even with a valid code", async () => {
    const world = await seedWorld("redeem4");
    const grant = await mintCodedGrant(world);

    for (let i = 0; i < 10; i++) {
      const res = await redeemRequest("AAAAAAAA", "198.51.100.9");
      expect(res.status).toBe(404);
    }
    const throttled = await redeemRequest(grant.code, "198.51.100.9");
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toEqual({ error: "muitas_tentativas" });

    // A different IP is not throttled and the valid code still redeems.
    const otherIp = await redeemRequest(grant.code, "198.51.100.10");
    expect(otherIp.status).toBe(200);

    // The counter is durable (a Postgres row, not process memory).
    const rows = await db.select().from(publicCodeRedeemThrottle);
    const total = rows.reduce((sum, row) => sum + row.failedAttempts, 0);
    expect(total).toBeGreaterThanOrEqual(10);
  });

  it("REQ-QPUB-015: a successful redemption records service_order.public_code_redeemed with IP + user-agent", async () => {
    const world = await seedWorld("redeem5");
    const grant = await mintCodedGrant(world);

    const res = await publicServiceOrderAccessRouter.request("/redeem-code", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        "x-forwarded-for": "203.0.113.77",
        "user-agent": "vitest-agent",
      },
      body: JSON.stringify({ code: grant.code }),
    });
    expect(res.status).toBe(200);

    const events = await db
      .select()
      .from(serviceOrderEventLog)
      .where(eq(serviceOrderEventLog.serviceOrderId, world.serviceOrderId));
    const redeemed = events.find(
      (event) => event.eventType === "service_order.public_code_redeemed",
    );
    expect(redeemed).toBeDefined();
    expect(redeemed?.actorType).toBe("public_token");
    expect(redeemed?.ipAddress).toBe("203.0.113.77");
    expect(redeemed?.userAgent).toBe("vitest-agent");
  });

  it("redeem-code responses carry no-store + noindex headers", async () => {
    const res = await redeemRequest("AAAAAAAA");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("REQ-QPUB-003 interlock: a sibling token minted by redemption is revoked when the quote is decided", async () => {
    const world = await seedWorld("redeem6");
    const grant = await mintCodedGrant(world);

    const redeem = await redeemRequest(grant.code);
    const body = await redeem.json();

    const approve = await publicServiceOrderAccessRouter.request(
      `/${body.data.token}/approve-quote`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
    );
    expect(approve.status).toBe(200);

    const rows = await db
      .select()
      .from(serviceOrderPublicAccessToken)
      .where(eq(serviceOrderPublicAccessToken.quoteId, world.quoteId));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.revokedReason).toBe("decided");
    }

    // And the original emailed code is now a generic miss (REQ-QPUB-013).
    const reuse = await redeemRequest(grant.code, "203.0.113.99");
    expect(reuse.status).toBe(404);
  });
});
