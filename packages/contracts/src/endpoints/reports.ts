import { z } from "zod";

import { endpoint, type EndpointGroup } from "./define";

/**
 * The consolidated (multi-unit) reports of the laboratory. Response schemas are
 * the wire bodies written from what `apps/api/src/domains/reports/routes/reports.ts` returns.
 *
 * Not client-facing, so not defined here: `GET /consolidated/summary` (no SDK
 * method). Cloud-only: consolidated reporting has no offline counterpart.
 */

export const REPORT_PERIODS = ["7d", "30d", "90d", "month"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** The query of every consolidated report; `unitIds` is a comma-separated list of unit ids. */
export const ReportQuerySchema = z.object({
  period: z.enum(REPORT_PERIODS).optional().default("30d"),
  unitIds: z.string().optional(),
});

const reportPeriodSchema = z.enum(REPORT_PERIODS);

const reportUnitSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
});
export type ReportUnitOption = z.infer<typeof reportUnitSchema>;

const healthStatusSchema = z.enum(["healthy", "attention", "critical"]);

/** The period, its label and the units the report covers: the head of every report body. */
const reportScopeShape = {
  period: reportPeriodSchema,
  label: z.string(),
  availableUnits: z.array(reportUnitSchema),
  selectedUnits: z.array(reportUnitSchema),
};

/** GET /api/reports/consolidated/executive-overview */
export const executiveOverviewSchema = z.object({
  ...reportScopeShape,
  range: z.object({ startDate: z.string(), endDate: z.string() }),
  scopeSummary: z.object({
    label: z.string(),
    description: z.string(),
    unitsIncluded: z.number(),
    isAllUnits: z.boolean(),
  }),
  metrics: z.object({
    pendingCalibrations: z.number(),
    approvedInPeriod: z.number(),
    rejectedInPeriod: z.number(),
    approvalRate: z.number(),
    overdueJobs: z.number(),
    expiringStandards: z.number(),
    unitsIncluded: z.number(),
    atRiskUnitsCount: z.number(),
  }),
  highlights: z.object({
    highestVolumeUnit: z
      .object({
        unitId: z.number(),
        unitName: z.string(),
        jobsCreatedInPeriod: z.number(),
      })
      .nullable(),
    bestApprovalUnit: z
      .object({
        unitId: z.number(),
        unitName: z.string(),
        approvalRate: z.number(),
        approvedInPeriod: z.number(),
      })
      .nullable(),
    attentionUnit: z
      .object({
        unitId: z.number(),
        unitName: z.string(),
        healthStatus: healthStatusSchema,
        healthReason: z.string(),
        overdueNow: z.number(),
        rejectedInPeriod: z.number(),
        expiringStandardsSoon: z.number(),
      })
      .nullable(),
  }),
});
export type ExecutiveOverviewResponse = z.infer<typeof executiveOverviewSchema>;

/** GET /api/reports/consolidated/comparison */
export const comparisonSchema = z.object({
  ...reportScopeShape,
  rows: z.array(
    z.object({
      unitId: z.number(),
      unitName: z.string(),
      unitSlug: z.string(),
      jobsCreatedInPeriod: z.number(),
      approvedInPeriod: z.number(),
      rejectedInPeriod: z.number(),
      pendingNow: z.number(),
      overdueNow: z.number(),
      expiringStandardsSoon: z.number(),
      approvalRate: z.number(),
      healthStatus: healthStatusSchema,
      healthReason: z.string(),
    }),
  ),
});
export type ComparisonResponse = z.infer<typeof comparisonSchema>;

/** GET /api/reports/consolidated/trend */
export const trendSchema = z.object({
  ...reportScopeShape,
  data: z.array(
    z.object({ date: z.string(), approved: z.number(), rejected: z.number() }),
  ),
});
export type TrendResponse = z.infer<typeof trendSchema>;

const DESKTOP_LABEL = "Relatórios consolidados";

export const reportEndpoints = {
  getExecutiveOverview: endpoint({
    method: "get",
    path: "/api/reports/consolidated/executive-overview",
    query: ReportQuerySchema,
    response: executiveOverviewSchema,
    failure: "Falha ao carregar visão executiva",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getComparison: endpoint({
    method: "get",
    path: "/api/reports/consolidated/comparison",
    query: ReportQuerySchema,
    response: comparisonSchema,
    failure: "Falha ao carregar comparativo consolidado",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getTrend: endpoint({
    method: "get",
    path: "/api/reports/consolidated/trend",
    query: ReportQuerySchema,
    response: trendSchema,
    failure: "Falha ao carregar tendência consolidada",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
