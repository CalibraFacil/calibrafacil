import {
  addCalendarDays,
  calendarDateKey,
  labToday,
} from "@calibra-facil/schemas";
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
  // A due date and a standard's validity are calendar days: they are judged
  // by the laboratory's day (Sao Paulo), not the UTC clock.
  const todayKey = calendarDateKey(labToday(now));
  const keyAfterToday = (days: number) =>
    calendarDateKey(addCalendarDays(labToday(now), days));
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  const dueDays = activeJobDueDays(database);

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
  const overdueJobs = dueDays.filter((day) => day < todayKey).length;
  const dueToday = dueDays.filter((day) => day === todayKey).length;
  const dueNextSevenDays = dueDays.filter(
    (day) => day > todayKey && day <= keyAfterToday(7),
  ).length;
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
      if (!Number.isFinite(dueAt)) return false;
      const validThrough = calendarDateKey(new Date(dueAt));
      return validThrough >= todayKey && validThrough <= keyAfterToday(30);
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

/** The calendar day (YYYY-MM-DD) each open job with a due date names. */
function activeJobDueDays(database: LocalDatabase): string[] {
  const rows = database
    .prepare<string[], { due_date: string }>(
      `
SELECT due_date
FROM calibration_jobs
WHERE deleted_at IS NULL AND due_date IS NOT NULL
  AND status IN (${ACTIVE_JOB_STATUSES.map(() => "?").join(",")})
`,
    )
    .all(...ACTIVE_JOB_STATUSES);
  const days: string[] = [];
  for (const row of rows) {
    const time = Date.parse(row.due_date);
    if (Number.isFinite(time)) days.push(calendarDateKey(new Date(time)));
  }
  return days;
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
