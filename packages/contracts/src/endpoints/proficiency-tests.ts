import { z } from "zod";
import {
  CreateProficiencyTestSchema,
  CreatePtPlanItemSchema,
  ListProficiencyTestsQuerySchema,
  RecordPtResultsSchema,
  UpdateProficiencyTestSchema,
  UpdatePtPlanItemSchema,
} from "@calibra-facil/schemas";
import { PT_OVERALL_STATUSES } from "@calibra-facil/schemas/machines";

import { nullableNumber, nullableString, paginationSchema } from "../common";
import { endpoint, routeId, type EndpointGroup } from "./define";

/**
 * Proficiency testing (ISO/IEC 17025 7.7.2): the PT register (rounds scored per
 * ISO 13528) and the risk-based participation plan (NIT-DICLA-026 9.4).
 * Response schemas are wire schemas written from what
 * `apps/api/src/domains/quality/routes/proficiency-tests.ts` returns.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ptActivityTypeSchema = z.enum([
  "proficiency_test",
  "interlab_comparison",
]);
export type PtActivityType = z.infer<typeof ptActivityTypeSchema>;

const ptOverallStatusSchema = z.enum(PT_OVERALL_STATUSES);
const ptScoreTypeSchema = z.enum(["en", "z", "z_prime", "zeta"]);
export type PtScoreType = z.infer<typeof ptScoreTypeSchema>;
const ptVerdictSchema = z.enum([
  "satisfactory",
  "questionable",
  "unsatisfactory",
]);

/** One scored measured point of a round (the server computes `score` and `verdict`). */
const ptResultPointSchema = z.object({
  label: z.string(),
  unit: nullableString.optional(),
  labValue: z.number(),
  labUncertainty: nullableNumber.optional(),
  refValue: z.number(),
  refUncertainty: nullableNumber.optional(),
  sigmaPt: nullableNumber.optional(),
  scoreType: ptScoreTypeSchema,
  score: nullableNumber.optional(),
  verdict: ptVerdictSchema.nullable().optional(),
});
export type PtResultPoint = z.infer<typeof ptResultPointSchema>;

/** One row of GET /api/proficiency-tests (the detail adds the results, notes and creator). */
const ptRoundSchema = z.object({
  id: z.number(),
  activityType: ptActivityTypeSchema,
  provider: z.string(),
  providerAccreditation: nullableString,
  ptRound: z.string(),
  scopePart: z.string(),
  metrologyKind: nullableString,
  standardId: nullableNumber,
  standardName: nullableString,
  registrationDate: nullableString,
  participationDate: nullableString,
  resultReportedAt: nullableString,
  overallStatus: ptOverallStatusSchema,
  capaId: nullableNumber,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PtRound = z.infer<typeof ptRoundSchema>;

export const ptListResponseSchema = z.object({
  data: z.array(ptRoundSchema),
  pagination: paginationSchema,
});
export type PtListResponse = z.infer<typeof ptListResponseSchema>;

/** GET /api/proficiency-tests/:id */
export const ptDetailSchema = ptRoundSchema.extend({
  results: z.array(ptResultPointSchema).nullable(),
  notes: nullableString,
  createdBy: z.string(),
  createdByName: nullableString,
});
export type PtDetail = z.infer<typeof ptDetailSchema>;

/** The stored `proficiency_test` row (what create, update and record-results answer). */
const ptRowSchema = z.object({
  id: z.number(),
  organizationId: z.string(),
  unitId: nullableNumber,
  activityType: ptActivityTypeSchema,
  provider: z.string(),
  providerAccreditation: nullableString,
  ptRound: z.string(),
  scopePart: z.string(),
  metrologyKind: nullableString,
  standardId: nullableNumber,
  registrationDate: nullableString,
  participationDate: nullableString,
  resultReportedAt: nullableString,
  results: z.array(ptResultPointSchema).nullable(),
  overallStatus: ptOverallStatusSchema,
  capaId: nullableNumber,
  notes: nullableString,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** GET /api/proficiency-tests/summary */
export const ptSummarySchema = z.object({
  total: z.number(),
  pending: z.number(),
  satisfactory: z.number(),
  questionable: z.number(),
  unsatisfactory: z.number(),
  planItems: z.number(),
  planOverdue: z.number(),
  planDueSoon: z.number(),
});
export type PtSummary = z.infer<typeof ptSummarySchema>;

const ptAuditEntrySchema = z.object({
  id: z.number(),
  action: z.string(),
  changes: z.unknown(),
  performedBy: z.string(),
  performedByName: nullableString,
  performedAt: z.string(),
  reason: nullableString,
});
export type PtAuditLogEntry = z.infer<typeof ptAuditEntrySchema>;

/** One item of the participation plan (the stored row also carries the organization, unit and creator). */
const ptPlanItemSchema = z.object({
  id: z.number(),
  scopePart: z.string(),
  riskJustification: nullableString,
  frequencyMonths: z.number(),
  lastSatisfactoryAt: nullableString,
  nextDueAt: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PtPlanItem = z.infer<typeof ptPlanItemSchema>;

const messageSchema = z.object({ message: z.string() });

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "Ensaios de proficiência";

export const proficiencyTestEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/proficiency-tests",
    query: ListProficiencyTestsQuerySchema,
    response: ptListResponseSchema,
    failure: "Falha ao carregar ensaios de proficiência",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { proficiency_test: ["read"] },
  }),
  summary: endpoint({
    method: "get",
    path: "/api/proficiency-tests/summary",
    response: ptSummarySchema,
    failure: "Falha ao carregar resumo",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { proficiency_test: ["read"] },
  }),
  get: endpoint({
    method: "get",
    path: "/api/proficiency-tests/:id",
    params: z.object({ id: routeId }),
    response: ptDetailSchema,
    failure: "Ensaio de proficiência não encontrado",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { proficiency_test: ["read"] },
  }),
  auditLog: endpoint({
    method: "get",
    path: "/api/proficiency-tests/:id/audit-log",
    params: z.object({ id: routeId }),
    response: z.object({ data: z.array(ptAuditEntrySchema) }),
    failure: "Falha ao carregar histórico",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { proficiency_test: ["read"] },
  }),
  create: endpoint({
    method: "post",
    path: "/api/proficiency-tests",
    body: CreateProficiencyTestSchema,
    response: ptRowSchema,
    status: 201,
    failure: "Erro ao registrar ensaio de proficiência",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { proficiency_test: ["create"] },
  }),
  update: endpoint({
    method: "put",
    path: "/api/proficiency-tests/:id",
    params: z.object({ id: routeId }),
    body: UpdateProficiencyTestSchema,
    response: ptRowSchema,
    failure: "Erro ao atualizar ensaio de proficiência",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { proficiency_test: ["update"] },
  }),
  recordResults: endpoint({
    method: "post",
    path: "/api/proficiency-tests/:id/results",
    params: z.object({ id: routeId }),
    body: RecordPtResultsSchema,
    response: ptRowSchema,
    failure: "Erro ao registrar resultados",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { proficiency_test: ["record_results"] },
  }),
  remove: endpoint({
    method: "delete",
    path: "/api/proficiency-tests/:id",
    params: z.object({ id: routeId }),
    response: messageSchema,
    failure: "Erro ao remover ensaio",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { proficiency_test: ["delete"] },
  }),
  listPlan: endpoint({
    method: "get",
    path: "/api/proficiency-tests/plan",
    response: z.object({ data: z.array(ptPlanItemSchema) }),
    failure: "Falha ao carregar plano de participação",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { proficiency_test: ["read"] },
  }),
  createPlanItem: endpoint({
    method: "post",
    path: "/api/proficiency-tests/plan",
    body: CreatePtPlanItemSchema,
    response: ptPlanItemSchema,
    status: 201,
    failure: "Erro ao criar item do plano",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { proficiency_test: ["create"] },
  }),
  updatePlanItem: endpoint({
    method: "put",
    path: "/api/proficiency-tests/plan/:id",
    params: z.object({ id: routeId }),
    body: UpdatePtPlanItemSchema,
    response: ptPlanItemSchema,
    failure: "Erro ao atualizar item do plano",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { proficiency_test: ["update"] },
  }),
  removePlanItem: endpoint({
    method: "delete",
    path: "/api/proficiency-tests/plan/:id",
    params: z.object({ id: routeId }),
    response: messageSchema,
    failure: "Erro ao remover item do plano",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { proficiency_test: ["delete"] },
  }),
} as const satisfies EndpointGroup;
