import type { LocalDatabase } from "./database";
import { listLocalJobs, type LocalJobStatus } from "./jobs";
import { listLocalStandards } from "./standards";

export type LocalDashboardJob = {
  id: number;
  jobId: string;
  customerName: string | null;
  assetName: string | null;
  serviceName: string | null;
  technicianName: string | null;
  status: LocalJobStatus;
  dueDate: string | null;
  isOverdue: boolean | null;
  createdAt: string;
};

export type LocalDashboardStats = {
  pendingCalibrations: number;
  approvedThisMonth: number;
  rejectedThisMonth: number;
  approvalRate: number;
  expiringStandards: number;
  overdueJobs: number;
  dueToday: number;
  dueNextSevenDays: number;
  statusBreakdown: Array<{ status: LocalJobStatus; count: number }>;
  reviewQueue: LocalDashboardJob[];
  standardsWatchlist: Array<{
    id: number;
    name: string;
    serialNumber: string;
    certificateNumber: string;
    nextCalibrationDate: string;
    status: string;
  }>;
  calibrationTrend: Array<{ date: string; approved: number; rejected: number }>;
  recentJobs: LocalDashboardJob[];
};

const ACTIVE_JOB_STATUSES: LocalJobStatus[] = [
  "DRAFT",
  "IN_PROGRESS",
  "REVIEW",
  "GENERATING_PDF",
];

const JOB_STATUSES: LocalJobStatus[] = [
  "DRAFT",
  "IN_PROGRESS",
  "REVIEW",
  "GENERATING_PDF",
  "APPROVED",
  "REJECTED",
  "CANCELED",
  "SUPERSEDED",
];

export function getLocalDashboardStats(
  database: LocalDatabase,
  now: Date = new Date(),
): LocalDashboardStats {
  const nowIso = now.toISOString();
  const today = isoDate(now);
  const startOfTomorrow = addDays(startOfDay(now), 1).toISOString();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  const nextSevenDays = addDays(startOfDay(now), 8).toISOString();
  const nextThirtyDays = addDays(startOfDay(now), 31).toISOString();

  const pendingCalibrations = countJobsWhere(
    database,
    `status IN (${ACTIVE_JOB_STATUSES.map(() => "?").join(",")})`,
    ACTIVE_JOB_STATUSES,
  );
  const approvedThisMonth = countJobsWhere(
    database,
    "status = ? AND COALESCE(approved_at, updated_at) >= ?",
    ["APPROVED", startOfMonth],
  );
  const rejectedThisMonth = countJobsWhere(
    database,
    "status = ? AND COALESCE(rejected_at, updated_at) >= ?",
    ["REJECTED", startOfMonth],
  );
  const overdueJobs = countJobsWhere(
    database,
    `due_date IS NOT NULL AND due_date < ? AND status IN (${ACTIVE_JOB_STATUSES.map(
      () => "?",
    ).join(",")})`,
    [nowIso, ...ACTIVE_JOB_STATUSES],
  );
  const dueToday = countJobsWhere(
    database,
    `due_date IS NOT NULL AND due_date >= ? AND due_date < ? AND status IN (${ACTIVE_JOB_STATUSES.map(
      () => "?",
    ).join(",")})`,
    [startOfDay(now).toISOString(), startOfTomorrow, ...ACTIVE_JOB_STATUSES],
  );
  const dueNextSevenDays = countJobsWhere(
    database,
    `due_date IS NOT NULL AND due_date >= ? AND due_date < ? AND status IN (${ACTIVE_JOB_STATUSES.map(
      () => "?",
    ).join(",")})`,
    [startOfTomorrow, nextSevenDays, ...ACTIVE_JOB_STATUSES],
  );
  const decisionTotal = approvedThisMonth + rejectedThisMonth;
  const activeStandards = listLocalStandards(database, {
    page: 1,
    limit: 100,
  }).data;
  const standardsWatchlist = activeStandards
    .filter((standard) => {
      if (standard.status === "OUT_OF_TOLERANCE") return true;
      if (standard.status !== "ACTIVE") return false;
      const dueAt = Date.parse(standard.nextCalibrationDate);
      return (
        Number.isFinite(dueAt) &&
        dueAt >= Date.parse(today) &&
        dueAt < Date.parse(nextThirtyDays)
      );
    })
    .sort((a, b) => a.nextCalibrationDate.localeCompare(b.nextCalibrationDate))
    .slice(0, 5)
    .map((standard) => ({
      id: standard.id,
      name: standard.name,
      serialNumber: standard.serialNumber,
      certificateNumber: standard.certificateNumber,
      nextCalibrationDate: standard.nextCalibrationDate,
      status: standard.status,
    }));

  return {
    pendingCalibrations,
    approvedThisMonth,
    rejectedThisMonth,
    approvalRate:
      decisionTotal === 0
        ? 0
        : Math.round((approvedThisMonth / decisionTotal) * 100),
    expiringStandards: standardsWatchlist.length,
    overdueJobs,
    dueToday,
    dueNextSevenDays,
    statusBreakdown: getStatusBreakdown(database),
    reviewQueue: listLocalJobs(database, {
      page: 1,
      limit: 5,
      status: "REVIEW",
    }).data,
    standardsWatchlist,
    calibrationTrend: getCalibrationTrend(database, now),
    recentJobs: listLocalJobs(database, { page: 1, limit: 5 }).data,
  };
}

function countJobsWhere(
  database: LocalDatabase,
  where: string,
  params: Array<string>,
) {
  const row = database
    .prepare<Array<string>, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM calibration_jobs
WHERE deleted_at IS NULL AND ${where}
`,
    )
    .get(...params);

  return row?.total ?? 0;
}

function getStatusBreakdown(database: LocalDatabase) {
  const rows = database
    .prepare<[], { status: LocalJobStatus; count: number }>(
      `
SELECT status, COUNT(*) AS count
FROM calibration_jobs
WHERE deleted_at IS NULL
GROUP BY status
`,
    )
    .all();
  const countByStatus = new Map(rows.map((row) => [row.status, row.count]));

  return JOB_STATUSES.map((status) => ({
    status,
    count: countByStatus.get(status) ?? 0,
  })).filter((item) => item.count > 0);
}

function getCalibrationTrend(database: LocalDatabase, now: Date) {
  const days = Array.from({ length: 7 }, (_, index) =>
    isoDate(addDays(startOfDay(now), index - 6)),
  );
  const trend = new Map(
    days.map((date) => [date, { date, approved: 0, rejected: 0 }]),
  );
  const start = `${days[0]}T00:00:00.000Z`;
  const rows = database
    .prepare<
      { start: string },
      {
        status: "APPROVED" | "REJECTED";
        date: string;
        count: number;
      }
    >(
      `
SELECT status, substr(COALESCE(approved_at, rejected_at, updated_at), 1, 10) AS date, COUNT(*) AS count
FROM calibration_jobs
WHERE deleted_at IS NULL
  AND status IN ('APPROVED', 'REJECTED')
  AND COALESCE(approved_at, rejected_at, updated_at) >= @start
GROUP BY status, date
`,
    )
    .all({ start });

  for (const row of rows) {
    const bucket = trend.get(row.date);
    if (!bucket) continue;
    if (row.status === "APPROVED") {
      bucket.approved = row.count;
    } else {
      bucket.rejected = row.count;
    }
  }

  return days.map(
    (date) => trend.get(date) ?? { date, approved: 0, rejected: 0 },
  );
}

function startOfDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
