import { z } from "zod";
import {
  ServiceOrderPrioritySchema,
  ServiceOrderStatusSchema,
} from "@calibra-facil/schemas";

import { nullableString, paginationSchema } from "./common";

/**
 * Response contracts for the service-order endpoints a technician uses in the
 * field (`/api/service-orders`: list, intake create, detail). Wire schemas (see
 * `jobs.ts` for the rules). The cloud API and the desktop local-server serve
 * these shapes; both are parsed with these schemas by their contract tests.
 */

const jsonRecordSchema = z.record(z.string(), z.unknown());

export const serviceOrderStatusSchema = ServiceOrderStatusSchema;
export const serviceOrderPrioritySchema = ServiceOrderPrioritySchema;

/** One row of GET /api/service-orders. */
export const serviceOrderListItemSchema = z.object({
  id: z.number(),
  /** Opaque id the dashboard links with; the serial never reaches a URL. */
  publicId: z.string(),
  serviceOrderNumber: z.string(),
  customerName: z.string(),
  assetName: z.string(),
  assetSerialNumber: nullableString,
  status: serviceOrderStatusSchema,
  statusLabel: z.string(),
  priority: serviceOrderPrioritySchema,
  responsibleTechnicianName: nullableString,
  openedAt: z.string(),
  quotedAt: nullableString,
  approvedAt: nullableString,
  totalApprovedCents: z.number(),
  totalQuotedCents: z.number(),
  unitName: nullableString,
});
export type ServiceOrderListItem = z.infer<typeof serviceOrderListItemSchema>;

/** GET /api/service-orders */
export const serviceOrdersListResponseSchema = z.object({
  data: z.array(serviceOrderListItemSchema),
  pagination: paginationSchema,
});
export type ServiceOrdersListResponse = z.infer<
  typeof serviceOrdersListResponseSchema
>;

/** POST /api/service-orders (201): enough to redirect to the new order. */
export const serviceOrderCreateResponseSchema = z.object({
  data: z.object({
    id: z.number(),
    publicId: z.string(),
    serviceOrderNumber: z.string(),
  }),
});
export type ServiceOrderCreateResponse = z.infer<
  typeof serviceOrderCreateResponseSchema
>;

const serviceOrderQuoteItemSchema = z.object({
  id: z.number(),
  type: z.string(),
  description: z.string(),
  quantity: z.number(),
  unit: z.string(),
  unitPriceCents: z.number(),
  totalPriceCents: z.number(),
});

const serviceOrderQuoteSchema = z.object({
  id: z.number(),
  status: z.string(),
  totalCents: z.number(),
  version: z.number(),
  items: z.array(serviceOrderQuoteItemSchema),
});

/** The order as GET /api/service-orders/:id returns it (the `data` of the response). */
export const serviceOrderDetailSchema = z.object({
  id: z.number(),
  publicId: z.string(),
  serviceOrderNumber: z.string(),
  status: serviceOrderStatusSchema,
  statusLabel: z.string(),
  priority: serviceOrderPrioritySchema,
  customerId: z.number(),
  customerName: z.string(),
  assetId: z.number(),
  assetName: z.string(),
  assetSerialNumber: nullableString,
  unitName: nullableString.optional(),
  responsibleTechnicianId: nullableString,
  claimedDefect: z.string(),
  intakeCondition: z.string(),
  accessories: nullableString,
  intakeType: z.string(),
  deliveryMethod: z.enum([
    "pickup_at_lab",
    "ship_to_client",
    "third_party_pickup",
  ]),
  clientVisibleNotes: nullableString,
  internalNotes: nullableString,
  openedAt: z.string(),
  updatedAt: z.string(),
  assetSnapshot: jsonRecordSchema.nullable(),
  evaluations: z.array(jsonRecordSchema),
  quotes: z.array(serviceOrderQuoteSchema),
  execution: jsonRecordSchema.nullable(),
  deliveryDocuments: z.array(jsonRecordSchema),
  events: z.array(
    z.object({
      id: z.number(),
      eventType: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export type ServiceOrderDetail = z.infer<typeof serviceOrderDetailSchema>;

/** GET /api/service-orders/:id */
export const serviceOrderDetailResponseSchema = z.object({
  data: serviceOrderDetailSchema,
});
export type ServiceOrderDetailResponse = z.infer<
  typeof serviceOrderDetailResponseSchema
>;
