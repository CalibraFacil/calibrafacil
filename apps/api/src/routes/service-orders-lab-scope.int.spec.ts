/**
 * service-orders-lab-scope.int.spec.ts — success paths of the laboratory service
 * order routes (P2-18g) that the other service-order specs do not reach, each
 * with a cross-laboratory negative: laboratory B's order, quote or evaluation
 * used in laboratory A's session answers 404/400 and leaves B's rows untouched.
 *
 * Real DB + real RBAC (only the better-auth session is mocked, see
 * test/integration/setup.ts). The handlers run every statement in
 * `orgDb(lab).transaction`, so this file is what the RLS shadow report
 * (`pnpm --filter @calibra-facil/api rls:shadow-report --files ...`) replays as
 * `calibra_app` to prove the order workflow carries the laboratory in every
 * statement.
 *
 *   REQ-SOLAB-001  POST / opens an order (number, asset snapshot, event, "nova OS"
 *                  outbox row, document jobs); foreign ids are refused
 *   REQ-SOLAB-002  reads: GET /by-public-id, /:id/communications, /reports/summary,
 *                  /pending-calibration, GET + PATCH /settings
 *   REQ-SOLAB-003  PATCH /:id, assign-technician, repair-mark
 *   REQ-SOLAB-004  evaluation, quote, send, manual approval, execution, delivery,
 *                  close with billing document (the whole lifecycle, step by step)
 *   REQ-SOLAB-005  documents: intake, tag, delivery document and their PDF links
 *   REQ-SOLAB-006  certificate link / unlink
 *   REQ-SOLAB-007  every endpoint refuses another laboratory's order with 404 and
 *                  writes nothing
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import {
  billingDocument,
  billingDocumentItem,
  receivableInstallment,
  serviceOrder,
  serviceOrderAssetSnapshot,
  serviceOrderCertificateLink,
  serviceOrderDeliveryDocument,
  serviceOrderEmailOutbox,
  serviceOrderEvaluation,
  serviceOrderEventLog,
  serviceOrderExecution,
  serviceOrderExecutionItem,
  serviceOrderIntakeDocument,
  serviceOrderNumberingSequence,
  serviceOrderPublicAccessToken,
  serviceOrderQuote,
  serviceOrderQuoteItem,
  serviceOrderSettings,
  serviceOrderTag,
} from "@calibra-facil/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedApprovedJob,
  seedBillableOrder,
  seedBillingLab,
  type BillingLab,
} from "../../test/integration/billing-fixtures";
import { organizationOf } from "../../test/integration/organization-of";
import { seedExtraMember } from "../../test/integration/tenant-refs";
import { enqueueBackgroundJob } from "../lib/background-jobs";
import { getQuoteDocumentDownloadUrl } from "../modules/service-orders/service-order.documents";
import { serviceOrdersRouter } from "./service-orders";

// The document and quote-PDF jobs read what the request wrote and render PDFs;
// they are not under test here (the enqueue itself is asserted).
vi.mock("../lib/background-jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/background-jobs")>()),
  enqueueBackgroundJob: vi.fn(async () => ({ messageId: "test-job" })),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const ENV = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  R2_BUCKET_NAME: "documents",
  R2_MEDIA_BUCKET_NAME: "media",
};

type Probe = { path: string; method?: string; body?: unknown };

async function call(probe: Probe) {
  const res = await serviceOrdersRouter.request(
    probe.path,
    {
      method: probe.method ?? "GET",
      headers: JSON_HEADERS,
      ...(probe.body === undefined ? {} : { body: JSON.stringify(probe.body) }),
    },
    ENV,
  );
  return { status: res.status, body: await res.json() };
}

async function twoLabs(): Promise<{ a: BillingLab; b: BillingLab }> {
  const a = await seedBillingLab("org-a");
  const b = await seedBillingLab("org-b");
  loginAs({ userId: a.userId, organizationId: a.orgId });
  return { a, b };
}

function intakeBody(lab: BillingLab, overrides: Record<string, unknown> = {}) {
  return {
    customerId: lab.customerId,
    assetId: lab.assetId,
    claimedDefect: "Nao liga",
    intakeCondition: "Riscos na carcaca",
    ...overrides,
  };
}

/** Opens an order of `lab` through the API (the "nova OS" path). */
async function openOrder(lab: BillingLab) {
  const { status, body } = await call({
    path: "/",
    method: "POST",
    body: intakeBody(lab),
  });
  expect(status).toBe(201);
  return {
    id: body.data.id,
    publicId: body.data.publicId,
    number: body.data.serviceOrderNumber,
  };
}

async function orderRow(id: number) {
  const [row] = await db
    .select()
    .from(serviceOrder)
    .where(eq(serviceOrder.id, id));
  return row;
}

async function eventTypes(orderId: number): Promise<string[]> {
  const rows = await db
    .select({ eventType: serviceOrderEventLog.eventType })
    .from(serviceOrderEventLog)
    .where(eq(serviceOrderEventLog.serviceOrderId, orderId))
    .orderBy(serviceOrderEventLog.id);
  return rows.map((row) => row.eventType);
}

/** Every service-order row of a laboratory, serialized, for "nothing changed" checks. */
async function snapshotOf(orgId: string): Promise<string> {
  const tables = [
    serviceOrder,
    serviceOrderAssetSnapshot,
    serviceOrderEvaluation,
    serviceOrderExecution,
    serviceOrderQuote,
    serviceOrderEventLog,
    serviceOrderEmailOutbox,
    serviceOrderIntakeDocument,
    serviceOrderTag,
    serviceOrderDeliveryDocument,
    serviceOrderPublicAccessToken,
    serviceOrderCertificateLink,
    serviceOrderSettings,
    billingDocument,
  ] as const;
  const rows = await Promise.all(
    tables.map((table) =>
      db.select().from(table).where(eq(table.organizationId, orgId)),
    ),
  );
  return JSON.stringify(rows);
}

describe("service orders (lab routes) — success paths and cross-laboratory negatives", () => {
  beforeEach(async () => {
    await truncateAll();
    vi.mocked(enqueueBackgroundJob).mockClear();
  });

  // ===========================================================================
  // REQ-SOLAB-001 — opening an order
  // ===========================================================================

  it("REQ-SOLAB-001 [HIGH RISK]: POST / numbers the order per laboratory, snapshots the asset, logs the event and queues the 'nova OS' e-mail and document jobs; ids of another laboratory are refused", async () => {
    const { a, b } = await twoLabs();
    const technicianB = await seedExtraMember({
      orgId: b.orgId,
      userId: "tech-b",
      role: "technician",
      unitId: b.unitId,
      unitRole: "technician",
    });
    const orderB = await seedBillableOrder(b, {
      number: "OS-B-SRC",
      status: "closed",
    });

    // Refusals first: nothing is created for any of them.
    const refusals = [
      intakeBody(a, { assetId: b.assetId }),
      intakeBody(a, { customerId: b.customerId }),
      intakeBody(a, { responsibleTechnicianId: technicianB.userId }),
      intakeBody(a, { sourceServiceOrderId: orderB }),
    ];
    const refused = await Promise.all(
      refusals.map((body) => call({ path: "/", method: "POST", body })),
    );
    expect(refused.map((res) => res.status)).toEqual([400, 400, 400, 400]);
    expect(
      await db
        .select()
        .from(serviceOrder)
        .where(eq(serviceOrder.organizationId, a.orgId)),
    ).toHaveLength(0);
    expect(vi.mocked(enqueueBackgroundJob)).not.toHaveBeenCalled();

    const created = await call({
      path: "/",
      method: "POST",
      body: intakeBody(a, { claimedDefect: "Display apagado" }),
    });
    expect(created.status).toBe(201);
    const order = created.body.data;
    expect(order.organizationId).toBe(a.orgId);
    expect(order.status).toBe("awaiting_tech_evaluation");
    expect(order.serviceOrderNumber).toMatch(/^OS-\d{4}-000001$/);

    const [snapshot] = await db
      .select({
        assetName: serviceOrderAssetSnapshot.assetName,
        serialNumber: serviceOrderAssetSnapshot.serialNumber,
      })
      .from(serviceOrderAssetSnapshot)
      .where(eq(serviceOrderAssetSnapshot.serviceOrderId, order.id));
    expect(snapshot).toEqual({
      assetName: `Instrument ${a.orgId}`,
      serialNumber: `SN-${a.orgId}`,
    });
    expect(await eventTypes(order.id)).toEqual(["service_order.created"]);
    const outbox = await db
      .select({
        organizationId: serviceOrderEmailOutbox.organizationId,
        eventKey: serviceOrderEmailOutbox.eventKey,
      })
      .from(serviceOrderEmailOutbox)
      .where(eq(serviceOrderEmailOutbox.serviceOrderId, order.id));
    expect(outbox.map((row) => row.eventKey).toSorted()).toEqual([
      "nova_os",
      "status_email:awaiting_tech_evaluation",
    ]);
    expect(outbox.every((row) => row.organizationId === a.orgId)).toBe(true);
    expect(
      vi
        .mocked(enqueueBackgroundJob)
        .mock.calls.map(([message]) => message.type)
        .toSorted(),
    ).toEqual(["SERVICE_ORDER_INTAKE_DOCUMENT", "SERVICE_ORDER_TAG"]);

    // The numbering sequence is per laboratory: B's first order is also 000001.
    loginAs({ userId: b.userId, organizationId: b.orgId });
    const createdB = await call({
      path: "/",
      method: "POST",
      body: intakeBody(b),
    });
    expect(createdB.status).toBe(201);
    expect(createdB.body.data.serviceOrderNumber).toMatch(/^OS-\d{4}-000001$/);
    const sequences = await db
      .select({ organizationId: serviceOrderNumberingSequence.organizationId })
      .from(serviceOrderNumberingSequence);
    expect(sequences.map((row) => row.organizationId).toSorted()).toEqual([
      a.orgId,
      b.orgId,
    ]);
  });

  // ===========================================================================
  // REQ-SOLAB-002 — reads and settings
  // ===========================================================================

  it("REQ-SOLAB-002: GET /by-public-id, /:id/communications, /reports/summary and /pending-calibration read only the laboratory's orders", async () => {
    const { a, b } = await twoLabs();
    const opened = await openOrder(a);
    const orderB = await seedBillableOrder(b, {
      number: "OS-B-1",
      status: "awaiting_tech_evaluation",
    });
    const [rowB] = await db
      .select({ publicId: serviceOrder.publicId })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, orderB));

    const byPublicId = await call({ path: `/by-public-id/${opened.publicId}` });
    expect(byPublicId.status).toBe(200);
    expect(byPublicId.body.data.id).toBe(opened.id);
    expect(
      (await call({ path: `/by-public-id/${rowB?.publicId}` })).status,
    ).toBe(404);

    const communications = await call({ path: `/${opened.id}/communications` });
    expect(communications.status).toBe(200);
    expect(
      communications.body.data
        .map((entry: { eventKey: string; status: string }) => [
          entry.eventKey,
          entry.status,
        ])
        .toSorted(),
    ).toEqual([
      ["nova_os", "queued"],
      ["status_email:awaiting_tech_evaluation", "queued"],
    ]);
    expect((await call({ path: `/${orderB}/communications` })).status).toBe(
      404,
    );

    const summary = await call({ path: "/reports/summary" });
    expect(summary.status).toBe(200);
    expect(summary.body.data.total).toBe(1);
    expect(summary.body.data.topCustomers).toEqual([
      {
        customerId: a.customerId,
        customerName: `Customer ${a.orgId}`,
        total: 1,
      },
    ]);

    // An order whose repair finished with "calibration required" and no job yet.
    const [execution] = await db
      .insert(serviceOrderExecution)
      .values({
        organizationId: a.orgId,
        serviceOrderId: opened.id,
        startedByUserId: a.userId,
        calibrationRequiredAfterRepair: true,
        finishedAt: new Date("2026-02-01T00:00:00.000Z"),
        result: "repaired",
      })
      .returning({ id: serviceOrderExecution.id });
    expect(execution).toBeDefined();
    await db.insert(serviceOrderExecution).values({
      organizationId: b.orgId,
      serviceOrderId: orderB,
      startedByUserId: b.userId,
      calibrationRequiredAfterRepair: true,
      finishedAt: new Date("2026-02-01T00:00:00.000Z"),
      result: "repaired",
    });
    const pending = await call({ path: "/pending-calibration" });
    expect(pending.status).toBe(200);
    expect(pending.body.data.map((row: { id: number }) => row.id)).toEqual([
      opened.id,
    ]);
  });

  it("REQ-SOLAB-002: GET and PATCH /settings create and change only the laboratory's settings", async () => {
    const { a, b } = await twoLabs();
    await db.insert(serviceOrderSettings).values({
      organizationId: b.orgId,
      numberingTemplate: "B-{SEQ}",
      numberingScope: "organization",
    });

    const read = await call({ path: "/settings" });
    expect(read.status).toBe(200);
    expect(read.body.data.organizationId).toBe(a.orgId);
    expect(read.body.data.numberingTemplate).toBe("OS-{YYYY}-{SEQ}");

    const patched = await call({
      path: "/settings",
      method: "PATCH",
      body: {
        numberingTemplate: "LAB-A-{SEQ}",
        allowPublicQuoteApproval: false,
      },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.numberingTemplate).toBe("LAB-A-{SEQ}");

    const rows = await db
      .select({
        organizationId: serviceOrderSettings.organizationId,
        numberingTemplate: serviceOrderSettings.numberingTemplate,
        allowPublicQuoteApproval: serviceOrderSettings.allowPublicQuoteApproval,
      })
      .from(serviceOrderSettings)
      .orderBy(serviceOrderSettings.organizationId);
    expect(rows).toEqual([
      {
        organizationId: a.orgId,
        numberingTemplate: "LAB-A-{SEQ}",
        allowPublicQuoteApproval: false,
      },
      {
        organizationId: b.orgId,
        numberingTemplate: "B-{SEQ}",
        allowPublicQuoteApproval: true,
      },
    ]);
  });

  // ===========================================================================
  // REQ-SOLAB-003 — editing
  // ===========================================================================

  it("REQ-SOLAB-003: PATCH /:id, assign-technician and repair-mark change the laboratory's order (with events); another laboratory's technician is refused", async () => {
    const { a, b } = await twoLabs();
    const opened = await openOrder(a);
    const technicianA = await seedExtraMember({
      orgId: a.orgId,
      userId: "tech-a",
      role: "technician",
      unitId: a.unitId,
      unitRole: "technician",
    });
    const technicianB = await seedExtraMember({
      orgId: b.orgId,
      userId: "tech-b",
      role: "technician",
      unitId: b.unitId,
      unitRole: "technician",
    });

    const patched = await call({
      path: `/${opened.id}`,
      method: "PATCH",
      body: { priority: "urgent", status: "under_evaluation" },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({
      priority: "urgent",
      status: "under_evaluation",
    });
    expect(
      (
        await call({
          path: `/${opened.id}`,
          method: "PATCH",
          body: { responsibleTechnicianId: technicianB.userId },
        })
      ).status,
    ).toBe(400);

    const assigned = await call({
      path: `/${opened.id}/assign-technician`,
      method: "POST",
      body: { technicianId: technicianA.userId },
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.responsibleTechnicianId).toBe(technicianA.userId);
    expect(
      (
        await call({
          path: `/${opened.id}/assign-technician`,
          method: "POST",
          body: { technicianId: technicianB.userId },
        })
      ).status,
    ).toBe(400);

    const marked = await call({
      path: `/${opened.id}/repair-mark`,
      method: "PATCH",
      body: {
        inmetroRepairMarkNumber: "SELO-0042",
        inmetroRepairMarkAppliedAt: "2026-03-01T12:00:00.000Z",
      },
    });
    expect(marked.status).toBe(200);
    const row = await orderRow(opened.id);
    expect(row).toMatchObject({
      inmetroRepairMarkNumber: "SELO-0042",
      inmetroRepairMarkAppliedByUserId: a.userId,
      responsibleTechnicianId: technicianA.userId,
    });
    expect(await eventTypes(opened.id)).toEqual([
      "service_order.created",
      "service_order.status_changed",
      "service_order.technician_assigned",
      "service_order.repair_mark_updated",
    ]);
  });

  // ===========================================================================
  // REQ-SOLAB-004 — the lifecycle
  // ===========================================================================

  it("REQ-SOLAB-004 [HIGH RISK]: evaluation, quote, send, manual approval, execution, delivery and close (with billing document) run in the laboratory's transactions", async () => {
    const { a, b } = await twoLabs();
    const opened = await openOrder(a);
    const technicianA = await seedExtraMember({
      orgId: a.orgId,
      userId: "tech-a",
      role: "technician",
      unitId: a.unitId,
      unitRole: "technician",
    });

    // --- evaluation -----------------------------------------------------------
    const evaluated = await call({
      path: `/${opened.id}/evaluations`,
      method: "POST",
      body: {
        technicianId: technicianA.userId,
        diagnosis: "Fonte danificada",
        recommendedAction: "repair",
      },
    });
    expect(evaluated.status).toBe(200);
    expect(evaluated.body.data.technicianId).toBe(technicianA.userId);
    expect((await orderRow(opened.id))?.status).toBe("awaiting_quote_approval");
    const duplicate = await call({
      path: `/${opened.id}/evaluations`,
      method: "POST",
      body: { diagnosis: "Outra", recommendedAction: "repair" },
    });
    expect(duplicate.status).toBe(409);

    const revised = await call({
      path: `/${opened.id}/evaluations/${evaluated.body.data.id}`,
      method: "PATCH",
      body: { diagnosis: "Fonte e capacitor danificados" },
    });
    expect(revised.status).toBe(200);
    expect(revised.body.data.diagnosis).toBe("Fonte e capacitor danificados");

    // --- quote ----------------------------------------------------------------
    const quoted = await call({
      path: `/${opened.id}/quotes`,
      method: "POST",
      body: {
        items: [
          {
            type: "service",
            description: "Reparo",
            quantity: 1,
            unitPriceCents: 20_000,
          },
          {
            type: "part",
            description: "Capacitor",
            quantity: 2,
            unitPriceCents: 1_500,
          },
        ],
      },
    });
    expect(quoted.status).toBe(201);
    const quoteId: number = quoted.body.data.id;
    expect(quoted.body.data).toMatchObject({
      version: 1,
      status: "draft",
      subtotalServicesCents: 20_000,
      subtotalPartsCents: 3_000,
      totalCents: 23_000,
    });
    expect(quoted.body.data.quoteNumber).toBe(`${opened.number}/ORC`);

    const redrafted = await call({
      path: `/${opened.id}/quotes/${quoteId}`,
      method: "PATCH",
      body: {
        clientMessage: "Valido por 15 dias",
        items: [
          {
            type: "service",
            description: "Reparo",
            quantity: 1,
            unitPriceCents: 18_000,
          },
        ],
      },
    });
    expect(redrafted.status).toBe(200);
    expect(redrafted.body.data).toMatchObject({
      totalCents: 18_000,
      clientMessage: "Valido por 15 dias",
    });
    const quoteItems = await db
      .select({ totalPriceCents: serviceOrderQuoteItem.totalPriceCents })
      .from(serviceOrderQuoteItem)
      .where(eq(serviceOrderQuoteItem.quoteId, quoteId));
    expect(quoteItems).toEqual([{ totalPriceCents: 18_000 }]);

    // --- send ------------------------------------------------------------------
    vi.mocked(enqueueBackgroundJob).mockClear();
    const sent = await call({
      path: `/${opened.id}/quotes/${quoteId}/send`,
      method: "POST",
      body: {},
    });
    expect(sent.status).toBe(200);
    expect(sent.body.publicUrl).toContain("/service-order-access/");
    const [quoteRow] = await db
      .select({ status: serviceOrderQuote.status })
      .from(serviceOrderQuote)
      .where(eq(serviceOrderQuote.id, quoteId));
    expect(quoteRow?.status).toBe("sent");
    const tokens = await db
      .select({
        organizationId: serviceOrderPublicAccessToken.organizationId,
        scope: serviceOrderPublicAccessToken.scope,
        revokedAt: serviceOrderPublicAccessToken.revokedAt,
      })
      .from(serviceOrderPublicAccessToken)
      .where(eq(serviceOrderPublicAccessToken.quoteId, quoteId));
    expect(tokens).toEqual([
      { organizationId: a.orgId, scope: "quote", revokedAt: null },
    ]);
    const outboxKeys = await db
      .select({ eventKey: serviceOrderEmailOutbox.eventKey })
      .from(serviceOrderEmailOutbox)
      .where(eq(serviceOrderEmailOutbox.serviceOrderId, opened.id));
    expect(outboxKeys.map((row) => row.eventKey).toSorted()).toEqual([
      "nova_os",
      `orcamento_sent:${quoteId}`,
      "status_email:awaiting_tech_evaluation",
    ]);
    expect(
      vi.mocked(enqueueBackgroundJob).mock.calls.map(([message]) => message),
    ).toEqual([
      expect.objectContaining({ type: "SERVICE_ORDER_QUOTE", quoteId }),
    ]);

    // --- manual approval ---------------------------------------------------------
    const approved = await call({
      path: `/${opened.id}/quotes/${quoteId}/approve-manually`,
      method: "POST",
      body: {
        approvedByName: "Cliente",
        manualApprovalEvidenceType: "phone",
        manualApprovalEvidenceText: "Aprovado por telefone.",
      },
    });
    expect(approved.status).toBe(200);
    expect(await orderRow(opened.id)).toMatchObject({
      status: "quote_approved",
      totalApprovedCents: 18_000,
    });
    const [revokedToken] = await db
      .select({ reason: serviceOrderPublicAccessToken.revokedReason })
      .from(serviceOrderPublicAccessToken)
      .where(eq(serviceOrderPublicAccessToken.quoteId, quoteId));
    expect(revokedToken?.reason).toBe("decided");

    // --- execution ---------------------------------------------------------------
    const started = await call({
      path: `/${opened.id}/execution/start`,
      method: "POST",
      body: { notes: "Inicio do reparo" },
    });
    expect(started.status).toBe(200);
    expect((await orderRow(opened.id))?.status).toBe("repair_in_progress");

    const progressed = await call({
      path: `/${opened.id}/execution`,
      method: "PATCH",
      body: {
        servicePerformed: "Troca de capacitor",
        items: [
          {
            type: "part",
            description: "Capacitor",
            quantity: 2,
            unitPriceCents: 1_500,
            unitCostCents: 400,
          },
        ],
      },
    });
    expect(progressed.status).toBe(200);
    const executionItems = await db
      .select({
        totalPriceCents: serviceOrderExecutionItem.totalPriceCents,
        unitCostCents: serviceOrderExecutionItem.unitCostCents,
      })
      .from(serviceOrderExecutionItem)
      .where(eq(serviceOrderExecutionItem.organizationId, a.orgId));
    expect(executionItems).toEqual([
      { totalPriceCents: 3_000, unitCostCents: 400 },
    ]);

    const finished = await call({
      path: `/${opened.id}/execution/finish`,
      method: "POST",
      body: {
        servicePerformed: "Troca de capacitor e fonte",
        result: "repaired",
      },
    });
    expect(finished.status).toBe(200);
    expect((await orderRow(opened.id))?.status).toBe("awaiting_final_review");

    // --- ready, deliver, close with billing --------------------------------------
    expect(
      (
        await call({
          path: `/${opened.id}`,
          method: "PATCH",
          body: { status: "ready_for_pickup" },
        })
      ).status,
    ).toBe(200);
    const delivered = await call({
      path: `/${opened.id}/deliver`,
      method: "POST",
      body: {
        deliveryMethod: "pickup_at_lab",
        deliveredToName: "Joao",
      },
    });
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.status).toBe("delivered");

    const closed = await call({
      path: `/${opened.id}/close`,
      method: "POST",
      body: {
        closingReason: "completed_repaired",
        createBillingDocument: true,
      },
    });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("closed");

    const closedRow = await orderRow(opened.id);
    expect(closedRow?.billingDocumentId).not.toBeNull();
    const [document] = await db
      .select()
      .from(billingDocument)
      .where(eq(billingDocument.id, closedRow?.billingDocumentId ?? 0));
    expect(document).toMatchObject({
      organizationId: a.orgId,
      status: "DRAFT",
      subtotalCents: 18_000,
      totalCents: 18_000,
    });
    expect(document?.documentNumber).toMatch(/^FIN-\d{4}-0001$/);
    const [item] = await db
      .select({
        organizationId: billingDocumentItem.organizationId,
        serviceOrderId: billingDocumentItem.serviceOrderId,
        totalCents: billingDocumentItem.totalCents,
      })
      .from(billingDocumentItem)
      .where(eq(billingDocumentItem.documentId, document?.id ?? 0));
    expect(item).toEqual({
      organizationId: a.orgId,
      serviceOrderId: opened.id,
      totalCents: 18_000,
    });
    const [installment] = await db
      .select({ amountCents: receivableInstallment.amountCents })
      .from(receivableInstallment)
      .where(eq(receivableInstallment.documentId, document?.id ?? 0));
    expect(installment?.amountCents).toBe(18_000);

    expect(await eventTypes(opened.id)).toEqual([
      "service_order.created",
      "service_order.evaluation_completed",
      "service_order.evaluation_updated",
      "service_order.quote_created",
      "service_order.quote_sent",
      "service_order.quote_approved_manually",
      "service_order.repair_started",
      "service_order.repair_finished",
      "service_order.status_changed",
      "service_order.delivered",
      "service_order.closed",
    ]);
    // Nothing of this was written for laboratory B.
    expect(await snapshotOf(b.orgId)).toBe(
      JSON.stringify(Array.from({ length: 14 }, () => [])),
    );

    // --- reopen (restores the status the order left) --------------------------------
    const reopened = await call({
      path: `/${opened.id}/reopen`,
      method: "POST",
      body: { reason: "Cliente pediu ajuste" },
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.status).toBe("delivered");
  });

  // ===========================================================================
  // REQ-SOLAB-005 — documents
  // ===========================================================================

  it("REQ-SOLAB-005: intake document, tag and delivery document are issued (with events and jobs) and their PDF links resolve; another laboratory's order answers 404", async () => {
    const { a, b } = await twoLabs();
    const opened = await openOrder(a);
    const orderB = await seedBillableOrder(b, {
      number: "OS-B-1",
      status: "awaiting_tech_evaluation",
    });
    vi.mocked(enqueueBackgroundJob).mockClear();

    const intake = await call({
      path: `/${opened.id}/intake-document`,
      method: "POST",
    });
    expect(intake.status).toBe(200);
    expect(intake.body.data.documentNumber).toBe(`${opened.number}/REC`);
    const tag = await call({ path: `/${opened.id}/tag`, method: "POST" });
    expect(tag.status).toBe(200);
    expect(tag.body.data.tagNumber).toBe(`${opened.number}-TAG-1`);
    const delivery = await call({
      path: `/${opened.id}/delivery-document`,
      method: "POST",
      body: {
        clientSignatureData: {
          signerName: "Joao",
          dataUrl: "data:image/png;base64,AAAA",
        },
      },
    });
    expect(delivery.status).toBe(200);
    expect(delivery.body.data.documentNumber).toBe(`${opened.number}/ENT`);
    expect(
      vi
        .mocked(enqueueBackgroundJob)
        .mock.calls.map(([message]) => message.type),
    ).toEqual([
      "SERVICE_ORDER_INTAKE_DOCUMENT",
      "SERVICE_ORDER_TAG",
      "SERVICE_ORDER_DELIVERY_RECEIPT",
    ]);
    expect(await eventTypes(opened.id)).toEqual([
      "service_order.created",
      "service_order.intake_document_issued",
      "service_order.tag_printed",
      "service_order.delivery_document_issued",
    ]);

    // Before the PDFs are rendered there is no link.
    expect(
      (await call({ path: `/${opened.id}/intake-document.pdf` })).status,
    ).toBe(404);
    await db
      .update(serviceOrderIntakeDocument)
      .set({ pdfR2Key: "docs/intake.pdf" })
      .where(eq(serviceOrderIntakeDocument.serviceOrderId, opened.id));
    await db
      .update(serviceOrderTag)
      .set({ pdfR2Key: "docs/tag.pdf" })
      .where(eq(serviceOrderTag.serviceOrderId, opened.id));
    await db
      .update(serviceOrderDeliveryDocument)
      .set({ pdfR2Key: "docs/delivery.pdf" })
      .where(eq(serviceOrderDeliveryDocument.serviceOrderId, opened.id));
    for (const path of [
      `/${opened.id}/intake-document.pdf`,
      `/${opened.id}/tag.pdf`,
      `/${opened.id}/delivery-document.pdf`,
    ]) {
      const link = await call({ path });
      expect(link.status).toBe(200);
      expect(link.body.url).toContain("docs/");
    }

    // The quote PDF link.
    const [quote] = await db
      .insert(serviceOrderQuote)
      .values({
        organizationId: a.orgId,
        serviceOrderId: opened.id,
        quoteNumber: `${opened.number}/ORC`,
        version: 1,
        status: "sent",
        pdfR2Key: "docs/quote.pdf",
        createdByUserId: a.userId,
      })
      .returning({ id: serviceOrderQuote.id });
    // (The route `/:id/quotes/:quoteId.pdf` captures "1.pdf" as the id and answers
    // 400 for every quote today, so the link function is exercised directly.)
    expect(
      await getQuoteDocumentDownloadUrl(
        ENV,
        opened.id,
        quote?.id ?? 0,
        a.orgId,
      ),
    ).toContain("docs/quote.pdf");
    expect(
      await getQuoteDocumentDownloadUrl(
        ENV,
        opened.id,
        quote?.id ?? 0,
        b.orgId,
      ),
    ).toBeNull();

    // Laboratory B: every document endpoint refuses, and issues nothing.
    const before = await snapshotOf(b.orgId);
    for (const probe of [
      { path: `/${orderB}/intake-document`, method: "POST" },
      { path: `/${orderB}/tag`, method: "POST" },
      {
        path: `/${orderB}/delivery-document`,
        method: "POST",
        body: {},
      },
      { path: `/${orderB}/intake-document.pdf` },
      { path: `/${orderB}/tag.pdf` },
      { path: `/${orderB}/delivery-document.pdf` },
    ] satisfies Probe[]) {
      expect((await call(probe)).status).toBe(404);
    }
    expect(await snapshotOf(b.orgId)).toBe(before);
  });

  // ===========================================================================
  // REQ-SOLAB-006 — certificate links
  // ===========================================================================

  it("REQ-SOLAB-006: link and unlink a certificate of the laboratory's asset; another laboratory's job is refused", async () => {
    const { a, b } = await twoLabs();
    const opened = await openOrder(a);
    const jobA = await seedApprovedJob(a, "JOB-A-1");
    const jobB = await seedApprovedJob(b, "JOB-B-1");

    const refused = await call({
      path: `/${opened.id}/certificates/${jobB}/link`,
      method: "POST",
    });
    expect(refused.status).toBe(404);
    expect(await db.select().from(serviceOrderCertificateLink)).toHaveLength(0);

    const linked = await call({
      path: `/${opened.id}/certificates/${jobA}/link`,
      method: "POST",
    });
    expect(linked.status).toBe(200);
    expect(linked.body.data.organizationId).toBe(a.orgId);
    expect(await eventTypes(opened.id)).toContain(
      "service_order.certificate_linked",
    );

    const unlinked = await call({
      path: `/${opened.id}/certificates/${jobA}/link`,
      method: "DELETE",
    });
    expect(unlinked.status).toBe(200);
    expect(await db.select().from(serviceOrderCertificateLink)).toHaveLength(0);
    expect(await eventTypes(opened.id)).toContain(
      "service_order.certificate_unlinked",
    );
  });

  // ===========================================================================
  // REQ-SOLAB-007 — one probe per endpoint
  // ===========================================================================

  it("REQ-SOLAB-007 [HIGH RISK]: every endpoint refuses another laboratory's order with 404 and leaves its rows untouched", async () => {
    const { a, b } = await twoLabs();
    const orderB = await seedBillableOrder(b, {
      number: "OS-B-1",
      status: "awaiting_quote_approval",
    });
    const [rowB] = await db
      .select({ publicId: serviceOrder.publicId })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, orderB));
    const [evaluationB] = await db
      .insert(serviceOrderEvaluation)
      .values({
        organizationId: b.orgId,
        serviceOrderId: orderB,
        technicianId: b.userId,
        diagnosis: "Diagnostico B",
        recommendedAction: "repair",
      })
      .returning({ id: serviceOrderEvaluation.id });
    const [draftB, sentB] = await Promise.all(
      (["draft", "sent"] as const).map(async (status, index) => {
        const [row] = await db
          .insert(serviceOrderQuote)
          .values({
            organizationId: b.orgId,
            serviceOrderId: orderB,
            quoteNumber: `OS-B-1/ORC${index}`,
            version: index + 1,
            status,
            totalCents: 10_000,
            createdByUserId: b.userId,
          })
          .returning({ id: serviceOrderQuote.id });
        return row;
      }),
    );
    await db.insert(serviceOrderExecution).values({
      organizationId: organizationOf("service_order", orderB),
      serviceOrderId: orderB,
      startedByUserId: b.userId,
    });
    const jobA = await seedApprovedJob(a, "JOB-A-1");
    expect(evaluationB && draftB && sentB).toBeTruthy();

    const probes: Probe[] = [
      { path: `/${orderB}` },
      { path: `/by-public-id/${rowB?.publicId}` },
      { path: `/${orderB}/communications` },
      { path: `/${orderB}`, method: "PATCH", body: { priority: "urgent" } },
      {
        path: `/${orderB}/assign-technician`,
        method: "POST",
        body: { technicianId: a.userId },
      },
      {
        path: `/${orderB}/repair-mark`,
        method: "PATCH",
        body: { inmetroRepairMarkNumber: "X" },
      },
      {
        path: `/${orderB}/evaluations`,
        method: "POST",
        body: { diagnosis: "x", recommendedAction: "repair" },
      },
      {
        path: `/${orderB}/evaluations/${evaluationB?.id}`,
        method: "PATCH",
        body: { diagnosis: "invadido" },
      },
      {
        path: `/${orderB}/quotes`,
        method: "POST",
        body: {
          items: [
            {
              type: "service",
              description: "x",
              quantity: 1,
              unitPriceCents: 1,
            },
          ],
        },
      },
      {
        path: `/${orderB}/quotes/${draftB?.id}`,
        method: "PATCH",
        body: { clientMessage: "invadido" },
      },
      {
        path: `/${orderB}/quotes/${draftB?.id}/send`,
        method: "POST",
        body: {},
      },
      {
        path: `/${orderB}/quotes/${sentB?.id}/approve-manually`,
        method: "POST",
        body: {
          approvedByName: "x",
          manualApprovalEvidenceType: "phone",
          manualApprovalEvidenceText: "invadido",
        },
      },
      {
        path: `/${orderB}/quotes/${sentB?.id}/reject-manually`,
        method: "POST",
        body: { rejectionReason: "invadido" },
      },
      { path: `/${orderB}/execution/start`, method: "POST", body: {} },
      {
        path: `/${orderB}/execution`,
        method: "PATCH",
        body: { servicePerformed: "invadido" },
      },
      {
        path: `/${orderB}/execution/finish`,
        method: "POST",
        body: { servicePerformed: "invadido", result: "repaired" },
      },
      {
        path: `/${orderB}/deliver`,
        method: "POST",
        body: { deliveryMethod: "pickup_at_lab", deliveredToName: "x" },
      },
      {
        path: `/${orderB}/close`,
        method: "POST",
        body: {
          closingReason: "completed_repaired",
          createBillingDocument: true,
        },
      },
      {
        path: `/${orderB}/cancel`,
        method: "POST",
        body: { reason: "invadido" },
      },
      {
        path: `/${orderB}/reopen`,
        method: "POST",
        body: { reason: "invadido" },
      },
      {
        path: `/${orderB}/certificates/${jobA}/link`,
        method: "POST",
      },
      {
        path: `/${orderB}/certificates/${jobA}/link`,
        method: "DELETE",
      },
    ];

    const before = await snapshotOf(b.orgId);
    const answers = await Promise.all(probes.map((probe) => call(probe)));
    expect(
      answers.map((answer, index) => [
        probes[index]?.method ?? "GET",
        probes[index]?.path.replace(String(orderB), ":id"),
        answer.status,
      ]),
    ).toEqual(
      probes.map((probe) => [
        probe.method ?? "GET",
        probe.path.replace(String(orderB), ":id"),
        404,
      ]),
    );
    expect(await snapshotOf(b.orgId)).toBe(before);
    // Nothing was written for A either (B's order never reached A's rows).
    expect(
      await db
        .select({ id: serviceOrderEventLog.id })
        .from(serviceOrderEventLog)
        .where(
          and(
            eq(serviceOrderEventLog.organizationId, a.orgId),
            inArray(serviceOrderEventLog.serviceOrderId, [orderB]),
          ),
        ),
    ).toHaveLength(0);
  });
});
