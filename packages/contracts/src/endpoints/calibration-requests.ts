import { z } from "zod";
import {
  ApproveCalibrationRequestSchema,
  ConvertCalibrationRequestSchema,
  ListCalibrationRequestsQuerySchema,
  RejectCalibrationRequestSchema,
  ReviewCalibrationRequestSchema,
  CalibrationRequestDeliveryMethodSchema,
  AddressSchema,
} from "@calibra-facil/schemas";
import { CALIBRATION_REQUEST_STATUSES } from "@calibra-facil/schemas/machines";

import { nullableNumber, nullableString, paginationSchema } from "../common";
import { endpoint, routeId, type EndpointGroup } from "./define";

/**
 * The calibration requests customers submit through the portal and the lab
 * triages. Response schemas are wire schemas written from what the handlers in
 * `apps/api/src/domains/visits/routes/calibration-requests.ts` return.
 */

const calibrationRequestStatusSchema = z.enum(CALIBRATION_REQUEST_STATUSES);
export type CalibrationRequestStatus = z.infer<
  typeof calibrationRequestStatusSchema
>;

const calibrationRequestListItemSchema = z.object({
  id: z.number(),
  status: calibrationRequestStatusSchema,
  observations: nullableString,
  requestedDueDate: nullableString,
  submittedAt: z.string(),
  reviewedAt: nullableString,
  approvedAt: nullableString,
  rejectedAt: nullableString,
  convertedAt: nullableString,
  customerId: z.number(),
  customerName: z.string(),
  submittedByName: nullableString,
  itemCount: z.number(),
});
export type CalibrationRequestListItem = z.infer<
  typeof calibrationRequestListItemSchema
>;

/** GET /api/calibration-requests */
export const calibrationRequestsListResponseSchema = z.object({
  data: z.array(calibrationRequestListItemSchema),
  pagination: paginationSchema,
});
export type CalibrationRequestsListData = z.infer<
  typeof calibrationRequestsListResponseSchema
>;

const calibrationRequestItemSchema = z.object({
  id: z.number(),
  assetId: z.number(),
  assetName: z.string(),
  assetTag: z.string(),
  assetSerialNumber: z.string(),
  assetManufacturer: nullableString,
  assetModel: nullableString,
  assetTypeId: nullableNumber,
  assetTypeName: nullableString,
  convertedJobId: nullableNumber,
  convertedJobCode: nullableString,
  convertedJobStatus: nullableString,
  convertedServiceName: nullableString,
});
export type CalibrationRequestItem = z.infer<
  typeof calibrationRequestItemSchema
>;

/** GET /api/calibration-requests/:id */
export const calibrationRequestDetailSchema = z.object({
  id: z.number(),
  status: calibrationRequestStatusSchema,
  observations: nullableString,
  internalNotes: nullableString,
  requestedDueDate: nullableString,
  deliveryMethod: CalibrationRequestDeliveryMethodSchema,
  onsiteAddress: AddressSchema.nullable(),
  preferredVisitDate: nullableString,
  submittedAt: z.string(),
  reviewedAt: nullableString,
  approvedAt: nullableString,
  rejectedAt: nullableString,
  rejectionReason: nullableString,
  convertedAt: nullableString,
  customerId: z.number(),
  customerName: z.string(),
  submittedBy: z.string(),
  submittedByName: nullableString,
  reviewedBy: nullableString,
  reviewedByName: nullableString,
  approvedBy: nullableString,
  approvedByName: nullableString,
  rejectedBy: nullableString,
  rejectedByName: nullableString,
  convertedBy: nullableString,
  convertedByName: nullableString,
  items: z.array(calibrationRequestItemSchema),
});
export type CalibrationRequestDetail = z.infer<
  typeof calibrationRequestDetailSchema
>;

const successSchema = z.object({ success: z.literal(true) });

/** POST /api/calibration-requests/:id/convert: the jobs created, one per converted item. */
const convertResponseSchema = z.object({
  success: z.literal(true),
  jobs: z.array(
    z.object({
      requestItemId: z.number(),
      jobId: z.number(),
      jobCode: z.string(),
      status: z.string(),
    }),
  ),
});

const DESKTOP_LABEL = "Solicitações de calibração";

export const calibrationRequestEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/calibration-requests",
    query: ListCalibrationRequestsQuerySchema,
    response: calibrationRequestsListResponseSchema,
    failure: "Falha ao carregar solicitações",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  get: endpoint({
    method: "get",
    path: "/api/calibration-requests/:id",
    params: z.object({ id: routeId }),
    response: calibrationRequestDetailSchema,
    failure: "Falha ao carregar solicitação",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  review: endpoint({
    method: "post",
    path: "/api/calibration-requests/:id/review",
    params: z.object({ id: routeId }),
    body: ReviewCalibrationRequestSchema,
    response: successSchema,
    failure: "Erro ao revisar",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  approve: endpoint({
    method: "post",
    path: "/api/calibration-requests/:id/approve",
    params: z.object({ id: routeId }),
    body: ApproveCalibrationRequestSchema,
    response: successSchema,
    failure: "Erro ao aprovar",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  reject: endpoint({
    method: "post",
    path: "/api/calibration-requests/:id/reject",
    params: z.object({ id: routeId }),
    body: RejectCalibrationRequestSchema,
    response: successSchema,
    failure: "Erro ao rejeitar",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  convert: endpoint({
    method: "post",
    path: "/api/calibration-requests/:id/convert",
    params: z.object({ id: routeId }),
    body: ConvertCalibrationRequestSchema,
    response: convertResponseSchema,
    failure: "Erro ao converter",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
