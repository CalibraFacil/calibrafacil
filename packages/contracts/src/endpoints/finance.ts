import { z } from "zod";
import {
  BILLING_DOCUMENT_EXPORT_STATUSES,
  BILLING_DOCUMENT_STATUSES,
  CERTIFICATE_RELEASE_STATUSES,
  COMMERCIAL_AGREEMENT_STATUSES,
  RECEIVABLE_INSTALLMENT_STATUSES,
  type AutomaticSendMilestone,
  type CertificateReleasePolicyMode,
} from "@calibra-facil/shared";

import { nullableNumber, nullableString } from "../common";
import { endpoint, routeId, type EndpointGroup } from "./define";

/**
 * The laboratory's finance: billing documents, commercial contracts, receipts,
 * the ERP export queue, the billing-readiness queue, the financial timeline, the
 * certificate-release policies and automatic-send rules, and the dashboards
 * (overview, operations-to-cash, revenue leakage, cash forecast, margins).
 * Response schemas are wire schemas written from what the handlers in
 * `apps/api/src/domains/finance/routes/` return; the request schemas the server
 * validated with live here now.
 *
 * Not client-facing, so not defined here: `GET /api/finance/access` and
 * `PUT /api/finance/contracts/:id` (nothing calls them).
 */

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

const agreementStatusSchema = z.enum(COMMERCIAL_AGREEMENT_STATUSES);
const documentStatusSchema = z.enum(BILLING_DOCUMENT_STATUSES);
const exportStatusSchema = z.enum(BILLING_DOCUMENT_EXPORT_STATUSES);
const installmentStatusSchema = z.enum(RECEIVABLE_INSTALLMENT_STATUSES);
const paymentMethodSchema = z.enum([
  "CREDIT_CARD",
  "PIX",
  "BOLETO",
  "BANK_TRANSFER",
  "CASH",
  "OTHER",
]);

const certificateReleaseStatusSchema = z.enum(CERTIFICATE_RELEASE_STATUSES);

/** Release policy modes (`CertificateReleasePolicyMode`). */
export const CERTIFICATE_RELEASE_POLICY_MODES = [
  "release_after_invoice",
  "release_after_first_installment",
  "release_after_full_payment",
  "trusted_customer",
  "manual_only",
] as const satisfies readonly CertificateReleasePolicyMode[];
const policyModeSchema = z.enum(CERTIFICATE_RELEASE_POLICY_MODES);

/** When an automatic send fires (`AutomaticSendMilestone`). */
export const AUTOMATIC_SEND_MILESTONES = [
  "certificate_approved",
  "service_order_delivered",
  "contract_anniversary",
  "manual_only",
] as const satisfies readonly AutomaticSendMilestone[];
const milestoneSchema = z.enum(AUTOMATIC_SEND_MILESTONES);

const ruleScopeSchema = z.enum([
  "customer",
  "agreement",
  "service",
  "organization",
]);

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const ListDocumentsQuerySchema = z.object({
  query: z.string().trim().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  status: z.enum(BILLING_DOCUMENT_STATUSES).optional(),
});

export const EligibleJobsQuerySchema = z.object({
  query: z.string().trim().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  mode: z.enum(["single", "consolidated"]).default("single"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const CreateDocumentSchema = z.object({
  mode: z.enum(["single", "consolidated"]).default("single"),
  jobIds: z.array(z.number().int().positive()).min(1),
  dueDate: z.string().datetime().optional(),
  notes: z.string().trim().max(5000).optional(),
  discountCents: z.number().int().min(0).default(0),
});

const UpdateDocumentItemSchema = z.object({
  id: z.number().int().positive(),
  description: z.string().trim().min(1).max(240),
  quantity: z.number().int().min(1).max(999).default(1),
  unitPriceCents: z.number().int().min(0),
});

export const UpdateDocumentSchema = z.object({
  dueDate: z.string().datetime().optional(),
  notes: z.string().trim().max(5000).optional(),
  discountCents: z.number().int().min(0).default(0),
  reason: z.string().trim().max(500).optional(),
  items: z.array(UpdateDocumentItemSchema).optional(),
});

export const VoidDocumentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const AgreementServiceTermSchema = z.object({
  id: z.number().int().optional(),
  serviceId: z.number().int().positive(),
  unitId: z.number().int().positive().nullable().optional(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().trim().min(3).max(8).default("BRL"),
  tatDays: z.number().int().nonnegative().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const CreateAgreementSchema = z.object({
  customerId: z.number().int().positive(),
  title: z.string().trim().min(3).max(120),
  agreementCode: z.string().trim().max(60).optional(),
  externalReference: z.string().trim().max(120).optional(),
  currency: z.string().trim().min(3).max(8).default("BRL"),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().optional(),
  defaultPaymentTermDays: z.number().int().min(1).max(180).default(28),
  notes: z.string().trim().max(5000).optional(),
  unitIds: z.array(z.number().int().positive()).default([]),
  serviceTerms: z.array(AgreementServiceTermSchema).min(1),
});

export const UpdateAgreementSchema = CreateAgreementSchema.extend({
  status: agreementStatusSchema.optional(),
});

export const ListContractsQuerySchema = z.object({
  query: z.string().trim().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  status: agreementStatusSchema.optional(),
});

export const RecordReceiptSchema = z.object({
  amountCents: z.number().int().positive(),
  paymentMethod: paymentMethodSchema,
  receivedAt: z.string().datetime().optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(5000).optional(),
});

export const SendBillingReadinessSchema = z.object({
  serviceOrderIds: z.array(z.number().int().positive()).min(1).max(50),
});

/**
 * The readiness filters are read leniently on purpose: an unknown status or a
 * non-numeric customer id is ignored, not refused (the queue shows everything).
 */
const BillingReadinessQuerySchema = z.object({
  status: z.string().optional(),
  customerId: z.string().optional(),
});

/** The stage filter is read leniently too: an unknown stage lists every stage. */
const OperationsToCashQuerySchema = z.object({ stage: z.string().optional() });

/** The timeline limit is parsed by the handler (a bad one is a 400 with its own code). */
const CustomerTimelineQuerySchema = z.object({ limit: z.string().optional() });

const RuleTargetShape = {
  customerId: z.number().int().positive().nullable().optional(),
  commercialAgreementId: z.number().int().positive().nullable().optional(),
  serviceCategory: z
    .string()
    .min(1)
    .max(200)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? null : value?.trim() || null)),
  priority: z.number().int().min(0).max(1000).optional(),
};

export const ReleaseByExceptionSchema = z.object({
  reason: z
    .string()
    .min(1, "Reason is required")
    .max(500)
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, "Reason is required"),
});

export const CreatePolicySchema = z.object({
  mode: policyModeSchema,
  ...RuleTargetShape,
});

export const UpdatePolicySchema = z.object({
  mode: policyModeSchema.optional(),
  archived: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});

export const CreateRuleSchema = z.object({
  milestone: milestoneSchema,
  ...RuleTargetShape,
});

export const UpdateRuleSchema = z.object({
  milestone: milestoneSchema.optional(),
  archived: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** One document as the list shows it. */
const documentListItemSchema = z.object({
  id: z.number(),
  publicId: z.string(),
  documentNumber: nullableString,
  status: documentStatusSchema,
  customerId: z.number(),
  customerName: z.string(),
  unitId: z.number(),
  unitName: z.string(),
  issueDate: nullableString,
  dueDate: z.string(),
  subtotalCents: z.number(),
  discountCents: z.number(),
  totalCents: z.number(),
  currency: z.string(),
  exportStatus: exportStatusSchema,
  exportedAt: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BillingDocumentListItem = z.infer<typeof documentListItemSchema>;

/** A completed job that can still be put on a billing document. */
const eligibleJobSchema = z.object({
  id: z.number(),
  jobId: z.string(),
  customerId: z.number(),
  customerName: z.string(),
  unitId: z.number(),
  unitName: z.string(),
  serviceId: z.number(),
  serviceName: z.string(),
  servicePrice: nullableNumber,
  currency: z.string(),
  approvedAt: nullableString,
  priceCents: z.number(),
  paymentTermDays: z.number(),
  snapshotId: z.number(),
});
export type FinanceEligibleJob = z.infer<typeof eligibleJobSchema>;

const installmentSchema = z.object({
  id: z.number(),
  documentId: z.number(),
  installmentNumber: z.number(),
  status: installmentStatusSchema,
  dueDate: z.string(),
  amountCents: z.number(),
  currency: z.string(),
  paidAt: nullableString,
  paymentMethod: paymentMethodSchema.nullable(),
  paymentReference: nullableString,
});

/** A billing document with its items, installments, receipts and audit trail. */
export const documentDetailSchema = z.object({
  id: z.number(),
  publicId: z.string(),
  organizationId: z.string(),
  customerId: z.number(),
  customerName: z.string(),
  unitId: z.number(),
  unitName: z.string(),
  agreementId: nullableNumber,
  documentNumber: nullableString,
  status: documentStatusSchema,
  issueDate: nullableString,
  dueDate: z.string(),
  currency: z.string(),
  subtotalCents: z.number(),
  discountCents: z.number(),
  totalCents: z.number(),
  notes: nullableString,
  exportStatus: exportStatusSchema,
  exportedAt: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
  voidReason: nullableString,
  items: z.array(
    z.object({
      id: z.number(),
      documentId: z.number(),
      jobId: nullableNumber,
      jobDisplayId: nullableString,
      jobCommercialSnapshotId: nullableNumber,
      snapshotServiceName: nullableString,
      snapshotPriceCents: nullableNumber,
      description: z.string(),
      quantity: z.number(),
      unitPriceCents: z.number(),
      totalCents: z.number(),
      sortOrder: z.number(),
    }),
  ),
  installments: z.array(installmentSchema),
  receipts: z.array(
    z.object({
      id: z.number(),
      installmentId: z.number(),
      amountCents: z.number(),
      paymentMethod: paymentMethodSchema,
      reference: nullableString,
      notes: nullableString,
      receivedAt: z.string(),
    }),
  ),
  audit: z.array(
    z.object({
      id: z.number(),
      action: z.string(),
      changes: z.unknown(),
      reason: nullableString,
      performedBy: nullableString,
      performedAt: z.string(),
    }),
  ),
});
export type BillingDocumentDetails = z.infer<typeof documentDetailSchema>;

/** The stored `billing_document` row a create answers. */
const documentRowSchema = z.object({
  id: z.number(),
  publicId: z.string(),
  organizationId: z.string(),
  customerId: z.number(),
  unitId: z.number(),
  documentNumber: nullableString,
  status: documentStatusSchema,
  dueDate: z.string(),
  currency: z.string(),
  subtotalCents: z.number(),
  discountCents: z.number(),
  totalCents: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const contractListItemSchema = z.object({
  id: z.number(),
  customerId: z.number(),
  customerName: z.string(),
  status: agreementStatusSchema,
  agreementCode: nullableString,
  title: z.string(),
  currency: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: nullableString,
  defaultPaymentTermDays: z.number(),
  updatedAt: z.string(),
});
export type ContractListItem = z.infer<typeof contractListItemSchema>;

const agreementRowSchema = z.object({
  id: z.number(),
  organizationId: z.string(),
  customerId: z.number(),
  status: agreementStatusSchema,
  agreementCode: nullableString,
  title: z.string(),
  currency: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: nullableString,
  defaultPaymentTermDays: z.number(),
  notes: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** A contract with its customer's qualification, unit scope and service terms. */
export const contractDetailSchema = contractListItemSchema.extend({
  organizationId: z.string(),
  externalReference: nullableString,
  notes: nullableString,
  createdAt: z.string(),
  customerCompliance: z
    .object({
      qualificationStatus: nullableString.optional(),
      qualityRequirementsAcknowledged: z.boolean().nullable().optional(),
      contractSignedAt: nullableString.optional(),
      contractNumber: nullableString.optional(),
    })
    .nullable(),
  unitIds: z.array(z.number()),
  serviceTerms: z.array(
    z.object({
      id: z.number(),
      serviceId: z.number(),
      unitId: nullableNumber,
      priceCents: z.number(),
      currency: z.string(),
      tatDays: nullableNumber,
      isActive: z.boolean(),
    }),
  ),
});
export type FinanceContractDetails = z.infer<typeof contractDetailSchema>;

const receiptRowSchema = z.object({
  installmentId: z.number(),
  documentId: z.number(),
  documentNumber: nullableString,
  documentStatus: documentStatusSchema,
  customerName: z.string(),
  dueDate: z.string(),
  amountCents: z.number(),
  installmentStatus: installmentStatusSchema,
  paidAt: nullableString,
  paymentMethod: paymentMethodSchema.nullable(),
  paymentReference: nullableString,
});
export type ReceiptRow = z.infer<typeof receiptRowSchema>;

const erpExportRowSchema = z.object({
  id: z.number(),
  documentNumber: nullableString,
  customerName: z.string(),
  status: documentStatusSchema,
  exportStatus: exportStatusSchema,
  exportedAt: nullableString,
  totalCents: z.number(),
  currency: z.string(),
  dueDate: z.string(),
  issueDate: nullableString,
});
export type ErpExportRow = z.infer<typeof erpExportRowSchema>;

/** GET /api/finance/overview */
export const financeOverviewSchema = z.object({
  totals: z.object({
    issuedCents: z.number(),
    openCents: z.number(),
    overdueCents: z.number(),
    receivedCents: z.number(),
  }),
  counts: z.object({
    draftDocuments: z.number(),
    issuedDocuments: z.number(),
    overdueDocuments: z.number(),
    paidDocuments: z.number(),
  }),
  aging: z.record(z.string(), z.number()),
  recentDocuments: z.array(
    z.object({
      id: z.number(),
      publicId: z.string(),
      documentNumber: nullableString,
      status: documentStatusSchema,
      exportStatus: exportStatusSchema,
      totalCents: z.number(),
      dueDate: z.string(),
      issueDate: nullableString,
      customerName: z.string(),
      unitName: z.string(),
    }),
  ),
  pendingExports: z.number(),
});
export type FinanceOverview = z.infer<typeof financeOverviewSchema>;

// Billing readiness -------------------------------------------------------

const billingReadinessStatusSchema = z.enum([
  "READY",
  "BLOCKED",
  "BILLED",
  "SENT",
]);
const billingBlockerSchema = z.object({
  code: z.enum([
    "BLOCKED_BY_CUSTOMER_DATA",
    "BLOCKED_BY_UNMAPPED_SERVICE",
    "BLOCKED_BY_CERTIFICATE_STATUS",
    "BLOCKED_BY_POLICY",
    "INTEGRATION_NOT_CONFIGURED",
    "INTEGRATION_DISCONNECTED",
    "CONFIGURATION_INCOMPLETE",
  ]),
  label: z.string(),
  owner: z.enum(["lab_ops", "finance", "commercial", "admin", "support"]),
  fixAction: z.string(),
  scope: z.enum(["order", "customer", "all_future"]),
});
const integrationStateSchema = z.enum([
  "connected",
  "disconnected",
  "not_configured",
]);
const entityRefSchema = z.object({ id: z.number(), name: z.string() });

export const billingReadinessResponseSchema = z.object({
  billing: z.object({ integrationState: integrationStateSchema }),
  summary: z.object({
    ready: z.number(),
    blocked: z.number(),
    billed: z.number(),
    sent: z.number(),
  }),
  data: z.array(
    z.object({
      serviceOrderId: z.number(),
      serviceOrderNumber: z.string(),
      customer: entityRefSchema,
      unit: entityRefSchema,
      amountCents: z.number(),
      currency: z.string(),
      completedAt: nullableString,
      certificateRefs: z.array(
        z.object({
          jobId: z.number(),
          displayId: z.string(),
          status: z.string(),
        }),
      ),
      readinessStatus: billingReadinessStatusSchema,
      blockers: z.array(billingBlockerSchema),
      existingBillingDocumentId: nullableNumber,
    }),
  ),
});
export type BillingReadinessResponse = z.infer<
  typeof billingReadinessResponseSchema
>;

// Financial timeline ------------------------------------------------------

const continuityStatusSchema = z.enum([
  "NOT_CONFIGURED",
  "NOT_SENT",
  "READY_FOR_BILLING",
  "BLOCKED",
  "SENT_TO_FINANCE",
  "INVOICE_AVAILABLE",
  "AWAITING_PAYMENT",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "STATUS_UNAVAILABLE",
  "SYNCHRONIZED_WITH_WARNINGS",
  "VOID",
]);
const freshnessSchema = z.object({
  status: z.enum(["fresh", "stale", "unknown", "local_only"]),
  lastSyncedAt: nullableString,
  label: z.string(),
});
const providerEvidenceSchema = z.object({
  label: z.string(),
  integrationState: integrationStateSchema,
  reconnectPath: nullableString,
});
const fiscalDocumentSchema = z.object({
  availability: z.enum([
    "NONE",
    "PENDING",
    "AVAILABLE",
    "UNAVAILABLE",
    "WARNINGS",
  ]),
  label: z.string(),
  number: nullableString,
  issuedAt: nullableString,
  accessKey: nullableString,
  xmlAvailable: z.boolean(),
  consultationOnly: z.boolean(),
  lastSyncedAt: nullableString,
});
const timelineInstallmentSchema = z.object({
  id: z.number(),
  installmentNumber: z.number(),
  status: installmentStatusSchema,
  label: z.string(),
  amountCents: z.number(),
  currency: z.string(),
  dueDate: z.string(),
  paidAt: nullableString,
  paymentMethod: paymentMethodSchema.nullable(),
});
const timelineReceiptSchema = z.object({
  id: z.number(),
  installmentId: z.number(),
  receivedAt: z.string(),
  amountCents: z.number(),
  paymentMethod: paymentMethodSchema,
  reference: nullableString,
});

/** GET /api/finance/service-orders/:serviceOrderId/status */
export const serviceOrderFinancialStatusSchema = z.object({
  serviceOrderId: z.number(),
  serviceOrderNumber: z.string(),
  status: continuityStatusSchema,
  label: z.string(),
  description: z.string(),
  readinessStatus: billingReadinessStatusSchema.nullable(),
  blockers: z.array(billingBlockerSchema),
  amountCents: z.number(),
  currency: z.string(),
  billingDocument: z
    .object({
      id: z.number(),
      documentNumber: nullableString,
      status: documentStatusSchema,
      exportStatus: exportStatusSchema,
      issuedAt: nullableString,
      dueDate: z.string(),
      totalCents: z.number(),
      currency: z.string(),
    })
    .nullable(),
  installments: z.array(timelineInstallmentSchema),
  installmentsSummary: z.object({
    total: z.number(),
    totalCents: z.number(),
    paidCents: z.number(),
    openCents: z.number(),
    overdueCents: z.number(),
    paidCount: z.number(),
    openCount: z.number(),
    overdueCount: z.number(),
    voidCount: z.number(),
  }),
  receipts: z.array(timelineReceiptSchema),
  fiscalDocument: fiscalDocumentSchema,
  freshness: freshnessSchema,
  providerEvidence: providerEvidenceSchema.nullable(),
});
export type ServiceOrderFinancialStatus = z.infer<
  typeof serviceOrderFinancialStatusSchema
>;

/** GET /api/finance/customers/:customerId/timeline */
export const customerFinancialTimelineSchema = z.object({
  customerId: z.number(),
  freshness: freshnessSchema,
  summary: z.object({
    scope: z.literal("recent_documents"),
    scopeLabel: z.string(),
    limit: z.number(),
    isTruncated: z.boolean(),
    documents: z.number(),
    totalDocuments: z.number(),
    openCents: z.number(),
    overdueCents: z.number(),
    receivedCents: z.number(),
  }),
  data: z.array(
    z.object({
      id: z.number(),
      documentNumber: nullableString,
      status: documentStatusSchema,
      exportStatus: exportStatusSchema,
      continuityStatus: continuityStatusSchema,
      label: z.string(),
      issueDate: nullableString,
      dueDate: z.string(),
      totalCents: z.number(),
      currency: z.string(),
      unit: entityRefSchema,
      installments: z.array(timelineInstallmentSchema),
      receipts: z.array(timelineReceiptSchema),
      fiscalDocuments: z.array(fiscalDocumentSchema),
      freshness: freshnessSchema,
      providerEvidence: providerEvidenceSchema.nullable(),
    }),
  ),
});
export type CustomerFinancialTimeline = z.infer<
  typeof customerFinancialTimelineSchema
>;

// Certificate release -----------------------------------------------------

/** A certificate's release state (the job's policy decision and its evidence). */
export const certificateReleaseSchema = z.object({
  status: certificateReleaseStatusSchema,
  appliedPolicy: z
    .object({ id: z.number(), mode: policyModeSchema })
    .nullable(),
  paymentState: z.unknown(),
  lastEvaluatedAt: z.string(),
  releasedByUserName: nullableString,
  releaseReason: nullableString,
});
export type CertificateReleaseDto = z.infer<typeof certificateReleaseSchema>;

const ruleBaseShape = {
  id: z.number(),
  customerId: nullableNumber,
  commercialAgreementId: nullableNumber,
  serviceCategory: nullableString,
  priority: z.number(),
  scope: ruleScopeSchema,
  archivedAt: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
};

/** A certificate-release policy as the settings list shows it. */
const policySchema = z.object({
  ...ruleBaseShape,
  mode: policyModeSchema,
  customerName: nullableString,
});
export type CertificateReleasePolicy = z.infer<typeof policySchema>;

/** An automatic-send rule as the settings list shows it. */
const sendRuleSchema = z.object({
  ...ruleBaseShape,
  milestone: milestoneSchema,
  customerName: nullableString,
});
export type AutomaticSendRule = z.infer<typeof sendRuleSchema>;

// Dashboards --------------------------------------------------------------

const stageSchema = z.enum([
  "READY_TO_BILL",
  "SENT_TO_FINANCE",
  "INVOICED",
  "PARTIALLY_COLLECTED",
  "COLLECTED",
]);
const stageBucketSchema = z.object({
  count: z.number(),
  totalCents: z.number(),
});

export const operationsToCashSchema = z.object({
  summary: z.object({
    stages: z.object({
      READY_TO_BILL: stageBucketSchema,
      SENT_TO_FINANCE: stageBucketSchema,
      INVOICED: stageBucketSchema,
      PARTIALLY_COLLECTED: stageBucketSchema,
      COLLECTED: stageBucketSchema,
    }),
    needsAttention: z.object({
      overdueCount: z.number(),
      blockedCount: z.number(),
      overdueCents: z.number(),
      blockedCents: z.number(),
    }),
  }),
  items: z.array(
    z.object({
      serviceOrderId: z.number(),
      serviceOrderNumber: z.string(),
      customer: entityRefSchema,
      unit: entityRefSchema,
      amountCents: z.number(),
      currency: z.string(),
      stage: stageSchema,
      isOverdue: z.boolean(),
      isBlocked: z.boolean(),
    }),
  ),
});
export type OperationsToCashEnvelope = z.infer<typeof operationsToCashSchema>;

const leakageClassSchema = z.enum([
  "STUCK_READY_TO_BILL",
  "STUCK_SENT_TO_FINANCE",
  "STUCK_INVOICED",
  "LONG_OVERDUE",
  "BLOCKED_TOO_LONG",
]);
const leakageBucketSchema = z.object({
  count: z.number(),
  totalCents: z.number(),
});

export const revenueLeakageSchema = z.object({
  summary: z.object({
    classes: z.object({
      STUCK_READY_TO_BILL: leakageBucketSchema,
      STUCK_SENT_TO_FINANCE: leakageBucketSchema,
      STUCK_INVOICED: leakageBucketSchema,
      LONG_OVERDUE: leakageBucketSchema,
      BLOCKED_TOO_LONG: leakageBucketSchema,
    }),
    totalAlerts: z.number(),
  }),
  alerts: z.array(
    z.object({
      serviceOrderId: z.number(),
      /** Opaque id the dashboard links with; the serial never reaches a URL. */
      serviceOrderPublicId: z.string(),
      serviceOrderNumber: z.string(),
      customer: entityRefSchema,
      unit: entityRefSchema,
      amountCents: z.number(),
      currency: z.string(),
      classes: z.array(leakageClassSchema),
      ageInDays: nullableNumber,
    }),
  ),
});
export type RevenueLeakageEnvelope = z.infer<typeof revenueLeakageSchema>;

const forecastBucketSchema = z.object({
  confirmedCents: z.number(),
  projectedCents: z.number(),
  confirmedCount: z.number(),
});

export const cashForecastSchema = z.object({
  buckets: z.object({
    OVERDUE: forecastBucketSchema,
    THIS_WEEK: forecastBucketSchema,
    NEXT_WEEK: forecastBucketSchema,
    IN_30_DAYS: forecastBucketSchema,
    IN_60_DAYS: forecastBucketSchema,
    IN_90_DAYS: forecastBucketSchema,
  }),
  totals: z.object({
    confirmedCents: z.number(),
    projectedCents: z.number(),
    overdueCents: z.number(),
  }),
});
export type CashForecastEnvelope = z.infer<typeof cashForecastSchema>;

const marginRowSchema = z.object({
  entityId: z.number(),
  entityName: z.string(),
  revenueCents: z.number(),
  outsourcedCostCents: z.number(),
  partsCostCents: z.number(),
  marginCents: z.number(),
  marginPercent: nullableNumber,
  serviceOrderCount: z.number(),
});

export const marginDashboardsSchema = z.object({
  byCustomer: z.array(marginRowSchema),
  byService: z.array(marginRowSchema),
});
export type MarginEnvelope = z.infer<typeof marginDashboardsSchema>;

const dataSchema = <TShape extends z.ZodType>(shape: TShape) =>
  z.object({ data: shape });
const idResultSchema = dataSchema(z.object({ id: z.number() }));

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "Financeiro";

export const financeEndpoints = {
  getOverview: endpoint({
    method: "get",
    path: "/api/finance/overview",
    response: financeOverviewSchema,
    failure: "Erro ao carregar visão geral financeira",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listDocuments: endpoint({
    method: "get",
    path: "/api/finance/documents",
    query: ListDocumentsQuerySchema,
    response: dataSchema(z.array(documentListItemSchema)),
    failure: "Erro ao carregar documentos",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getDocument: endpoint({
    method: "get",
    path: "/api/finance/documents/:id",
    response: dataSchema(documentDetailSchema),
    failure: "Erro ao carregar documento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  updateDocument: endpoint({
    method: "put",
    path: "/api/finance/documents/:id",
    params: z.object({ id: routeId }),
    body: UpdateDocumentSchema,
    response: dataSchema(documentDetailSchema),
    failure: "Erro ao atualizar documento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  issueDocument: endpoint({
    method: "post",
    path: "/api/finance/documents/:id/issue",
    params: z.object({ id: routeId }),
    response: dataSchema(documentDetailSchema),
    failure: "Erro ao emitir documento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  voidDocument: endpoint({
    method: "post",
    path: "/api/finance/documents/:id/void",
    params: z.object({ id: routeId }),
    body: VoidDocumentSchema,
    response: dataSchema(documentDetailSchema),
    failure: "Erro ao anular documento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listEligibleJobs: endpoint({
    method: "get",
    path: "/api/finance/documents/eligible-jobs",
    query: EligibleJobsQuerySchema,
    response: dataSchema(z.array(eligibleJobSchema)),
    failure: "Erro ao carregar OS elegíveis",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  createDocument: endpoint({
    method: "post",
    path: "/api/finance/documents",
    body: CreateDocumentSchema,
    response: dataSchema(documentRowSchema),
    status: 201,
    failure: "Erro ao criar documento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listContracts: endpoint({
    method: "get",
    path: "/api/finance/contracts",
    query: ListContractsQuerySchema,
    response: dataSchema(z.array(contractListItemSchema)),
    failure: "Erro ao carregar contratos",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getContract: endpoint({
    method: "get",
    path: "/api/finance/contracts/:id",
    params: z.object({ id: routeId }),
    response: dataSchema(contractDetailSchema),
    failure: "Erro ao carregar contrato",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  createContract: endpoint({
    method: "post",
    path: "/api/finance/contracts",
    body: CreateAgreementSchema,
    response: dataSchema(agreementRowSchema),
    status: 201,
    failure: "Erro ao criar contrato",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  activateContract: endpoint({
    method: "post",
    path: "/api/finance/contracts/:id/activate",
    params: z.object({ id: routeId }),
    response: dataSchema(agreementRowSchema),
    failure: "Erro ao ativar contrato",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  cancelContract: endpoint({
    method: "post",
    path: "/api/finance/contracts/:id/cancel",
    params: z.object({ id: routeId }),
    response: dataSchema(agreementRowSchema),
    failure: "Erro ao cancelar contrato",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listReceipts: endpoint({
    method: "get",
    path: "/api/finance/receipts",
    response: dataSchema(z.array(receiptRowSchema)),
    failure: "Erro ao carregar recebimentos",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  receiveInstallment: endpoint({
    method: "post",
    path: "/api/finance/installments/:id/receive",
    params: z.object({ id: routeId }),
    body: RecordReceiptSchema,
    response: dataSchema(
      z.object({
        id: z.number(),
        installmentId: z.number(),
        amountCents: z.number(),
        paymentMethod: paymentMethodSchema,
        receivedAt: z.string(),
      }),
    ),
    status: 201,
    failure: "Erro ao registrar recebimento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listErpExports: endpoint({
    method: "get",
    path: "/api/finance/erp/exports",
    response: dataSchema(z.array(erpExportRowSchema)),
    failure: "Erro ao carregar fila ERP",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  exportErpDocument: endpoint({
    method: "post",
    path: "/api/finance/erp/documents/:id/export",
    params: z.object({ id: routeId }),
    response: z.object({ data: z.unknown() }),
    failure: "Erro ao exportar documento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listBillingReadiness: endpoint({
    method: "get",
    path: "/api/finance/billing-readiness",
    query: BillingReadinessQuerySchema,
    response: billingReadinessResponseSchema,
    failure: "Erro ao carregar fila de faturamento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  sendBillingReadiness: endpoint({
    method: "post",
    path: "/api/finance/billing-readiness/send",
    body: SendBillingReadinessSchema,
    response: z.object({ data: z.array(z.unknown()) }),
    failure: "Erro ao enviar para o financeiro",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getServiceOrderStatus: endpoint({
    method: "get",
    path: "/api/finance/service-orders/:serviceOrderId/status",
    params: z.object({ serviceOrderId: routeId }),
    response: dataSchema(serviceOrderFinancialStatusSchema),
    failure: "Erro ao carregar status financeiro da OS",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getCustomerTimeline: endpoint({
    method: "get",
    path: "/api/finance/customers/:customerId/timeline",
    query: CustomerTimelineQuerySchema,
    response: dataSchema(customerFinancialTimelineSchema),
    failure: "Erro ao carregar linha do tempo financeira",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getCertificateRelease: endpoint({
    method: "get",
    path: "/api/finance/certificate-releases/:calibrationJobId",
    params: z.object({ calibrationJobId: routeId }),
    response: dataSchema(certificateReleaseSchema),
    failure: "Erro ao carregar status de liberação",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  releaseCertificateByException: endpoint({
    method: "post",
    path: "/api/finance/certificate-releases/:calibrationJobId/release-by-exception",
    params: z.object({ calibrationJobId: routeId }),
    body: ReleaseByExceptionSchema,
    response: dataSchema(certificateReleaseSchema),
    failure: "Erro ao liberar certificado com exceção",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listCertificateReleasePolicies: endpoint({
    method: "get",
    path: "/api/finance/certificate-release-policies",
    response: dataSchema(z.array(policySchema)),
    failure: "Erro ao carregar políticas de liberação",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  createCertificateReleasePolicy: endpoint({
    method: "post",
    path: "/api/finance/certificate-release-policies",
    body: CreatePolicySchema,
    response: dataSchema(policySchema.omit({ customerName: true })),
    failure: "Erro ao criar política de liberação",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  updateCertificateReleasePolicy: endpoint({
    method: "put",
    path: "/api/finance/certificate-release-policies/:id",
    params: z.object({ id: routeId }),
    body: UpdatePolicySchema,
    response: idResultSchema,
    failure: "Erro ao atualizar política de liberação",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listAutomaticSendRules: endpoint({
    method: "get",
    path: "/api/finance/automatic-send-rules",
    response: dataSchema(z.array(sendRuleSchema)),
    failure: "Erro ao carregar regras de envio automático",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  createAutomaticSendRule: endpoint({
    method: "post",
    path: "/api/finance/automatic-send-rules",
    body: CreateRuleSchema,
    response: dataSchema(sendRuleSchema.omit({ customerName: true })),
    failure: "Erro ao criar regra de envio automático",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  updateAutomaticSendRule: endpoint({
    method: "put",
    path: "/api/finance/automatic-send-rules/:id",
    params: z.object({ id: routeId }),
    body: UpdateRuleSchema,
    response: idResultSchema,
    failure: "Erro ao atualizar regra de envio automático",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getOperationsToCash: endpoint({
    method: "get",
    path: "/api/finance/operations-to-cash",
    query: OperationsToCashQuerySchema,
    response: operationsToCashSchema,
    failure: "Erro ao carregar painel operação-ao-caixa",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getRevenueLeakage: endpoint({
    method: "get",
    path: "/api/finance/revenue-leakage",
    response: revenueLeakageSchema,
    failure: "Erro ao carregar alertas de receita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getCashForecast: endpoint({
    method: "get",
    path: "/api/finance/cash-forecast",
    response: cashForecastSchema,
    failure: "Erro ao carregar previsão de caixa",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getMarginDashboards: endpoint({
    method: "get",
    path: "/api/finance/margin-dashboards",
    response: marginDashboardsSchema,
    failure: "Erro ao carregar painel de margens",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
