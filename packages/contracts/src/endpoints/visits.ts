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
} from "@calibra-facil/schemas";
import {
  VISIT_RESCHEDULE_REQUEST_STATUSES,
  VISIT_STATUSES,
} from "@calibra-facil/schemas/machines";

import { jobRowSchema } from "../jobs";
import { nullableString, paginationSchema } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * On-site (calibração in loco) visits. Response schemas are wire schemas
 * written from what the handlers in `apps/api/src/routes/visits.ts` return (the
 * three routers it exports are all mounted at `/api/visits`).
 */

const visitStatusSchema = z.enum(VISIT_STATUSES);
export type VisitStatus = z.infer<typeof visitStatusSchema>;

const visitAddressSchema = z.object({
  cep: z.string().optional(),
  number: z.string().optional(),
  street: z.string().optional(),
  complement: z.string().optional(),
  neighbourhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

const visitListItemSchema = z.object({
  id: z.number(),
  status: visitStatusSchema,
  scheduledAt: nullableString,
  address: visitAddressSchema.nullable(),
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
  period: z.enum(["MORNING", "AFTERNOON", "ANY"]),
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
  address: visitAddressSchema.nullable(),
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
  address: visitAddressSchema.nullable(),
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
  }),
  get: endpoint({
    method: "get",
    path: "/api/visits/:id",
    response: visitDetailSchema,
    failure: "Falha ao carregar visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  assign: endpoint({
    method: "post",
    path: "/api/visits/:id/assign",
    body: AssignVisitTechnicianSchema,
    response: visitRowSchema,
    failure: "Erro ao atribuir técnico",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  confirm: endpoint({
    method: "post",
    path: "/api/visits/:id/confirm",
    body: ConfirmVisitSchema,
    response: visitRowSchema,
    failure: "Erro ao confirmar visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  reschedule: endpoint({
    method: "patch",
    path: "/api/visits/:id",
    body: RescheduleVisitSchema,
    response: visitRowSchema,
    failure: "Erro ao reagendar visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  cancel: endpoint({
    method: "post",
    path: "/api/visits/:id/cancel",
    body: CancelVisitSchema,
    response: visitRowSchema,
    failure: "Erro ao cancelar visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  complete: endpoint({
    method: "post",
    path: "/api/visits/:id/complete",
    response: visitRowSchema,
    failure: "Erro ao concluir visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  addJob: endpoint({
    method: "post",
    path: "/api/visits/:id/jobs",
    body: AddVisitJobSchema,
    response: jobRowSchema,
    status: 201,
    failure: "Erro ao adicionar instrumento a visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  removeJob: endpoint({
    method: "delete",
    path: "/api/visits/:id/jobs/:jobId",
    response: jobRowSchema,
    failure: "Erro ao remover instrumento da visita",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  acceptRescheduleRequest: endpoint({
    method: "post",
    path: "/api/visits/:id/reschedule-requests/:requestId/accept",
    body: AcceptVisitRescheduleRequestSchema,
    response: visitRowSchema,
    failure: "Erro ao aceitar o reagendamento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  // Answers the resolved request(s) as a list (the update's `.returning()` rows), as it always did.
  declineRescheduleRequest: endpoint({
    method: "post",
    path: "/api/visits/:id/reschedule-requests/:requestId/decline",
    body: DeclineVisitRescheduleRequestSchema,
    response: z.array(visitRescheduleRequestRowSchema),
    failure: "Erro ao recusar o reagendamento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
