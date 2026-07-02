import { z } from "zod";
const SERVICE_ORDER_STATUSES = [
  "opened",
  "awaiting_tech_evaluation",
  "under_evaluation",
  "awaiting_quote_approval",
  "quote_approved",
  "quote_rejected",
  "repair_in_progress",
  "awaiting_calibration",
  "calibration_in_progress",
  "awaiting_final_review",
  "ready_for_pickup",
  "delivered",
  "closed",
  "canceled",
  "warranty_return",
] as const;
const SERVICE_ORDER_PRIORITIES = [
  "normal",
  "urgent",
  "contract",
  "warranty",
] as const;
const SERVICE_ORDER_INTAKE_TYPES = [
  "counter",
  "carrier",
  "third_party",
  "internal",
  "warranty_return",
] as const;
const SERVICE_ORDER_DELIVERY_METHODS = [
  "pickup_at_lab",
  "ship_to_client",
  "third_party_pickup",
] as const;
const SERVICE_ORDER_CLOSING_REASONS = [
  "completed_repaired",
  "completed_calibrated",
  "completed_repaired_and_calibrated",
  "quote_rejected_returned",
  "condemned_returned",
  "no_defect_found",
  "warranty_completed",
  "canceled_before_execution",
] as const;
const SERVICE_ORDER_RECOMMENDED_ACTIONS = [
  "repair",
  "calibration_only",
  "return_without_repair",
  "condemned",
  "warranty_service",
  "external_service_required",
] as const;
const SERVICE_ORDER_QUOTE_STATUSES = [
  "draft",
  "sent",
  "approved",
  "rejected",
  "expired",
  "canceled",
  "superseded",
] as const;
const SERVICE_ORDER_ITEM_TYPES = [
  "service",
  "part",
  "external_service",
  "freight",
  "discount",
  "evaluation_fee",
  "other",
] as const;
const SERVICE_ORDER_EXECUTION_RESULTS = [
  "repaired",
  "not_repaired",
  "condemned",
  "returned_without_service",
  "sent_to_third_party",
] as const;
const SERVICE_ORDER_ACTOR_TYPES = [
  "lab_user",
  "portal_user",
  "system",
  "public_token",
] as const;
const SERVICE_ORDER_MANUAL_APPROVAL_EVIDENCE_TYPES = [
  "phone",
  "whatsapp",
  "email",
  "in_person",
  "other",
] as const;

const nullableText = z.string().trim().max(5000).optional().nullable();
const moneyCents = z.coerce.number().int().min(0).max(999999999);
const signedMoneyCents = z.coerce.number().int().min(-999999999).max(999999999);
const positiveQuantity = z.coerce.number().positive().max(999999);

export const ServiceOrderStatusSchema = z.enum(SERVICE_ORDER_STATUSES);
export const ServiceOrderPrioritySchema = z.enum(SERVICE_ORDER_PRIORITIES);
export const ServiceOrderIntakeTypeSchema = z.enum(SERVICE_ORDER_INTAKE_TYPES);
export const ServiceOrderDeliveryMethodSchema = z.enum(
  SERVICE_ORDER_DELIVERY_METHODS,
);
export const ServiceOrderClosingReasonSchema = z.enum(
  SERVICE_ORDER_CLOSING_REASONS,
);
export const ServiceOrderRecommendedActionSchema = z.enum(
  SERVICE_ORDER_RECOMMENDED_ACTIONS,
);
export const ServiceOrderQuoteStatusSchema = z.enum(
  SERVICE_ORDER_QUOTE_STATUSES,
);
export const ServiceOrderItemTypeSchema = z.enum(SERVICE_ORDER_ITEM_TYPES);
export const ServiceOrderExecutionResultSchema = z.enum(
  SERVICE_ORDER_EXECUTION_RESULTS,
);
export const ServiceOrderActorTypeSchema = z.enum(SERVICE_ORDER_ACTOR_TYPES);
export const ServiceOrderManualApprovalEvidenceTypeSchema = z.enum(
  SERVICE_ORDER_MANUAL_APPROVAL_EVIDENCE_TYPES,
);

export const ServiceOrderSignatureDataSchema = z.object({
  signerName: z.string().trim().min(1).max(160),
  signedAt: z.string().datetime().optional(),
  dataUrl: z.string().trim().min(1).max(500000),
});

export const ServiceOrderAssetSnapshotInputSchema = z.object({
  observedIdentification: z.string().trim().max(500).optional(),
  photos: z.array(z.string().trim().min(1).max(2048)).default([]),
});

const ServiceOrderInputBaseSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  clientContactId: z.coerce.number().int().positive().optional().nullable(),
  clientContactSnapshot: z.record(z.string(), z.unknown()).optional(),
  assetId: z.coerce.number().int().positive(),
  intakeType: ServiceOrderIntakeTypeSchema.default("counter"),
  // External / in-loco order: the technician travels to the client.
  isExternalService: z.boolean().optional().default(false),
  sourceServiceOrderId: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .nullable(),
  priority: ServiceOrderPrioritySchema.default("normal"),
  responsibleTechnicianId: z.string().trim().min(1).optional().nullable(),
  claimedDefect: z.string().trim().min(1).max(5000),
  intakeCondition: z.string().trim().min(1).max(5000),
  accessories: z.string().trim().max(5000).optional().nullable(),
  removedSealingMarkNumber: z.string().trim().max(120).optional().nullable(),
  affixedSealingMarkNumber: z.string().trim().max(120).optional().nullable(),
  inmetroRepairMarkNumber: z.string().trim().max(120).optional().nullable(),
  invoiceRemittanceNumber: z.string().trim().max(120).optional().nullable(),
  invoiceRemittanceKey: z.string().trim().max(80).optional().nullable(),
  invoiceRemittanceIssuedAt: z.string().datetime().optional().nullable(),
  carrierName: z.string().trim().max(200).optional().nullable(),
  carrierDocument: z.string().trim().max(80).optional().nullable(),
  thirdPartyName: z.string().trim().max(200).optional().nullable(),
  thirdPartyDocument: z.string().trim().max(80).optional().nullable(),
  thirdPartyPhone: z.string().trim().max(80).optional().nullable(),
  deliveryMethod: ServiceOrderDeliveryMethodSchema.default("pickup_at_lab"),
  internalNotes: nullableText,
  clientVisibleNotes: nullableText,
  evaluationFeeCents: moneyCents.default(0),
  warrantyUntil: z.string().datetime().optional().nullable(),
  warrantyTerms: nullableText,
  // When the technician actually started the service/budget work (not auto-set).
  serviceStartedAt: z.string().datetime().optional().nullable(),
  assetSnapshot: ServiceOrderAssetSnapshotInputSchema.optional(),
  signatureData: ServiceOrderSignatureDataSchema.optional().nullable(),
});

export const CreateServiceOrderSchema = ServiceOrderInputBaseSchema.superRefine(
  (input, ctx) => {
    if (input.intakeType === "warranty_return" && !input.sourceServiceOrderId) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceServiceOrderId"],
        message: "OS de garantia deve referenciar a OS de origem",
      });
    }
  },
);

export const UpdateServiceOrderSchema = ServiceOrderInputBaseSchema.omit({
  customerId: true,
  assetId: true,
  assetSnapshot: true,
  signatureData: true,
})
  .partial()
  .extend({
    status: ServiceOrderStatusSchema.optional(),
  });

export const ListServiceOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().optional(),
  status: ServiceOrderStatusSchema.optional(),
  customerId: z.coerce.number().int().positive().optional(),
  assetId: z.coerce.number().int().positive().optional(),
  technicianId: z.string().trim().optional(),
  unitId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  warranty: z.coerce.boolean().optional(),
  awaitingApproval: z.coerce.boolean().optional(),
  readyForPickup: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional(),
});

export const AssignServiceOrderTechnicianSchema = z.object({
  technicianId: z.string().trim().min(1, "Tecnico e obrigatorio"),
});

export const CreateServiceOrderEvaluationSchema = z.object({
  technicianId: z.string().trim().min(1).optional(),
  diagnosis: z.string().trim().min(1).max(10000),
  detectedIssues: z.string().trim().max(10000).optional().nullable(),
  recommendedAction: ServiceOrderRecommendedActionSchema,
  requiresQuote: z.boolean().default(true),
  requiresClientApproval: z.boolean().default(true),
  calibrationRecommended: z.boolean().default(false),
  photos: z.array(z.string().trim().min(1).max(2048)).default([]),
  internalNotes: nullableText,
  clientVisibleNotes: nullableText,
});

export const UpdateServiceOrderEvaluationSchema =
  CreateServiceOrderEvaluationSchema.partial();

export const ServiceOrderPricedItemSchema = z.object({
  id: z.number().int().positive().optional(),
  type: ServiceOrderItemTypeSchema,
  description: z.string().trim().min(1).max(500),
  // Optional material-catalog reference for "part" items; free-form items omit it
  materialId: z.number().int().positive().optional().nullable(),
  quantity: positiveQuantity,
  unit: z.string().trim().min(1).max(32).default("un"),
  unitCostCents: moneyCents.optional(),
  unitPriceCents: signedMoneyCents,
  taxable: z.boolean().default(true),
  warrantyCovered: z.boolean().default(false),
  warrantyUntil: z.string().datetime().optional().nullable(),
  warrantyTerms: nullableText,
  notes: nullableText,
});

export const CreateServiceOrderQuoteSchema = z.object({
  validUntil: z.string().datetime().optional().nullable(),
  paymentTerms: z.string().trim().max(1000).optional().nullable(),
  deliveryEstimate: z.string().trim().max(500).optional().nullable(),
  warrantyTerms: nullableText,
  clientMessage: nullableText,
  internalNotes: nullableText,
  items: z.array(ServiceOrderPricedItemSchema).min(1),
});

export const UpdateServiceOrderQuoteDraftSchema =
  CreateServiceOrderQuoteSchema.partial().extend({
    items: z.array(ServiceOrderPricedItemSchema).optional(),
  });

export const SendServiceOrderQuoteSchema = z.object({
  clientMessage: nullableText,
  expiresAt: z.string().datetime().optional().nullable(),
});

export const ApproveServiceOrderQuoteManuallySchema = z.object({
  approvedByName: z.string().trim().min(1).max(160),
  approvedAt: z.string().datetime().optional(),
  manualApprovalEvidenceType: ServiceOrderManualApprovalEvidenceTypeSchema,
  manualApprovalEvidenceText: z.string().trim().min(3).max(5000),
});

export const RejectServiceOrderQuoteManuallySchema = z.object({
  rejectionReason: z.string().trim().min(1).max(5000),
});

export const ApproveServiceOrderQuotePortalSchema = z.object({
  acceptedTerms: z.boolean().default(true),
});

export const RejectServiceOrderQuotePortalSchema = z.object({
  rejectionReason: z.string().trim().max(5000).optional().nullable(),
});

export const StartServiceOrderExecutionSchema = z.object({
  notes: nullableText,
});

export const UpdateServiceOrderExecutionSchema = z.object({
  servicePerformed: nullableText,
  partsUsedSummary: nullableText,
  technicalNotes: nullableText,
  calibrationRequiredAfterRepair: z.boolean().optional(),
  result: ServiceOrderExecutionResultSchema.optional(),
  items: z.array(ServiceOrderPricedItemSchema).optional(),
});

export const FinishServiceOrderExecutionSchema =
  UpdateServiceOrderExecutionSchema.extend({
    servicePerformed: z.string().trim().min(1).max(10000),
    result: ServiceOrderExecutionResultSchema,
  });

export const DeliverServiceOrderSchema = z.object({
  deliveryMethod: ServiceOrderDeliveryMethodSchema,
  deliveredToName: z.string().trim().min(1).max(200),
  deliveredToDocument: z.string().trim().max(80).optional().nullable(),
  deliveryNotes: nullableText,
  inmetroRepairMarkNumber: z.string().trim().max(120).optional().nullable(),
});

export const UpdateServiceOrderRepairMarkSchema = z.object({
  inmetroRepairMarkNumber: z.string().trim().max(120).optional().nullable(),
  inmetroRepairMarkIssuedAt: z.string().datetime().optional().nullable(),
  inmetroRepairMarkAppliedAt: z.string().datetime().optional().nullable(),
  inmetroRepairMarkNotes: nullableText,
});

export const IssueServiceOrderDeliveryDocumentSchema = z.object({
  technicianSignatureData:
    ServiceOrderSignatureDataSchema.optional().nullable(),
  clientSignatureData: ServiceOrderSignatureDataSchema.optional().nullable(),
});

export const CloseServiceOrderSchema = z.object({
  closingReason: ServiceOrderClosingReasonSchema,
  notes: nullableText,
  createBillingDocument: z.boolean().default(false),
  dueDate: z.string().datetime().optional(),
});

export const CancelServiceOrderSchema = z.object({
  reason: z.string().trim().min(3).max(5000),
});

export const ReopenServiceOrderSchema = z.object({
  reason: z.string().trim().min(3).max(5000),
});

export const LinkServiceOrderCertificateSchema = z.object({
  certificateJobId: z.coerce.number().int().positive(),
});

export const UpdateServiceOrderSettingsSchema = z.object({
  numberingTemplate: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .default("OS-{YYYY}-{SEQ}"),
  numberingScope: z.enum(["organization", "unit"]).default("unit"),
  nextNumber: z.coerce.number().int().min(1).optional(),
  defaultIntakeTerms: nullableText,
  defaultQuoteTerms: nullableText,
  requirePhotoOnIntake: z.boolean().default(false),
  requireInvoiceOrJustification: z.boolean().default(false),
  allowPublicQuoteApproval: z.boolean().default(true),
  requirePortalLoginForApproval: z.boolean().default(false),
  autoEmailOnOpen: z.boolean().default(true),
  autoEmailOnQuoteSent: z.boolean().default(true),
  autoEmailOnReady: z.boolean().default(true),
  autoEmailOnClose: z.boolean().default(false),
  showValuesInPortal: z.boolean().default(true),
  defaultQuoteValidityDays: z.coerce.number().int().min(1).max(365).default(15),
  defaultWarrantyTerms: nullableText,
});

export type CreateServiceOrderInput = z.infer<typeof CreateServiceOrderSchema>;
export type UpdateServiceOrderInput = z.infer<typeof UpdateServiceOrderSchema>;
export type ListServiceOrdersQuery = z.infer<
  typeof ListServiceOrdersQuerySchema
>;
export type CreateServiceOrderQuoteInput = z.infer<
  typeof CreateServiceOrderQuoteSchema
>;
export type ServiceOrderPricedItemInput = z.infer<
  typeof ServiceOrderPricedItemSchema
>;
