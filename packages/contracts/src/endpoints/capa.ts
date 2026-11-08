import { z } from "zod";
import {
  CloseCorrectiveActionSchema,
  CreateCapaSchema,
  ImplementCorrectiveActionSchema,
  ListCorrectiveActionsQuerySchema,
  UpdateCorrectiveActionSchema,
  VerifyCorrectiveActionSchema,
} from "@calibra-facil/schemas";
import { CORRECTIVE_ACTION_STATUSES } from "@calibra-facil/schemas/machines";

import { nullableString, paginationSchema } from "../common";
import { endpoint, routeId, type EndpointGroup } from "./define";

/**
 * Corrective and preventive actions (CAPA, ISO/IEC 17025 8.7 and 8.9). Response
 * schemas are wire schemas written from what `apps/api/src/domains/quality/routes/capa.ts`
 * returns. `GET /:id/label` (command palette) is not client-facing, so it is not
 * defined here and stays a plain route.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const capaStatusSchema = z.enum(CORRECTIVE_ACTION_STATUSES);

/** The stored `corrective_action` row (what create, update and the transitions answer; also embedded in an NC). */
export const correctiveActionRowSchema = z.object({
  id: z.number(),
  capaNumber: z.string(),
  organizationId: z.string(),
  source: z.string(),
  sourceReference: nullableString,
  title: z.string(),
  description: z.string(),
  detectionDate: nullableString,
  type: z.string(),
  severity: z.string(),
  category: z.string(),
  rootCauseAnalysis: nullableString,
  rootCauseAnalysisMethod: nullableString,
  actionPlan: nullableString,
  preventiveMeasures: nullableString,
  responsibleId: nullableString,
  dueDate: nullableString,
  implementationEvidence: nullableString,
  implementedAt: nullableString,
  investigationCompletedAt: nullableString,
  verifiedAt: nullableString,
  verifiedBy: nullableString,
  verificationNotes: nullableString,
  effectivenessConfirmed: z.boolean().nullable(),
  verificationIndependence: z
    .enum(["independent", "waived_single_verifier"])
    .nullable(),
  verificationIndependenceJustification: nullableString,
  status: capaStatusSchema,
  closedAt: nullableString,
  closedBy: nullableString,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CorrectiveActionRow = z.infer<typeof correctiveActionRowSchema>;

/** One row of GET /api/capa. */
const capaListItemSchema = z.object({
  id: z.number(),
  capaNumber: z.string(),
  source: z.string(),
  sourceReference: nullableString,
  title: z.string(),
  description: z.string(),
  detectionDate: nullableString,
  type: z.string(),
  severity: z.string(),
  category: z.string(),
  status: capaStatusSchema,
  responsibleId: nullableString,
  dueDate: nullableString,
  implementedAt: nullableString,
  verifiedAt: nullableString,
  closedAt: nullableString,
  effectivenessConfirmed: z.boolean().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  responsibleName: nullableString,
  ageDays: z.number(),
  isOverdue: z.boolean().nullable(),
});
export type CapaListItem = z.infer<typeof capaListItemSchema>;

export const capaListResponseSchema = z.object({
  data: z.array(capaListItemSchema),
  pagination: paginationSchema,
});
export type CapaListResponse = z.infer<typeof capaListResponseSchema>;

export const capaSummarySchema = z.object({
  byStatus: z.array(z.object({ status: capaStatusSchema, count: z.number() })),
  bySeverity: z.array(z.object({ severity: z.string(), count: z.number() })),
  byCategory: z.array(z.object({ category: z.string(), count: z.number() })),
  overdue: z.number(),
  effectivenessRate: z.number(),
  totalClosed: z.number(),
});
export type CapaSummary = z.infer<typeof capaSummarySchema>;

/** GET /api/capa/:id: the row with the names, the linked NCs and the age. */
export const capaDetailSchema = correctiveActionRowSchema.extend({
  responsibleName: nullableString,
  verifiedByName: nullableString,
  closedByName: nullableString,
  createdByName: nullableString,
  linkedNCs: z.array(
    z.object({
      id: z.number(),
      ncNumber: z.string(),
      type: z.string(),
      description: z.string(),
      status: z.string(),
      detectedAt: z.string(),
    }),
  ),
  ageDays: z.number(),
  isOverdue: z.boolean().nullable(),
});
export type CapaDetail = z.infer<typeof capaDetailSchema>;

const capaAuditEntrySchema = z.object({
  id: z.number(),
  capaId: z.number(),
  action: z.string(),
  changes: z.unknown(),
  performedBy: z.string(),
  performedAt: z.string(),
  ipAddress: nullableString,
  reason: nullableString,
  performedByName: nullableString,
});
export type CapaAuditLogEntry = z.infer<typeof capaAuditEntrySchema>;

const capaTransitionResponseSchema = z.object({
  message: z.string(),
  data: correctiveActionRowSchema,
});

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "CAPA";

export const capaEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/capa",
    query: ListCorrectiveActionsQuerySchema,
    response: capaListResponseSchema,
    failure: "Falha ao carregar CAPAs",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  summary: endpoint({
    method: "get",
    path: "/api/capa/summary",
    response: capaSummarySchema,
    failure: "Falha ao carregar resumo",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  get: endpoint({
    method: "get",
    path: "/api/capa/:id",
    params: z.object({ id: routeId }),
    response: capaDetailSchema,
    failure: "CAPA não encontrada",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  auditLog: endpoint({
    method: "get",
    path: "/api/capa/:id/audit-log",
    params: z.object({ id: routeId }),
    response: z.object({ data: z.array(capaAuditEntrySchema) }),
    failure: "Falha ao carregar histórico",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  create: endpoint({
    method: "post",
    path: "/api/capa",
    body: CreateCapaSchema,
    response: correctiveActionRowSchema,
    status: 201,
    failure: "Erro ao criar CAPA",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  update: endpoint({
    method: "put",
    path: "/api/capa/:id",
    params: z.object({ id: routeId }),
    body: UpdateCorrectiveActionSchema,
    response: correctiveActionRowSchema,
    failure: "Erro ao atualizar CAPA",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  implement: endpoint({
    method: "post",
    path: "/api/capa/:id/implement",
    params: z.object({ id: routeId }),
    body: ImplementCorrectiveActionSchema,
    response: capaTransitionResponseSchema,
    failure: "Erro ao implementar",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  verify: endpoint({
    method: "post",
    path: "/api/capa/:id/verify",
    params: z.object({ id: routeId }),
    body: VerifyCorrectiveActionSchema,
    response: capaTransitionResponseSchema,
    failure: "Erro ao verificar",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  close: endpoint({
    method: "post",
    path: "/api/capa/:id/close",
    params: z.object({ id: routeId }),
    body: CloseCorrectiveActionSchema,
    response: capaTransitionResponseSchema,
    failure: "Erro ao fechar CAPA",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
