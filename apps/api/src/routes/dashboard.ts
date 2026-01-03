import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  referenceStandard,
  customer,
  asset,
  service,
  user,
} from "@calibra-facil/db/schema";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { eq, and, count, sql, gte, lte, inArray, desc } from "drizzle-orm";

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
    const memberData = c.get("member");
    const now = new Date();

    // Calculate date boundaries
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(now.getDate() + 30);
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(now.getDate() - 90);

    try {
      // Run all queries in parallel for performance
      const [
        pendingResult,
        approvedResult,
        rejectedResult,
        expiringStandardsResult,
        overdueResult,
        trendResult,
        recentJobsResult,
      ] = await Promise.all([
        // 1. Pending calibrations (DRAFT + IN_PROGRESS + REVIEW)
        db
          .select({ count: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, memberData.organizationId),
              inArray(calibrationJob.status, ["DRAFT", "IN_PROGRESS", "REVIEW"]),
            ),
          ),

        // 2. Approved this month
        db
          .select({ count: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, memberData.organizationId),
              eq(calibrationJob.status, "APPROVED"),
              gte(calibrationJob.approvedAt, startOfMonth),
            ),
          ),

        // 3. Rejected this month (for approval rate calculation)
        db
          .select({ count: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, memberData.organizationId),
              eq(calibrationJob.status, "REJECTED"),
              gte(calibrationJob.rejectedAt, startOfMonth),
            ),
          ),

        // 4. Expiring standards (within 30 days)
        db
          .select({ count: count() })
          .from(referenceStandard)
          .where(
            and(
              eq(referenceStandard.organizationId, memberData.organizationId),
              eq(referenceStandard.status, "ACTIVE"),
              lte(referenceStandard.nextCalibrationDate, thirtyDaysFromNow),
              gte(referenceStandard.nextCalibrationDate, now),
            ),
          ),

        // 5. Overdue jobs (past due date, not APPROVED/CANCELED)
        db
          .select({ count: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, memberData.organizationId),
              lte(calibrationJob.dueDate, now),
              inArray(calibrationJob.status, ["DRAFT", "IN_PROGRESS", "REVIEW"]),
            ),
          ),

        // 6. Calibration trend (last 90 days, aggregated by day)
        // Note: Convert dates to ISO strings for raw SQL to avoid postgres driver issues
        db.execute(sql`
          SELECT
            DATE(COALESCE(approved_at, rejected_at)) as date,
            COUNT(*) FILTER (WHERE status = 'APPROVED') as approved,
            COUNT(*) FILTER (WHERE status = 'REJECTED') as rejected
          FROM calibration_job
          WHERE organization_id = ${memberData.organizationId}
            AND (
              (status = 'APPROVED' AND approved_at >= ${ninetyDaysAgo.toISOString()})
              OR (status = 'REJECTED' AND rejected_at >= ${ninetyDaysAgo.toISOString()})
            )
          GROUP BY DATE(COALESCE(approved_at, rejected_at))
          ORDER BY date ASC
        `),

        // 7. Recent jobs (last 10)
        db
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
          .where(eq(calibrationJob.organizationId, memberData.organizationId))
          .orderBy(desc(calibrationJob.createdAt))
          .limit(10),
      ]);

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

      // Format trend data
      // db.execute returns array directly for postgres driver
      const trendRows = trendResult as unknown as Array<{
        date: string;
        approved: string;
        rejected: string;
      }>;
      const calibrationTrend = trendRows.map((row) => ({
        date: row.date,
        approved: parseInt(row.approved, 10) || 0,
        rejected: parseInt(row.rejected, 10) || 0,
      }));

      // Format recent jobs with computed isOverdue
      const recentJobs = recentJobsResult.map((job) => ({
        ...job,
        isOverdue:
          job.dueDate &&
          job.dueDate < now &&
          ["DRAFT", "IN_PROGRESS", "REVIEW"].includes(job.status),
      }));

      return c.json({
        pendingCalibrations,
        approvedThisMonth,
        rejectedThisMonth,
        approvalRate,
        expiringStandards,
        overdueJobs,
        calibrationTrend,
        recentJobs,
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      return c.json({ error: "Erro ao carregar estatisticas" }, 500);
    }
  });
