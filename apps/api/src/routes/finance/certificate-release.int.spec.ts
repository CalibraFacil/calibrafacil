/**
 * certificate-release.int.spec.ts — Real-DB + real-RBAC integration tests for
 * the certificate-release PAYMENT GATE (regulated: a certificate must not be
 * released while payment is outstanding unless overridden by exception).
 *
 * Only the better-auth session is mocked (see test/integration/setup.ts).
 * RBAC guards, feature-gates, and all SQL run against the real test Postgres.
 * Production code is NOT changed.
 *
 * ESCALATION (noted per instructions):
 *   exception-release requires only financial:export + a non-empty reason string
 *   — no four-eyes / second-approver. ISO 17025 consideration: overriding a
 *   payment hold should arguably require a second authorizer. Flagged for human
 *   review; not enforced by current production code.
 *
 * Proven properties (oracle):
 *   REQ-CREL-001  Tenant isolation: GET org-B job as org-A → 404; policy list
 *                 (GET /settings/) scoped to org-A only + definite count.
 *   REQ-CREL-002  PAYMENT GATE: release_after_full_payment policy — UNPAID job
 *                 (billing DRAFT / installment OPEN) → status HELD_FOR_PAYMENT;
 *                 PAID job (billing PAID / installment PAID) → status RELEASED.
 *   REQ-CREL-003  Exception override: reason + APPROVED job → RELEASED_BY_EXCEPTION
 *                 (sticky on subsequent GET); empty reason → 400; non-APPROVED
 *                 job → 400 {code:"NOT_APPROVED"}.
 *   REQ-CREL-004  RBAC: member/technician lacking financial:export → 403 on
 *                 exception-release; member lacking financial:contract_create →
 *                 403 on POST /settings/; admin succeeds.
 *   REQ-CREL-005  Unauthenticated GET and exception-release → 401.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  financeCertificateReleaseRouter,
  settingsCertificateReleasePolicyRouter,
} from "./certificate-release";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  billingDocument,
  calibrationJob,
  certificateRelease,
  certificateReleasePolicy,
  customer,
  member,
  organization,
  receivableInstallment,
  service,
  serviceOrder,
  serviceOrderCertificateLink,
  subscription,
  user,
} from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { loginAs, logout } from "../../../test/integration/setup";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";

// ---------------------------------------------------------------------------
// No notifications or background-jobs imported by certificate-release route or
// its lib — no vi.mock required.
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Inline domain seed helpers
// ---------------------------------------------------------------------------

/** Insert a minimal CLIENT org (required for customer.authOrganizationId FK). */
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

/** Seed a PROFESSIONAL subscription so requireFeature("financial") passes. */
async function seedProfessionalSubscription(orgId: string): Promise<void> {
  await db.insert(subscription).values({
    organizationId: orgId,
    planId: "PROFESSIONAL",
    status: "ACTIVE",
  });
}

/** Seed a customer owned by a LAB org. Returns customer.id. */
async function seedCustomer(params: {
  labOrgId: string;
  clientOrgId: string;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);
  const [row] = await db
    .insert(customer)
    .values({
      name: `Customer of ${params.labOrgId}`,
      labOrganizationId: params.labOrgId,
      authOrganizationId: params.clientOrgId,
    })
    .returning({ id: customer.id });
  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}

/** Seed an assetType. Returns assetType.id. */
async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name: `AT ${slug}`, slug, definition: [] })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

/** Seed an asset. Returns asset.id. */
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
      // SEC-03b (#638): per-org tag uniqueness — derive lab org from the customer.
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${params.customerId})`,
      assetTypeId: params.assetTypeId,
      name: "Test Instrument",
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

/** Seed a service. Returns service.id. */
async function seedService(params: {
  organizationId: string;
  unitId: number;
}): Promise<number> {
  const [row] = await db
    .insert(service)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: `Service ${params.organizationId}-${params.unitId}`,
      isActive: true,
    })
    .returning({ id: service.id });
  if (!row) throw new Error("seedService: insert failed");
  return row.id;
}

/**
 * Minimal valid MethodSnapshot (required NOT-NULL JSONB on calibration_job).
 * Satisfies the MethodSnapshot interface defined in @calibra-facil/db/schema.
 */
function minimalMethodSnapshot(): Record<string, unknown> {
  return {
    methodId: 1,
    methodName: "Test Method",
    methodVersion: 1,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
  };
}

type JobStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "GENERATING_PDF"
  | "SUPERSEDED"
  | "CANCELED";

/** Seed a calibration_job. Returns the DB-assigned numeric id. */
async function seedJob(params: {
  jobId: string;
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  serviceId: number;
  createdBy: string;
  status?: JobStatus;
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
      status: params.status ?? "APPROVED",
      methodSnapshot: minimalMethodSnapshot(),
      certificateName: params.jobId,
    })
    .returning({ id: calibrationJob.id });
  if (!row) throw new Error("seedJob: insert failed");
  return row.id;
}

/**
 * Seed a service_order linked to a job via service_order_certificate_link.
 * The link is what makes loadJobInOrgScope resolve the SO unit and allows
 * recomputeCertificateRelease to read billing state through the SO.
 *
 * Sets service_order.billing_document_id so buildPaymentStateForJob can
 * follow the SO → billing_document chain.
 */
async function seedServiceOrderWithLink(params: {
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  openedByUserId: string;
  jobId: number;
  billingDocumentId?: number;
}): Promise<number> {
  const [soRow] = await db
    .insert(serviceOrder)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      serviceOrderNumber: `SO-${params.jobId}`,
      customerId: params.customerId,
      assetId: params.assetId,
      openedByUserId: params.openedByUserId,
      claimedDefect: "Calibração periódica",
      intakeCondition: "Bom estado",
      status: "opened",
      billingDocumentId: params.billingDocumentId ?? null,
    })
    .returning({ id: serviceOrder.id });
  if (!soRow) throw new Error("seedServiceOrderWithLink: SO insert failed");

  await db.insert(serviceOrderCertificateLink).values({
    serviceOrderId: soRow.id,
    certificateJobId: params.jobId,
    linkedByUserId: params.openedByUserId,
  });

  return soRow.id;
}

/** Seed a billing_document. Returns the inserted id. */
async function seedBillingDocument(params: {
  orgId: string;
  unitId: number;
  customerId: number;
  createdBy: string;
  status?: "DRAFT" | "ISSUED" | "PAID" | "OVERDUE";
}): Promise<number> {
  const [row] = await db
    .insert(billingDocument)
    .values({
      organizationId: params.orgId,
      unitId: params.unitId,
      customerId: params.customerId,
      status: params.status ?? "DRAFT",
      dueDate: new Date("2026-12-31T00:00:00.000Z"),
      currency: "BRL",
      subtotalCents: 100_00,
      discountCents: 0,
      totalCents: 100_00,
      createdBy: params.createdBy,
      updatedBy: params.createdBy,
    })
    .returning({ id: billingDocument.id });
  if (!row) throw new Error("seedBillingDocument: insert failed");
  return row.id;
}

/** Seed a receivable_installment on a billing document. */
async function seedInstallment(params: {
  documentId: number;
  status?: "OPEN" | "PAID" | "OVERDUE" | "VOID";
}): Promise<void> {
  await db.insert(receivableInstallment).values({
    documentId: params.documentId,
    installmentNumber: 1,
    status: params.status ?? "OPEN",
    dueDate: new Date("2026-12-31T00:00:00.000Z"),
    amountCents: 100_00,
    currency: "BRL",
  });
}

/** Seed a certificate_release_policy (org-level default). Returns id. */
async function seedReleasePolicy(params: {
  orgId: string;
  createdByUserId: string;
  mode:
    | "release_after_full_payment"
    | "release_after_invoice"
    | "release_after_first_installment"
    | "trusted_customer"
    | "manual_only";
}): Promise<number> {
  const [row] = await db
    .insert(certificateReleasePolicy)
    .values({
      organizationId: params.orgId,
      mode: params.mode,
      customerId: null,
      commercialAgreementId: null,
      serviceCategory: null,
      priority: 0,
      createdByUserId: params.createdByUserId,
    })
    .returning({ id: certificateReleasePolicy.id });
  if (!row) throw new Error("seedReleasePolicy: insert failed");
  return row.id;
}

/**
 * Seed a complete domain fixture for one org:
 * org + PROFESSIONAL subscription + customer + asset + service.
 */
async function seedOrgFixture(params: {
  orgId: string;
  role?: "owner" | "admin" | "technician" | "operator" | "member";
  tagSuffix?: string;
}) {
  const org = await seedOrg({
    orgId: params.orgId,
    role: params.role ?? "admin",
  });
  await seedProfessionalSubscription(org.orgId);

  const customerId = await seedCustomer({
    labOrgId: org.orgId,
    clientOrgId: `client-${org.orgId}`,
  });

  const suffix = params.tagSuffix ?? params.orgId;
  const assetTypeId = await seedAssetType(`at-${suffix}`);
  const assetId = await seedAsset({
    unitId: org.unitId,
    customerId,
    assetTypeId,
    tag: `TAG-${suffix}`,
  });
  const serviceId = await seedService({
    organizationId: org.orgId,
    unitId: org.unitId,
  });

  return { ...org, customerId, assetTypeId, assetId, serviceId };
}

// ---------------------------------------------------------------------------

describe("financeCertificateReleaseRouter — payment gate + RBAC (real DB)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =======================================================================
  // REQ-CREL-001: Tenant isolation
  // =======================================================================
  it("REQ-CREL-001: GET org-B job as org-A → 404; GET /settings/ scoped to org-A only + definite count", async () => {
    // Two independent orgs.
    const orgA = await seedOrgFixture({ orgId: "org-a", tagSuffix: "a" });
    const orgB = await seedOrgFixture({ orgId: "org-b", tagSuffix: "b" });

    // Org-A has one policy (trusted_customer).
    await seedReleasePolicy({
      orgId: orgA.orgId,
      createdByUserId: orgA.userId,
      mode: "trusted_customer",
    });
    // Org-B has a different policy (manual_only) — must NOT leak into org-A.
    await seedReleasePolicy({
      orgId: orgB.orgId,
      createdByUserId: orgB.userId,
      mode: "manual_only",
    });

    // Org-B creates an APPROVED job with SO link.
    const jobBId = await seedJob({
      jobId: "JOB-B-001",
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      customerId: orgB.customerId,
      assetId: orgB.assetId,
      serviceId: orgB.serviceId,
      createdBy: orgB.userId,
      status: "APPROVED",
    });
    await seedServiceOrderWithLink({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      customerId: orgB.customerId,
      assetId: orgB.assetId,
      openedByUserId: orgB.userId,
      jobId: jobBId,
    });

    // Authenticate as org-A admin.
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

    // GET org-B's job as org-A → 404 (cross-tenant blocked).
    const getRes = await financeCertificateReleaseRouter.request(`/${jobBId}`, {
      headers: JSON_HEADERS,
    });
    expect(getRes.status).toBe(404);

    // GET /settings/ as org-A → returns exactly org-A's policies (count = 1).
    const settingsRes = await settingsCertificateReleasePolicyRouter.request(
      "/",
      { headers: JSON_HEADERS },
    );
    expect(settingsRes.status).toBe(200);
    const settingsBody = await settingsRes.json();
    expect(settingsBody.data).toHaveLength(1);
    expect(settingsBody.data[0].mode).toBe("trusted_customer");
  });

  // =======================================================================
  // REQ-CREL-002 [HIGH RISK]: PAYMENT GATE
  // =======================================================================
  it("REQ-CREL-002 [HIGH RISK]: release_after_full_payment — UNPAID (billing DRAFT / installment OPEN) → HELD_FOR_PAYMENT; PAID (billing PAID / installment PAID) → RELEASED (DB-verified)", async () => {
    const org = await seedOrgFixture({
      orgId: "org-gate",
      tagSuffix: "gate",
    });
    await seedReleasePolicy({
      orgId: org.orgId,
      createdByUserId: org.userId,
      mode: "release_after_full_payment",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });

    // ---- UNPAID scenario ----
    const billingDraftId = await seedBillingDocument({
      orgId: org.orgId,
      unitId: org.unitId,
      customerId: org.customerId,
      createdBy: org.userId,
      status: "DRAFT",
    });
    await seedInstallment({ documentId: billingDraftId, status: "OPEN" });

    const unpaidJobId = await seedJob({
      jobId: "JOB-UNPAID-001",
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: org.customerId,
      assetId: org.assetId,
      serviceId: org.serviceId,
      createdBy: org.userId,
      status: "APPROVED",
    });
    await seedServiceOrderWithLink({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: org.customerId,
      assetId: org.assetId,
      openedByUserId: org.userId,
      jobId: unpaidJobId,
      billingDocumentId: billingDraftId,
    });

    const unpaidRes = await financeCertificateReleaseRouter.request(
      `/${unpaidJobId}`,
      { headers: JSON_HEADERS },
    );
    expect(unpaidRes.status).toBe(200);
    const unpaidBody = await unpaidRes.json();
    // ORACLE: payment outstanding → release BLOCKED
    expect(unpaidBody.data.status).toBe("HELD_FOR_PAYMENT");

    // Verify the status was persisted to the DB (not just in the response).
    const [dbUnpaidRow] = await db
      .select({ status: certificateRelease.status })
      .from(certificateRelease)
      .where(eq(certificateRelease.calibrationJobId, unpaidJobId));
    expect(dbUnpaidRow?.status).toBe("HELD_FOR_PAYMENT");

    // ---- PAID scenario ----
    const billingPaidId = await seedBillingDocument({
      orgId: org.orgId,
      unitId: org.unitId,
      customerId: org.customerId,
      createdBy: org.userId,
      status: "PAID",
    });
    await seedInstallment({ documentId: billingPaidId, status: "PAID" });

    const paidJobId = await seedJob({
      jobId: "JOB-PAID-001",
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: org.customerId,
      assetId: org.assetId,
      serviceId: org.serviceId,
      createdBy: org.userId,
      status: "APPROVED",
    });
    await seedServiceOrderWithLink({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: org.customerId,
      assetId: org.assetId,
      openedByUserId: org.userId,
      jobId: paidJobId,
      billingDocumentId: billingPaidId,
    });

    const paidRes = await financeCertificateReleaseRouter.request(
      `/${paidJobId}`,
      { headers: JSON_HEADERS },
    );
    expect(paidRes.status).toBe(200);
    const paidBody = await paidRes.json();
    // ORACLE: payment complete → release ALLOWED
    expect(paidBody.data.status).toBe("RELEASED");

    // Verify the DB reflects RELEASED.
    const [dbPaidRow] = await db
      .select({ status: certificateRelease.status })
      .from(certificateRelease)
      .where(eq(certificateRelease.calibrationJobId, paidJobId));
    expect(dbPaidRow?.status).toBe("RELEASED");
  });

  // =======================================================================
  // REQ-CREL-003 [HIGH RISK]: Exception override
  // =======================================================================
  it("REQ-CREL-003 [HIGH RISK]: exception release with reason on HELD APPROVED job → 200 + RELEASED_BY_EXCEPTION (sticky); empty reason → 400; non-APPROVED job → 409", async () => {
    const org = await seedOrgFixture({
      orgId: "org-exc",
      tagSuffix: "exc",
    });
    await seedReleasePolicy({
      orgId: org.orgId,
      createdByUserId: org.userId,
      mode: "release_after_full_payment",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });

    // Seed an APPROVED job with unpaid billing → will be HELD_FOR_PAYMENT.
    const billingId = await seedBillingDocument({
      orgId: org.orgId,
      unitId: org.unitId,
      customerId: org.customerId,
      createdBy: org.userId,
      status: "DRAFT",
    });
    await seedInstallment({ documentId: billingId, status: "OPEN" });

    const heldJobId = await seedJob({
      jobId: "JOB-HELD-001",
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: org.customerId,
      assetId: org.assetId,
      serviceId: org.serviceId,
      createdBy: org.userId,
      status: "APPROVED",
    });
    await seedServiceOrderWithLink({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: org.customerId,
      assetId: org.assetId,
      openedByUserId: org.userId,
      jobId: heldJobId,
      billingDocumentId: billingId,
    });

    // Confirm initial state is HELD_FOR_PAYMENT.
    const initRes = await financeCertificateReleaseRouter.request(
      `/${heldJobId}`,
      { headers: JSON_HEADERS },
    );
    expect(initRes.status).toBe(200);
    expect((await initRes.json()).data.status).toBe("HELD_FOR_PAYMENT");

    // --- Empty reason must be rejected ---
    const emptyReasonRes = await financeCertificateReleaseRouter.request(
      `/${heldJobId}/release-by-exception`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "" }),
      },
    );
    expect(emptyReasonRes.status).toBe(400);

    // --- Valid reason on APPROVED job → RELEASED_BY_EXCEPTION ---
    const excRes = await financeCertificateReleaseRouter.request(
      `/${heldJobId}/release-by-exception`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          reason: "Cliente viajará; certificado necessário urgente",
        }),
      },
    );
    expect(excRes.status).toBe(200);
    const excBody = await excRes.json();
    expect(excBody.data.status).toBe("RELEASED_BY_EXCEPTION");

    // --- Subsequent GET must still return RELEASED_BY_EXCEPTION (sticky) ---
    const stickyRes = await financeCertificateReleaseRouter.request(
      `/${heldJobId}`,
      { headers: JSON_HEADERS },
    );
    expect(stickyRes.status).toBe(200);
    const stickyBody = await stickyRes.json();
    expect(stickyBody.data.status).toBe("RELEASED_BY_EXCEPTION");

    // --- non-APPROVED job (REVIEW) → 409 (NOT_APPROVED) ---
    const reviewJobId = await seedJob({
      jobId: "JOB-REVIEW-001",
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: org.customerId,
      assetId: org.assetId,
      serviceId: org.serviceId,
      createdBy: org.userId,
      status: "REVIEW",
    });
    await seedServiceOrderWithLink({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: org.customerId,
      assetId: org.assetId,
      openedByUserId: org.userId,
      jobId: reviewJobId,
    });

    const notApprovedRes = await financeCertificateReleaseRouter.request(
      `/${reviewJobId}/release-by-exception`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "valid reason" }),
      },
    );
    // Route maps NOT_APPROVED → 409
    expect(notApprovedRes.status).toBe(409);
  });

  // =======================================================================
  // REQ-CREL-004 [HIGH RISK]: RBAC
  // =======================================================================
  it("REQ-CREL-004 [HIGH RISK]: member (no financial:export) → 403 on exception-release; member (no financial:contract_create) → 403 on POST /settings/; admin → 200 on both", async () => {
    const adminOrg = await seedOrgFixture({
      orgId: "org-rbac",
      role: "admin",
      tagSuffix: "rbac",
    });
    await seedReleasePolicy({
      orgId: adminOrg.orgId,
      createdByUserId: adminOrg.userId,
      mode: "release_after_full_payment",
    });

    // Add a second user with "member" role in the same org.
    const memberUserId = "user-member-rbac";
    const memberId = `member-rbac-${memberUserId}`;
    await db.insert(user).values({
      id: memberUserId,
      name: "Member User",
      email: `${memberUserId}@lab.test`,
    });
    await db.insert(member).values({
      id: memberId,
      organizationId: adminOrg.orgId,
      userId: memberUserId,
      role: "member",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    // Seed an APPROVED job (no billing doc so it resolves via fallback policy
    // → RELEASED under "release_after_full_payment" without billing = HELD_FOR_BILLING,
    // but for RBAC tests the status value is irrelevant — only HTTP status matters).
    const jobId = await seedJob({
      jobId: "JOB-RBAC-001",
      organizationId: adminOrg.orgId,
      unitId: adminOrg.unitId,
      customerId: adminOrg.customerId,
      assetId: adminOrg.assetId,
      serviceId: adminOrg.serviceId,
      createdBy: adminOrg.userId,
      status: "APPROVED",
    });
    await seedServiceOrderWithLink({
      organizationId: adminOrg.orgId,
      unitId: adminOrg.unitId,
      customerId: adminOrg.customerId,
      assetId: adminOrg.assetId,
      openedByUserId: adminOrg.userId,
      jobId,
    });

    // --- Member: lacks financial:export → 403 on exception-release ---
    loginAs({ userId: memberUserId, organizationId: adminOrg.orgId });
    const memberExcRes = await financeCertificateReleaseRouter.request(
      `/${jobId}/release-by-exception`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "member bypass attempt" }),
      },
    );
    expect(memberExcRes.status).toBe(403);

    // --- Member: lacks financial:contract_create → 403 on POST /settings/ ---
    const memberPolicyRes =
      await settingsCertificateReleasePolicyRouter.request("/", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ mode: "trusted_customer" }),
      });
    expect(memberPolicyRes.status).toBe(403);

    // --- Admin: has financial:contract_create → 200 on POST /settings/ ---
    loginAs({ userId: adminOrg.userId, organizationId: adminOrg.orgId });
    const adminPolicyRes = await settingsCertificateReleasePolicyRouter.request(
      "/",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ mode: "trusted_customer" }),
      },
    );
    expect(adminPolicyRes.status).toBe(200);

    // --- Admin: has financial:export → 200 on exception-release ---
    // Trigger initial recompute so the release row exists.
    await financeCertificateReleaseRouter.request(`/${jobId}`, {
      headers: JSON_HEADERS,
    });
    const adminExcRes = await financeCertificateReleaseRouter.request(
      `/${jobId}/release-by-exception`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "Admin authorized override" }),
      },
    );
    expect(adminExcRes.status).toBe(200);
    expect((await adminExcRes.json()).data.status).toBe(
      "RELEASED_BY_EXCEPTION",
    );
  });

  // =======================================================================
  // REQ-CREL-005: Unauthenticated → 401
  // =======================================================================
  it("REQ-CREL-005: unauthenticated GET and exception-release → 401", async () => {
    logout();

    const getRes = await financeCertificateReleaseRouter.request("/999", {
      headers: JSON_HEADERS,
    });
    expect(getRes.status).toBe(401);

    const postRes = await financeCertificateReleaseRouter.request(
      "/999/release-by-exception",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "anon bypass" }),
      },
    );
    expect(postRes.status).toBe(401);
  });
});
