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
import {
  type ConsolidatedCutoffs,
  readConsolidatedUnitCounts,
  sumCounts,
} from "../consolidated-counts";
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

/**
 * The laboratory's reports measure against the report window's end (now): a job is overdue
 * when its due date is before it, a standard is expiring when it is ACTIVE and its next
 * calibration falls in the 30 days after it. (Public API v2 answers both by laboratory
 * calendar day instead; see `domains/public-api/routes/public-api-v2/reports.ts`.)
 */
function labCutoffs(range: ReturnType<typeof resolvePeriodRange>) {
  return {
    startDate: range.startDate,
    overdueBefore: range.endDate,
    expiring: {
      from: range.endDate,
      until: new Date(range.endDate.getTime() + 30 * 24 * 60 * 60 * 1000),
      activeOnly: true,
    },
  } satisfies ConsolidatedCutoffs;
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

      const counts = await readConsolidatedUnitCounts(o, {
        organizationId: memberData.organizationId,
        unitIds: selectedUnitIds,
        cutoffs: labCutoffs(range),
      });
      const approvedInPeriod = sumCounts(counts.approvedInPeriod);
      const rejectedInPeriod = sumCounts(counts.rejectedInPeriod);
      const totalDecisions = approvedInPeriod + rejectedInPeriod;

      const createdByUnit = counts.createdInPeriod;
      const approvedByUnit = counts.approvedInPeriod;
      const rejectedByUnit = counts.rejectedInPeriod;
      const overdueByUnit = counts.overdueNow;
      const expiringByUnit = counts.expiringStandardsSoon;

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
          pendingCalibrations: sumCounts(counts.pendingNow),
          approvedInPeriod,
          rejectedInPeriod,
          approvalRate:
            totalDecisions > 0
              ? Math.round((approvedInPeriod / totalDecisions) * 1000) / 10
              : 0,
          overdueJobs: sumCounts(counts.overdueNow),
          expiringStandards: sumCounts(counts.expiringStandardsSoon),
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

      const counts = await readConsolidatedUnitCounts(o, {
        organizationId: memberData.organizationId,
        unitIds: selectedUnitIds,
        cutoffs: labCutoffs(range),
      });
      const approvedInPeriod = sumCounts(counts.approvedInPeriod);
      const rejectedInPeriod = sumCounts(counts.rejectedInPeriod);
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
          pendingCalibrations: sumCounts(counts.pendingNow),
          approvedInPeriod,
          rejectedInPeriod,
          approvalRate:
            totalDecisions > 0
              ? Math.round((approvedInPeriod / totalDecisions) * 1000) / 10
              : 0,
          overdueJobs: sumCounts(counts.overdueNow),
          expiringStandards: sumCounts(counts.expiringStandardsSoon),
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

      const counts = await readConsolidatedUnitCounts(o, {
        organizationId: memberData.organizationId,
        unitIds: selectedUnitIds,
        cutoffs: labCutoffs(range),
      });
      const createdByUnit = counts.createdInPeriod;
      const approvedByUnit = counts.approvedInPeriod;
      const rejectedByUnit = counts.rejectedInPeriod;
      const pendingByUnit = counts.pendingNow;
      const overdueByUnit = counts.overdueNow;
      const expiringByUnit = counts.expiringStandardsSoon;

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
