import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  calibrationJob,
  organizationUnit,
  referenceStandard,
} from "@calibra-facil/db/schema";
import { and, count, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { addCalendarDays, labToday } from "@calibra-facil/shared";
import { requireApiScope } from "../../middleware/api-key-auth";
import { type PublicApiV2Env } from "./env";
import { ReportQuerySchema } from "./schemas";
import {
  buildReportScopeSummary,
  getHealthReason,
  getHealthStatus,
  getPeriodLabel,
  parseRequestedUnitIds,
  resolvePeriodRange,
} from "./report-support";
import { orgDb } from "../../lib/org-db";

export const reportRoutes = new Hono<PublicApiV2Env>()
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
      ] = await orgDb(apiKey.organizationId).transaction((o) =>
        Promise.all([
          o
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, apiKey.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                inArray(calibrationJob.status, [
                  "DRAFT",
                  "IN_PROGRESS",
                  "REVIEW",
                ]),
              ),
            ),
          o
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, apiKey.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                eq(calibrationJob.status, "APPROVED"),
                sql`${calibrationJob.approvedAt} >= ${range.startDate}`,
              ),
            ),
          o
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, apiKey.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                eq(calibrationJob.status, "REJECTED"),
                sql`${calibrationJob.rejectedAt} >= ${range.startDate}`,
              ),
            ),
          o
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, apiKey.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                inArray(calibrationJob.status, [
                  "DRAFT",
                  "IN_PROGRESS",
                  "REVIEW",
                ]),
                lt(calibrationJob.dueDate, labToday()),
              ),
            ),
          o
            .select({ count: count() })
            .from(referenceStandard)
            .where(
              and(
                eq(referenceStandard.organizationId, apiKey.organizationId),
                inArray(referenceStandard.unitId, selectedUnitIds),
                lte(
                  referenceStandard.nextCalibrationDate,
                  addCalendarDays(labToday(), 30),
                ),
              ),
            ),
          o
            .select({
              unitId: calibrationJob.unitId,
              value: sql<number>`count(*)`,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, apiKey.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                sql`${calibrationJob.createdAt} >= ${range.startDate}`,
              ),
            )
            .groupBy(calibrationJob.unitId),
          o
            .select({
              unitId: calibrationJob.unitId,
              value: sql<number>`count(*)`,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, apiKey.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                eq(calibrationJob.status, "APPROVED"),
                sql`${calibrationJob.approvedAt} >= ${range.startDate}`,
              ),
            )
            .groupBy(calibrationJob.unitId),
          o
            .select({
              unitId: calibrationJob.unitId,
              value: sql<number>`count(*)`,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, apiKey.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                eq(calibrationJob.status, "REJECTED"),
                sql`${calibrationJob.rejectedAt} >= ${range.startDate}`,
              ),
            )
            .groupBy(calibrationJob.unitId),
          o
            .select({
              unitId: calibrationJob.unitId,
              value: sql<number>`count(*)`,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, apiKey.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                inArray(calibrationJob.status, [
                  "DRAFT",
                  "IN_PROGRESS",
                  "REVIEW",
                ]),
                lt(calibrationJob.dueDate, labToday()),
              ),
            )
            .groupBy(calibrationJob.unitId),
          o
            .select({
              unitId: referenceStandard.unitId,
              value: sql<number>`count(*)`,
            })
            .from(referenceStandard)
            .where(
              and(
                eq(referenceStandard.organizationId, apiKey.organizationId),
                inArray(referenceStandard.unitId, selectedUnitIds),
                lte(
                  referenceStandard.nextCalibrationDate,
                  addCalendarDays(labToday(), 30),
                ),
              ),
            )
            .groupBy(referenceStandard.unitId),
        ]),
      );

      const createdByUnit = new Map(
        createdRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const approvedByUnit = new Map(
        approvedRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const rejectedByUnit = new Map(
        rejectedRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const overdueByUnit = new Map(
        overdueRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const expiringByUnit = new Map(
        expiringRows.map((row) => [row.unitId, Number(row.value)]),
      );

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
            pendingCalibrations: pendingResult[0]?.count ?? 0,
            approvedInPeriod: approvedResult[0]?.count ?? 0,
            rejectedInPeriod: rejectedResult[0]?.count ?? 0,
            approvalRate:
              (approvedResult[0]?.count ?? 0) +
                (rejectedResult[0]?.count ?? 0) >
              0
                ? Math.round(
                    ((approvedResult[0]?.count ?? 0) /
                      ((approvedResult[0]?.count ?? 0) +
                        (rejectedResult[0]?.count ?? 0))) *
                      100,
                  )
                : 0,
            overdueJobs: overdueResult[0]?.count ?? 0,
            expiringStandards: expiringStandardsResult[0]?.count ?? 0,
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

      const [
        createdRows,
        approvedRows,
        rejectedRows,
        overdueRows,
        expiringRows,
      ] = await orgDb(apiKey.organizationId).transaction((o) =>
        Promise.all([
          o
            .select({
              unitId: calibrationJob.unitId,
              value: sql<number>`count(*)`,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, apiKey.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                sql`${calibrationJob.createdAt} >= ${range.startDate}`,
              ),
            )
            .groupBy(calibrationJob.unitId),
          o
            .select({
              unitId: calibrationJob.unitId,
              value: sql<number>`count(*)`,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, apiKey.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                eq(calibrationJob.status, "APPROVED"),
                sql`${calibrationJob.approvedAt} >= ${range.startDate}`,
              ),
            )
            .groupBy(calibrationJob.unitId),
          o
            .select({
              unitId: calibrationJob.unitId,
              value: sql<number>`count(*)`,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, apiKey.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                eq(calibrationJob.status, "REJECTED"),
                sql`${calibrationJob.rejectedAt} >= ${range.startDate}`,
              ),
            )
            .groupBy(calibrationJob.unitId),
          o
            .select({
              unitId: calibrationJob.unitId,
              value: sql<number>`count(*)`,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, apiKey.organizationId),
                inArray(calibrationJob.unitId, selectedUnitIds),
                inArray(calibrationJob.status, [
                  "DRAFT",
                  "IN_PROGRESS",
                  "REVIEW",
                ]),
                lt(calibrationJob.dueDate, labToday()),
              ),
            )
            .groupBy(calibrationJob.unitId),
          o
            .select({
              unitId: referenceStandard.unitId,
              value: sql<number>`count(*)`,
            })
            .from(referenceStandard)
            .where(
              and(
                eq(referenceStandard.organizationId, apiKey.organizationId),
                inArray(referenceStandard.unitId, selectedUnitIds),
                lte(
                  referenceStandard.nextCalibrationDate,
                  addCalendarDays(labToday(), 30),
                ),
              ),
            )
            .groupBy(referenceStandard.unitId),
        ]),
      );

      const createdByUnit = new Map(
        createdRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const approvedByUnit = new Map(
        approvedRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const rejectedByUnit = new Map(
        rejectedRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const overdueByUnit = new Map(
        overdueRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const expiringByUnit = new Map(
        expiringRows.map((row) => [row.unitId, Number(row.value)]),
      );

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
