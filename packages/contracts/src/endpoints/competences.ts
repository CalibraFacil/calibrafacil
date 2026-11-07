import { z } from "zod";
import {
  AssignTrainingSchema,
  CancelCompetenceSchema,
  CreateCompetenceRequestSchema,
  EvaluateCompetenceSchema,
  ListPersonnelCompetenceQuerySchema,
} from "@calibra-facil/schemas";
import { COMPETENCE_STATUSES } from "@calibra-facil/schemas/machines";

import { nullableString, paginationSchema } from "../common";
import { endpoint, routeId, type EndpointGroup } from "./define";
import { trainingRecordRowSchema } from "./training-records";

/**
 * Personnel competences (ISO/IEC 17025 6.2.3): the request, training,
 * evaluation, renewal and suspension workflow. Response schemas are wire
 * schemas written from what `apps/api/src/routes/competences.ts` returns.
 *
 * Not client-facing, so not defined here: `GET /:id/label` (command palette)
 * and `PUT /:id` (nothing calls it).
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const competenceStatusSchema = z.enum(COMPETENCE_STATUSES);

/** The row the workflow transitions answer (`personnel_competence`, soft-delete and audit columns included). */
const competenceRowSchema = z.object({
  id: z.number(),
  organizationId: z.string(),
  /** Null once the owning user was deleted (the record survives, migration 0083). */
  userId: nullableString,
  assetTypeId: z.number().nullable(),
  scopeDescription: z.string(),
  status: competenceStatusSchema,
  qualifiedAt: nullableString,
  expiresAt: nullableString,
  certificateR2Key: nullableString,
  certificateFileName: nullableString,
  notes: nullableString,
  requestedBy: z.string(),
  evaluatedBy: nullableString,
  approvedBy: nullableString,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: nullableString,
});
export type CompetenceRecord = z.infer<typeof competenceRowSchema>;

/** One row of GET /api/competences. */
const competenceListItemSchema = z.object({
  id: z.number(),
  userId: nullableString,
  userName: z.string(),
  assetTypeId: z.number().nullable(),
  assetTypeName: nullableString,
  scopeDescription: z.string(),
  status: competenceStatusSchema,
  qualifiedAt: nullableString,
  expiresAt: nullableString,
  notes: nullableString,
  createdAt: z.string(),
});
export type CompetenceListItem = z.infer<typeof competenceListItemSchema>;

export const competencesListResponseSchema = z.object({
  data: z.array(competenceListItemSchema),
  pagination: paginationSchema,
});
export type CompetencesListResponse = z.infer<
  typeof competencesListResponseSchema
>;

/** GET /api/competences/matrix: technicians by asset types. */
export const competencesMatrixResponseSchema = z.object({
  technicians: z.array(
    z.object({ userId: z.string(), userName: z.string(), role: z.string() }),
  ),
  assetTypes: z.array(z.object({ id: z.number(), name: z.string() })),
  competences: z.array(
    z.object({
      id: z.number(),
      userId: nullableString,
      assetTypeId: z.number().nullable(),
      status: competenceStatusSchema,
      expiresAt: nullableString,
    }),
  ),
});
export type CompetencesMatrixResponse = z.infer<
  typeof competencesMatrixResponseSchema
>;

/** GET /api/competences/:id: the record with the names and its training records. */
export const competenceDetailSchema = competenceRowSchema
  .omit({ createdBy: true, deletedAt: true })
  .extend({
    userName: nullableString,
    userEmail: nullableString,
    assetTypeName: nullableString,
    requestedByName: nullableString,
    evaluatedByName: nullableString,
    approvedByName: nullableString,
    trainingRecords: z.array(trainingRecordRowSchema),
  });
export type CompetenceDetail = z.infer<typeof competenceDetailSchema>;

const competenceAuditEntrySchema = z.object({
  id: z.number(),
  action: z.string(),
  changes: z.unknown(),
  performedBy: z.string(),
  performedByName: z.string(),
  performedAt: z.string(),
  reason: nullableString,
});
export type CompetenceAuditLogEntry = z.infer<
  typeof competenceAuditEntrySchema
>;

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "Competências";

export const competenceEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/competences",
    query: ListPersonnelCompetenceQuerySchema,
    response: competencesListResponseSchema,
    failure: "Falha ao carregar competências",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  matrix: endpoint({
    method: "get",
    path: "/api/competences/matrix",
    response: competencesMatrixResponseSchema,
    failure: "Falha ao carregar matriz",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  get: endpoint({
    method: "get",
    path: "/api/competences/:id",
    params: z.object({ id: routeId }),
    response: competenceDetailSchema,
    failure: "Falha ao carregar competência",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  auditLog: endpoint({
    method: "get",
    path: "/api/competences/:id/audit-log",
    params: z.object({ id: routeId }),
    response: z.array(competenceAuditEntrySchema),
    failure: "Falha ao carregar histórico",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  create: endpoint({
    method: "post",
    path: "/api/competences",
    body: CreateCompetenceRequestSchema,
    response: competenceRowSchema,
    status: 201,
    failure: "Erro ao criar solicitação",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  startTraining: endpoint({
    method: "post",
    path: "/api/competences/:id/start-training",
    params: z.object({ id: routeId }),
    response: competenceRowSchema,
    failure: "Erro na operação",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  completeTraining: endpoint({
    method: "post",
    path: "/api/competences/:id/complete-training",
    params: z.object({ id: routeId }),
    response: competenceRowSchema,
    failure: "Erro na operação",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  suspend: endpoint({
    method: "post",
    path: "/api/competences/:id/suspend",
    params: z.object({ id: routeId }),
    response: competenceRowSchema,
    failure: "Erro na operação",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  evaluate: endpoint({
    method: "post",
    path: "/api/competences/:id/evaluate",
    params: z.object({ id: routeId }),
    body: EvaluateCompetenceSchema,
    response: competenceRowSchema,
    failure: "Erro na avaliação",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  renew: endpoint({
    method: "post",
    path: "/api/competences/:id/renew",
    params: z.object({ id: routeId }),
    body: EvaluateCompetenceSchema,
    response: competenceRowSchema,
    failure: "Erro na renovação",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  cancel: endpoint({
    method: "post",
    path: "/api/competences/:id/cancel",
    params: z.object({ id: routeId }),
    body: CancelCompetenceSchema,
    response: competenceRowSchema,
    failure: "Erro ao cancelar competência",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  delete: endpoint({
    method: "delete",
    path: "/api/competences/:id",
    params: z.object({ id: routeId }),
    response: z.object({ message: z.string() }),
    failure: "Erro ao excluir competência",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  assignTraining: endpoint({
    method: "post",
    path: "/api/competences/:id/assign-training",
    params: z.object({ id: routeId }),
    body: AssignTrainingSchema,
    response: competenceRowSchema,
    failure: "Erro ao atribuir treinamento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
