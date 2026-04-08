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

const ReportQuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d", "month"]).optional().default("30d"),
  unitIds: z.string().optional(),
});

type ReportPeriod = z.infer<typeof ReportQuerySchema>["period"];

const OPEN_JOB_STATUSES = ["DRAFT", "IN_PROGRESS", "REVIEW"] as const;

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

export const reportsRouter = new Hono<{ Variables: AuthVariables }>()
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

        const [
          createdRows,
          approvedRows,
          rejectedRows,
          pendingRows,
          overdueRows,
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
        ]);

        const createdByUnit = mapCountsByUnit(createdRows);
        const approvedByUnit = mapCountsByUnit(approvedRows);
        const rejectedByUnit = mapCountsByUnit(rejectedRows);
        const pendingByUnit = mapCountsByUnit(pendingRows);
        const overdueByUnit = mapCountsByUnit(overdueRows);

        return c.json({
          period: range.period,
          label: getPeriodLabel(range.period),
          availableUnits,
          selectedUnits,
          rows: selectedUnits.map((unit) => {
            const approvedInPeriod = approvedByUnit.get(unit.id) ?? 0;
            const rejectedInPeriod = rejectedByUnit.get(unit.id) ?? 0;
            const totalDecisions = approvedInPeriod + rejectedInPeriod;

            return {
              unitId: unit.id,
              unitName: unit.name,
              unitSlug: unit.slug,
              jobsCreatedInPeriod: createdByUnit.get(unit.id) ?? 0,
              approvedInPeriod,
              rejectedInPeriod,
              pendingNow: pendingByUnit.get(unit.id) ?? 0,
              overdueNow: overdueByUnit.get(unit.id) ?? 0,
              approvalRate:
                totalDecisions > 0
                  ? Math.round((approvedInPeriod / totalDecisions) * 1000) / 10
                  : 0,
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

        const rows = (await db.execute(sql`
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
        `)) as unknown as Array<{
          date: string;
          approved: string;
          rejected: string;
        }>;

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
