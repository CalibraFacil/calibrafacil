import { Hono } from "hono";
import { LAB_TIME_ZONE } from "@calibra-facil/documents";
import { isCalendarDatePast } from "@calibra-facil/shared";
import {
  calibrationJob,
  referenceStandard,
  customer,
  asset,
  service,
  user,
  nonConformance,
  correctiveAction,
  personnelCompetence,
  serviceOrder,
  calibrationRequest,
  ptPlanItem,
  proficiencyTest,
  controlChart,
} from "@calibra-facil/db/schema";
import {
  withLabPermission,
  type AuthVariables,
  addServerTiming,
} from "../middleware/permission";
import {
  eq,
  ne,
  and,
  count,
  sql,
  gte,
  lt,
  lte,
  inArray,
  notInArray,
  desc,
  asc,
  isNull,
  or,
} from "drizzle-orm";
import { getDashboardWindows } from "../lib/dashboard-windows";
import { orgDb } from "../lib/org-db";
import { buildUnitScopeCondition } from "../lib/units";

/**
 * Dashboard Router - Aggregated metrics for ISO 17025 lab dashboard
 *
 * Provides a single endpoint with all metrics needed for the dashboard:
 * - KPI counts (pending calibrations, approved this month, etc.)
 * - Calibration trend data for charts
 * - Recent jobs list
 *
 * Permissions:
 * - GET /stats: calibration:read (all lab roles)
 */
export const dashboardRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET /stats - Get all dashboard statistics
  // =========================================================================
  .get("/stats", ...withLabPermission({ calibration: ["read"] }), async (c) => {
    return orgDb(c.get("member").organizationId).transaction(async (o) => {
      const handlerStartedAt = performance.now();
      const memberData = c.get("member");
      const now = new Date();

      // Calculate date boundaries ("this month" and "today" are the lab's days)
      const {
        startOfMonth,
        thirtyDaysFromNow,
        endOfToday,
        sevenDaysFromNow,
        ninetyDaysAgo,
      } = getDashboardWindows(now);
      const jobUnitScopeCondition = buildUnitScopeCondition(
        calibrationJob.unitId,
        memberData,
      );
      const standardUnitScopeCondition = buildUnitScopeCondition(
        referenceStandard.unitId,
        memberData,
      );
      // Bucket decisions by the lab's calendar day (the columns are UTC
      // timestamps), the day the dashboard trend chart labels them with.
      const trendDay = sql`(COALESCE(approved_at, rejected_at) AT TIME ZONE 'UTC' AT TIME ZONE '${sql.raw(LAB_TIME_ZONE)}')::date`;
      const trendUnitCondition =
        memberData.selectedUnitScope === "all"
          ? sql`${calibrationJob.unitId} IN (${sql.join(
              memberData.accessibleUnitIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : sql`${calibrationJob.unitId} = ${memberData.activeUnitId}`;

      try {
        const dbStartedAt = performance.now();
        // Run all queries in parallel for performance
        const [
          pendingResult,
          approvedResult,
          rejectedResult,
          expiringStandardsResult,
          overdueResult,
          dueTodayResult,
          dueNextSevenDaysResult,
          statusBreakdownResult,
          reviewQueueResult,
          standardsWatchlistResult,
          trendResult,
          recentJobsResult,
          openNonConformancesResult,
          ncAwaitingDispositionResult,
          capasOpenResult,
          capasOverdueResult,
          pendingRequestsResult,
          serviceOrdersInProgressResult,
          competencesExpiringResult,
          competencesPendingEvaluationResult,
          dueSoonJobsResult,
          ptPlanOverdueResult,
          ptRoundsPendingResult,
          spcSignalsResult,
        ] = await Promise.all([
          // 1. Pending calibrations (DRAFT + IN_PROGRESS + REVIEW)
          o
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                jobUnitScopeCondition,
                inArray(calibrationJob.status, [
                  "DRAFT",
                  "IN_PROGRESS",
                  "REVIEW",
                ]),
              ),
            ),

          // 2. Approved this month
          o
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                jobUnitScopeCondition,
                eq(calibrationJob.status, "APPROVED"),
                gte(calibrationJob.approvedAt, startOfMonth),
              ),
            ),

          // 3. Rejected this month (for approval rate calculation)
          o
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                jobUnitScopeCondition,
                eq(calibrationJob.status, "REJECTED"),
                gte(calibrationJob.rejectedAt, startOfMonth),
              ),
            ),

          // 4. Expiring standards (within 30 days)
          o
            .select({ count: count() })
            .from(referenceStandard)
            .where(
              and(
                eq(referenceStandard.organizationId, memberData.organizationId),
                standardUnitScopeCondition,
                isNull(referenceStandard.deletedAt),
                eq(referenceStandard.status, "ACTIVE"),
                lte(referenceStandard.nextCalibrationDate, thirtyDaysFromNow),
                gte(referenceStandard.nextCalibrationDate, now),
              ),
            ),

          // 5. Overdue jobs (due date is before today in the lab, not APPROVED/CANCELED).
          // due_date is a calendar day: lt(col, now) compares it with the lab day of now.
          o
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                jobUnitScopeCondition,
                lt(calibrationJob.dueDate, now),
                inArray(calibrationJob.status, [
                  "DRAFT",
                  "IN_PROGRESS",
                  "REVIEW",
                ]),
              ),
            ),

          // 6. Due today (including currently overdue work still open)
          o
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                jobUnitScopeCondition,
                lte(calibrationJob.dueDate, endOfToday),
                inArray(calibrationJob.status, [
                  "DRAFT",
                  "IN_PROGRESS",
                  "REVIEW",
                ]),
              ),
            ),

          // 7. Due in the next 7 days
          o
            .select({ count: count() })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                jobUnitScopeCondition,
                gte(calibrationJob.dueDate, now),
                lte(calibrationJob.dueDate, sevenDaysFromNow),
                inArray(calibrationJob.status, [
                  "DRAFT",
                  "IN_PROGRESS",
                  "REVIEW",
                ]),
              ),
            ),

          // 8. Status distribution for the active work queue
          o
            .select({
              status: calibrationJob.status,
              count: count(),
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                jobUnitScopeCondition,
                inArray(calibrationJob.status, [
                  "DRAFT",
                  "IN_PROGRESS",
                  "REVIEW",
                  "GENERATING_PDF",
                  "RENDER_FAILED",
                ]),
              ),
            )
            .groupBy(calibrationJob.status),

          // 9. Jobs waiting for technical/quality review
          o
            .select({
              id: calibrationJob.id,
              jobId: calibrationJob.jobId,
              status: calibrationJob.status,
              dueDate: calibrationJob.dueDate,
              createdAt: calibrationJob.createdAt,
              customerName: customer.name,
              assetName: asset.name,
              serviceName: service.name,
              technicianName: user.name,
            })
            .from(calibrationJob)
            .leftJoin(customer, eq(calibrationJob.customerId, customer.id))
            .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
            .leftJoin(service, eq(calibrationJob.serviceId, service.id))
            .leftJoin(user, eq(calibrationJob.technicianId, user.id))
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                jobUnitScopeCondition,
                eq(calibrationJob.status, "REVIEW"),
              ),
            )
            .orderBy(
              asc(calibrationJob.dueDate),
              desc(calibrationJob.createdAt),
            )
            .limit(5),

          // 10. Standards requiring traceability attention
          o
            .select({
              id: referenceStandard.id,
              name: referenceStandard.name,
              serialNumber: referenceStandard.serialNumber,
              certificateNumber: referenceStandard.certificateNumber,
              nextCalibrationDate: referenceStandard.nextCalibrationDate,
              status: referenceStandard.status,
            })
            .from(referenceStandard)
            .where(
              and(
                eq(referenceStandard.organizationId, memberData.organizationId),
                standardUnitScopeCondition,
                isNull(referenceStandard.deletedAt),
                eq(referenceStandard.status, "ACTIVE"),
                gte(referenceStandard.nextCalibrationDate, now),
                lte(referenceStandard.nextCalibrationDate, thirtyDaysFromNow),
              ),
            )
            .orderBy(asc(referenceStandard.nextCalibrationDate))
            .limit(5),

          // 11. Calibration trend (last 90 days, aggregated by day)
          // Note: Convert dates to ISO strings for raw SQL to avoid postgres driver issues
          o
            .select({
              date: sql<string>`${trendDay}`,
              approved: sql<string>`COUNT(*) FILTER (WHERE ${calibrationJob.status} = 'APPROVED')`,
              rejected: sql<string>`COUNT(*) FILTER (WHERE ${calibrationJob.status} = 'REJECTED')`,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                trendUnitCondition,
                or(
                  and(
                    eq(calibrationJob.status, "APPROVED"),
                    gte(calibrationJob.approvedAt, ninetyDaysAgo),
                  ),
                  and(
                    eq(calibrationJob.status, "REJECTED"),
                    gte(calibrationJob.rejectedAt, ninetyDaysAgo),
                  ),
                ),
              ),
            )
            .groupBy(trendDay)
            .orderBy(asc(trendDay)),

          // 12. Recent jobs (last 10)
          o
            .select({
              id: calibrationJob.id,
              jobId: calibrationJob.jobId,
              status: calibrationJob.status,
              dueDate: calibrationJob.dueDate,
              createdAt: calibrationJob.createdAt,
              customerName: customer.name,
              assetName: asset.name,
              serviceName: service.name,
              technicianName: user.name,
            })
            .from(calibrationJob)
            .leftJoin(customer, eq(calibrationJob.customerId, customer.id))
            .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
            .leftJoin(service, eq(calibrationJob.serviceId, service.id))
            .leftJoin(user, eq(calibrationJob.technicianId, user.id))
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                jobUnitScopeCondition,
              ),
            )
            .orderBy(desc(calibrationJob.createdAt))
            .limit(10),

          // 13. Open non-conformances (not yet resolved) — org-wide
          o
            .select({ count: count() })
            .from(nonConformance)
            .where(
              and(
                eq(nonConformance.organizationId, memberData.organizationId),
                ne(nonConformance.status, "resolved"),
              ),
            ),

          // 14. NCs awaiting disposition (open, no disposition decided yet)
          o
            .select({ count: count() })
            .from(nonConformance)
            .where(
              and(
                eq(nonConformance.organizationId, memberData.organizationId),
                ne(nonConformance.status, "resolved"),
                isNull(nonConformance.disposition),
              ),
            ),

          // 15. Open CAPAs (corrective actions not closed)
          o
            .select({ count: count() })
            .from(correctiveAction)
            .where(
              and(
                eq(correctiveAction.organizationId, memberData.organizationId),
                ne(correctiveAction.status, "CLOSED"),
              ),
            ),

          // 16. Overdue CAPAs (open, target date in the past)
          o
            .select({ count: count() })
            .from(correctiveAction)
            .where(
              and(
                eq(correctiveAction.organizationId, memberData.organizationId),
                ne(correctiveAction.status, "CLOSED"),
                lte(correctiveAction.dueDate, now),
              ),
            ),

          // 17. Calibration requests awaiting triage
          o
            .select({ count: count() })
            .from(calibrationRequest)
            .where(
              and(
                eq(
                  calibrationRequest.organizationId,
                  memberData.organizationId,
                ),
                inArray(calibrationRequest.status, ["PENDING", "UNDER_REVIEW"]),
              ),
            ),

          // 18. Service orders in flight (not in a terminal state)
          o
            .select({ count: count() })
            .from(serviceOrder)
            .where(
              and(
                eq(serviceOrder.organizationId, memberData.organizationId),
                notInArray(serviceOrder.status, [
                  "closed",
                  "delivered",
                  "canceled",
                  "quote_rejected",
                ]),
              ),
            ),

          // 19. Active competences expiring within 30 days
          o
            .select({ count: count() })
            .from(personnelCompetence)
            .where(
              and(
                eq(
                  personnelCompetence.organizationId,
                  memberData.organizationId,
                ),
                eq(personnelCompetence.status, "ACTIVE"),
                gte(personnelCompetence.expiresAt, now),
                lte(personnelCompetence.expiresAt, thirtyDaysFromNow),
              ),
            ),

          // 20. Competences pending evaluation
          o
            .select({ count: count() })
            .from(personnelCompetence)
            .where(
              and(
                eq(
                  personnelCompetence.organizationId,
                  memberData.organizationId,
                ),
                eq(personnelCompetence.status, "PENDING_EVALUATION"),
              ),
            ),

          // 21. Due-soon dispatch list (open jobs due within 7 days, incl. overdue)
          o
            .select({
              id: calibrationJob.id,
              jobId: calibrationJob.jobId,
              status: calibrationJob.status,
              dueDate: calibrationJob.dueDate,
              createdAt: calibrationJob.createdAt,
              customerName: customer.name,
              assetName: asset.name,
              serviceName: service.name,
              technicianName: user.name,
            })
            .from(calibrationJob)
            .leftJoin(customer, eq(calibrationJob.customerId, customer.id))
            .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
            .leftJoin(service, eq(calibrationJob.serviceId, service.id))
            .leftJoin(user, eq(calibrationJob.technicianId, user.id))
            .where(
              and(
                eq(calibrationJob.organizationId, memberData.organizationId),
                jobUnitScopeCondition,
                inArray(calibrationJob.status, [
                  "DRAFT",
                  "IN_PROGRESS",
                  "REVIEW",
                ]),
                lte(calibrationJob.dueDate, sevenDaysFromNow),
              ),
            )
            .orderBy(
              asc(calibrationJob.dueDate),
              desc(calibrationJob.createdAt),
            )
            .limit(6),

          // 22. PT participation-plan items past their §7.7.2 cycle (issue #60)
          o
            .select({ count: count() })
            .from(ptPlanItem)
            .where(
              and(
                eq(ptPlanItem.organizationId, memberData.organizationId),
                lte(ptPlanItem.nextDueAt, now),
              ),
            ),

          // 23. PT rounds awaiting the provider's final report
          o
            .select({ count: count() })
            .from(proficiencyTest)
            .where(
              and(
                eq(proficiencyTest.organizationId, memberData.organizationId),
                eq(proficiencyTest.overallStatus, "pending"),
              ),
            ),

          // 24. Control charts signalling (trending or out of control, §7.7.1)
          o
            .select({ count: count() })
            .from(controlChart)
            .where(
              and(
                eq(controlChart.organizationId, memberData.organizationId),
                inArray(controlChart.status, ["trending", "out_of_control"]),
              ),
            ),
        ]);
        addServerTiming(c, "dashboard_db", dbStartedAt);

        // Extract counts
        const pendingCalibrations = pendingResult[0]?.count ?? 0;
        const approvedThisMonth = approvedResult[0]?.count ?? 0;
        const rejectedThisMonth = rejectedResult[0]?.count ?? 0;
        const expiringStandards = expiringStandardsResult[0]?.count ?? 0;
        const overdueJobs = overdueResult[0]?.count ?? 0;

        // Calculate approval rate
        const totalDecisions = approvedThisMonth + rejectedThisMonth;
        const approvalRate =
          totalDecisions > 0
            ? Math.round((approvedThisMonth / totalDecisions) * 100 * 10) / 10
            : 100; // Default to 100% if no decisions made
        const dueToday = dueTodayResult[0]?.count ?? 0;
        const dueNextSevenDays = dueNextSevenDaysResult[0]?.count ?? 0;
        const statusBreakdown = statusBreakdownResult.map(
          (row: { status: string; count: number }) => ({
            status: row.status,
            count: row.count,
          }),
        );

        // Format trend data
        const calibrationTrend = trendResult.map((row) => ({
          date: row.date,
          approved: parseInt(row.approved, 10) || 0,
          rejected: parseInt(row.rejected, 10) || 0,
        }));

        const withOverdueFlag = <
          T extends { dueDate: Date | null; status: string },
        >(
          job: T,
        ) => ({
          ...job,
          isOverdue:
            job.dueDate &&
            isCalendarDatePast(job.dueDate, now) &&
            ["DRAFT", "IN_PROGRESS", "REVIEW"].includes(job.status),
        });

        const reviewQueue = reviewQueueResult.map(withOverdueFlag);
        const recentJobs = recentJobsResult.map(withOverdueFlag);
        const dueSoonJobs = dueSoonJobsResult.map(withOverdueFlag);

        return c.json({
          pendingCalibrations,
          approvedThisMonth,
          rejectedThisMonth,
          approvalRate,
          expiringStandards,
          overdueJobs,
          dueToday,
          dueNextSevenDays,
          statusBreakdown,
          reviewQueue,
          standardsWatchlist: standardsWatchlistResult,
          calibrationTrend,
          recentJobs,
          // Cross-domain operational signals
          openNonConformances: openNonConformancesResult[0]?.count ?? 0,
          nonConformancesAwaitingDisposition:
            ncAwaitingDispositionResult[0]?.count ?? 0,
          capasOpen: capasOpenResult[0]?.count ?? 0,
          capasOverdue: capasOverdueResult[0]?.count ?? 0,
          pendingCalibrationRequests: pendingRequestsResult[0]?.count ?? 0,
          serviceOrdersInProgress: serviceOrdersInProgressResult[0]?.count ?? 0,
          competencesExpiring: competencesExpiringResult[0]?.count ?? 0,
          competencesPendingEvaluation:
            competencesPendingEvaluationResult[0]?.count ?? 0,
          // §7.7 validity-of-results signals (issue #60)
          ptPlanOverdue: ptPlanOverdueResult[0]?.count ?? 0,
          ptRoundsPending: ptRoundsPendingResult[0]?.count ?? 0,
          spcChartsWithSignals: spcSignalsResult[0]?.count ?? 0,
          dueSoonJobs,
        });
      } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        return c.json({ error: "Erro ao carregar estatisticas" }, 500);
      } finally {
        addServerTiming(c, "dashboard_handler", handlerStartedAt);
      }
    });
  });
