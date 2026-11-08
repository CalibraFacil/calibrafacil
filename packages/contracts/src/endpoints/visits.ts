import { z } from "zod";
import {
  AcceptVisitRescheduleRequestSchema,
  AddVisitJobSchema,
  AssignVisitTechnicianSchema,
  CancelVisitSchema,
  ConfirmVisitSchema,
  DeclineVisitRescheduleRequestSchema,
  ListVisitsQuerySchema,
  RescheduleVisitSchema,
  VisitReschedulePreferredPeriodSchema,
  AddressSchema,
} from "@calibra-facil/schemas";
import {
  VISIT_RESCHEDULE_REQUEST_STATUSES,
  VISIT_STATUSES,
} from "@calibra-facil/schemas/machines";

import { jobRowSchema } from "../jobs";
import { nullableString, paginationSchema } from "../common";
import { endpoint, routeId, type EndpointGroup } from "./define";

/**
 * On-site (calibração in loco) visits. Response schemas are wire schemas
 * written from what the handlers in `apps/api/src/domains/visits/routes/visits.ts` return (the
 * three routers it exports are all mounted at `/api/visits`).
 */

const visitStatusSchema = z.enum(VISIT_STATUSES);
export type VisitStatus = z.infer<typeof visitStatusSchema>;

const visitListItemSchema = z.object({
  id: z.number(),
  status: visitStatusSchema,
  scheduledAt: nullableString,
  address: AddressSchema.nullable(),
  customerId: z.number(),
  customerName: z.string(),
  technicianId: nullableString,
  technicianName: nullableString,
  sourceRequestId: z.number().nullable(),
  createdAt: z.string(),
  assetCount: z.number(),
  customerConfirmedAt: nullableString,
  rescheduleRequested: z.boolean(),
});

/** GET /api/visits */
export const visitsListResponseSchema = z.object({
  data: z.array(visitListItemSchema),
  pagination: paginationSchema,
});
export type VisitsListData = z.infer<typeof visitsListResponseSchema>;

const visitDetailJobSchema = z.object({
  jobId: z.number(),
  jobCode: z.string(),
  status: z.string(),
  assetName: z.string(),
  assetTag: z.string(),
});
export type VisitDetailJob = z.infer<typeof visitDetailJobSchema>;

const visitReschedulePreferredWindowSchema = z.object({
  /** ISO yyyy-mm-dd */
  date: z.string(),
  period: VisitReschedulePreferredPeriodSchema,
  note: z.string().optional(),
});
export type VisitReschedulePreferredWindow = z.infer<
  typeof visitReschedulePreferredWindowSchema
>;

const visitPendingRescheduleRequestSchema = z.object({
  id: z.number(),
  reason: nullableString,
  preferredWindows: z.array(visitReschedulePreferredWindowSchema),
  createdAt: z.string(),
  requestedByName: nullableString,
});
export type VisitPendingRescheduleRequest = z.infer<
  typeof visitPendingRescheduleRequestSchema
>;

/** GET /api/visits/:id: the visit with its linked jobs and the pending customer reschedule request. */
export const visitDetailSchema = z.object({
  id: z.number(),
  status: visitStatusSchema,
  scheduledAt: nullableString,
  scheduledEndAt: nullableString,
  address: AddressSchema.nullable(),
  notes: nullableString,
  customerId: z.number(),
  customerName: z.string(),
  technicianId: nullableString,
  technicianName: nullableString,
  sourceRequestId: z.number().nullable(),
  createdAt: z.string(),
  confirmedAt: nullableString,
  cancelledAt: nullableString,
  cancelReason: nullableString,
  customerConfirmedAt: nullableString,
  jobs: z.array(visitDetailJobSchema),
  pendingRescheduleRequest: visitPendingRescheduleRequestSchema.nullable(),
});
export type VisitDetail = z.infer<typeof visitDetailSchema>;

/** The stored `calibration_visit` row, as the lab's writes answer with it (`.returning()`). */
const visitRowSchema = z.object({
  id: z.number(),
  organizationId: z.string(),
  unitId: z.number(),
  customerId: z.number(),
  sourceRequestId: z.number().nullable(),
  technicianId: nullableString,
  status: visitStatusSchema,
  scheduledAt: nullableString,
  scheduledEndAt: nullableString,
  address: AddressSchema.nullable(),
  notes: nullableString,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  confirmedBy: nullableString,
  confirmedAt: nullableString,
  cancelledBy: nullableString,
  cancelledAt: nullableString,
  cancelReason: nullableString,
  customerConfirmedBy: nullableString,
  customerConfirmedAt: nullableString,
});
export type VisitRow = z.infer<typeof visitRowSchema>;

/** The stored `visit_reschedule_request` row (`.returning()`). */
const visitRescheduleRequestRowSchema = z.object({
  id: z.number(),
  visitId: z.number(),
  organizationId: z.string(),
  customerId: z.number(),
  requestedBy: z.string(),
  reason: nullableString,
  preferredWindows: z.array(visitReschedulePreferredWindowSchema),
  status: z.enum(VISIT_RESCHEDULE_REQUEST_STATUSES),
  resolvedBy: nullableString,
  resolvedAt: nullableString,
  resolutionNote: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const DESKTOP_LABEL = "Visitas";

export const visitEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/visits",
    query: ListVisitsQuerySchema,
    response: visitsListResponseSchema,
    failure: "Falha ao carregar visitas",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { request: ["read"] },
  }),
  get: endpoint({
    method: "get",
    path: "/api/visits/:id",
    params: z.object({ id: routeId }),
    response: visitDetailSchema,
    failure: "Falha ao carregar visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { request: ["read"] },
  }),
  assign: endpoint({
    method: "post",
    path: "/api/visits/:id/assign",
    params: z.object({ id: routeId }),
    body: AssignVisitTechnicianSchema,
    response: visitRowSchema,
    failure: "Erro ao atribuir técnico",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { request: ["update"] },
  }),
  confirm: endpoint({
    method: "post",
    path: "/api/visits/:id/confirm",
    params: z.object({ id: routeId }),
    body: ConfirmVisitSchema,
    response: visitRowSchema,
    failure: "Erro ao confirmar visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { request: ["update"] },
  }),
  reschedule: endpoint({
    method: "patch",
    path: "/api/visits/:id",
    params: z.object({ id: routeId }),
    body: RescheduleVisitSchema,
    response: visitRowSchema,
    failure: "Erro ao reagendar visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { request: ["update"] },
  }),
  cancel: endpoint({
    method: "post",
    path: "/api/visits/:id/cancel",
    params: z.object({ id: routeId }),
    body: CancelVisitSchema,
    response: visitRowSchema,
    failure: "Erro ao cancelar visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { request: ["update"] },
  }),
  complete: endpoint({
    method: "post",
    path: "/api/visits/:id/complete",
    params: z.object({ id: routeId }),
    response: visitRowSchema,
    failure: "Erro ao concluir visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { request: ["update"] },
  }),
  addJob: endpoint({
    method: "post",
    path: "/api/visits/:id/jobs",
    params: z.object({ id: routeId }),
    body: AddVisitJobSchema,
    response: jobRowSchema,
    status: 201,
    failure: "Erro ao adicionar instrumento a visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { request: ["update"] },
  }),
  removeJob: endpoint({
    method: "delete",
    path: "/api/visits/:id/jobs/:jobId",
    params: z.object({ id: routeId, jobId: routeId }),
    response: jobRowSchema,
    failure: "Erro ao remover instrumento da visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { request: ["update"] },
  }),
  acceptRescheduleRequest: endpoint({
    method: "post",
    path: "/api/visits/:id/reschedule-requests/:requestId/accept",
    params: z.object({ id: routeId, requestId: routeId }),
    body: AcceptVisitRescheduleRequestSchema,
    response: visitRowSchema,
    failure: "Erro ao aceitar o reagendamento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { request: ["update"] },
  }),
  // Answers the resolved request(s) as a list (the update's `.returning()` rows), as it always did.
  declineRescheduleRequest: endpoint({
    method: "post",
    path: "/api/visits/:id/reschedule-requests/:requestId/decline",
    params: z.object({ id: routeId, requestId: routeId }),
    body: DeclineVisitRescheduleRequestSchema,
    response: z.array(visitRescheduleRequestRowSchema),
    failure: "Erro ao recusar o reagendamento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { request: ["update"] },
  }),
} as const satisfies EndpointGroup;
