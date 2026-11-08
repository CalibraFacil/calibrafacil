import { createRouter } from "../../../../server/router";
import { zValidator } from "@hono/zod-validator";
import { organizationUnit } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { addCalendarDays, labToday } from "@calibra-facil/shared";
import { requireApiScope } from "../../../../middleware/api-key-auth";
import { type PublicApiV2Env } from "./env";
import { ReportQuerySchema } from "./schemas";
import {
  buildReportScopeSummary,
  getHealthReason,
  getHealthStatus,
  getPeriodLabel,
  parseRequestedUnitIds,
  readConsolidatedUnitCounts,
  resolvePeriodRange,
  sumCounts,
  type ConsolidatedCutoffs,
} from "../../../reports";
import { orgDb } from "../../../../lib/org-db";

/**
 * The public API answers "overdue" and "expiring" by laboratory calendar day: an open job is
 * overdue when its due date is before today, a standard is expiring when its next calibration
 * is within 30 days of today (a lapsed one included, whatever its status). The laboratory's
 * own reports measure against the window's end instead; the queries are the same ones
 * (`reports/consolidated-counts.ts`), only these cut-offs differ.
 */
function v2Cutoffs(
  range: ReturnType<typeof resolvePeriodRange>,
): ConsolidatedCutoffs {
  return {
    startDate: range.startDate,
    overdueBefore: labToday(),
    expiring: {
      from: null,
      until: addCalendarDays(labToday(), 30),
      activeOnly: false,
    },
  };
}

export const reportRoutes = createRouter<PublicApiV2Env>()
  .get(
    "/reports/consolidated/executive-overview",
    requireApiScope("reports:read"),
    zValidator("query", ReportQuerySchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("query");
      const range = resolvePeriodRange(input.period);
      const requestedUnitIds = parseRequestedUnitIds(input.unitIds);

      const availableUnits = await orgDb(apiKey.organizationId).transaction(
        (o) =>
          o
            .select({
              id: organizationUnit.id,
              name: organizationUnit.name,
              slug: organizationUnit.slug,
            })
            .from(organizationUnit)
            .where(
              and(
                eq(organizationUnit.organizationId, apiKey.organizationId),
                eq(organizationUnit.status, "ACTIVE"),
              ),
            )
            .orderBy(organizationUnit.name),
      );

      const selectedUnits = requestedUnitIds
        ? availableUnits.filter((unit) => requestedUnitIds.includes(unit.id))
        : availableUnits;
      const selectedUnitIds = selectedUnits.map((unit) => unit.id);
      const scopeSummary = buildReportScopeSummary({
        selectedUnits,
        availableUnits,
      });

      if (selectedUnitIds.length === 0) {
        return c.json({
          data: {
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
          },
        });
      }

      const counts = await orgDb(apiKey.organizationId).transaction((o) =>
        readConsolidatedUnitCounts(o, {
          organizationId: apiKey.organizationId,
          unitIds: selectedUnitIds,
          cutoffs: v2Cutoffs(range),
        }),
      );
      const createdByUnit = counts.createdInPeriod;
      const approvedByUnit = counts.approvedInPeriod;
      const rejectedByUnit = counts.rejectedInPeriod;
      const overdueByUnit = counts.overdueNow;
      const expiringByUnit = counts.expiringStandardsSoon;
      const approvedTotal = sumCounts(approvedByUnit);
      const rejectedTotal = sumCounts(rejectedByUnit);

      const comparison = selectedUnits.map((unit) => {
        const created = createdByUnit.get(unit.id) ?? 0;
        const approved = approvedByUnit.get(unit.id) ?? 0;
        const rejected = rejectedByUnit.get(unit.id) ?? 0;
        const overdue = overdueByUnit.get(unit.id) ?? 0;
        const expiring = expiringByUnit.get(unit.id) ?? 0;
        const approvalRate =
          created > 0 ? Math.round((approved / created) * 100) : 0;
        const healthStatus = getHealthStatus({
          overdueNow: overdue,
          rejectedInPeriod: rejected,
          expiringStandardsSoon: expiring,
        });

        return {
          unit,
          createdInPeriod: created,
          approvedInPeriod: approved,
          rejectedInPeriod: rejected,
          overdueNow: overdue,
          expiringStandardsSoon: expiring,
          approvalRate,
          healthStatus,
          healthReason: getHealthReason({
            overdueNow: overdue,
            rejectedInPeriod: rejected,
            expiringStandardsSoon: expiring,
          }),
        };
      });

      const attentionCandidates = comparison.filter(
        (row) => row.healthStatus !== "healthy",
      );
      const highestVolumeUnit =
        [...comparison].sort(
          (a, b) => b.createdInPeriod - a.createdInPeriod,
        )[0] ?? null;
      const bestApprovalUnit =
        [...comparison].sort((a, b) => b.approvalRate - a.approvalRate)[0] ??
        null;
      const attentionUnit =
        [...attentionCandidates].sort((a, b) => {
          const severity = (status: string) =>
            status === "critical" ? 2 : status === "attention" ? 1 : 0;
          return (
            severity(b.healthStatus) - severity(a.healthStatus) ||
            b.rejectedInPeriod - a.rejectedInPeriod ||
            a.approvalRate - b.approvalRate
          );
        })[0] ?? null;

      return c.json({
        data: {
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
            approvedInPeriod: approvedTotal,
            rejectedInPeriod: rejectedTotal,
            approvalRate:
              approvedTotal + rejectedTotal > 0
                ? Math.round(
                    (approvedTotal / (approvedTotal + rejectedTotal)) * 100,
                  )
                : 0,
            overdueJobs: sumCounts(counts.overdueNow),
            expiringStandards: sumCounts(counts.expiringStandardsSoon),
            unitsIncluded: selectedUnits.length,
            atRiskUnitsCount: comparison.filter(
              (row) => row.healthStatus !== "healthy",
            ).length,
          },
          highlights: {
            highestVolumeUnit,
            bestApprovalUnit,
            attentionUnit,
          },
        },
      });
    },
  )
  .get(
    "/reports/consolidated/comparison",
    requireApiScope("reports:read"),
    zValidator("query", ReportQuerySchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("query");
      const range = resolvePeriodRange(input.period);
      const requestedUnitIds = parseRequestedUnitIds(input.unitIds);

      const availableUnits = await orgDb(apiKey.organizationId).transaction(
        (o) =>
          o
            .select({
              id: organizationUnit.id,
              name: organizationUnit.name,
              slug: organizationUnit.slug,
            })
            .from(organizationUnit)
            .where(
              and(
                eq(organizationUnit.organizationId, apiKey.organizationId),
                eq(organizationUnit.status, "ACTIVE"),
              ),
            )
            .orderBy(organizationUnit.name),
      );

      const selectedUnits = requestedUnitIds
        ? availableUnits.filter((unit) => requestedUnitIds.includes(unit.id))
        : availableUnits;
      const selectedUnitIds = selectedUnits.map((unit) => unit.id);

      if (selectedUnitIds.length === 0) {
        return c.json({ data: [] });
      }

      const counts = await orgDb(apiKey.organizationId).transaction((o) =>
        readConsolidatedUnitCounts(o, {
          organizationId: apiKey.organizationId,
          unitIds: selectedUnitIds,
          cutoffs: v2Cutoffs(range),
        }),
      );
      const createdByUnit = counts.createdInPeriod;
      const approvedByUnit = counts.approvedInPeriod;
      const rejectedByUnit = counts.rejectedInPeriod;
      const overdueByUnit = counts.overdueNow;
      const expiringByUnit = counts.expiringStandardsSoon;

      return c.json({
        data: selectedUnits.map((unit) => {
          const created = createdByUnit.get(unit.id) ?? 0;
          const approved = approvedByUnit.get(unit.id) ?? 0;
          const rejected = rejectedByUnit.get(unit.id) ?? 0;
          const overdue = overdueByUnit.get(unit.id) ?? 0;
          const expiring = expiringByUnit.get(unit.id) ?? 0;
          return {
            unit,
            createdInPeriod: created,
            approvedInPeriod: approved,
            rejectedInPeriod: rejected,
            approvalRate:
              created > 0 ? Math.round((approved / created) * 100) : 0,
            overdueNow: overdue,
            expiringStandardsSoon: expiring,
            healthStatus: getHealthStatus({
              overdueNow: overdue,
              rejectedInPeriod: rejected,
              expiringStandardsSoon: expiring,
            }),
            healthReason: getHealthReason({
              overdueNow: overdue,
              rejectedInPeriod: rejected,
              expiringStandardsSoon: expiring,
            }),
          };
        }),
      });
    },
  );
