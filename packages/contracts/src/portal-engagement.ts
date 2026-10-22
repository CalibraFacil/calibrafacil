import { z } from "zod";

import { nullableNumber, nullableString, paginationSchema } from "./common";
import { serviceOrderStatusSchema } from "./service-orders";

/**
 * Response contracts for what the customer does in the portal: notifications,
 * out-of-tolerance notices, visits, calibration requests and service orders
 * (`/api/portal/*`). Wire schemas (see `jobs.ts`): validate only, unknown keys
 * allowed, timestamps are ISO strings.
 */

const jsonRecordSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const portalNotificationItemSchema = z.object({
  id: z.number(),
  type: z.string(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
  status: z.enum(["UNREAD", "READ", "ARCHIVED"]),
  title: z.string(),
  message: z.string(),
  actionUrl: nullableString,
  createdAt: z.string(),
  readAt: nullableString,
});
export type PortalNotificationItem = z.infer<
  typeof portalNotificationItemSchema
>;

/** GET /api/portal/notifications (cursor-paginated). */
export const portalNotificationFeedResponseSchema = z.object({
  data: z.array(portalNotificationItemSchema),
  nextCursor: nullableNumber,
});
export type PortalNotificationFeedResponse = z.infer<
  typeof portalNotificationFeedResponseSchema
>;

/** GET /api/portal/notifications/unread-count and POST .../mark-all-read. */
export const portalNotificationCountResponseSchema = z.object({
  count: z.number(),
});
export type PortalNotificationCountResponse = z.infer<
  typeof portalNotificationCountResponseSchema
>;

/** POST /api/portal/notifications/mark-read */
export const portalNotificationMarkReadResponseSchema = z.object({
  updatedIds: z.array(z.number()),
});
export type PortalNotificationMarkReadResponse = z.infer<
  typeof portalNotificationMarkReadResponseSchema
>;

const notificationChannelsSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
});

/** GET and PUT /api/portal/notification-preferences. */
export const portalNotificationPreferencesResponseSchema = z.object({
  digestFrequency: z.enum(["NONE", "DAILY", "WEEKLY"]),
  emailEnabled: z.boolean(),
  preferences: z.record(z.string(), notificationChannelsSchema),
});
export type PortalNotificationPreferencesResponse = z.infer<
  typeof portalNotificationPreferencesResponseSchema
>;

// ---------------------------------------------------------------------------
// Out-of-tolerance notices (ISO/IEC 17025 §7.10)
// ---------------------------------------------------------------------------

export const portalOotNotificationSchema = z.object({
  /** Opaque acknowledgment token, never a numeric database id. */
  id: z.string(),
  ncNumber: z.string(),
  certificateNumber: nullableString,
  affectedScope: nullableString,
  status: z.enum(["PENDING", "GENERATED", "SENT", "ACKNOWLEDGED"]),
  sentAt: nullableString,
  acknowledgedAt: nullableString,
  acknowledgedVia: z.enum(["email_link", "portal_link", "manual"]).nullable(),
  createdAt: z.string(),
  assetName: nullableString,
  assetTag: nullableString,
  unitName: nullableString,
});
export type PortalOotNotification = z.infer<typeof portalOotNotificationSchema>;

/** GET /api/portal/oot-notifications */
export const portalOotNotificationsResponseSchema = z.object({
  data: z.array(portalOotNotificationSchema),
  counts: z.object({ total: z.number(), pending: z.number() }),
});
export type PortalOotNotificationsResponse = z.infer<
  typeof portalOotNotificationsResponseSchema
>;

/** POST /api/portal/oot-notifications/:token/acknowledge */
export const portalOotAcknowledgeResponseSchema = z.object({
  message: z.string(),
});
export type PortalOotAcknowledgeResponse = z.infer<
  typeof portalOotAcknowledgeResponseSchema
>;

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

const visitStatusSchema = z.enum([
  "PROPOSED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

const portalAddressSchema = z.object({
  cep: z.string().optional(),
  number: z.string().optional(),
  street: z.string().optional(),
  complement: z.string().optional(),
  neighbourhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

const rescheduleRequestSchema = z.object({
  id: z.number(),
  status: z.enum(["PENDING", "ACCEPTED", "DECLINED", "SUPERSEDED"]),
  reason: nullableString,
  preferredWindows: z.array(
    z.object({
      date: z.string(),
      period: z.enum(["MORNING", "AFTERNOON", "ANY"]),
      note: z.string().optional(),
    }),
  ),
  resolutionNote: nullableString,
  createdAt: z.string(),
  resolvedAt: nullableString,
});

export const portalVisitSchema = z.object({
  id: z.number(),
  status: visitStatusSchema,
  scheduledAt: nullableString,
  scheduledEndAt: nullableString,
  address: portalAddressSchema.nullable(),
  customerName: z.string(),
  technicianName: nullableString,
  sourceRequestId: nullableNumber,
  cancelReason: nullableString,
  assetCount: z.number(),
  customerConfirmedAt: nullableString,
  /** Latest reschedule request for this visit (any status), if one exists. */
  rescheduleRequest: rescheduleRequestSchema.nullable(),
});
export type PortalVisit = z.infer<typeof portalVisitSchema>;

/** GET /api/portal/visits */
export const portalVisitsResponseSchema = z.object({
  data: z.array(portalVisitSchema),
});
export type PortalVisitsResponse = z.infer<typeof portalVisitsResponseSchema>;

/** POST /api/portal/visits/:id/confirm */
export const portalVisitConfirmResponseSchema = z.object({
  ok: z.literal(true),
  customerConfirmedAt: z.string(),
});
export type PortalVisitConfirmResponse = z.infer<
  typeof portalVisitConfirmResponseSchema
>;

/** POST /api/portal/visits/:id/reschedule-request */
export const portalVisitRescheduleResponseSchema = z.object({
  ok: z.literal(true),
  requestId: z.number(),
});
export type PortalVisitRescheduleResponse = z.infer<
  typeof portalVisitRescheduleResponseSchema
>;

// ---------------------------------------------------------------------------
// Calibration requests
// ---------------------------------------------------------------------------

export const portalRequestStatusValueSchema = z.enum([
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
]);

export const portalRequestListItemSchema = z.object({
  id: z.number(),
  status: portalRequestStatusValueSchema,
  observations: nullableString,
  requestedDueDate: nullableString,
  submittedAt: z.string(),
  reviewedAt: nullableString,
  approvedAt: nullableString,
  convertedAt: nullableString,
  customerName: z.string(),
  itemCount: z.number(),
});
export type PortalRequestListItem = z.infer<typeof portalRequestListItemSchema>;

/** GET /api/portal/requests */
export const portalRequestsResponseSchema = z.object({
  data: z.array(portalRequestListItemSchema),
  pagination: paginationSchema,
});
export type PortalRequestsResponse = z.infer<
  typeof portalRequestsResponseSchema
>;

/** GET /api/portal/requests/:id */
export const portalRequestDetailSchema = z.object({
  id: z.number(),
  status: portalRequestStatusValueSchema,
  observations: nullableString,
  requestedDueDate: nullableString,
  deliveryMethod: z.enum(["dropoff", "carrier", "onsite"]),
  invoiceRemittanceNumber: nullableString,
  invoiceRemittanceKey: nullableString,
  invoiceRemittanceIssuedAt: nullableString,
  carrierName: nullableString,
  onsiteAddress: portalAddressSchema.nullable(),
  preferredVisitDate: nullableString,
  visit: z
    .object({
      status: visitStatusSchema,
      scheduledAt: nullableString,
      technicianName: nullableString,
    })
    .nullable(),
  submittedAt: z.string(),
  reviewedAt: nullableString,
  approvedAt: nullableString,
  rejectedAt: nullableString,
  rejectionReason: nullableString,
  convertedAt: nullableString,
  customerName: z.string(),
  items: z.array(
    z.object({
      id: z.number(),
      assetId: z.number(),
      assetName: z.string(),
      assetTag: z.string(),
      assetSerialNumber: z.string(),
      assetManufacturer: nullableString,
      assetModel: nullableString,
      assetTypeName: nullableString,
      convertedJobId: nullableNumber,
      convertedJobCode: nullableString,
      convertedJobStatus: nullableString,
      convertedServiceName: nullableString,
    }),
  ),
});
export type PortalRequestDetail = z.infer<typeof portalRequestDetailSchema>;

/** POST /api/portal/requests/batch (201): one request per unit. */
export const portalRequestBatchResponseSchema = z.object({
  created: z.array(
    z.object({
      id: z.number(),
      status: portalRequestStatusValueSchema,
      customerId: z.number(),
      unitId: z.number().nullable().optional(),
      itemCount: z.number(),
    }),
  ),
});
export type PortalRequestBatchResponse = z.infer<
  typeof portalRequestBatchResponseSchema
>;

// ---------------------------------------------------------------------------
// Service orders
// ---------------------------------------------------------------------------

const serviceOrderStatusValueSchema = z.string();

export const portalServiceOrderListItemSchema = z.object({
  id: z.number(),
  publicId: z.string(),
  serviceOrderNumber: z.string(),
  status: serviceOrderStatusSchema,
  statusLabel: z.string(),
  openedAt: z.string(),
  readyAt: nullableString,
  assetName: z.string(),
  assetSerialNumber: nullableString,
});
export type PortalServiceOrderListItem = z.infer<
  typeof portalServiceOrderListItemSchema
>;

/** GET /api/portal/service-orders */
export const portalServiceOrdersResponseSchema = z.object({
  data: z.array(portalServiceOrderListItemSchema),
  pagination: paginationSchema,
});
export type PortalServiceOrdersResponse = z.infer<
  typeof portalServiceOrdersResponseSchema
>;

const portalQuoteItemSchema = z.object({
  id: z.number(),
  type: z.string(),
  description: z.string(),
  quantity: z.union([z.string(), z.number()]),
  unit: z.string(),
  unitPriceCents: z.number(),
  totalPriceCents: z.number(),
  warrantyCovered: z.boolean(),
});

/** GET /api/portal/service-orders/:id (`data`): the client-visible order. */
export const portalServiceOrderDetailSchema = z.object({
  id: z.number(),
  serviceOrderNumber: z.string(),
  status: serviceOrderStatusValueSchema,
  openedAt: z.string(),
  evaluatedAt: nullableString.optional(),
  repairStartedAt: nullableString.optional(),
  repairFinishedAt: nullableString.optional(),
  readyAt: nullableString.optional(),
  deliveredAt: nullableString.optional(),
  deliveredToName: nullableString.optional(),
  deliveryNotes: nullableString.optional(),
  claimedDefect: nullableString,
  intakeCondition: nullableString,
  accessories: nullableString,
  clientVisibleNotes: nullableString,
  removedSealingMarkNumber: nullableString.optional(),
  affixedSealingMarkNumber: nullableString.optional(),
  inmetroRepairMarkNumber: nullableString.optional(),
  inmetroRepairMarkNotes: nullableString.optional(),
  warrantyUntil: nullableString.optional(),
  warrantyTerms: nullableString.optional(),
  assetSnapshot: jsonRecordSchema.nullable().optional(),
  evaluations: z
    .array(
      z.object({
        id: z.number(),
        diagnosis: nullableString,
        detectedIssues: nullableString,
        clientVisibleNotes: nullableString,
        evaluatedAt: nullableString,
      }),
    )
    .optional(),
  execution: z
    .object({
      id: z.number(),
      startedAt: nullableString,
      finishedAt: nullableString,
      servicePerformed: nullableString,
      partsUsedSummary: nullableString,
      technicalNotes: nullableString,
      result: nullableString,
      calibrationRequiredAfterRepair: z.boolean().optional(),
      items: z
        .array(
          z.object({
            id: z.number(),
            type: z.string(),
            description: z.string(),
            quantity: z.union([z.string(), z.number()]),
            unit: z.string(),
            unitPriceCents: z.number(),
            totalPriceCents: z.number(),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
  quotes: z
    .array(
      z.object({
        id: z.number(),
        quoteNumber: z.string(),
        version: z.number(),
        status: z.string(),
        totalCents: z.number(),
        validUntil: nullableString,
        clientMessage: nullableString,
        warrantyTerms: nullableString,
        items: z.array(portalQuoteItemSchema).optional(),
      }),
    )
    .optional(),
});
export type PortalServiceOrderDetail = z.infer<
  typeof portalServiceOrderDetailSchema
>;

export const portalServiceOrderDetailResponseSchema = z.object({
  data: portalServiceOrderDetailSchema,
});
export type PortalServiceOrderDetailResponse = z.infer<
  typeof portalServiceOrderDetailResponseSchema
>;

/** GET /api/portal/service-orders/:id/financial-summary (`data`). */
export const portalFinancialSummarySchema = z.object({
  state: z
    .enum(["INVOICE_AVAILABLE", "PAYMENT_PENDING", "PAID", "OVERDUE"])
    .nullable(),
  visible: z.boolean(),
  dueDate: nullableString,
  paidAt: nullableString,
  openAmountCents: z.number(),
  overdueAmountCents: z.number(),
  lastUpdatedAt: nullableString,
  freshness: z.enum(["fresh", "stale", "unknown"]),
  documents: z.array(
    z.object({
      kind: z.enum(["invoice", "fiscal_document", "receipt"]),
      label: z.string(),
      availableAt: nullableString,
      href: nullableString,
    }),
  ),
});
export type PortalFinancialSummary = z.infer<
  typeof portalFinancialSummarySchema
>;

export const portalFinancialSummaryResponseSchema = z.object({
  data: portalFinancialSummarySchema,
});
export type PortalFinancialSummaryResponse = z.infer<
  typeof portalFinancialSummaryResponseSchema
>;

/** POST .../quotes/:quoteId/approve and /reject. */
export const portalQuoteDecisionResponseSchema = z.object({
  ok: z.literal(true),
});
export type PortalQuoteDecisionResponse = z.infer<
  typeof portalQuoteDecisionResponseSchema
>;
