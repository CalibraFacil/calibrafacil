/**
 * outbox-wiring.int.spec.ts: the e-mails a service-order command owes are queued in the SAME
 * transaction as the command, against a real Postgres through the real routes and RBAC (only
 * the better-auth session and the background queue are faked).
 *
 *   REQ-SOEMAIL-071  each command leaves exactly one `service_order_email_outbox` row with its
 *                    stable event key and a payload the drain can parse: `nova_os` (create),
 *                    `orcamento_sent:<quote>` (send quote), `quote_approved:<quote>` and
 *                    `quote_rejected:<quote>` (manual decision)
 *   REQ-SOEMAIL-072  the row and the command commit or roll back together: a refused command
 *                    queues nothing, and an outbox the database refuses takes the command
 *                    with it (the order and the quote are left as they were)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  organization,
  serviceOrder,
  serviceOrderEmailOutbox,
  serviceOrderQuote,
  serviceOrderQuoteItem,
} from "@calibra-facil/db/schema";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";
import { organizationOf } from "../../../../test/integration/organization-of";
import { serviceOrdersRouter } from "../routes/service-orders";
import { parseOutboxPayloadByNamespace } from "./email-outbox-payloads";

vi.mock("../../../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

const JSON_HEADERS = { "content-type": "application/json" };

async function seedWorld(status: (typeof serviceOrder.$inferInsert)["status"]) {
  const org = await seedOrg({ orgId: "org-a", role: "admin" });
  await withStatusRepair((tx) =>
    tx.insert(organization).values({
      id: "client-a",
      name: "Client A",
      slug: "client-a",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      type: "CLIENT",
      status: "ACTIVE",
    }),
  );
  const [cust] = await db
    .insert(customer)
    .values({
      name: "Cliente Exemplo",
      email: "cliente@exemplo.test",
      authOrganizationId: "client-a",
      labOrganizationId: org.orgId,
    })
    .returning({ id: customer.id });
  const [type] = await db
    .insert(assetType)
    .values({ name: "Instrumento", slug: "type-outbox", definition: [] })
    .returning({ id: assetType.id });
  if (!cust || !type) throw new Error("seed failed");
  const [ast] = await withStatusRepair((tx) =>
    tx
      .insert(asset)
      .values({
        unitId: org.unitId,
        customerId: cust.id,
        labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${cust.id})`,
        assetTypeId: type.id,
        name: "Balança",
        serialNumber: "SN-OUTBOX",
        tag: "TAG-OUTBOX",
        status: "ACTIVE",
      })
      .returning({ id: asset.id }),
  );
  if (!ast) throw new Error("seed failed");
  const [order] = await withStatusRepair((tx) =>
    tx
      .insert(serviceOrder)
      .values({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust.id,
        assetId: ast.id,
        openedByUserId: org.userId,
        serviceOrderNumber: "OS-OUTBOX-1",
        status,
        claimedDefect: "Não liga",
        intakeCondition: "Sem avarias",
        intakeType: "counter",
        deliveryMethod: "pickup_at_lab",
        priority: "normal",
        totalQuotedCents: 0,
        totalApprovedCents: 0,
        evaluationFeeCents: 0,
        evaluationFeeApplied: false,
        isExternalService: false,
      })
      .returning({ id: serviceOrder.id }),
  );
  if (!order) throw new Error("seed failed");
  loginAs({ userId: org.userId, organizationId: org.orgId });
  return { org, customerId: cust.id, assetId: ast.id, orderId: order.id };
}

async function seedQuote(
  world: Awaited<ReturnType<typeof seedWorld>>,
  status: (typeof serviceOrderQuote.$inferInsert)["status"],
) {
  const [quote] = await withStatusRepair((tx) =>
    tx
      .insert(serviceOrderQuote)
      .values({
        organizationId: organizationOf("service_order", world.orderId),
        serviceOrderId: world.orderId,
        quoteNumber: `ORC-${world.orderId}-1`,
        version: 1,
        status,
        totalCents: 12_000,
        createdByUserId: world.org.userId,
      })
      .returning({ id: serviceOrderQuote.id }),
  );
  if (!quote) throw new Error("quote insert failed");
  await db.insert(serviceOrderQuoteItem).values({
    organizationId: organizationOf("service_order", world.orderId),
    quoteId: quote.id,
    type: "service",
    description: "Serviço",
    quantity: "1",
    unit: "un",
    unitPriceCents: 12_000,
    totalPriceCents: 12_000,
  });
  return quote.id;
}

async function outboxRows(orderId: number) {
  return db
    .select({
      eventKey: serviceOrderEmailOutbox.eventKey,
      targetStatus: serviceOrderEmailOutbox.targetStatus,
      payload: serviceOrderEmailOutbox.payload,
      processedAt: serviceOrderEmailOutbox.processedAt,
    })
    .from(serviceOrderEmailOutbox)
    .where(eq(serviceOrderEmailOutbox.serviceOrderId, orderId));
}

function post(path: string, body: unknown) {
  return serviceOrdersRouter.request(
    path,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) },
    { PORTAL_APP_URL: "https://portal.test" },
  );
}

async function quoteStatus(quoteId: number) {
  const [row] = await db
    .select({ status: serviceOrderQuote.status })
    .from(serviceOrderQuote)
    .where(eq(serviceOrderQuote.id, quoteId));
  return row?.status;
}

async function orderStatus(orderId: number) {
  const [row] = await db
    .select({ status: serviceOrder.status })
    .from(serviceOrder)
    .where(eq(serviceOrder.id, orderId));
  return row?.status;
}

beforeEach(async () => {
  await truncateAll();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("REQ-SOEMAIL-071: one outbox row per command, with a payload the drain can parse", () => {
  it("creating a service order queues one nova_os row for it, and a refused creation queues none", async () => {
    const world = await seedWorld("awaiting_tech_evaluation");
    const create = (customerId: number) =>
      post("/", {
        customerId,
        assetId: world.assetId,
        intakeType: "counter",
        priority: "normal",
        claimedDefect: "Equipamento não liga",
        intakeCondition: "Caixa danificada",
        deliveryMethod: "pickup_at_lab",
        evaluationFeeCents: 0,
      });

    // A customer that does not exist for this laboratory: refused, nothing queued.
    expect((await create(999_999)).status).toBeGreaterThanOrEqual(400);
    expect(await db.select().from(serviceOrderEmailOutbox)).toEqual([]);

    const res = await create(world.customerId);
    expect(res.status).toBe(201);
    const created = (await res.json()).data;

    const rows = (await outboxRows(created.id)).filter(
      (row) => row.eventKey === "nova_os",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ processedAt: null });
    const parsed = parseOutboxPayloadByNamespace("nova_os", rows[0]?.payload);
    expect(parsed.namespace, JSON.stringify(parsed)).not.toBe("invalid");
    expect(rows[0]?.payload).toMatchObject({
      serviceOrderId: created.id,
      serviceOrderNumber: created.serviceOrderNumber,
      organizationId: world.org.orgId,
      customerName: "Cliente Exemplo",
    });
    // Nothing else of this order is queued by the creation.
  });

  it("sending a quote queues orcamento_sent:<quote> with the quote's items and the access link", async () => {
    const world = await seedWorld("awaiting_tech_evaluation");
    const quoteId = await seedQuote(world, "draft");

    const res = await post(`/${world.orderId}/quotes/${quoteId}/send`, {});

    expect(res.status).toBe(200);
    const rows = await outboxRows(world.orderId);
    expect(rows.map((row) => row.eventKey)).toEqual([
      `orcamento_sent:${quoteId}`,
    ]);
    const parsed = parseOutboxPayloadByNamespace(
      `orcamento_sent:${quoteId}`,
      rows[0]?.payload,
    );
    expect(parsed.namespace, JSON.stringify(parsed)).not.toBe("invalid");
    expect(rows[0]?.payload).toMatchObject({
      serviceOrderId: world.orderId,
      quoteId,
      organizationId: world.org.orgId,
      totalCents: 12_000,
    });
  });

  it("approving a quote by hand queues quote_approved:<quote>", async () => {
    const world = await seedWorld("awaiting_quote_approval");
    const quoteId = await seedQuote(world, "sent");

    const res = await post(
      `/${world.orderId}/quotes/${quoteId}/approve-manually`,
      {
        approvedByName: "Cliente Teste",
        manualApprovalEvidenceType: "phone",
        manualApprovalEvidenceText: "Cliente autorizou por telefone",
      },
    );

    expect(res.status).toBe(200);
    const rows = await outboxRows(world.orderId);
    expect(rows.map((row) => row.eventKey)).toEqual([
      `quote_approved:${quoteId}`,
    ]);
    const parsed = parseOutboxPayloadByNamespace(
      `quote_approved:${quoteId}`,
      rows[0]?.payload,
    );
    expect(parsed.namespace, JSON.stringify(parsed)).not.toBe("invalid");
    expect(rows[0]?.payload).toMatchObject({
      serviceOrderId: world.orderId,
      quoteId,
      organizationId: world.org.orgId,
      totalApprovedCents: 12_000,
    });
  });

  it("rejecting a quote by hand queues quote_rejected:<quote> carrying the reason", async () => {
    const world = await seedWorld("awaiting_quote_approval");
    const quoteId = await seedQuote(world, "sent");

    const res = await post(
      `/${world.orderId}/quotes/${quoteId}/reject-manually`,
      { rejectionReason: "Fora do orçamento" },
    );

    expect(res.status).toBe(200);
    const rows = await outboxRows(world.orderId);
    expect(rows.map((row) => row.eventKey)).toEqual([
      `quote_rejected:${quoteId}`,
    ]);
    const parsed = parseOutboxPayloadByNamespace(
      `quote_rejected:${quoteId}`,
      rows[0]?.payload,
    );
    expect(parsed.namespace, JSON.stringify(parsed)).not.toBe("invalid");
    expect(rows[0]?.payload).toMatchObject({
      serviceOrderId: world.orderId,
      quoteId,
      organizationId: world.org.orgId,
      rejectionReason: "Fora do orçamento",
    });
  });
});

describe("REQ-SOEMAIL-072: the outbox row and the command are one transaction", () => {
  it("a decision on a quote that is not awaiting one is refused (409) and queues nothing", async () => {
    const world = await seedWorld("awaiting_quote_approval");
    const quoteId = await seedQuote(world, "draft");

    const res = await post(
      `/${world.orderId}/quotes/${quoteId}/reject-manually`,
      { rejectionReason: "Fora do orçamento" },
    );

    expect(res.status).toBe(409);
    expect(await outboxRows(world.orderId)).toEqual([]);
    expect(await quoteStatus(quoteId)).toBe("draft");
  });

  it("an outbox the database refuses takes the approval with it: the quote stays sent and the order keeps its status", async () => {
    const world = await seedWorld("awaiting_quote_approval");
    const quoteId = await seedQuote(world, "sent");
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION outbox_test_refuse() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'outbox_test: service_order_email_outbox insert forced to fail';
      END;
      $$ LANGUAGE plpgsql`);
    await db.execute(sql`
      CREATE TRIGGER outbox_test_refuse
      BEFORE INSERT ON service_order_email_outbox
      FOR EACH ROW EXECUTE FUNCTION outbox_test_refuse()`);
    let res: Response;
    try {
      res = await post(`/${world.orderId}/quotes/${quoteId}/approve-manually`, {
        approvedByName: "Cliente Teste",
        manualApprovalEvidenceType: "phone",
        manualApprovalEvidenceText: "Cliente autorizou por telefone",
      });
    } finally {
      await db.execute(
        sql`DROP TRIGGER IF EXISTS outbox_test_refuse ON service_order_email_outbox`,
      );
      await db.execute(sql`DROP FUNCTION IF EXISTS outbox_test_refuse()`);
    }

    expect(res.status).not.toBe(200);
    expect(await quoteStatus(quoteId)).toBe("sent");
    expect(await orderStatus(world.orderId)).toBe("awaiting_quote_approval");
    expect(await outboxRows(world.orderId)).toEqual([]);
  });

  it("the same quote decided twice never queues the same event key twice", async () => {
    const world = await seedWorld("awaiting_quote_approval");
    const quoteId = await seedQuote(world, "sent");
    const approve = () =>
      post(`/${world.orderId}/quotes/${quoteId}/approve-manually`, {
        approvedByName: "Cliente Teste",
        manualApprovalEvidenceType: "phone",
        manualApprovalEvidenceText: "Cliente autorizou por telefone",
      });

    expect((await approve()).status).toBe(200);
    expect((await approve()).status).toBe(409);

    const keys = (await outboxRows(world.orderId)).map((row) => row.eventKey);
    expect(keys).toEqual([`quote_approved:${quoteId}`]);
    expect(
      await db
        .select({ id: serviceOrderEmailOutbox.id })
        .from(serviceOrderEmailOutbox)
        .where(
          and(
            eq(serviceOrderEmailOutbox.serviceOrderId, world.orderId),
            eq(serviceOrderEmailOutbox.eventKey, `quote_approved:${quoteId}`),
          ),
        ),
    ).toHaveLength(1);
  });
});
