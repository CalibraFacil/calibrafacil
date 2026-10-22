import { z } from "zod";

/**
 * Response contracts for the client portal (`/api/portal/*`). Wire schemas, same
 * rules as `jobs.ts`: validate only (no defaults/transforms), unknown keys
 * allowed, timestamps are ISO strings.
 */

const nullableString = z.string().nullable();

export const portalRequestStatusSchema = z.enum([
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
]);

const portalOverviewServiceOrderSchema = z.object({
  id: z.number(),
  publicId: z.string(),
  serviceOrderNumber: z.string(),
  status: z.string(),
  openedAt: z.string(),
  assetName: nullableString,
});

/** GET /api/portal/overview: the dashboard's single aggregation round-trip. */
export const portalOverviewResponseSchema = z.object({
  equipment: z.object({
    total: z.number(),
    overdue: z.number(),
    dueSoon: z.number(),
    scheduled: z.number(),
    unscheduled: z.number(),
    inLab: z.number(),
    attention: z.array(
      z.object({
        id: z.number(),
        publicId: z.string(),
        name: z.string(),
        tag: z.string(),
        nextCalibrationDate: nullableString,
        customerId: z.number(),
        customerName: z.string(),
      }),
    ),
  }),
  certificates: z.object({
    available: z.number(),
    recent: z.array(
      z.object({
        id: z.number(),
        jobId: z.string(),
        approvedAt: nullableString,
        assetName: z.string(),
        assetTag: z.string(),
        releaseStatus: z.enum(["RELEASED", "PAYMENT_PENDING"]),
        ready: z.boolean(),
      }),
    ),
  }),
  requests: z.object({
    total: z.number(),
    open: z.number(),
    rejected: z.number(),
    recent: z.array(
      z.object({
        id: z.number(),
        status: portalRequestStatusSchema,
        submittedAt: z.string(),
        itemCount: z.number(),
      }),
    ),
  }),
  serviceOrders: z.object({
    total: z.number(),
    inProgress: z.number(),
    awaitingQuoteApproval: z.number(),
    readyForPickup: z.number(),
    awaitingQuote: z.array(portalOverviewServiceOrderSchema),
    recent: z.array(portalOverviewServiceOrderSchema),
  }),
});
export type PortalOverviewResponse = z.infer<
  typeof portalOverviewResponseSchema
>;
