import { z } from "zod";
import {
  CreateNonConformanceSchema,
  EscalateToCapaSchema,
  ListNonConformancesQuerySchema,
  NonConformanceStatusSchema,
  NonConformanceTypeSchema,
  RegisterOotAcknowledgementSchema,
  ResolveNonConformanceSchema,
  SaveOotImpactAssessmentSchema,
  SetDispositionSchema,
} from "@calibra-facil/schemas";
import { OOT_NOTIFICATION_STATUSES } from "@calibra-facil/schemas/machines";

import { nullableNumber, nullableString, paginationSchema } from "../common";
import { correctiveActionRowSchema } from "./capa";
import { endpoint, routeId, type EndpointGroup } from "./define";

/**
 * Non-conforming work (ISO/IEC 17025 8.7) and its 7.10 out-of-tolerance
 * follow-up: disposition, resolution, escalation to a CAPA, the customer
 * notification and the impact assessment. Response schemas are wire schemas
 * written from what `apps/api/src/routes/non-conformances.ts` returns.
 * `GET /:id/label` (command palette) is not client-facing, so it is not defined
 * here and stays a plain route.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ncDispositionSchema = z.enum([
  "rework",
  "scrap",
  "use_as_is",
  "concession",
]);
export type NonConformanceDisposition = z.infer<typeof ncDispositionSchema>;

/** The stored `non_conformance` row (what the transitions answer and the detail spreads). */
const ncRowSchema = z.object({
  id: z.number(),
  ncNumber: z.string(),
  organizationId: z.string(),
  jobId: nullableNumber,
  type: NonConformanceTypeSchema,
  triggerSource: nullableString,
  description: z.string(),
  detectedBy: z.string(),
  detectedAt: z.string(),
  disposition: ncDispositionSchema.nullable(),
  dispositionJustification: nullableString,
  dispositionApprovedBy: nullableString,
  dispositionApprovedAt: nullableString,
  correctionTaken: nullableString,
  resolvedAt: nullableString,
  resolvedBy: nullableString,
  status: NonConformanceStatusSchema,
  capaId: nullableNumber,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NonConformanceRecord = z.infer<typeof ncRowSchema>;

/** One row of GET /api/nc. */
const ncListItemSchema = z.object({
  id: z.number(),
  ncNumber: z.string(),
  jobId: nullableNumber,
  type: NonConformanceTypeSchema,
  description: z.string(),
  detectedBy: z.string(),
  detectedAt: z.string(),
  disposition: ncDispositionSchema.nullable(),
  dispositionJustification: nullableString,
  dispositionApprovedBy: nullableString,
  dispositionApprovedAt: nullableString,
  correctionTaken: nullableString,
  resolvedAt: nullableString,
  resolvedBy: nullableString,
  status: NonConformanceStatusSchema,
  capaId: nullableNumber,
  createdAt: z.string(),
  updatedAt: z.string(),
  detectedByName: nullableString,
  ageDays: z.number(),
});
export type NonConformanceListItem = z.infer<typeof ncListItemSchema>;

export const ncListResponseSchema = z.object({
  data: z.array(ncListItemSchema),
  pagination: paginationSchema,
});
export type NonConformanceListResponse = z.infer<typeof ncListResponseSchema>;

export const ncSummarySchema = z.object({
  byStatus: z.array(
    z.object({ status: NonConformanceStatusSchema, count: z.number() }),
  ),
  byType: z.array(
    z.object({ type: NonConformanceTypeSchema, count: z.number() }),
  ),
  ageBrackets: z.object({
    lessThan7Days: z.number(),
    moreThan30Days: z.number(),
  }),
});
export type NonConformanceSummary = z.infer<typeof ncSummarySchema>;

/** GET /api/nc/:id: the row with the names, its CAPA and job, and the age. */
export const ncDetailSchema = ncRowSchema.extend({
  detectedByName: nullableString,
  dispositionApproverName: nullableString,
  resolverName: nullableString,
  capa: correctiveActionRowSchema.nullable(),
  job: z
    .object({ id: z.number(), jobId: z.string(), status: z.string() })
    .nullable(),
  ageDays: z.number(),
});
export type NonConformanceDetail = z.infer<typeof ncDetailSchema>;

const ncAuditEntrySchema = z.object({
  id: z.number(),
  organizationId: nullableString,
  ncId: z.number(),
  action: z.string(),
  changes: z.unknown(),
  performedBy: z.string(),
  performedAt: z.string(),
  ipAddress: nullableString,
  reason: nullableString,
});
export type NonConformanceAuditLogEntry = z.infer<typeof ncAuditEntrySchema>;

/** The 7.10 customer-notification record (the unguessable `ackToken` is never read out). */
const ootNotificationSchema = z.object({
  id: z.number(),
  ncId: nullableNumber,
  jobId: nullableNumber,
  certificateNumber: nullableString,
  recipientName: nullableString,
  recipientEmail: nullableString,
  affectedScope: nullableString,
  status: z.enum(OOT_NOTIFICATION_STATUSES),
  pdfR2Key: nullableString,
  sentAt: nullableString,
  acknowledgedAt: nullableString,
  acknowledgedVia: nullableString,
  acknowledgedNote: nullableString,
  createdAt: z.string(),
});
export type OotNotification = z.infer<typeof ootNotificationSchema>;

const impactConclusionSchema = z.enum([
  "no_significant_impact",
  "impact_confirmed",
  "inconclusive",
]);

/** The guided 7.10 impact-assessment record, one per out-of-tolerance NC. */
const ootImpactAssessmentSchema = z.object({
  id: z.number(),
  organizationId: z.string(),
  ncId: z.number(),
  deviationSummary: z.string(),
  deviationMagnitude: nullableNumber,
  customerTolerance: nullableNumber,
  toleranceUnit: nullableString,
  affectedFrom: nullableString,
  affectedTo: nullableString,
  items: z
    .array(
      z.object({
        description: z.string(),
        disposition: z.enum([
          "no_impact",
          "recheck",
          "notify_downstream",
          "other",
        ]),
        note: nullableString.optional(),
      }),
    )
    .nullable(),
  conclusion: impactConclusionSchema.nullable(),
  correctiveActionNote: nullableString,
  signedBy: nullableString,
  signedAt: nullableString,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OotImpactAssessment = z.infer<typeof ootImpactAssessmentSchema>;

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "Não conformidades";

export const nonConformanceEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/nc",
    query: ListNonConformancesQuerySchema,
    response: ncListResponseSchema,
    failure: "Falha ao carregar não conformidades",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  summary: endpoint({
    method: "get",
    path: "/api/nc/summary",
    response: ncSummarySchema,
    failure: "Falha ao carregar resumo",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  get: endpoint({
    method: "get",
    path: "/api/nc/:id",
    params: z.object({ id: routeId }),
    response: ncDetailSchema,
    failure: "Falha ao carregar NC",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  auditLog: endpoint({
    method: "get",
    path: "/api/nc/:id/audit-log",
    params: z.object({ id: routeId }),
    response: z.object({ data: z.array(ncAuditEntrySchema) }),
    failure: "Falha ao carregar histórico",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  create: endpoint({
    method: "post",
    path: "/api/nc",
    body: CreateNonConformanceSchema,
    response: ncRowSchema,
    status: 201,
    failure: "Erro ao registrar NC",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  setDisposition: endpoint({
    method: "put",
    path: "/api/nc/:id/disposition",
    params: z.object({ id: routeId }),
    body: SetDispositionSchema,
    response: ncRowSchema,
    failure: "Erro ao definir disposição",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  resolve: endpoint({
    method: "post",
    path: "/api/nc/:id/resolve",
    params: z.object({ id: routeId }),
    body: ResolveNonConformanceSchema,
    response: z.object({ message: z.string(), data: ncRowSchema }),
    failure: "Erro ao resolver",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  escalateToCapa: endpoint({
    method: "post",
    path: "/api/nc/:id/escalate-to-capa",
    params: z.object({ id: routeId }),
    body: EscalateToCapaSchema,
    response: z.object({
      message: z.string(),
      data: z.object({ nc: ncRowSchema, capa: correctiveActionRowSchema }),
    }),
    status: 201,
    failure: "Erro ao escalar para CAPA",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getOotNotification: endpoint({
    method: "get",
    path: "/api/nc/:id/oot-notification",
    params: z.object({ id: routeId }),
    response: z.object({ data: ootNotificationSchema.nullable() }),
    failure: "Falha ao carregar notificação 7.10",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  registerOotAcknowledgement: endpoint({
    method: "post",
    path: "/api/nc/:id/oot-ack",
    params: z.object({ id: routeId }),
    body: RegisterOotAcknowledgementSchema,
    response: z.object({
      message: z.string(),
      data: ootNotificationSchema,
    }),
    failure: "Erro ao registrar confirmação de recebimento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getImpactAssessment: endpoint({
    method: "get",
    path: "/api/nc/:id/oot-impact-assessment",
    params: z.object({ id: routeId }),
    response: z.object({ data: ootImpactAssessmentSchema.nullable() }),
    failure: "Falha ao carregar avaliação de impacto",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  saveImpactAssessment: endpoint({
    method: "put",
    path: "/api/nc/:id/oot-impact-assessment",
    params: z.object({ id: routeId }),
    body: SaveOotImpactAssessmentSchema,
    response: z.object({
      message: z.string(),
      data: ootImpactAssessmentSchema,
    }),
    failure: "Erro ao salvar avaliação de impacto",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  signImpactAssessment: endpoint({
    method: "post",
    path: "/api/nc/:id/oot-impact-assessment/sign",
    params: z.object({ id: routeId }),
    response: z.object({
      message: z.string(),
      data: ootImpactAssessmentSchema,
    }),
    failure: "Erro ao assinar avaliação de impacto",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
