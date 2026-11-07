import { z } from "zod";
import {
  CreateCheckStandardReadingSchema,
  CreateControlChartSchema,
  EscalateControlChartSchema,
  ListCheckStandardReadingsQuerySchema,
  ListControlChartsQuerySchema,
  UpdateControlChartSchema,
} from "@calibra-facil/schemas";
import { SPC_STATUSES } from "@calibra-facil/schemas/machines";

import { nullableNumber, nullableString, paginationSchema } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * Statistical process control (ISO/IEC 17025 7.7.1): check-standard readings and
 * the control chart per standard and parameter. Response schemas are wire
 * schemas written from what `apps/api/src/routes/spc.ts` returns.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const spcStatusSchema = z.enum(SPC_STATUSES);
const spcChartTypeSchema = z.enum(["i_mr", "xbar_r", "cusum", "ewma"]);
export type SpcChartType = z.infer<typeof spcChartTypeSchema>;

const spcChartParamsSchema = z.object({
  baselineWindow: nullableNumber.optional(),
  centerline: nullableNumber.optional(),
  sigma: nullableNumber.optional(),
  subgroupSize: nullableNumber.optional(),
  cusumK: nullableNumber.optional(),
  cusumH: nullableNumber.optional(),
  ewmaLambda: nullableNumber.optional(),
  ewmaK: nullableNumber.optional(),
  enabledRules: z.array(z.string()).nullable().optional(),
});

const spcRuleHitSchema = z.object({
  rule: z.string(),
  severity: z.enum(["trending", "out_of_control"]),
  /** Indices into the evaluated reading sequence (chronological). */
  pointIndices: z.array(z.number()),
  description: z.string(),
});

/** The engine's last evaluation of a chart (`@calibra-facil/interval-analysis`). */
const spcEvaluationSchema = z.object({
  engineVersion: z.string(),
  fingerprint: z.string(),
  status: spcStatusSchema,
  sampleSize: z.number(),
  limits: z
    .object({
      centerline: z.number(),
      sigma: z.number(),
      ucl: z.number(),
      lcl: z.number(),
      secondaryUcl: nullableNumber.optional(),
      secondaryLcl: nullableNumber.optional(),
    })
    .nullable()
    .optional(),
  ruleHits: z.array(spcRuleHitSchema),
  evaluatedAt: nullableString.optional(),
});

/** One chart as the overview lists it. */
const spcChartSchema = z.object({
  id: z.number(),
  standardId: z.number(),
  standardName: nullableString,
  parameter: z.string(),
  chartType: spcChartTypeSchema,
  params: spcChartParamsSchema.nullable(),
  status: spcStatusSchema,
  lastEvaluation: spcEvaluationSchema.nullable(),
  lastEvaluatedAt: nullableString,
  ncId: nullableNumber,
  capaId: nullableNumber,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SpcChart = z.infer<typeof spcChartSchema>;

/** The stored `control_chart` row (what create, update and recalculate answer). */
const spcChartRowSchema = spcChartSchema.omit({ standardName: true }).extend({
  organizationId: z.string(),
  unitId: nullableNumber,
  createdBy: z.string(),
});

export const spcChartsListResponseSchema = z.object({
  data: z.array(spcChartSchema),
  pagination: paginationSchema,
});
export type SpcChartsListResponse = z.infer<typeof spcChartsListResponseSchema>;

/** GET /api/spc/charts/:id: the chart row with its standard's name and chronological readings. */
export const spcChartDetailSchema = spcChartRowSchema.extend({
  standardName: nullableString,
  readings: z.array(
    z.object({
      id: z.number(),
      value: z.number(),
      uncertainty: nullableNumber,
      measuredAt: z.string(),
      sourceJobId: nullableNumber,
      createdBy: z.string(),
    }),
  ),
});
export type SpcChartDetail = z.infer<typeof spcChartDetailSchema>;

/** A check-standard reading as the readings list shows it. */
const spcReadingListItemSchema = z.object({
  id: z.number(),
  standardId: z.number(),
  parameter: z.string(),
  value: z.number(),
  uncertainty: nullableNumber,
  measuredAt: z.string(),
  sourceJobId: nullableNumber,
  createdBy: z.string(),
  createdByName: nullableString,
  createdAt: z.string(),
});

const spcReadingRowSchema = z.object({
  id: z.number(),
  organizationId: z.string(),
  standardId: z.number(),
  parameter: z.string(),
  value: z.number(),
  uncertainty: nullableNumber,
  measuredAt: z.string(),
  sourceJobId: nullableNumber,
  createdBy: z.string(),
  createdAt: z.string(),
});

const messageSchema = z.object({ message: z.string() });

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "Cartas de controle";

export const spcEndpoints = {
  listCharts: endpoint({
    method: "get",
    path: "/api/spc/charts",
    query: ListControlChartsQuerySchema,
    response: spcChartsListResponseSchema,
    failure: "Falha ao carregar cartas de controle",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getChart: endpoint({
    method: "get",
    path: "/api/spc/charts/:id",
    response: spcChartDetailSchema,
    failure: "Carta de controle não encontrada",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  createChart: endpoint({
    method: "post",
    path: "/api/spc/charts",
    body: CreateControlChartSchema,
    response: spcChartRowSchema,
    status: 201,
    failure: "Erro ao criar carta de controle",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  updateChart: endpoint({
    method: "put",
    path: "/api/spc/charts/:id",
    body: UpdateControlChartSchema,
    response: spcChartRowSchema,
    failure: "Erro ao atualizar carta de controle",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  removeChart: endpoint({
    method: "delete",
    path: "/api/spc/charts/:id",
    response: messageSchema,
    failure: "Erro ao remover carta de controle",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  recalculateChart: endpoint({
    method: "post",
    path: "/api/spc/charts/:id/recalculate",
    response: spcChartRowSchema,
    failure: "Erro ao recalcular carta",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  escalateChart: endpoint({
    method: "post",
    path: "/api/spc/charts/:id/escalate",
    body: EscalateControlChartSchema,
    response: z.object({
      message: z.string(),
      data: z.object({
        chart: spcChartRowSchema,
        capa: z.object({ id: z.number(), capaNumber: z.string() }),
      }),
    }),
    status: 201,
    failure: "Erro ao escalar sinal",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listReadings: endpoint({
    method: "get",
    path: "/api/spc/readings",
    query: ListCheckStandardReadingsQuerySchema,
    response: z.object({ data: z.array(spcReadingListItemSchema) }),
    failure: "Falha ao carregar leituras",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  createReading: endpoint({
    method: "post",
    path: "/api/spc/readings",
    body: CreateCheckStandardReadingSchema,
    response: spcReadingRowSchema,
    status: 201,
    failure: "Erro ao registrar leitura",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  removeReading: endpoint({
    method: "delete",
    path: "/api/spc/readings/:id",
    response: messageSchema,
    failure: "Erro ao remover leitura",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
