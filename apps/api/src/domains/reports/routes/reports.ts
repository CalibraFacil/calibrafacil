import { createRouter } from "../../../server/router";
import { ReportQuerySchema, reportEndpoints } from "@calibra-facil/contracts";
import { OPEN_JOB_STATUSES } from "@calibra-facil/schemas";
import { createMiddleware } from "hono/factory";
import { zValidator } from "@hono/zod-validator";
import {
  calibrationJob,
  organizationUnit,
  referenceStandard,
} from "@calibra-facil/db/schema";
import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  type AuthVariables,
  getGovernanceAccess,
  requireLabProtected,
  requireOrgType,
} from "../../../middleware/permission";
import { forbidden, invalid } from "../../../lib/domain-errors";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import type { OrgDb } from "@calibra-facil/db/for-org";
import { resolvePeriodRange } from "../report-period";
import {
  buildReportScopeSummary,
  getHealthReason,
  getHealthStatus,
  getPeriodLabel,
  parseRequestedUnitIds,
} from "../report-support";

type UnitSummary = {
  id: number;
  name: string;
  slug: string;
};

function mapCountsByUnit<
  T extends { unitId: number | null; value: number | string },
>(rows: T[]) {
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
    throw forbidden(
      "forbidden",
      "Apenas administradores globais podem acessar relatórios consolidados",
    );
  }

  await next();
});

async function resolveSelectedUnits(params: {
  executor: OrgDb;
  organizationId: string;
  accessibleUnitIds: number[];
  requestedUnitIds: number[] | null;
}) {
  const availableUnits = await params.executor
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
    const emptyUnits: UnitSummary[] = [];
    const emptyUnitIds: number[] = [];

    return {
      availableUnits: emptyUnits,
      selectedUnits: emptyUnits,
      selectedUnitIds: emptyUnitIds,
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
    throw invalid(
      "invalid_request",
      "Uma ou mais unidades estão fora do escopo permitido",
    );
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

const PREFIX = "/api/reports";

export const reportsRouter = createRouter<{ Variables: AuthVariables }>();

mount(
  reportsRouter,
  PREFIX,
  reportEndpoints.getExecutiveOverview,
  [
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireConsolidatedReportingAccess,
  ],
  async (c, { query: input }) => {
    return orgDb(c.get("member").organizationId).transaction(async (o) => {
      const memberData = c.get("member");
      const requestedUnitIds = parseRequestedUnitIds(input.unitIds);
      const range = resolvePeriodRange(input.period);

      const { availableUnits, selectedUnits, selectedUnitIds } =
        await resolveSelectedUnits({
          executor: o,
          organizationId: memberData.organizationId,
          accessibleUnitIds: memberData.accessibleUnitIds,
          requestedUnitIds,
        });
      const scopeSummary = buildReportScopeSummary({
        selectedUnits,
        availableUnits,
      });

      if (selectedUnitIds.length === 0) {
        return {
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
        };
      }

      const buildGroupedJobCount = async (
        condition: SQL<unknown> | undefined,
      ) =>
        o
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

      const buildGroupedStandardCount = async (
        condition: SQL<unknown> | undefined,
      ) =>
        o
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
        o
          .select({ count: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, memberData.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              inArray(calibrationJob.status, OPEN_JOB_STATUSES),
            ),
          ),
        o
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
        o
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
        o
          .select({ count: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, memberData.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              lt(calibrationJob.dueDate, range.endDate),
              inArray(calibrationJob.status, OPEN_JOB_STATUSES),
            ),
          ),
        o
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
            lt(calibrationJob.dueDate, range.endDate),
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

      const highestVolumeUnit =
        [...unitRows].sort((left, right) => {
          if (right.jobsCreatedInPeriod !== left.jobsCreatedInPeriod) {
            return right.jobsCreatedInPeriod - left.jobsCreatedInPeriod;
          }

          return right.approvedInPeriod - left.approvedInPeriod;
        })[0] ?? null;

      const bestApprovalUnit =
        unitRows
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
            const severity = {
              critical: 2,
              attention: 1,
              healthy: 0,
            } as const;
            if (severity[right.healthStatus] !== severity[left.healthStatus]) {
              return severity[right.healthStatus] - severity[left.healthStatus];
            }
            if (right.overdueNow !== left.overdueNow) {
              return right.overdueNow - left.overdueNow;
            }
            return right.rejectedInPeriod - left.rejectedInPeriod;
          })[0] ?? null;

      return {
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
      };
    });
  },
);

// GET /consolidated/summary: no SDK method calls it, so no endpoint definition.
reportsRouter.get(
  "/consolidated/summary",
  ...requireLabProtected,
  requireOrgType("LAB"),
  requireConsolidatedReportingAccess,
  zValidator("query", ReportQuerySchema),
  async (c) => {
    return orgDb(c.get("member").organizationId).transaction(async (o) => {
      const memberData = c.get("member");
      const input = c.req.valid("query");
      const requestedUnitIds = parseRequestedUnitIds(input.unitIds);
      const range = resolvePeriodRange(input.period);

      const { availableUnits, selectedUnits, selectedUnitIds } =
        await resolveSelectedUnits({
          executor: o,
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
        o
          .select({ count: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, memberData.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              inArray(calibrationJob.status, OPEN_JOB_STATUSES),
            ),
          ),
        o
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
        o
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
        o
          .select({ count: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, memberData.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              lt(calibrationJob.dueDate, range.endDate),
              inArray(calibrationJob.status, OPEN_JOB_STATUSES),
            ),
          ),
        o
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
      ]);

      const approvedInPeriod = pendingResult
        ? (approvedResult[0]?.count ?? 0)
        : 0;
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
    });
  },
);

mount(
  reportsRouter,
  PREFIX,
  reportEndpoints.getComparison,
  [
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireConsolidatedReportingAccess,
  ],
  async (c, { query: input }) => {
    return orgDb(c.get("member").organizationId).transaction(async (o) => {
      const memberData = c.get("member");
      const requestedUnitIds = parseRequestedUnitIds(input.unitIds);
      const range = resolvePeriodRange(input.period);

      const { availableUnits, selectedUnits, selectedUnitIds } =
        await resolveSelectedUnits({
          executor: o,
          organizationId: memberData.organizationId,
          accessibleUnitIds: memberData.accessibleUnitIds,
          requestedUnitIds,
        });

      if (selectedUnitIds.length === 0) {
        return {
          period: range.period,
          label: getPeriodLabel(range.period),
          availableUnits,
          selectedUnits,
          rows: [],
        };
      }

      const buildGroupedCount = async (condition: SQL<unknown> | undefined) =>
        o
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

      const buildGroupedStandardCount = async (
        condition: SQL<unknown> | undefined,
      ) =>
        o
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
            lt(calibrationJob.dueDate, range.endDate),
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

      return {
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
      };
    });
  },
);

mount(
  reportsRouter,
  PREFIX,
  reportEndpoints.getTrend,
  [
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireConsolidatedReportingAccess,
  ],
  async (c, { query: input }) => {
    return orgDb(c.get("member").organizationId).transaction(async (o) => {
      const memberData = c.get("member");
      const requestedUnitIds = parseRequestedUnitIds(input.unitIds);
      const range = resolvePeriodRange(input.period);

      const { availableUnits, selectedUnits, selectedUnitIds } =
        await resolveSelectedUnits({
          executor: o,
          organizationId: memberData.organizationId,
          accessibleUnitIds: memberData.accessibleUnitIds,
          requestedUnitIds,
        });

      if (selectedUnitIds.length === 0) {
        return {
          period: range.period,
          label: getPeriodLabel(range.period),
          availableUnits,
          selectedUnits,
          data: [],
        };
      }

      const trendDay = sql`DATE(COALESCE(approved_at, rejected_at))`;
      const rows = await o
        .select({
          date: sql<string>`${trendDay}`,
          approved: sql<string>`COUNT(*) FILTER (WHERE ${calibrationJob.status} = 'APPROVED')`,
          rejected: sql<string>`COUNT(*) FILTER (WHERE ${calibrationJob.status} = 'REJECTED')`,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.organizationId, memberData.organizationId),
            inArray(calibrationJob.unitId, selectedUnitIds),
            or(
              and(
                eq(calibrationJob.status, "APPROVED"),
                gte(calibrationJob.approvedAt, range.startDate),
              ),
              and(
                eq(calibrationJob.status, "REJECTED"),
                gte(calibrationJob.rejectedAt, range.startDate),
              ),
            ),
          ),
        )
        .groupBy(trendDay)
        .orderBy(asc(trendDay));

      return {
        period: range.period,
        label: getPeriodLabel(range.period),
        availableUnits,
        selectedUnits,
        data: rows.map((row) => ({
          date: row.date,
          approved: Number.parseInt(row.approved, 10) || 0,
          rejected: Number.parseInt(row.rejected, 10) || 0,
        })),
      };
    });
  },
);
