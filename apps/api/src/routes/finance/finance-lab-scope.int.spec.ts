/**
 * finance-lab-scope.int.spec.ts — success paths of the finance routes and libs
 * (P2-18g) that the per-router specs do not reach, each with a cross-laboratory
 * negative: laboratory B's id used in laboratory A's session answers 404 (or an
 * `ok: false` result), with nothing read or written for B.
 *
 * Real DB + real RBAC (only the better-auth session is mocked, see
 * test/integration/setup.ts; the ERP's HTTP endpoint is a stubbed `fetch`). The
 * handlers run every statement in `orgDb(lab).transaction`, so this file is what
 * the RLS shadow report (`pnpm --filter @calibra-facil/api rls:shadow-report
 * --files ...`) replays as `calibra_app` to prove the money paths carry the
 * laboratory in every statement.
 *
 *   REQ-FINLAB-DOC   documents: POST, GET list / eligible-jobs / :id, PUT, issue, void
 *   REQ-FINLAB-REC   receipts: GET list, POST installment receive
 *   REQ-FINLAB-CON   contracts: GET list / :id, PUT, activate, cancel
 *   REQ-FINLAB-RDY   billing readiness: GET queue, POST send (document + ERP export)
 *   REQ-FINLAB-ERP   ERP: GET exports, POST document export
 *   REQ-FINLAB-DASH  operations-to-cash, revenue leakage, cash forecast, margins
 *   REQ-FINLAB-FCST  cash forecast by unit scope (standalone documents count lab-wide)
 *   REQ-FINLAB-POL   certificate-release policy PUT, automatic-send rule GET / PUT
 *   REQ-FINLAB-ENG   automatic-send engine (trigger + job lookup)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import {
  automaticSendAuditLog,
  automaticSendRule,
  billingDocument,
  billingDocumentItem,
  certificateReleasePolicy,
  commercialAgreement,
  commercialAgreementServiceTerm,
  customer,
  financialAuditLog,
  integrationConnection,
  integrationEventLog,
  integrationObjectLink,
  jobCommercialSnapshot,
  organizationUnit,
  organizationIntegration,
  paymentReceipt,
  receivableInstallment,
  serviceOrder,
} from "@calibra-facil/db/schema";
import { routeOutboundThroughGlobalFetch } from "@calibra-facil/shared/outbound-testing";
import { encryptPassword } from "@calibra-facil/signing";
import { and, eq, inArray, sql } from "drizzle-orm";
import { loginAs } from "../../../test/integration/setup";
import { truncateAll } from "../../../test/integration/db";
import {
  SERVICE_PRICE_CENTS,
  seedApprovedJob,
  seedBillableOrder,
  seedBillingLab,
  type BillingLab,
} from "../../../test/integration/billing-fixtures";
import {
  findServiceOrdersForCalibrationJob,
  triggerAutomaticSendForMilestone,
} from "../../lib/automatic-send";
import { financeRouter } from "./index";
import { settingsCertificateReleasePolicyRouter } from "./certificate-release";

const JSON_HEADERS = { "content-type": "application/json" };
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = { INTEGRATIONS_MASTER_KEY: MASTER_KEY };

type Probe = {
  path: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

type Requester = {
  request(
    input: string,
    init?: RequestInit,
    env?: unknown,
  ): Response | Promise<Response>;
};

async function call(probe: Probe, app: Requester = financeRouter) {
  const res = await app.request(
    probe.path,
    {
      method: probe.method ?? "GET",
      headers: { ...JSON_HEADERS, ...probe.headers },
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

/** A billing document written directly (no job, no snapshot). */
async function seedDocument(
  lab: BillingLab,
  params: {
    status?: "DRAFT" | "ISSUED" | "PAID" | "OVERDUE" | "VOID";
    totalCents?: number;
    documentNumber?: string;
    dueDate?: Date;
    withInstallment?: boolean;
  } = {},
): Promise<{ id: number; publicId: string; installmentId: number | null }> {
  const total = params.totalCents ?? 10_000;
  const [row] = await db
    .insert(billingDocument)
    .values({
      organizationId: lab.orgId,
      unitId: lab.unitId,
      customerId: lab.customerId,
      status: params.status ?? "DRAFT",
      documentNumber: params.documentNumber ?? null,
      dueDate: params.dueDate ?? new Date("2026-12-31T00:00:00.000Z"),
      currency: "BRL",
      subtotalCents: total,
      discountCents: 0,
      totalCents: total,
      createdBy: lab.userId,
      updatedBy: lab.userId,
    })
    .returning({ id: billingDocument.id, publicId: billingDocument.publicId });
  if (!row) throw new Error("seedDocument: insert failed");
  let installmentId: number | null = null;
  if (params.withInstallment) {
    const [installment] = await db
      .insert(receivableInstallment)
      .values({
        organizationId: lab.orgId,
        documentId: row.id,
        installmentNumber: 1,
        status: "OPEN",
        dueDate: params.dueDate ?? new Date("2026-12-31T00:00:00.000Z"),
        amountCents: total,
        currency: "BRL",
      })
      .returning({ id: receivableInstallment.id });
    installmentId = installment?.id ?? null;
  }
  return { ...row, installmentId };
}

async function documentRow(id: number) {
  const [row] = await db
    .select()
    .from(billingDocument)
    .where(eq(billingDocument.id, id));
  return row;
}

/** Creates a draft document for one job of `lab` through the API. */
async function createDraftThroughApi(jobId: number) {
  const { status, body } = await call({
    path: "/documents",
    method: "POST",
    body: { mode: "single", jobIds: [jobId] },
  });
  expect(status).toBe(201);
  return { id: body.data.id, publicId: body.data.publicId };
}

describe("finance routes — success paths and cross-laboratory negatives", () => {
  let restoreOutbound = () => {};

  beforeEach(async () => {
    await truncateAll();
    // The ERP export goes through safeOutboundFetch: route it through the
    // stubbed global fetch so the remote system stays a mock.
    restoreOutbound = routeOutboundThroughGlobalFetch();
  });

  afterEach(() => {
    restoreOutbound();
    vi.unstubAllGlobals();
  });

  // ===========================================================================
  // documents
  // ===========================================================================

  it("REQ-FINLAB-DOC-001 [HIGH RISK]: POST /documents bills the laboratory's approved job at its snapshot price; another laboratory's job answers 404 and creates nothing", async () => {
    const { a, b } = await twoLabs();
    const jobA = await seedApprovedJob(a, "JOB-A-1");
    const jobB = await seedApprovedJob(b, "JOB-B-1");

    const denied = await call({
      path: "/documents",
      method: "POST",
      body: { mode: "single", jobIds: [jobB] },
    });
    expect(denied.status).toBe(404);
    expect(await db.select().from(billingDocument)).toHaveLength(0);
    expect(await db.select().from(jobCommercialSnapshot)).toHaveLength(0);

    const created = await call({
      path: "/documents",
      method: "POST",
      body: { mode: "single", jobIds: [jobA], discountCents: 500 },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.organizationId).toBe(a.orgId);
    expect(created.body.data.status).toBe("DRAFT");
    expect(created.body.data.subtotalCents).toBe(SERVICE_PRICE_CENTS);
    expect(created.body.data.discountCents).toBe(500);
    expect(created.body.data.totalCents).toBe(SERVICE_PRICE_CENTS - 500);

    const items = await db
      .select()
      .from(billingDocumentItem)
      .where(eq(billingDocumentItem.documentId, created.body.data.id));
    expect(items).toHaveLength(1);
    expect(items[0]?.jobId).toBe(jobA);
    expect(items[0]?.totalCents).toBe(SERVICE_PRICE_CENTS);
    const audit = await db
      .select({ action: financialAuditLog.action })
      .from(financialAuditLog)
      .where(eq(financialAuditLog.organizationId, a.orgId));
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(["document.create", "snapshot.create"]),
    );
    // Laboratory B has no row of any kind.
    expect(
      await db
        .select()
        .from(financialAuditLog)
        .where(eq(financialAuditLog.organizationId, b.orgId)),
    ).toHaveLength(0);
  });

  it("REQ-FINLAB-DOC-002: GET /documents and /documents/:publicId list and read only the laboratory's documents", async () => {
    const { a, b } = await twoLabs();
    const jobA = await seedApprovedJob(a, "JOB-A-1");
    const docA = await createDraftThroughApi(jobA);
    const docB = await seedDocument(b);

    const list = await call({ path: "/documents" });
    expect(list.status).toBe(200);
    expect(list.body.data.map((row: { id: number }) => row.id)).toEqual([
      docA.id,
    ]);

    const one = await call({ path: `/documents/${docA.publicId}` });
    expect(one.status).toBe(200);
    expect(one.body.data.id).toBe(docA.id);
    expect(one.body.data.items).toHaveLength(1);

    const denied = await call({ path: `/documents/${docB.publicId}` });
    expect(denied.status).toBe(404);
  });

  it("REQ-FINLAB-DOC-003: GET /documents/eligible-jobs offers only the laboratory's unbilled approved jobs", async () => {
    const { a, b } = await twoLabs();
    const billedJob = await seedApprovedJob(a, "JOB-A-1");
    await seedApprovedJob(a, "JOB-A-2");
    await seedApprovedJob(b, "JOB-B-1");
    await createDraftThroughApi(billedJob);

    const res = await call({ path: "/documents/eligible-jobs" });
    expect(res.status).toBe(200);
    expect(res.body.data.map((job: { jobId: string }) => job.jobId)).toEqual([
      "JOB-A-2",
    ]);
    expect(res.body.data[0].priceCents).toBe(SERVICE_PRICE_CENTS);
    // The eligible listing creates the snapshot of the laboratory's own jobs only.
    const snapshots = await db
      .select({ organizationId: jobCommercialSnapshot.organizationId })
      .from(jobCommercialSnapshot);
    expect(snapshots.map((row) => row.organizationId)).not.toContain(b.orgId);
  });

  it("REQ-FINLAB-DOC-004 [HIGH RISK]: PUT /documents/:id edits a draft (totals follow the items); another laboratory's id answers 404 and stays untouched", async () => {
    const { a, b } = await twoLabs();
    const jobA = await seedApprovedJob(a, "JOB-A-1");
    const docA = await createDraftThroughApi(jobA);
    const docB = await seedDocument(b, { totalCents: 7_000 });

    const [itemA] = await db
      .select({ id: billingDocumentItem.id })
      .from(billingDocumentItem)
      .where(eq(billingDocumentItem.documentId, docA.id));

    const denied = await call({
      path: `/documents/${docB.id}`,
      method: "PUT",
      body: { discountCents: 1_000, notes: "tentativa cross-lab" },
    });
    expect(denied.status).toBe(404);
    const untouched = await documentRow(docB.id);
    expect(untouched?.discountCents).toBe(0);
    expect(untouched?.totalCents).toBe(7_000);
    expect(untouched?.notes).toBeNull();

    const updated = await call({
      path: `/documents/${docA.id}`,
      method: "PUT",
      body: {
        discountCents: 1_000,
        notes: "Ajuste comercial",
        reason: "Desconto aprovado pelo gerente",
        items: [
          {
            id: itemA?.id,
            description: "Calibracao com desconto",
            quantity: 2,
            unitPriceCents: 6_000,
          },
        ],
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.subtotalCents).toBe(12_000);
    expect(updated.body.data.discountCents).toBe(1_000);
    expect(updated.body.data.totalCents).toBe(11_000);
    expect(updated.body.data.notes).toBe("Ajuste comercial");
    const audit = await db
      .select({ action: financialAuditLog.action })
      .from(financialAuditLog)
      .where(eq(financialAuditLog.entityType, "document"));
    expect(audit.map((row) => row.action)).toContain("document.update");
  });

  it("REQ-FINLAB-DOC-005 [HIGH RISK]: POST /documents/:id/issue numbers the draft and opens its installment; another laboratory's draft answers 404 and stays a draft", async () => {
    const { a, b } = await twoLabs();
    const jobA = await seedApprovedJob(a, "JOB-A-1");
    const docA = await createDraftThroughApi(jobA);
    const docB = await seedDocument(b);

    const denied = await call({
      path: `/documents/${docB.id}/issue`,
      method: "POST",
    });
    expect(denied.status).toBe(404);
    const stillDraft = await documentRow(docB.id);
    expect(stillDraft?.status).toBe("DRAFT");
    expect(stillDraft?.documentNumber).toBeNull();
    expect(
      await db
        .select()
        .from(receivableInstallment)
        .where(eq(receivableInstallment.documentId, docB.id)),
    ).toHaveLength(0);

    const issued = await call({
      path: `/documents/${docA.id}/issue`,
      method: "POST",
    });
    expect(issued.status).toBe(200);
    expect(issued.body.data.status).toBe("ISSUED");
    expect(issued.body.data.documentNumber).toMatch(/^FIN-\d{4}-0001$/);
    expect(issued.body.data.installments).toHaveLength(1);
    expect(issued.body.data.installments[0].status).toBe("OPEN");
    expect(issued.body.data.installments[0].amountCents).toBe(
      SERVICE_PRICE_CENTS,
    );

    // The numbering sequence is per laboratory: B's first document is also 0001.
    loginAs({ userId: b.userId, organizationId: b.orgId });
    const issuedB = await call({
      path: `/documents/${docB.id}/issue`,
      method: "POST",
    });
    expect(issuedB.status).toBe(200);
    expect(issuedB.body.data.documentNumber).toMatch(/^FIN-\d{4}-0001$/);
  });

  it("REQ-FINLAB-DOC-006 [HIGH RISK]: POST /documents/:id/void voids the document and its installments; another laboratory's id answers 404 and stays issued", async () => {
    const { a, b } = await twoLabs();
    const docA = await seedDocument(a, {
      status: "ISSUED",
      documentNumber: "FIN-2026-0001",
      withInstallment: true,
    });
    const docB = await seedDocument(b, {
      status: "ISSUED",
      documentNumber: "FIN-2026-0001",
      withInstallment: true,
    });

    const denied = await call({
      path: `/documents/${docB.id}/void`,
      method: "POST",
      body: { reason: "tentativa cross-lab" },
    });
    expect(denied.status).toBe(404);
    expect((await documentRow(docB.id))?.status).toBe("ISSUED");
    const [installmentB] = await db
      .select({ status: receivableInstallment.status })
      .from(receivableInstallment)
      .where(eq(receivableInstallment.documentId, docB.id));
    expect(installmentB?.status).toBe("OPEN");

    const voided = await call({
      path: `/documents/${docA.id}/void`,
      method: "POST",
      body: { reason: "Faturado em duplicidade" },
    });
    expect(voided.status).toBe(200);
    expect(voided.body.data.status).toBe("VOID");
    expect(voided.body.data.voidReason).toBe("Faturado em duplicidade");
    expect(voided.body.data.installments[0].status).toBe("VOID");
  });

  // ===========================================================================
  // receipts
  // ===========================================================================

  it("REQ-FINLAB-REC-001 [HIGH RISK]: GET /receipts lists only the laboratory's installments; POST /installments/:id/receive settles it in full, another laboratory's installment answers 404 and stays open", async () => {
    const { a, b } = await twoLabs();
    const docA = await seedDocument(a, {
      status: "ISSUED",
      documentNumber: "FIN-2026-0001",
      totalCents: 15_000,
      withInstallment: true,
    });
    const docB = await seedDocument(b, {
      status: "ISSUED",
      documentNumber: "FIN-2026-0001",
      totalCents: 9_000,
      withInstallment: true,
    });

    const list = await call({ path: "/receipts" });
    expect(list.status).toBe(200);
    expect(
      list.body.data.map((row: { documentId: number }) => row.documentId),
    ).toEqual([docA.id]);

    const denied = await call({
      path: `/installments/${docB.installmentId}/receive`,
      method: "POST",
      body: { amountCents: 9_000, paymentMethod: "PIX" },
    });
    expect(denied.status).toBe(404);
    const [openB] = await db
      .select({ status: receivableInstallment.status })
      .from(receivableInstallment)
      .where(eq(receivableInstallment.id, docB.installmentId ?? 0));
    expect(openB?.status).toBe("OPEN");
    expect(await db.select().from(paymentReceipt)).toHaveLength(0);

    const partial = await call({
      path: `/installments/${docA.installmentId}/receive`,
      method: "POST",
      body: { amountCents: 5_000, paymentMethod: "PIX" },
    });
    expect(partial.status).toBe(400);

    const received = await call({
      path: `/installments/${docA.installmentId}/receive`,
      method: "POST",
      body: { amountCents: 15_000, paymentMethod: "PIX", reference: "E2E-1" },
    });
    expect(received.status).toBe(201);
    expect(received.body.data.amountCents).toBe(15_000);
    const [paidInstallment] = await db
      .select({
        status: receivableInstallment.status,
        reference: receivableInstallment.paymentReference,
      })
      .from(receivableInstallment)
      .where(eq(receivableInstallment.id, docA.installmentId ?? 0));
    expect(paidInstallment).toEqual({ status: "PAID", reference: "E2E-1" });
    expect((await documentRow(docA.id))?.status).toBe("PAID");
    const audit = await db
      .select({ action: financialAuditLog.action })
      .from(financialAuditLog)
      .where(eq(financialAuditLog.organizationId, a.orgId));
    expect(audit.map((row) => row.action)).toContain("receipt.record");
  });

  // ===========================================================================
  // contracts
  // ===========================================================================

  async function seedAgreement(lab: BillingLab, title: string) {
    const [agreement] = await db
      .insert(commercialAgreement)
      .values({
        organizationId: lab.orgId,
        customerId: lab.customerId,
        title,
        status: "DRAFT",
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
        createdBy: lab.userId,
        updatedBy: lab.userId,
      })
      .returning({ id: commercialAgreement.id });
    if (!agreement) throw new Error("seedAgreement: insert failed");
    await db.insert(commercialAgreementServiceTerm).values({
      organizationId: lab.orgId,
      agreementId: agreement.id,
      serviceId: lab.serviceId,
      priceCents: 12_000,
      currency: "BRL",
    });
    return agreement.id;
  }

  async function agreementRow(id: number) {
    const [row] = await db
      .select()
      .from(commercialAgreement)
      .where(eq(commercialAgreement.id, id));
    return row;
  }

  it("REQ-FINLAB-CON-001: GET /contracts and /contracts/:id read only the laboratory's agreements", async () => {
    const { a, b } = await twoLabs();
    const agreementA = await seedAgreement(a, "Contrato A");
    const agreementB = await seedAgreement(b, "Contrato B");

    const list = await call({ path: "/contracts" });
    expect(list.status).toBe(200);
    expect(list.body.data.map((row: { id: number }) => row.id)).toEqual([
      agreementA,
    ]);

    const one = await call({ path: `/contracts/${agreementA}` });
    expect(one.status).toBe(200);
    expect(one.body.data.serviceTerms).toHaveLength(1);
    expect(one.body.data.serviceTerms[0].priceCents).toBe(12_000);

    expect((await call({ path: `/contracts/${agreementB}` })).status).toBe(404);
  });

  it("REQ-FINLAB-CON-002 [HIGH RISK]: PUT /contracts/:id, activate and cancel change only the laboratory's agreement and keep the customer's compliance in step; another laboratory's id answers 404", async () => {
    const { a, b } = await twoLabs();
    const agreementA = await seedAgreement(a, "Contrato A");
    const agreementB = await seedAgreement(b, "Contrato B");

    for (const probe of [
      {
        path: `/contracts/${agreementB}`,
        method: "PUT",
        body: {
          customerId: a.customerId,
          title: "Invadido",
          effectiveFrom: "2020-01-01T00:00:00.000Z",
          serviceTerms: [{ serviceId: a.serviceId, priceCents: 1 }],
        },
      },
      { path: `/contracts/${agreementB}/activate`, method: "POST" },
      { path: `/contracts/${agreementB}/cancel`, method: "POST" },
    ] satisfies Probe[]) {
      const denied = await call(probe);
      expect(denied.status).toBe(404);
    }
    const untouchedB = await agreementRow(agreementB);
    expect(untouchedB?.title).toBe("Contrato B");
    expect(untouchedB?.status).toBe("DRAFT");

    const updated = await call({
      path: `/contracts/${agreementA}`,
      method: "PUT",
      body: {
        customerId: a.customerId,
        title: "Contrato A revisado",
        effectiveFrom: "2020-01-01T00:00:00.000Z",
        defaultPaymentTermDays: 45,
        serviceTerms: [{ serviceId: a.serviceId, priceCents: 13_500 }],
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.title).toBe("Contrato A revisado");
    const [term] = await db
      .select({ priceCents: commercialAgreementServiceTerm.priceCents })
      .from(commercialAgreementServiceTerm)
      .where(eq(commercialAgreementServiceTerm.agreementId, agreementA));
    expect(term?.priceCents).toBe(13_500);

    const activated = await call({
      path: `/contracts/${agreementA}/activate`,
      method: "POST",
    });
    expect(activated.status).toBe(200);
    expect(activated.body.data.status).toBe("ACTIVE");
    const [syncedCustomer] = await db
      .select({ compliance: customer.compliance })
      .from(customer)
      .where(eq(customer.id, a.customerId));
    expect(syncedCustomer?.compliance?.contractAgreementId).toBe(agreementA);

    const canceled = await call({
      path: `/contracts/${agreementA}/cancel`,
      method: "POST",
    });
    expect(canceled.status).toBe(200);
    expect(canceled.body.data.status).toBe("CANCELED");
    const [clearedCustomer] = await db
      .select({ compliance: customer.compliance })
      .from(customer)
      .where(eq(customer.id, a.customerId));
    expect(clearedCustomer?.compliance?.contractAgreementId).toBeUndefined();
  });

  // ===========================================================================
  // billing readiness + ERP
  // ===========================================================================

  /** A generic-HTTP financial ERP connection (its secret encrypted at rest). */
  async function seedErp(lab: BillingLab) {
    const integrationId = `erp-${lab.orgId}`;
    await db.insert(organizationIntegration).values({
      id: integrationId,
      organizationId: lab.orgId,
      type: "financial_erp",
      provider: "generic_http",
      name: "ERP de teste",
      status: "ACTIVE",
      createdBy: lab.userId,
    });
    const { encryptedPassword, iv } = encryptPassword("erp-secret", MASTER_KEY);
    await db.insert(integrationConnection).values({
      id: `conn-${lab.orgId}`,
      integrationId,
      organizationId: lab.orgId,
      credentialType: "bearer",
      config: {
        baseUrl: "https://erp.example.test",
        healthPath: "/health",
        customerPath: "/customers",
        serviceOrderPath: "/service-orders",
        billingDocumentPath: "/billing-documents",
        authType: "bearer",
        schedules: {},
        mappings: {},
      },
      encryptedSecret: encryptedPassword,
      secretIv: iv,
      createdBy: lab.userId,
    });
    return integrationId;
  }

  function stubErpFetch() {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "erp-doc-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("REQ-FINLAB-RDY-001 [HIGH RISK]: GET /billing-readiness queues only the laboratory's orders; POST /send bills and exports one, another laboratory's order answers ok:false with nothing written", async () => {
    const { a, b } = await twoLabs();
    const integrationId = await seedErp(a);
    const fetchMock = stubErpFetch();
    const jobA = await seedApprovedJob(a, "JOB-A-1");
    const jobB = await seedApprovedJob(b, "JOB-B-1");
    const orderA = await seedBillableOrder(a, {
      number: "OS-A-1",
      linkedJobId: jobA,
    });
    const orderB = await seedBillableOrder(b, {
      number: "OS-B-1",
      linkedJobId: jobB,
    });

    const queue = await call({ path: "/billing-readiness" });
    expect(queue.status).toBe(200);
    expect(queue.body.billing.integrationState).toBe("connected");
    expect(
      queue.body.data.map(
        (item: { serviceOrderId: number }) => item.serviceOrderId,
      ),
    ).toEqual([orderA]);
    expect(queue.body.data[0].readinessStatus).toBe("READY");
    expect(queue.body.data[0].amountCents).toBe(20_000);

    const denied = await call({
      path: "/billing-readiness/send",
      method: "POST",
      body: { serviceOrderIds: [orderB] },
    });
    expect(denied.status).toBe(200);
    expect(denied.body.data[0]).toMatchObject({
      serviceOrderId: orderB,
      ok: false,
      billingDocumentId: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await db
        .select()
        .from(billingDocument)
        .where(eq(billingDocument.organizationId, b.orgId)),
    ).toHaveLength(0);
    const [untouchedOrderB] = await db
      .select({ billingDocumentId: serviceOrder.billingDocumentId })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, orderB));
    expect(untouchedOrderB?.billingDocumentId).toBeNull();

    const sent = await call({
      path: "/billing-readiness/send",
      method: "POST",
      body: { serviceOrderIds: [orderA] },
    });
    expect(sent.status).toBe(200);
    const result = sent.body.data[0];
    expect(result).toMatchObject({ serviceOrderId: orderA, ok: true });

    const document = await documentRow(result.billingDocumentId);
    expect(document).toMatchObject({
      organizationId: a.orgId,
      status: "ISSUED",
      totalCents: SERVICE_PRICE_CENTS,
      exportStatus: "EXPORTED",
    });
    expect(document?.documentNumber).toMatch(/^FIN-\d{4}-0001$/);
    const [installment] = await db
      .select({
        status: receivableInstallment.status,
        amountCents: receivableInstallment.amountCents,
      })
      .from(receivableInstallment)
      .where(eq(receivableInstallment.documentId, result.billingDocumentId));
    expect(installment).toEqual({
      status: "OPEN",
      amountCents: SERVICE_PRICE_CENTS,
    });
    const [linkedOrder] = await db
      .select({ billingDocumentId: serviceOrder.billingDocumentId })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, orderA));
    expect(linkedOrder?.billingDocumentId).toBe(result.billingDocumentId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://erp.example.test/billing-documents");
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer erp-secret" }),
    });
    const links = await db
      .select({
        organizationId: integrationObjectLink.organizationId,
        integrationId: integrationObjectLink.integrationId,
        remoteEntityId: integrationObjectLink.remoteEntityId,
      })
      .from(integrationObjectLink);
    expect(links).toEqual([
      {
        organizationId: a.orgId,
        integrationId,
        remoteEntityId: "erp-doc-1",
      },
    ]);
    const events = await db
      .select({ event: integrationEventLog.event })
      .from(integrationEventLog)
      .where(eq(integrationEventLog.organizationId, a.orgId));
    expect(events.map((row) => row.event)).toContain(
      "finance.document_export.completed",
    );
  });

  it("REQ-FINLAB-RDY-002: POST /send reuses and issues the order's draft document", async () => {
    const { a } = await twoLabs();
    await seedErp(a);
    stubErpFetch();
    const draft = await seedDocument(a, { totalCents: 20_000 });
    const orderA = await seedBillableOrder(a, {
      number: "OS-A-1",
      billingDocumentId: draft.id,
    });

    const sent = await call({
      path: "/billing-readiness/send",
      method: "POST",
      body: { serviceOrderIds: [orderA] },
    });
    expect(sent.body.data[0]).toMatchObject({
      serviceOrderId: orderA,
      ok: true,
      billingDocumentId: draft.id,
    });
    const issued = await documentRow(draft.id);
    expect(issued?.status).toBe("ISSUED");
    expect(issued?.documentNumber).toMatch(/^FIN-\d{4}-0001$/);
    expect(issued?.exportStatus).toBe("EXPORTED");
    expect(
      await db
        .select()
        .from(receivableInstallment)
        .where(eq(receivableInstallment.documentId, draft.id)),
    ).toHaveLength(1);
  });

  it("REQ-FINLAB-ERP-001 [HIGH RISK]: GET /erp/exports lists only the laboratory's documents; POST /erp/documents/:id/export exports one, another laboratory's document answers 404 and nothing is sent", async () => {
    const { a, b } = await twoLabs();
    await seedErp(a);
    const fetchMock = stubErpFetch();
    const docA = await seedDocument(a, {
      status: "ISSUED",
      documentNumber: "FIN-2026-0001",
    });
    const docB = await seedDocument(b, {
      status: "ISSUED",
      documentNumber: "FIN-2026-0001",
    });

    const list = await call({ path: "/erp/exports" });
    expect(list.status).toBe(200);
    expect(list.body.data.map((row: { id: number }) => row.id)).toEqual([
      docA.id,
    ]);

    const denied = await call({
      path: `/erp/documents/${docB.id}/export`,
      method: "POST",
    });
    expect(denied.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await documentRow(docB.id))?.exportStatus).toBe("NOT_EXPORTED");

    const exported = await call({
      path: `/erp/documents/${docA.id}/export`,
      method: "POST",
    });
    expect(exported.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const after = await documentRow(docA.id);
    expect(after?.exportStatus).toBe("EXPORTED");
    expect(after?.exportedAt).not.toBeNull();

    // A second export updates the remote document it already created (PUT).
    const again = await call({
      path: `/erp/documents/${docA.id}/export`,
      method: "POST",
    });
    expect(again.status).toBe(200);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PUT" });
  });

  it("REQ-FINLAB-ERP-002: a failing ERP marks the document FAILED and logs the event", async () => {
    const { a } = await twoLabs();
    await seedErp(a);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const docA = await seedDocument(a, {
      status: "ISSUED",
      documentNumber: "FIN-2026-0001",
    });

    const exported = await call({
      path: `/erp/documents/${docA.id}/export`,
      method: "POST",
    });
    expect(exported.status).toBe(502);
    expect((await documentRow(docA.id))?.exportStatus).toBe("FAILED");
    const events = await db
      .select({ event: integrationEventLog.event })
      .from(integrationEventLog)
      .where(eq(integrationEventLog.organizationId, a.orgId));
    expect(events.map((row) => row.event)).toContain(
      "finance.document_export.failed",
    );
  });

  // ===========================================================================
  // dashboards
  // ===========================================================================

  it("REQ-FINLAB-DASH-001: operations-to-cash, revenue-leakage, cash-forecast and margin-dashboards read only the laboratory's data", async () => {
    const { a, b } = await twoLabs();
    const jobA = await seedApprovedJob(a, "JOB-A-1");
    const jobB = await seedApprovedJob(b, "JOB-B-1");
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 3);
    soon.setUTCHours(0, 0, 0, 0);
    // The forecast counts the installments of documents that an order points at.
    const docA = await seedDocument(a, {
      status: "ISSUED",
      documentNumber: "FIN-2026-0001",
      totalCents: 15_000,
      dueDate: soon,
      withInstallment: true,
    });
    const docB = await seedDocument(b, {
      status: "ISSUED",
      documentNumber: "FIN-2026-0001",
      totalCents: 77_000,
      dueDate: soon,
      withInstallment: true,
    });
    const orderA = await seedBillableOrder(a, {
      number: "OS-A-1",
      linkedJobId: jobA,
      totalApprovedCents: 20_000,
      billingDocumentId: docA.id,
    });
    const orderB = await seedBillableOrder(b, {
      number: "OS-B-1",
      linkedJobId: jobB,
      totalApprovedCents: 90_000,
      billingDocumentId: docB.id,
    });

    const toCash = await call({ path: "/operations-to-cash" });
    expect(toCash.status).toBe(200);
    expect(
      toCash.body.items.map(
        (item: { serviceOrderId: number }) => item.serviceOrderId,
      ),
    ).toEqual([orderA]);

    const leakage = await call({ path: "/revenue-leakage" });
    expect(leakage.status).toBe(200);
    expect(
      leakage.body.alerts.map(
        (alert: { serviceOrderId: number }) => alert.serviceOrderId,
      ),
    ).not.toContain(orderB);

    const forecast = await call({ path: "/cash-forecast" });
    expect(forecast.status).toBe(200);
    expect(forecast.body.buckets.THIS_WEEK.confirmedCents).toBe(15_000);
    expect(forecast.body.totals.confirmedCents).toBe(15_000);

    const margins = await call({ path: "/margin-dashboards" });
    expect(margins.status).toBe(200);
    expect(
      margins.body.byCustomer.map(
        (row: { entityId: number; revenueCents: number }) => [
          row.entityId,
          row.revenueCents,
        ],
      ),
    ).toEqual([[a.customerId, 20_000]]);
  });

  it("REQ-FINLAB-FCST-001: the cash forecast counts a standalone document's installment for a lab-wide viewer only; a unit-scoped viewer sees just the installments of their unit's orders", async () => {
    const { a } = await twoLabs();
    const [other] = await db
      .insert(organizationUnit)
      .values({
        organizationId: a.orgId,
        name: "Filial",
        slug: "filial",
        status: "ACTIVE",
      })
      .returning({ id: organizationUnit.id });
    if (!other) throw new Error("second unit insert failed");
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 3);
    soon.setUTCHours(0, 0, 0, 0);
    const installmentDoc = (totalCents: number, documentNumber: string) =>
      seedDocument(a, {
        status: "ISSUED",
        documentNumber,
        totalCents,
        dueDate: soon,
        withInstallment: true,
      });
    // No service order points at this document.
    await installmentDoc(5_000, "FIN-2026-0001");
    const inFirstUnit = await installmentDoc(7_000, "FIN-2026-0002");
    const inOtherUnit = await installmentDoc(11_000, "FIN-2026-0003");
    await seedBillableOrder(a, {
      number: "OS-A-1",
      billingDocumentId: inFirstUnit.id,
    });
    await seedBillableOrder(
      { ...a, unitId: other.id },
      { number: "OS-A-2", billingDocumentId: inOtherUnit.id },
    );

    const confirmedFor = async (scope: string) => {
      const res = await call({
        path: "/cash-forecast",
        headers: { "x-active-unit-id": scope },
      });
      expect(res.status).toBe(200);
      return res.body.totals.confirmedCents;
    };

    expect(await confirmedFor("all")).toBe(5_000 + 7_000 + 11_000);
    expect(await confirmedFor(String(a.unitId))).toBe(7_000);
    expect(await confirmedFor(String(other.id))).toBe(11_000);
  });

  // ===========================================================================
  // rollback: a failure after partial writes leaves nothing behind
  // ===========================================================================

  /** Makes every insert into the financial audit log fail, for `run`. */
  async function withFailingAuditInsert<T>(run: () => Promise<T>): Promise<T> {
    await db.execute(sql`
      create function test_fail_financial_audit() returns trigger as $$
      begin raise exception 'audit write refused'; end;
      $$ language plpgsql`);
    await db.execute(sql`
      create trigger test_fail_financial_audit_trg
      before insert on financial_audit_log
      for each row execute function test_fail_financial_audit()`);
    try {
      return await run();
    } finally {
      await db.execute(
        sql`drop trigger test_fail_financial_audit_trg on financial_audit_log`,
      );
      await db.execute(sql`drop function test_fail_financial_audit()`);
    }
  }

  it("REQ-FINLAB-RB-001 [HIGH RISK]: a failure after the first writes of POST /documents/:id/issue rolls the whole issue back (number, status, installment)", async () => {
    const { a } = await twoLabs();
    const doc = await seedDocument(a, { totalCents: 15_000 });

    const res = await withFailingAuditInsert(() =>
      financeRouter.request(
        `/documents/${doc.id}/issue`,
        { method: "POST", headers: JSON_HEADERS },
        ENV,
      ),
    );
    expect(res.status).toBe(500);

    const after = await documentRow(doc.id);
    expect(after?.status).toBe("DRAFT");
    expect(after?.documentNumber).toBeNull();
    expect(
      await db
        .select()
        .from(receivableInstallment)
        .where(eq(receivableInstallment.documentId, doc.id)),
    ).toHaveLength(0);
  });

  it("REQ-FINLAB-RB-002 [HIGH RISK]: a failure after the first writes of POST /installments/:id/receive rolls the receipt, the installment and the document back", async () => {
    const { a } = await twoLabs();
    const doc = await seedDocument(a, {
      status: "ISSUED",
      documentNumber: "FIN-2026-0001",
      totalCents: 15_000,
      withInstallment: true,
    });

    const res = await withFailingAuditInsert(() =>
      financeRouter.request(
        `/installments/${doc.installmentId}/receive`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ amountCents: 15_000, paymentMethod: "PIX" }),
        },
        ENV,
      ),
    );
    expect(res.status).toBe(500);

    expect(await db.select().from(paymentReceipt)).toHaveLength(0);
    expect((await documentRow(doc.id))?.status).toBe("ISSUED");
    const [installment] = await db
      .select({ status: receivableInstallment.status })
      .from(receivableInstallment)
      .where(eq(receivableInstallment.id, doc.installmentId ?? 0));
    expect(installment?.status).toBe("OPEN");
  });

  // ===========================================================================
  // policies and rules
  // ===========================================================================

  it("REQ-FINLAB-POL-001: PUT /certificate-release-policies/:id changes the laboratory's policy; another laboratory's id answers 404 and stays untouched", async () => {
    const { a, b } = await twoLabs();
    const [policyA] = await db
      .insert(certificateReleasePolicy)
      .values({
        organizationId: a.orgId,
        mode: "manual_only",
        customerId: a.customerId,
        createdByUserId: a.userId,
      })
      .returning({ id: certificateReleasePolicy.id });
    const [policyB] = await db
      .insert(certificateReleasePolicy)
      .values({
        organizationId: b.orgId,
        mode: "manual_only",
        customerId: b.customerId,
        createdByUserId: b.userId,
      })
      .returning({ id: certificateReleasePolicy.id });
    if (!policyA || !policyB) throw new Error("policy seed failed");

    const denied = await call(
      {
        path: `/${policyB.id}`,
        method: "PUT",
        body: { mode: "release_after_full_payment", archived: true },
      },
      settingsCertificateReleasePolicyRouter,
    );
    expect(denied.status).toBe(404);
    const [untouched] = await db
      .select({
        mode: certificateReleasePolicy.mode,
        archivedAt: certificateReleasePolicy.archivedAt,
      })
      .from(certificateReleasePolicy)
      .where(eq(certificateReleasePolicy.id, policyB.id));
    expect(untouched).toEqual({ mode: "manual_only", archivedAt: null });

    const updated = await call(
      {
        path: `/${policyA.id}`,
        method: "PUT",
        body: { mode: "release_after_full_payment", priority: 5 },
      },
      settingsCertificateReleasePolicyRouter,
    );
    expect(updated.status).toBe(200);
    const [changed] = await db
      .select({
        mode: certificateReleasePolicy.mode,
        priority: certificateReleasePolicy.priority,
      })
      .from(certificateReleasePolicy)
      .where(eq(certificateReleasePolicy.id, policyA.id));
    expect(changed).toEqual({
      mode: "release_after_full_payment",
      priority: 5,
    });
  });

  it("REQ-FINLAB-POL-002: GET and PUT /automatic-send-rules read and change only the laboratory's rules", async () => {
    const { a, b } = await twoLabs();
    const [ruleA] = await db
      .insert(automaticSendRule)
      .values({
        organizationId: a.orgId,
        milestone: "manual_only",
        customerId: a.customerId,
        createdByUserId: a.userId,
      })
      .returning({ id: automaticSendRule.id });
    const [ruleB] = await db
      .insert(automaticSendRule)
      .values({
        organizationId: b.orgId,
        milestone: "manual_only",
        customerId: b.customerId,
        createdByUserId: b.userId,
      })
      .returning({ id: automaticSendRule.id });
    if (!ruleA || !ruleB) throw new Error("rule seed failed");

    const list = await call({ path: "/automatic-send-rules" });
    expect(list.status).toBe(200);
    expect(list.body.data.map((row: { id: number }) => row.id)).toEqual([
      ruleA.id,
    ]);
    expect(list.body.data[0].customerName).toBe(`Customer ${a.orgId}`);

    const denied = await call({
      path: `/automatic-send-rules/${ruleB.id}`,
      method: "PUT",
      body: { milestone: "certificate_approved", archived: true },
    });
    expect(denied.status).toBe(404);
    const [untouched] = await db
      .select({
        milestone: automaticSendRule.milestone,
        archivedAt: automaticSendRule.archivedAt,
      })
      .from(automaticSendRule)
      .where(eq(automaticSendRule.id, ruleB.id));
    expect(untouched).toEqual({ milestone: "manual_only", archivedAt: null });

    const updated = await call({
      path: `/automatic-send-rules/${ruleA.id}`,
      method: "PUT",
      body: { milestone: "certificate_approved" },
    });
    expect(updated.status).toBe(200);
    const [changed] = await db
      .select({ milestone: automaticSendRule.milestone })
      .from(automaticSendRule)
      .where(eq(automaticSendRule.id, ruleA.id));
    expect(changed?.milestone).toBe("certificate_approved");
  });

  // ===========================================================================
  // automatic-send engine (the certificate approval calls it)
  // ===========================================================================

  it("REQ-FINLAB-ENG-001: the engine matches the laboratory's rule, calls the invoker and writes one audit row; another laboratory's order is 'service_order_not_found'", async () => {
    const { a, b } = await twoLabs();
    const jobA = await seedApprovedJob(a, "JOB-A-1");
    const orderA = await seedBillableOrder(a, {
      number: "OS-A-1",
      linkedJobId: jobA,
    });
    const jobB = await seedApprovedJob(b, "JOB-B-1");
    const orderB = await seedBillableOrder(b, {
      number: "OS-B-1",
      linkedJobId: jobB,
    });
    await db.insert(automaticSendRule).values({
      organizationId: a.orgId,
      milestone: "certificate_approved",
      createdByUserId: a.userId,
    });

    expect(await findServiceOrdersForCalibrationJob(jobA, a.orgId)).toEqual([
      orderA,
    ]);
    expect(await findServiceOrdersForCalibrationJob(jobB, a.orgId)).toEqual([]);

    const invoker = vi.fn(async () => ({ ok: true, summary: { sent: 1 } }));
    const sent = await triggerAutomaticSendForMilestone({
      event: {
        event: "certificate_approved",
        serviceOrderId: orderA,
        organizationId: a.orgId,
      },
      actorUserId: a.userId,
      invoker,
    });
    expect(sent.outcome).toBe("sent");
    expect(invoker).toHaveBeenCalledTimes(1);

    const crossLab = await triggerAutomaticSendForMilestone({
      event: {
        event: "certificate_approved",
        serviceOrderId: orderB,
        organizationId: a.orgId,
      },
      actorUserId: a.userId,
      invoker,
    });
    expect(crossLab).toMatchObject({
      outcome: "failed",
      reason: "service_order_not_found",
    });
    expect(invoker).toHaveBeenCalledTimes(1);

    const audits = await db
      .select({
        organizationId: automaticSendAuditLog.organizationId,
        serviceOrderId: automaticSendAuditLog.serviceOrderId,
        outcome: automaticSendAuditLog.outcome,
      })
      .from(automaticSendAuditLog)
      .where(inArray(automaticSendAuditLog.serviceOrderId, [orderA, orderB]));
    expect(audits).toEqual(
      expect.arrayContaining([
        { organizationId: a.orgId, serviceOrderId: orderA, outcome: "sent" },
        { organizationId: a.orgId, serviceOrderId: orderB, outcome: "failed" },
      ]),
    );
    expect(
      await db
        .select()
        .from(automaticSendAuditLog)
        .where(
          and(
            eq(automaticSendAuditLog.organizationId, b.orgId),
            eq(automaticSendAuditLog.serviceOrderId, orderB),
          ),
        ),
    ).toHaveLength(0);
  });
});
