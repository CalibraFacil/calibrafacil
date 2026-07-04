import { beforeEach, describe, expect, it } from "vitest";
import { serviceOrdersRouter } from "./service-orders";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  customer,
  organization,
  serviceOrder,
  serviceOrderCertificateLink,
  serviceOrderQuote,
} from "@calibra-facil/db/schema";
import type { ServiceOrderQuoteStatus } from "@calibra-facil/shared";
import { and, eq } from "drizzle-orm";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedService } from "../../test/integration/seed";

// SEC-01 — cross-tenant IDOR regression suite for the lab serviceOrdersRouter.
//
// These three write endpoints resolved the target OS by its sequential numeric
// `:id` WITHOUT filtering `organizationId`, so a member of org A could mutate an
// OS belonging to org B (approve/reject a quote, unlink a certificate). The fix
// mirrors the already-correct siblings: the quote routes resolve the OS via
// `getScopedServiceOrder(id, member)` and pass `organizationId` into the module;
// `unlinkServiceOrderCertificate` validates `order.organizationId` before DELETE,
// exactly as `linkServiceOrderCertificate` already does.
//
// Every cross-tenant case asserts BOTH the 404 response AND that the persisted
// state is unchanged (so a silent mutation that still 404'd would fail too).
//
// REQ-SEC-SO-001  approve-manually: org A → org B's :id → 404, no status/approver write
// REQ-SEC-SO-002  reject-manually:  org A → org B's :id → 404, quote untouched
// REQ-SEC-SO-003  unlink certificate: org A → org B's :id → 404, link NOT removed
// REQ-SEC-SO-004  same-org caller with valid data → each op still succeeds

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Domain seed helpers — inline for self-containment; never touch shared files.
// ---------------------------------------------------------------------------

/** Seed a CLIENT org (required as customer.authOrganizationId FK). */
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

/** Seed a customer owned by a LAB org. Returns the customer.id. */
async function seedCustomer(params: {
  labOrganizationId: string;
  clientOrgId: string;
  name?: string;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);
  const [row] = await db
    .insert(customer)
    .values({
      name: params.name ?? `Customer of ${params.labOrganizationId}`,
      authOrganizationId: params.clientOrgId,
      labOrganizationId: params.labOrganizationId,
    })
    .returning({ id: customer.id });
  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}

/** Seed an asset type with no required spec fields. Returns the id. */
async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name: "Test Instrument", slug, definition: [] })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

/** Seed an asset scoped to a unit + customer. Returns the asset id. */
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

/** Seed a minimal service order row. Returns the created service order id. */
async function seedServiceOrder(params: {
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  openedByUserId: string;
  serviceOrderNumber: string;
  status?: typeof serviceOrder.$inferInsert["status"];
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

/** Seed a quote. Defaults to status "sent" (the only approvable/rejectable state). */
async function seedQuote(params: {
  serviceOrderId: number;
  createdByUserId: string;
  serviceOrderNumber: string;
  status?: ServiceOrderQuoteStatus;
  totalCents?: number;
}): Promise<number> {
  const [row] = await db
    .insert(serviceOrderQuote)
    .values({
      serviceOrderId: params.serviceOrderId,
      quoteNumber: `${params.serviceOrderNumber}/ORC`,
      version: 1,
      status: params.status ?? "sent",
      totalCents: params.totalCents ?? 10000,
      createdByUserId: params.createdByUserId,
    })
    .returning({ id: serviceOrderQuote.id });
  if (!row) throw new Error("seedQuote: insert failed");
  return row.id;
}

function minimalMethodSnapshot() {
  return {
    methodId: 1,
    methodName: "Test",
    methodVersion: 1,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
  } satisfies Record<string, unknown>;
}

/** Seed a calibration job (owned by an org) so a certificate link can reference it. */
async function seedCalibrationJob(params: {
  jobId: string;
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  serviceId: number;
  createdBy: string;
}): Promise<number> {
  const [row] = await db
    .insert(calibrationJob)
    .values({
      jobId: params.jobId,
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      assetId: params.assetId,
      serviceId: params.serviceId,
      createdBy: params.createdBy,
      status: "APPROVED",
      methodSnapshot: minimalMethodSnapshot(),
      certificateName: params.jobId,
    })
    .returning({ id: calibrationJob.id });
  if (!row) throw new Error("seedCalibrationJob: insert failed");
  return row.id;
}

/** Link a certificate job to a service order. */
async function seedCertificateLink(params: {
  serviceOrderId: number;
  certificateJobId: number;
  linkedByUserId: string;
}): Promise<void> {
  await db.insert(serviceOrderCertificateLink).values({
    serviceOrderId: params.serviceOrderId,
    certificateJobId: params.certificateJobId,
    linkedByUserId: params.linkedByUserId,
  });
}

const APPROVE_BODY = JSON.stringify({
  approvedByName: "Cliente Teste",
  manualApprovalEvidenceType: "phone",
  manualApprovalEvidenceText: "Aprovado por telefone.",
});

const REJECT_BODY = JSON.stringify({
  rejectionReason: "Cliente recusou o orçamento.",
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("serviceOrdersRouter — SEC-01 cross-tenant IDORs (real DB + real RBAC)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ==========================================================================
  // REQ-SEC-SO-001: approve-manually cross-tenant → 404, no mutation
  // ==========================================================================
  it(
    "REQ-SEC-SO-001: org A approve-manually on org B's OS → 404, quote status + approver unchanged",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
      const typeId = await seedAssetType("type-idor-001");
      const custB = await seedCustomer({
        labOrganizationId: orgB.orgId,
        clientOrgId: "client-b-001",
      });
      const assetB = await seedAsset({
        unitId: orgB.unitId,
        customerId: custB,
        assetTypeId: typeId,
        tag: "TAG-B-001",
      });
      const orderB = await seedServiceOrder({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
        customerId: custB,
        assetId: assetB,
        openedByUserId: orgB.userId,
        serviceOrderNumber: "OS-B-001",
      });
      const quoteB = await seedQuote({
        serviceOrderId: orderB,
        createdByUserId: orgB.userId,
        serviceOrderNumber: "OS-B-001",
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await serviceOrdersRouter.request(
        `/${orderB}/quotes/${quoteB}/approve-manually`,
        { method: "POST", headers: JSON_HEADERS, body: APPROVE_BODY },
      );

      expect(res.status).toBe(404);

      // Quote must NOT have been approved by the cross-tenant caller.
      const [quoteRow] = await db
        .select({
          status: serviceOrderQuote.status,
          approvedManuallyByUserId:
            serviceOrderQuote.approvedManuallyByUserId,
        })
        .from(serviceOrderQuote)
        .where(eq(serviceOrderQuote.id, quoteB));
      expect(quoteRow?.status).toBe("sent");
      expect(quoteRow?.approvedManuallyByUserId).toBeNull();

      // Service order status must be untouched.
      const [orderRow] = await db
        .select({ status: serviceOrder.status })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, orderB));
      expect(orderRow?.status).toBe("awaiting_quote_approval");
    },
  );

  // ==========================================================================
  // REQ-SEC-SO-002: reject-manually cross-tenant → 404, no mutation
  // ==========================================================================
  it(
    "REQ-SEC-SO-002: org A reject-manually on org B's OS → 404, quote unchanged",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
      const typeId = await seedAssetType("type-idor-002");
      const custB = await seedCustomer({
        labOrganizationId: orgB.orgId,
        clientOrgId: "client-b-002",
      });
      const assetB = await seedAsset({
        unitId: orgB.unitId,
        customerId: custB,
        assetTypeId: typeId,
        tag: "TAG-B-002",
      });
      const orderB = await seedServiceOrder({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
        customerId: custB,
        assetId: assetB,
        openedByUserId: orgB.userId,
        serviceOrderNumber: "OS-B-002",
      });
      const quoteB = await seedQuote({
        serviceOrderId: orderB,
        createdByUserId: orgB.userId,
        serviceOrderNumber: "OS-B-002",
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await serviceOrdersRouter.request(
        `/${orderB}/quotes/${quoteB}/reject-manually`,
        { method: "POST", headers: JSON_HEADERS, body: REJECT_BODY },
      );

      expect(res.status).toBe(404);

      const [quoteRow] = await db
        .select({
          status: serviceOrderQuote.status,
          rejectionReason: serviceOrderQuote.rejectionReason,
        })
        .from(serviceOrderQuote)
        .where(eq(serviceOrderQuote.id, quoteB));
      expect(quoteRow?.status).toBe("sent");
      expect(quoteRow?.rejectionReason).toBeNull();

      const [orderRow] = await db
        .select({ status: serviceOrder.status })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, orderB));
      expect(orderRow?.status).toBe("awaiting_quote_approval");
    },
  );

  // ==========================================================================
  // REQ-SEC-SO-003: unlink certificate cross-tenant → 404, link NOT removed
  // ==========================================================================
  it(
    "REQ-SEC-SO-003: org A unlink on org B's OS → 404, certificate link intact",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
      const typeId = await seedAssetType("type-idor-003");
      const custB = await seedCustomer({
        labOrganizationId: orgB.orgId,
        clientOrgId: "client-b-003",
      });
      const assetB = await seedAsset({
        unitId: orgB.unitId,
        customerId: custB,
        assetTypeId: typeId,
        tag: "TAG-B-003",
      });
      const serviceB = await seedService({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
        name: "Calibração",
      });
      const orderB = await seedServiceOrder({
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
        customerId: custB,
        assetId: assetB,
        openedByUserId: orgB.userId,
        serviceOrderNumber: "OS-B-003",
      });
      const jobB = await seedCalibrationJob({
        jobId: "JOB-B-003",
        organizationId: orgB.orgId,
        unitId: orgB.unitId,
        customerId: custB,
        assetId: assetB,
        serviceId: serviceB,
        createdBy: orgB.userId,
      });
      await seedCertificateLink({
        serviceOrderId: orderB,
        certificateJobId: jobB,
        linkedByUserId: orgB.userId,
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await serviceOrdersRouter.request(
        `/${orderB}/certificates/${jobB}/link`,
        { method: "DELETE", headers: JSON_HEADERS },
      );

      expect(res.status).toBe(404);

      // The link row must still exist — the cross-tenant DELETE must not touch it.
      const links = await db
        .select({ id: serviceOrderCertificateLink.id })
        .from(serviceOrderCertificateLink)
        .where(
          and(
            eq(serviceOrderCertificateLink.serviceOrderId, orderB),
            eq(serviceOrderCertificateLink.certificateJobId, jobB),
          ),
        );
      expect(links).toHaveLength(1);
    },
  );

  // ==========================================================================
  // REQ-SEC-SO-004: same-org callers still succeed (no regression)
  // ==========================================================================
  it(
    "REQ-SEC-SO-004: same-org approve-manually → 200, quote approved by caller",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("type-idor-004a");
      const cust = await seedCustomer({
        labOrganizationId: org.orgId,
        clientOrgId: "client-a-004a",
      });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: cust,
        assetTypeId: typeId,
        tag: "TAG-004A",
      });
      const orderId = await seedServiceOrder({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust,
        assetId,
        openedByUserId: org.userId,
        serviceOrderNumber: "OS-004A",
      });
      const quoteId = await seedQuote({
        serviceOrderId: orderId,
        createdByUserId: org.userId,
        serviceOrderNumber: "OS-004A",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await serviceOrdersRouter.request(
        `/${orderId}/quotes/${quoteId}/approve-manually`,
        { method: "POST", headers: JSON_HEADERS, body: APPROVE_BODY },
      );

      expect(res.status).toBe(200);

      const [quoteRow] = await db
        .select({
          status: serviceOrderQuote.status,
          approvedManuallyByUserId:
            serviceOrderQuote.approvedManuallyByUserId,
        })
        .from(serviceOrderQuote)
        .where(eq(serviceOrderQuote.id, quoteId));
      expect(quoteRow?.status).toBe("approved");
      expect(quoteRow?.approvedManuallyByUserId).toBe(org.userId);

      const [orderRow] = await db
        .select({ status: serviceOrder.status })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, orderId));
      expect(orderRow?.status).toBe("quote_approved");
    },
  );

  it(
    "REQ-SEC-SO-004: same-org reject-manually → 200, quote rejected",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("type-idor-004b");
      const cust = await seedCustomer({
        labOrganizationId: org.orgId,
        clientOrgId: "client-a-004b",
      });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: cust,
        assetTypeId: typeId,
        tag: "TAG-004B",
      });
      const orderId = await seedServiceOrder({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust,
        assetId,
        openedByUserId: org.userId,
        serviceOrderNumber: "OS-004B",
      });
      const quoteId = await seedQuote({
        serviceOrderId: orderId,
        createdByUserId: org.userId,
        serviceOrderNumber: "OS-004B",
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await serviceOrdersRouter.request(
        `/${orderId}/quotes/${quoteId}/reject-manually`,
        { method: "POST", headers: JSON_HEADERS, body: REJECT_BODY },
      );

      expect(res.status).toBe(200);

      const [quoteRow] = await db
        .select({
          status: serviceOrderQuote.status,
          rejectionReason: serviceOrderQuote.rejectionReason,
        })
        .from(serviceOrderQuote)
        .where(eq(serviceOrderQuote.id, quoteId));
      expect(quoteRow?.status).toBe("rejected");
      expect(quoteRow?.rejectionReason).toBe("Cliente recusou o orçamento.");
    },
  );

  it(
    "REQ-SEC-SO-004: same-org unlink certificate → 200, link removed",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const typeId = await seedAssetType("type-idor-004c");
      const cust = await seedCustomer({
        labOrganizationId: org.orgId,
        clientOrgId: "client-a-004c",
      });
      const assetId = await seedAsset({
        unitId: org.unitId,
        customerId: cust,
        assetTypeId: typeId,
        tag: "TAG-004C",
      });
      const serviceId = await seedService({
        organizationId: org.orgId,
        unitId: org.unitId,
        name: "Calibração",
      });
      const orderId = await seedServiceOrder({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust,
        assetId,
        openedByUserId: org.userId,
        serviceOrderNumber: "OS-004C",
      });
      const jobId = await seedCalibrationJob({
        jobId: "JOB-004C",
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId: cust,
        assetId,
        serviceId,
        createdBy: org.userId,
      });
      await seedCertificateLink({
        serviceOrderId: orderId,
        certificateJobId: jobId,
        linkedByUserId: org.userId,
      });

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await serviceOrdersRouter.request(
        `/${orderId}/certificates/${jobId}/link`,
        { method: "DELETE", headers: JSON_HEADERS },
      );

      expect(res.status).toBe(200);

      const links = await db
        .select({ id: serviceOrderCertificateLink.id })
        .from(serviceOrderCertificateLink)
        .where(
          and(
            eq(serviceOrderCertificateLink.serviceOrderId, orderId),
            eq(serviceOrderCertificateLink.certificateJobId, jobId),
          ),
        );
      expect(links).toHaveLength(0);
    },
  );
});
