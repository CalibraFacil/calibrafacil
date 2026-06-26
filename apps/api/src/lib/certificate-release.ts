import { db } from "@calibra-facil/db";
import {
  certificateRelease,
  certificateReleaseAuditLog,
  certificateReleasePolicy,
  billingDocument,
  calibrationJob,
  jobCommercialSnapshot,
  receivableInstallment,
  service,
  serviceOrder,
  serviceOrderCertificateLink,
} from "@calibra-facil/db/schema";
import type {
  BillingDocumentExportStatus,
  BillingDocumentStatus,
  CertificateReleaseAuditSource,
  CertificateReleasePaymentStateSnapshot,
  CertificateReleasePolicyMode,
  CertificateReleaseStatus,
  FinancialContinuityStatus,
  ReceivableInstallmentStatus,
} from "@calibra-facil/shared";
import { deriveFinancialContinuityStatus } from "@calibra-facil/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Pure evaluator. Decides target release status from policy mode + payment
// state. ERP payment status is read-only here; the only mutation downstream
// is `certificate_release` + `certificate_release_audit_log`. Never reads or
// writes `calibration_job.status` or `issued_certificate_snapshot.status`.
// ---------------------------------------------------------------------------

export interface CertificateReleaseEvaluatorPaymentState {
  hasBillingDocument: boolean;
  billingDocumentStatus: BillingDocumentStatus | null;
  installmentStatuses: ReceivableInstallmentStatus[]; // VOID excluded by caller
  anyInstallmentPaid: boolean;
  allActiveInstallmentsPaid: boolean;
  continuityStatus: FinancialContinuityStatus | null;
}

export interface CertificateReleaseEvaluatorInput {
  mode: CertificateReleasePolicyMode;
  paymentState: CertificateReleaseEvaluatorPaymentState;
  hasExceptionRelease: boolean;
}

export function evaluateReleaseStatus(
  input: CertificateReleaseEvaluatorInput,
): CertificateReleaseStatus {
  // Exception release is sticky. The only way out is policy_change or a
  // future "reset to policy" action — not modeled in slice 1.
  if (input.hasExceptionRelease) return "RELEASED_BY_EXCEPTION";

  const { mode, paymentState } = input;

  if (mode === "manual_only" || mode === "trusted_customer") {
    return "RELEASED";
  }

  if (mode === "release_after_invoice") {
    if (!paymentState.hasBillingDocument) return "HELD_FOR_BILLING";
    const status = paymentState.billingDocumentStatus;
    if (status === "ISSUED" || status === "PAID" || status === "OVERDUE") {
      return "RELEASED";
    }
    return "HELD_FOR_BILLING";
  }

  if (mode === "release_after_first_installment") {
    if (!paymentState.hasBillingDocument) return "HELD_FOR_BILLING";
    return paymentState.anyInstallmentPaid ? "RELEASED" : "HELD_FOR_PAYMENT";
  }

  if (mode === "release_after_full_payment") {
    if (!paymentState.hasBillingDocument) return "HELD_FOR_BILLING";
    if (
      paymentState.billingDocumentStatus === "PAID" ||
      paymentState.allActiveInstallmentsPaid
    ) {
      return "RELEASED";
    }
    return "HELD_FOR_PAYMENT";
  }

  // Exhaustive fallback. New modes added to the enum must extend the switch.
  return "HELD_FOR_PAYMENT";
}

// ---------------------------------------------------------------------------
// Policy resolution.
// ---------------------------------------------------------------------------

export interface CertificateReleasePolicyResolutionInput {
  organizationId: string;
  customerId: number | null;
  commercialAgreementId: number | null;
  serviceName: string | null;
}

export interface ResolvedCertificateReleasePolicy {
  id: number | null;
  mode: CertificateReleasePolicyMode;
  scope: "customer" | "agreement" | "service" | "organization" | "fallback";
}

const FALLBACK_POLICY: ResolvedCertificateReleasePolicy = {
  id: null,
  mode: "manual_only",
  scope: "fallback",
};

export async function resolveCertificateReleasePolicy(
  input: CertificateReleasePolicyResolutionInput,
): Promise<ResolvedCertificateReleasePolicy> {
  const rows = await db
    .select({
      id: certificateReleasePolicy.id,
      mode: certificateReleasePolicy.mode,
      customerId: certificateReleasePolicy.customerId,
      commercialAgreementId: certificateReleasePolicy.commercialAgreementId,
      serviceCategory: certificateReleasePolicy.serviceCategory,
      priority: certificateReleasePolicy.priority,
    })
    .from(certificateReleasePolicy)
    .where(
      and(
        eq(certificateReleasePolicy.organizationId, input.organizationId),
        isNull(certificateReleasePolicy.archivedAt),
      ),
    );

  if (rows.length === 0) return FALLBACK_POLICY;

  // Specificity: customer > agreement > service category > org default.
  // Within a specificity tier, higher priority wins; ties resolve by id desc.
  const customerMatch = rows
    .filter(
      (row) =>
        input.customerId !== null &&
        row.customerId === input.customerId &&
        row.commercialAgreementId === null &&
        row.serviceCategory === null,
    )
    .sort(byPriorityThenId);
  if (customerMatch[0]) {
    return {
      id: customerMatch[0].id,
      mode: customerMatch[0].mode,
      scope: "customer",
    };
  }

  const agreementMatch = rows
    .filter(
      (row) =>
        input.commercialAgreementId !== null &&
        row.commercialAgreementId === input.commercialAgreementId &&
        row.customerId === null &&
        row.serviceCategory === null,
    )
    .sort(byPriorityThenId);
  if (agreementMatch[0]) {
    return {
      id: agreementMatch[0].id,
      mode: agreementMatch[0].mode,
      scope: "agreement",
    };
  }

  if (input.serviceName !== null) {
    const lowered = input.serviceName.trim().toLowerCase();
    const serviceMatch = rows
      .filter(
        (row) =>
          row.serviceCategory !== null &&
          row.serviceCategory.trim().toLowerCase() === lowered &&
          row.customerId === null &&
          row.commercialAgreementId === null,
      )
      .sort(byPriorityThenId);
    if (serviceMatch[0]) {
      return {
        id: serviceMatch[0].id,
        mode: serviceMatch[0].mode,
        scope: "service",
      };
    }
  }

  const orgDefaultMatch = rows
    .filter(
      (row) =>
        row.customerId === null &&
        row.commercialAgreementId === null &&
        row.serviceCategory === null,
    )
    .sort(byPriorityThenId);
  if (orgDefaultMatch[0]) {
    return {
      id: orgDefaultMatch[0].id,
      mode: orgDefaultMatch[0].mode,
      scope: "organization",
    };
  }

  return FALLBACK_POLICY;
}

function byPriorityThenId(
  a: { priority: number; id: number },
  b: { priority: number; id: number },
) {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return b.id - a.id;
}

// ---------------------------------------------------------------------------
// Recompute helper. Reads job + customer + service + agreement + financial
// state, resolves the active policy, runs the evaluator, persists state +
// audit. Returns the resulting release row.
// ---------------------------------------------------------------------------

export interface RecomputeCertificateReleaseInput {
  calibrationJobId: number;
  source: CertificateReleaseAuditSource;
  actorUserId?: string | null;
}

export interface RecomputedCertificateRelease {
  releaseId: number;
  status: CertificateReleaseStatus;
  appliedPolicyId: number | null;
  changed: boolean;
}

export async function recomputeCertificateRelease(
  input: RecomputeCertificateReleaseInput,
): Promise<RecomputedCertificateRelease | null> {
  const [job] = await db
    .select({
      id: calibrationJob.id,
      organizationId: calibrationJob.organizationId,
      customerId: calibrationJob.customerId,
      serviceId: calibrationJob.serviceId,
      status: calibrationJob.status,
    })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, input.calibrationJobId))
    .limit(1);

  if (!job) return null;
  if (job.status !== "APPROVED" && job.status !== "SUPERSEDED") {
    // Certificate is not yet eligible for release surfacing. Leave any
    // existing row untouched (likely was created via backfill or won't be
    // created until approval).
    return null;
  }

  const [snapshot] = await db
    .select({
      agreementId: jobCommercialSnapshot.agreementId,
    })
    .from(jobCommercialSnapshot)
    .where(eq(jobCommercialSnapshot.jobId, job.id))
    .limit(1);

  const [serviceRow] = await db
    .select({ name: service.name })
    .from(service)
    .where(eq(service.id, job.serviceId))
    .limit(1);

  const policy = await resolveCertificateReleasePolicy({
    organizationId: job.organizationId,
    customerId: job.customerId,
    commercialAgreementId: snapshot?.agreementId ?? null,
    serviceName: serviceRow?.name ?? null,
  });

  const paymentState = await buildPaymentStateForJob(
    job.id,
    job.organizationId,
  );

  const [existing] = await db
    .select({
      id: certificateRelease.id,
      status: certificateRelease.status,
      releaseReason: certificateRelease.releaseReason,
      releasedByUserId: certificateRelease.releasedByUserId,
      appliedPolicyId: certificateRelease.appliedPolicyId,
    })
    .from(certificateRelease)
    .where(eq(certificateRelease.calibrationJobId, job.id))
    .limit(1);

  const hasExceptionRelease = existing?.status === "RELEASED_BY_EXCEPTION";

  const nextStatus = evaluateReleaseStatus({
    mode: policy.mode,
    paymentState: paymentState.evaluatorInput,
    hasExceptionRelease,
  });

  const now = new Date();
  const snapshotJson = paymentState.snapshot;

  if (existing) {
    const changed = existing.status !== nextStatus;
    await db
      .update(certificateRelease)
      .set({
        status: nextStatus,
        appliedPolicyId: hasExceptionRelease ? existing.appliedPolicyId : policy.id,
        lastEvaluatedAt: now,
        paymentStateSnapshot: snapshotJson,
        updatedAt: now,
      })
      .where(eq(certificateRelease.id, existing.id));

    if (changed) {
      await db.insert(certificateReleaseAuditLog).values({
        organizationId: job.organizationId,
        certificateReleaseId: existing.id,
        actorUserId: input.actorUserId ?? null,
        fromStatus: existing.status,
        toStatus: nextStatus,
        appliedPolicyId: policy.id,
        paymentStateSnapshot: snapshotJson,
        reason: null,
        source: input.source,
      });
    }

    return {
      releaseId: existing.id,
      status: nextStatus,
      appliedPolicyId: existing.appliedPolicyId ?? policy.id,
      changed,
    };
  }

  const [inserted] = await db
    .insert(certificateRelease)
    .values({
      organizationId: job.organizationId,
      calibrationJobId: job.id,
      status: nextStatus,
      appliedPolicyId: policy.id,
      lastEvaluatedAt: now,
      paymentStateSnapshot: snapshotJson,
      releasedByUserId: null,
      releaseReason: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!inserted) return null;

  await db.insert(certificateReleaseAuditLog).values({
    organizationId: job.organizationId,
    certificateReleaseId: inserted.id,
    actorUserId: input.actorUserId ?? null,
    fromStatus: null,
    toStatus: nextStatus,
    appliedPolicyId: policy.id,
    paymentStateSnapshot: snapshotJson,
    reason: null,
    source: input.source,
  });

  return {
    releaseId: inserted.id,
    status: nextStatus,
    appliedPolicyId: policy.id,
    changed: true,
  };
}

// ---------------------------------------------------------------------------
// Manual / exception release. Reason is required and trimmed non-empty.
// ---------------------------------------------------------------------------

export interface ReleaseByExceptionInput {
  calibrationJobId: number;
  actorUserId: string;
  reason: string;
}

export interface ExceptionReleaseError {
  code: "JOB_NOT_FOUND" | "REASON_REQUIRED" | "NOT_APPROVED";
}

export async function releaseByException(
  input: ReleaseByExceptionInput,
): Promise<RecomputedCertificateRelease | ExceptionReleaseError> {
  const reason = input.reason?.trim?.() ?? "";
  if (!reason) return { code: "REASON_REQUIRED" };

  const [job] = await db
    .select({
      id: calibrationJob.id,
      organizationId: calibrationJob.organizationId,
      status: calibrationJob.status,
    })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, input.calibrationJobId))
    .limit(1);

  if (!job) return { code: "JOB_NOT_FOUND" };
  if (job.status !== "APPROVED" && job.status !== "SUPERSEDED") {
    return { code: "NOT_APPROVED" };
  }

  const paymentState = await buildPaymentStateForJob(
    job.id,
    job.organizationId,
  );

  const [existing] = await db
    .select({
      id: certificateRelease.id,
      status: certificateRelease.status,
      appliedPolicyId: certificateRelease.appliedPolicyId,
    })
    .from(certificateRelease)
    .where(eq(certificateRelease.calibrationJobId, job.id))
    .limit(1);

  const now = new Date();
  const snapshotJson = paymentState.snapshot;

  if (existing) {
    await db
      .update(certificateRelease)
      .set({
        status: "RELEASED_BY_EXCEPTION",
        releasedByUserId: input.actorUserId,
        releaseReason: reason,
        lastEvaluatedAt: now,
        paymentStateSnapshot: snapshotJson,
        updatedAt: now,
      })
      .where(eq(certificateRelease.id, existing.id));

    await db.insert(certificateReleaseAuditLog).values({
      organizationId: job.organizationId,
      certificateReleaseId: existing.id,
      actorUserId: input.actorUserId,
      fromStatus: existing.status,
      toStatus: "RELEASED_BY_EXCEPTION",
      appliedPolicyId: existing.appliedPolicyId,
      paymentStateSnapshot: snapshotJson,
      reason,
      source: "exception_release",
    });

    return {
      releaseId: existing.id,
      status: "RELEASED_BY_EXCEPTION",
      appliedPolicyId: existing.appliedPolicyId,
      changed: existing.status !== "RELEASED_BY_EXCEPTION",
    };
  }

  const [inserted] = await db
    .insert(certificateRelease)
    .values({
      organizationId: job.organizationId,
      calibrationJobId: job.id,
      status: "RELEASED_BY_EXCEPTION",
      appliedPolicyId: null,
      lastEvaluatedAt: now,
      paymentStateSnapshot: snapshotJson,
      releasedByUserId: input.actorUserId,
      releaseReason: reason,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!inserted) return { code: "JOB_NOT_FOUND" };

  await db.insert(certificateReleaseAuditLog).values({
    organizationId: job.organizationId,
    certificateReleaseId: inserted.id,
    actorUserId: input.actorUserId,
    fromStatus: null,
    toStatus: "RELEASED_BY_EXCEPTION",
    appliedPolicyId: null,
    paymentStateSnapshot: snapshotJson,
    reason,
    source: "exception_release",
  });

  return {
    releaseId: inserted.id,
    status: "RELEASED_BY_EXCEPTION",
    appliedPolicyId: null,
    changed: true,
  };
}

// ---------------------------------------------------------------------------
// Payment state assembly for a job. Reads the job's linked SOs, their
// billing documents and installments, and derives the Phase 1 continuity
// status. Read-only: never touches calibrationJob or issuedCertificateSnapshot.
// ---------------------------------------------------------------------------

async function buildPaymentStateForJob(
  calibrationJobId: number,
  organizationId: string,
): Promise<{
  evaluatorInput: CertificateReleaseEvaluatorPaymentState;
  snapshot: CertificateReleasePaymentStateSnapshot;
}> {
  const orderLinks = await db
    .select({
      serviceOrderId: serviceOrderCertificateLink.serviceOrderId,
      directBillingDocumentId: serviceOrder.billingDocumentId,
    })
    .from(serviceOrderCertificateLink)
    .innerJoin(
      serviceOrder,
      eq(serviceOrder.id, serviceOrderCertificateLink.serviceOrderId),
    )
    .where(
      and(
        eq(serviceOrderCertificateLink.certificateJobId, calibrationJobId),
        eq(serviceOrder.organizationId, organizationId),
      ),
    );

  const billingDocumentIds = orderLinks
    .map((link) => link.directBillingDocumentId)
    .filter((id): id is number => typeof id === "number");

  let billingDoc: {
    id: number;
    status: BillingDocumentStatus;
    issuedAt: Date | null;
    exportStatusRaw: BillingDocumentExportStatus;
  } | null = null;

  if (billingDocumentIds.length > 0) {
    const docs = await db
      .select({
        id: billingDocument.id,
        status: billingDocument.status,
        issuedAt: billingDocument.issueDate,
        exportStatus: billingDocument.exportStatus,
      })
      .from(billingDocument)
      .where(
        and(
          eq(billingDocument.organizationId, organizationId),
          inArray(billingDocument.id, billingDocumentIds),
        ),
      );

    // If a job is linked to multiple SOs that point at different billing
    // documents, pick the most advanced (PAID > OVERDUE > ISSUED > DRAFT >
    // VOID) so a single split-billing edge case can't downgrade the gate.
    const ranked = docs.slice().sort(rankBillingDocument).reverse();
    const top = ranked[0];
    if (top) {
      billingDoc = {
        id: top.id,
        status: top.status,
        issuedAt: top.issuedAt,
        exportStatusRaw: top.exportStatus,
      };
    }
  }

  const installments = billingDoc
    ? await db
        .select({
          id: receivableInstallment.id,
          status: receivableInstallment.status,
          dueDate: receivableInstallment.dueDate,
          amountCents: receivableInstallment.amountCents,
        })
        .from(receivableInstallment)
        .where(eq(receivableInstallment.documentId, billingDoc.id))
    : [];

  const activeInstallments = installments.filter(
    (installment) => installment.status !== "VOID",
  );
  const anyInstallmentPaid = activeInstallments.some(
    (installment) => installment.status === "PAID",
  );
  const allActiveInstallmentsPaid =
    activeInstallments.length > 0 &&
    activeInstallments.every((installment) => installment.status === "PAID");
  const openCents = activeInstallments
    .filter(
      (installment) =>
        installment.status === "OPEN" || installment.status === "OVERDUE",
    )
    .reduce((sum, installment) => sum + installment.amountCents, 0);
  const overdueCents = activeInstallments
    .filter((installment) => installment.status === "OVERDUE")
    .reduce((sum, installment) => sum + installment.amountCents, 0);

  const continuityStatus = deriveFinancialContinuityStatus({
    hasBillingDocument: Boolean(billingDoc),
    billingDocumentStatus: billingDoc?.status ?? null,
    exportStatus: billingDoc?.exportStatusRaw ?? null,
    installmentStatuses: activeInstallments.map(
      (installment) => installment.status,
    ),
    blockers: [],
    isStale: false,
    isConfigured: true,
  });

  const snapshot: CertificateReleasePaymentStateSnapshot = {
    continuityStatus,
    openCents,
    overdueCents,
    installments: installments.map((installment) => ({
      id: installment.id,
      status: installment.status,
      dueDate: installment.dueDate
        ? installment.dueDate.toISOString().slice(0, 10)
        : null,
    })),
    billingDocument: billingDoc
      ? {
          id: billingDoc.id,
          status: billingDoc.status,
          exportStatus: billingDoc.exportStatusRaw,
          issuedAt: billingDoc.issuedAt
            ? billingDoc.issuedAt.toISOString()
            : null,
        }
      : null,
  };

  return {
    evaluatorInput: {
      hasBillingDocument: Boolean(billingDoc),
      billingDocumentStatus: billingDoc?.status ?? null,
      installmentStatuses: activeInstallments.map(
        (installment) => installment.status,
      ),
      anyInstallmentPaid,
      allActiveInstallmentsPaid,
      continuityStatus,
    },
    snapshot,
  };
}

const BILLING_RANK: Record<BillingDocumentStatus, number> = {
  VOID: 0,
  DRAFT: 1,
  ISSUED: 2,
  OVERDUE: 3,
  PAID: 4,
};

function rankBillingDocument(
  a: { status: BillingDocumentStatus },
  b: { status: BillingDocumentStatus },
) {
  return BILLING_RANK[a.status] - BILLING_RANK[b.status];
}
