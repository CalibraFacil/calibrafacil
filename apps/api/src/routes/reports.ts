import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  organizationUnit,
  referenceStandard,
} from "@calibra-facil/db/schema";
import { and, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  type AuthVariables,
  getGovernanceAccess,
  requireLabProtected,
  requireOrgType,
} from "../middleware/permission";
import { getExecuteRows } from "../lib/db";

const ReportQuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d", "month"]).optional().default("30d"),
  unitIds: z.string().optional(),
});

type ReportPeriod = z.infer<typeof ReportQuerySchema>["period"];

const OPEN_JOB_STATUSES = ["DRAFT", "IN_PROGRESS", "REVIEW"] as const;

type HealthStatus = "healthy" | "attention" | "critical";

type UnitSummary = {
  id: number;
  name: string;
  slug: string;
};

function resolvePeriodRange(period: ReportPeriod) {
  const now = new Date();
  const startDate = new Date(now);

  if (period === "month") {
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);
  } else {
    const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
    startDate.setDate(now.getDate() - days);
  }

  return {
    period,
    startDate,
    endDate: now,
  };
}

function parseRequestedUnitIds(raw?: string) {
  if (!raw?.trim()) return null;

  const unitIds = raw
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  return unitIds.length > 0 ? Array.from(new Set(unitIds)) : null;
}

function mapCountsByUnit<T extends { unitId: number | null; value: number | string }>(
  rows: T[],
) {
  return new Map(
    rows
      .filter((row): row is T & { unitId: number } => row.unitId !== null)
      .map((row) => [row.unitId, Number(row.value)]),
  );
}

const requireConsolidatedReportingAccess = createMiddleware<{
  Variables: AuthVariables;
}>(async (c, next) => {
  const memberData = c.get("member");
  const viewer = getGovernanceAccess(memberData);

  if (!viewer.canAccessConsolidatedView) {
    return c.json({ error: "Apenas administradores globais podem acessar relatórios consolidados" }, 403);
  }

  await next();
});

async function resolveSelectedUnits(params: {
  organizationId: string;
  accessibleUnitIds: number[];
  requestedUnitIds: number[] | null;
}) {
  const availableUnits = await db
    .select({
      id: organizationUnit.id,
      name: organizationUnit.name,
      slug: organizationUnit.slug,
    })
    .from(organizationUnit)
    .where(
      and(
        eq(organizationUnit.organizationId, params.organizationId),
        eq(organizationUnit.status, "ACTIVE"),
        inArray(organizationUnit.id, params.accessibleUnitIds),
      ),
    )
    .orderBy(organizationUnit.name);

  if (availableUnits.length === 0) {
    return {
      availableUnits: [] as UnitSummary[],
      selectedUnits: [] as UnitSummary[],
      selectedUnitIds: [] as number[],
    };
  }

  if (!params.requestedUnitIds) {
    return {
      availableUnits,
      selectedUnits: availableUnits,
      selectedUnitIds: availableUnits.map((unit) => unit.id),
    };
  }

  const availableUnitIdSet = new Set(availableUnits.map((unit) => unit.id));
  const invalidRequestedUnit = params.requestedUnitIds.some(
    (unitId) => !availableUnitIdSet.has(unitId),
  );

  if (invalidRequestedUnit) {
    throw new Error("Uma ou mais unidades estão fora do escopo permitido");
  }

  const selectedUnits = availableUnits.filter((unit) =>
    params.requestedUnitIds?.includes(unit.id),
  );

  return {
    availableUnits,
    selectedUnits,
    selectedUnitIds: selectedUnits.map((unit) => unit.id),
  };
}

function getPeriodLabel(period: ReportPeriod) {
  switch (period) {
    case "7d":
      return "Últimos 7 dias";
    case "30d":
      return "Últimos 30 dias";
    case "90d":
      return "Últimos 90 dias";
    case "month":
      return "Mês atual";
    default:
      return "Últimos 30 dias";
  }
}

function buildScopeSummary(params: {
  selectedUnits: UnitSummary[];
  availableUnits: UnitSummary[];
}) {
  const unitsIncluded = params.selectedUnits.length;
  const isAllUnits = unitsIncluded === params.availableUnits.length;

  return {
    label: isAllUnits
      ? "Todas as unidades ativas"
      : `${unitsIncluded} unidade(s) selecionada(s)`,
    description: isAllUnits
      ? "Visão executiva consolidada para todas as unidades ativas acessíveis."
      : `Visão executiva filtrada para ${unitsIncluded} unidade(s) dentro do consolidado.`,
    unitsIncluded,
    isAllUnits,
  };
}

function getHealthStatus(params: {
  overdueNow: number;
  rejectedInPeriod: number;
  expiringStandardsSoon: number;
}): HealthStatus {
  if (params.overdueNow > 0) {
    return "critical";
  }

  if (params.rejectedInPeriod > 0 || params.expiringStandardsSoon > 0) {
    return "attention";
  }

  return "healthy";
}

function getHealthReason(params: {
  overdueNow: number;
  rejectedInPeriod: number;
  expiringStandardsSoon: number;
}) {
  if (params.overdueNow > 0) {
    return `${params.overdueNow} OS atrasada(s) em aberto`;
  }

  if (params.rejectedInPeriod > 0) {
    return `${params.rejectedInPeriod} rejeição(ões) no período`;
  }

  if (params.expiringStandardsSoon > 0) {
    return `${params.expiringStandardsSoon} padrão(ões) expirando em 30 dias`;
  }

  return "Operação sem alertas executivos no período";
}

export const reportsRouter = new Hono<{ Variables: AuthVariables }>()
  .get(
    "/consolidated/executive-overview",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireConsolidatedReportingAccess,
    zValidator("query", ReportQuerySchema),
    async (c) => {
      const memberData = c.get("member");
      const input = c.req.valid("query");
      const requestedUnitIds = parseRequestedUnitIds(input.unitIds);
      const range = resolvePeriodRange(input.period);

      try {
        const { availableUnits, selectedUnits, selectedUnitIds } =
          await resolveSelectedUnits({
            organizationId: memberData.organizationId,
            accessibleUnitIds: memberData.accessibleUnitIds,
            requestedUnitIds,
          });
        const scopeSummary = buildScopeSummary({
          selectedUnits,
          availableUnits,
        });

        if (selectedUnitIds.length === 0) {
          return c.json({
            period: range.period,
            label: getPeriodLabel(range.period),
            range: {
              startDate: range.startDate.toISOString(),
              endDate: range.endDate.toISOString(),
            },
            availableUnits,
            selectedUnits,
            scopeSummary,
            metrics: {
              pendingCalibrations: 0,
              approvedInPeriod: 0,
              rejectedInPeriod: 0,
              approvalRate: 0,
              overdueJobs: 0,
              expiringStandards: 0,
              unitsIncluded: 0,
              atRiskUnitsCount: 0,
            },
            highlights: {
              highestVolumeUnit: null,
              bestApprovalUnit: null,
              attentionUnit: null,
            },
          });
        }

        const buildGroupedJobCount = async (condition: SQL<unknown> | undefined) =>
          db
            .select({
              unitId: calibrationJob.unitId,
              value: sql<number>`count(*)`,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                condition,
              ),
            )
            .groupBy(calibrationJob.unitId);

        const buildGroupedStandardCount = async (condition: SQL<unknown> | undefined) =>
          db
            .select({
              unitId: referenceStandard.unitId,
              value: sql<number>`count(*)`,
            })
            .from(referenceStandard)
            .where(
              and(
                eq(referenceStandard.organizationId, memberData.organizationId),
                inArray(referenceStandard.unitId, selectedUnitIds),
                condition,
              ),
            )
            .groupBy(referenceStandard.unitId);

        const [
          pendingResult,
          approvedResult,
          rejectedResult,
          overdueResult,
          expiringStandardsResult,
          createdRows,
          approvedRows,
          rejectedRows,
          overdueRows,
          expiringRows,
        ] = await Promise.all([
          db
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                inArray(calibrationJob.status, OPEN_JOB_STATUSES),
              ),
            ),
          db
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                eq(calibrationJob.status, "APPROVED"),
                gte(calibrationJob.approvedAt, range.startDate),
              ),
            ),
          db
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                eq(calibrationJob.status, "REJECTED"),
                gte(calibrationJob.rejectedAt, range.startDate),
              ),
            ),
          db
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                lte(calibrationJob.dueDate, range.endDate),
                inArray(calibrationJob.status, OPEN_JOB_STATUSES),
              ),
            ),
          db
            .select({ count: count() })
            .from(referenceStandard)
            .where(
              and(
                eq(referenceStandard.organizationId, memberData.organizationId),
                inArray(referenceStandard.unitId, selectedUnitIds),
                eq(referenceStandard.status, "ACTIVE"),
                lte(
                  referenceStandard.nextCalibrationDate,
                  new Date(range.endDate.getTime() + 30 * 24 * 60 * 60 * 1000),
                ),
                gte(referenceStandard.nextCalibrationDate, range.endDate),
              ),
            ),
          buildGroupedJobCount(gte(calibrationJob.createdAt, range.startDate)),
          buildGroupedJobCount(
            and(
              eq(calibrationJob.status, "APPROVED"),
              gte(calibrationJob.approvedAt, range.startDate),
            ),
          ),
          buildGroupedJobCount(
            and(
              eq(calibrationJob.status, "REJECTED"),
              gte(calibrationJob.rejectedAt, range.startDate),
            ),
          ),
          buildGroupedJobCount(
            and(
              inArray(calibrationJob.status, OPEN_JOB_STATUSES),
              lte(calibrationJob.dueDate, range.endDate),
            ),
          ),
          buildGroupedStandardCount(
            and(
              eq(referenceStandard.status, "ACTIVE"),
              lte(
                referenceStandard.nextCalibrationDate,
                new Date(range.endDate.getTime() + 30 * 24 * 60 * 60 * 1000),
              ),
              gte(referenceStandard.nextCalibrationDate, range.endDate),
            ),
          ),
        ]);

        const approvedInPeriod = approvedResult[0]?.count ?? 0;
        const rejectedInPeriod = rejectedResult[0]?.count ?? 0;
        const totalDecisions = approvedInPeriod + rejectedInPeriod;

        const createdByUnit = mapCountsByUnit(createdRows);
        const approvedByUnit = mapCountsByUnit(approvedRows);
        const rejectedByUnit = mapCountsByUnit(rejectedRows);
        const overdueByUnit = mapCountsByUnit(overdueRows);
        const expiringByUnit = mapCountsByUnit(expiringRows);

        const unitRows = selectedUnits.map((unit) => {
          const unitApproved = approvedByUnit.get(unit.id) ?? 0;
          const unitRejected = rejectedByUnit.get(unit.id) ?? 0;
          const unitOverdue = overdueByUnit.get(unit.id) ?? 0;
          const unitExpiring = expiringByUnit.get(unit.id) ?? 0;
          const unitTotalDecisions = unitApproved + unitRejected;
          const approvalRate =
            unitTotalDecisions > 0
              ? Math.round((unitApproved / unitTotalDecisions) * 1000) / 10
              : 0;
          const healthStatus = getHealthStatus({
            overdueNow: unitOverdue,
            rejectedInPeriod: unitRejected,
            expiringStandardsSoon: unitExpiring,
          });

          return {
            unitId: unit.id,
            unitName: unit.name,
            unitSlug: unit.slug,
            jobsCreatedInPeriod: createdByUnit.get(unit.id) ?? 0,
            approvedInPeriod: unitApproved,
            rejectedInPeriod: unitRejected,
            overdueNow: unitOverdue,
            expiringStandardsSoon: unitExpiring,
            approvalRate,
            healthStatus,
            healthReason: getHealthReason({
              overdueNow: unitOverdue,
              rejectedInPeriod: unitRejected,
              expiringStandardsSoon: unitExpiring,
            }),
          };
        });

        const highestVolumeUnit = [...unitRows].sort((left, right) => {
          if (right.jobsCreatedInPeriod !== left.jobsCreatedInPeriod) {
            return right.jobsCreatedInPeriod - left.jobsCreatedInPeriod;
          }

          return right.approvedInPeriod - left.approvedInPeriod;
        })[0] ?? null;

        const bestApprovalUnit = unitRows
          .filter((row) => row.approvedInPeriod + row.rejectedInPeriod > 0)
          .sort((left, right) => {
            if (right.approvalRate !== left.approvalRate) {
              return right.approvalRate - left.approvalRate;
            }

            return right.approvedInPeriod - left.approvedInPeriod;
          })[0] ?? null;

        const attentionUnit =
          unitRows
            .filter((row) => row.healthStatus !== "healthy")
            .sort((left, right) => {
              const severity = { critical: 2, attention: 1, healthy: 0 } as const;
              if (severity[right.healthStatus] !== severity[left.healthStatus]) {
                return severity[right.healthStatus] - severity[left.healthStatus];
              }
              if (right.overdueNow !== left.overdueNow) {
                return right.overdueNow - left.overdueNow;
              }
              return right.rejectedInPeriod - left.rejectedInPeriod;
            })[0] ?? null;

        return c.json({
          period: range.period,
          label: getPeriodLabel(range.period),
          range: {
            startDate: range.startDate.toISOString(),
            endDate: range.endDate.toISOString(),
          },
          availableUnits,
          selectedUnits,
          scopeSummary,
          metrics: {
            pendingCalibrations: pendingResult[0]?.count ?? 0,
            approvedInPeriod,
            rejectedInPeriod,
            approvalRate:
              totalDecisions > 0
                ? Math.round((approvedInPeriod / totalDecisions) * 1000) / 10
                : 0,
            overdueJobs: overdueResult[0]?.count ?? 0,
            expiringStandards: expiringStandardsResult[0]?.count ?? 0,
            unitsIncluded: scopeSummary.unitsIncluded,
            atRiskUnitsCount: unitRows.filter(
              (row) => row.healthStatus !== "healthy",
            ).length,
          },
          highlights: {
            highestVolumeUnit,
            bestApprovalUnit,
            attentionUnit,
          },
        });
      } catch (error) {
        if (error instanceof Error) {
          return c.json({ error: error.message }, 400);
        }

        return c.json({ error: "Falha ao carregar visão executiva consolidada" }, 500);
      }
    },
  )
  .get(
    "/consolidated/summary",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireConsolidatedReportingAccess,
    zValidator("query", ReportQuerySchema),
    async (c) => {
      const memberData = c.get("member");
      const input = c.req.valid("query");
      const requestedUnitIds = parseRequestedUnitIds(input.unitIds);
      const range = resolvePeriodRange(input.period);

      try {
        const { availableUnits, selectedUnits, selectedUnitIds } =
          await resolveSelectedUnits({
            organizationId: memberData.organizationId,
            accessibleUnitIds: memberData.accessibleUnitIds,
            requestedUnitIds,
          });

        if (selectedUnitIds.length === 0) {
          return c.json({
            period: range.period,
            label: getPeriodLabel(range.period),
            range: {
              startDate: range.startDate.toISOString(),
              endDate: range.endDate.toISOString(),
            },
            availableUnits,
            selectedUnits,
            metrics: {
              pendingCalibrations: 0,
              approvedInPeriod: 0,
              rejectedInPeriod: 0,
              approvalRate: 0,
              overdueJobs: 0,
              expiringStandards: 0,
            },
          });
        }

        const [
          pendingResult,
          approvedResult,
          rejectedResult,
          overdueResult,
          expiringStandardsResult,
        ] = await Promise.all([
          db
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                inArray(calibrationJob.status, OPEN_JOB_STATUSES),
              ),
            ),
          db
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                eq(calibrationJob.status, "APPROVED"),
                gte(calibrationJob.approvedAt, range.startDate),
              ),
            ),
          db
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                eq(calibrationJob.status, "REJECTED"),
                gte(calibrationJob.rejectedAt, range.startDate),
              ),
            ),
          db
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                lte(calibrationJob.dueDate, range.endDate),
                inArray(calibrationJob.status, OPEN_JOB_STATUSES),
              ),
            ),
          db
            .select({ count: count() })
            .from(referenceStandard)
            .where(
              and(
                eq(referenceStandard.organizationId, memberData.organizationId),
                inArray(referenceStandard.unitId, selectedUnitIds),
                eq(referenceStandard.status, "ACTIVE"),
                lte(referenceStandard.nextCalibrationDate, new Date(range.endDate.getTime() + 30 * 24 * 60 * 60 * 1000)),
                gte(referenceStandard.nextCalibrationDate, range.endDate),
              ),
            ),
        ]);

        const approvedInPeriod = pendingResult ? approvedResult[0]?.count ?? 0 : 0;
        const rejectedInPeriod = rejectedResult[0]?.count ?? 0;
        const totalDecisions = approvedInPeriod + rejectedInPeriod;

        return c.json({
          period: range.period,
          label: getPeriodLabel(range.period),
          range: {
            startDate: range.startDate.toISOString(),
            endDate: range.endDate.toISOString(),
          },
          availableUnits,
          selectedUnits,
          metrics: {
            pendingCalibrations: pendingResult[0]?.count ?? 0,
            approvedInPeriod,
            rejectedInPeriod,
            approvalRate:
              totalDecisions > 0
                ? Math.round((approvedInPeriod / totalDecisions) * 1000) / 10
                : 0,
            overdueJobs: overdueResult[0]?.count ?? 0,
            expiringStandards: expiringStandardsResult[0]?.count ?? 0,
          },
        });
      } catch (error) {
        if (error instanceof Error) {
          return c.json({ error: error.message }, 400);
        }

        return c.json({ error: "Falha ao carregar resumo consolidado" }, 500);
      }
    },
  )
  .get(
    "/consolidated/comparison",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireConsolidatedReportingAccess,
    zValidator("query", ReportQuerySchema),
    async (c) => {
      const memberData = c.get("member");
      const input = c.req.valid("query");
      const requestedUnitIds = parseRequestedUnitIds(input.unitIds);
      const range = resolvePeriodRange(input.period);

      try {
        const { availableUnits, selectedUnits, selectedUnitIds } =
          await resolveSelectedUnits({
            organizationId: memberData.organizationId,
            accessibleUnitIds: memberData.accessibleUnitIds,
            requestedUnitIds,
          });

        if (selectedUnitIds.length === 0) {
          return c.json({
            period: range.period,
            label: getPeriodLabel(range.period),
            availableUnits,
            selectedUnits,
            rows: [],
          });
        }

        const buildGroupedCount = async (condition: SQL<unknown> | undefined) =>
          db
            .select({
              unitId: calibrationJob.unitId,
              value: sql<number>`count(*)`,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                condition,
              ),
            )
            .groupBy(calibrationJob.unitId);

        const buildGroupedStandardCount = async (condition: SQL<unknown> | undefined) =>
          db
            .select({
              unitId: referenceStandard.unitId,
              value: sql<number>`count(*)`,
            })
            .from(referenceStandard)
            .where(
              and(
                eq(referenceStandard.organizationId, memberData.organizationId),
                inArray(referenceStandard.unitId, selectedUnitIds),
                condition,
              ),
            )
            .groupBy(referenceStandard.unitId);

        const [
          createdRows,
          approvedRows,
          rejectedRows,
          pendingRows,
          overdueRows,
          expiringRows,
        ] = await Promise.all([
          buildGroupedCount(gte(calibrationJob.createdAt, range.startDate)),
          buildGroupedCount(
            and(
              eq(calibrationJob.status, "APPROVED"),
              gte(calibrationJob.approvedAt, range.startDate),
            ),
          ),
          buildGroupedCount(
            and(
              eq(calibrationJob.status, "REJECTED"),
              gte(calibrationJob.rejectedAt, range.startDate),
            ),
          ),
          buildGroupedCount(inArray(calibrationJob.status, OPEN_JOB_STATUSES)),
          buildGroupedCount(
            and(
              inArray(calibrationJob.status, OPEN_JOB_STATUSES),
              lte(calibrationJob.dueDate, range.endDate),
            ),
          ),
          buildGroupedStandardCount(
            and(
              eq(referenceStandard.status, "ACTIVE"),
              lte(
                referenceStandard.nextCalibrationDate,
                new Date(range.endDate.getTime() + 30 * 24 * 60 * 60 * 1000),
              ),
              gte(referenceStandard.nextCalibrationDate, range.endDate),
            ),
          ),
        ]);

        const createdByUnit = mapCountsByUnit(createdRows);
        const approvedByUnit = mapCountsByUnit(approvedRows);
        const rejectedByUnit = mapCountsByUnit(rejectedRows);
        const pendingByUnit = mapCountsByUnit(pendingRows);
        const overdueByUnit = mapCountsByUnit(overdueRows);
        const expiringByUnit = mapCountsByUnit(expiringRows);

        return c.json({
          period: range.period,
          label: getPeriodLabel(range.period),
          availableUnits,
          selectedUnits,
          rows: selectedUnits.map((unit) => {
            const approvedInPeriod = approvedByUnit.get(unit.id) ?? 0;
            const rejectedInPeriod = rejectedByUnit.get(unit.id) ?? 0;
            const overdueNow = overdueByUnit.get(unit.id) ?? 0;
            const expiringStandardsSoon = expiringByUnit.get(unit.id) ?? 0;
            const totalDecisions = approvedInPeriod + rejectedInPeriod;
            const healthStatus = getHealthStatus({
              overdueNow,
              rejectedInPeriod,
              expiringStandardsSoon,
            });

            return {
              unitId: unit.id,
              unitName: unit.name,
              unitSlug: unit.slug,
              jobsCreatedInPeriod: createdByUnit.get(unit.id) ?? 0,
              approvedInPeriod,
              rejectedInPeriod,
              pendingNow: pendingByUnit.get(unit.id) ?? 0,
              overdueNow,
              expiringStandardsSoon,
              approvalRate:
                totalDecisions > 0
                  ? Math.round((approvedInPeriod / totalDecisions) * 1000) / 10
                  : 0,
              healthStatus,
              healthReason: getHealthReason({
                overdueNow,
                rejectedInPeriod,
                expiringStandardsSoon,
              }),
            };
          }),
        });
      } catch (error) {
        if (error instanceof Error) {
          return c.json({ error: error.message }, 400);
        }

        return c.json({ error: "Falha ao carregar comparativo por unidade" }, 500);
      }
    },
  )
  .get(
    "/consolidated/trend",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireConsolidatedReportingAccess,
    zValidator("query", ReportQuerySchema),
    async (c) => {
      const memberData = c.get("member");
      const input = c.req.valid("query");
      const requestedUnitIds = parseRequestedUnitIds(input.unitIds);
      const range = resolvePeriodRange(input.period);

      try {
        const { availableUnits, selectedUnits, selectedUnitIds } =
          await resolveSelectedUnits({
            organizationId: memberData.organizationId,
            accessibleUnitIds: memberData.accessibleUnitIds,
            requestedUnitIds,
          });

        if (selectedUnitIds.length === 0) {
          return c.json({
            period: range.period,
            label: getPeriodLabel(range.period),
            availableUnits,
            selectedUnits,
            data: [],
          });
        }

        const rows = getExecuteRows<{
          date: string;
          approved: string;
          rejected: string;
        }>(await db.execute(sql`
          SELECT
            DATE(COALESCE(approved_at, rejected_at)) as date,
            COUNT(*) FILTER (WHERE status = 'APPROVED') as approved,
            COUNT(*) FILTER (WHERE status = 'REJECTED') as rejected
          FROM calibration_job
          WHERE organization_id = ${memberData.organizationId}
            AND unit_id IN (${sql.join(
              selectedUnitIds.map((id) => sql`${id}`),
              sql`, `,
            )})
            AND (
              (status = 'APPROVED' AND approved_at >= ${range.startDate.toISOString()})
              OR (status = 'REJECTED' AND rejected_at >= ${range.startDate.toISOString()})
            )
          GROUP BY DATE(COALESCE(approved_at, rejected_at))
          ORDER BY date ASC
        `));

        return c.json({
          period: range.period,
          label: getPeriodLabel(range.period),
          availableUnits,
          selectedUnits,
          data: rows.map((row) => ({
            date: row.date,
            approved: Number.parseInt(row.approved, 10) || 0,
            rejected: Number.parseInt(row.rejected, 10) || 0,
          })),
        });
      } catch (error) {
        if (error instanceof Error) {
          return c.json({ error: error.message }, 400);
        }

        return c.json({ error: "Falha ao carregar tendência consolidada" }, 500);
      }
    },
  );
