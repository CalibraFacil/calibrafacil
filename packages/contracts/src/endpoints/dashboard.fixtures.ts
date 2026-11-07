import type { DashboardJob, DashboardStats } from "./dashboard";

/**
 * Contract-valid example payloads for the dashboard endpoint, for tests in any
 * package. `dashboard.test.ts` parses every builder against its response schema.
 */

export function buildDashboardJob(
  overrides: Partial<DashboardJob> = {},
): DashboardJob {
  return {
    id: 1,
    jobId: "CAL-0001",
    customerName: "Metalúrgica Alfa Ltda",
    assetName: "Paquímetro 150 mm",
    serviceName: "Calibração dimensional",
    technicianName: "Ana Souza",
    status: "IN_PROGRESS",
    dueDate: "2026-02-10T00:00:00.000Z",
    isOverdue: false,
    createdAt: "2026-01-10T12:00:00.000Z",
    ...overrides,
  };
}

/** A laboratory with nothing open: every counter at zero, every list empty. */
export function buildDashboardStats(
  overrides: Partial<DashboardStats> = {},
): DashboardStats {
  return {
    pendingCalibrations: 0,
    approvedThisMonth: 0,
    rejectedThisMonth: 0,
    approvalRate: 100,
    expiringStandards: 0,
    overdueJobs: 0,
    dueToday: 0,
    dueNextSevenDays: 0,
    statusBreakdown: [],
    reviewQueue: [],
    standardsWatchlist: [],
    calibrationTrend: [],
    recentJobs: [],
    openNonConformances: 0,
    nonConformancesAwaitingDisposition: 0,
    capasOpen: 0,
    capasOverdue: 0,
    pendingCalibrationRequests: 0,
    serviceOrdersInProgress: 0,
    competencesExpiring: 0,
    competencesPendingEvaluation: 0,
    ptPlanOverdue: 0,
    ptRoundsPending: 0,
    spcChartsWithSignals: 0,
    dueSoonJobs: [],
    ...overrides,
  };
}
