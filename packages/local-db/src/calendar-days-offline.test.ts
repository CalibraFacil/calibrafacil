import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLocalDashboardStats,
  listLocalJobs,
  openLocalDatabase,
  upsertLocalJobProjection,
} from "./index";

// REQ-CAL-003, offline: a job's due date and a standard's validity are
// CALENDAR DAYS. The desktop's dashboard and job list judge them by the
// laboratory's (Sao Paulo) day, also from 21:00 to 24:00 when the UTC day is
// already tomorrow, so they agree with the cloud.

const tempDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

// 23:30 on 2026-10-15 in Sao Paulo is 02:30Z on the 16th.
const LAST_EVENING = new Date("2026-10-16T02:30:00.000Z");

function createDatabase() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-days-"));
  tempDirectories.push(directory);
  return openLocalDatabase({
    filePath: path.join(directory, "calibra.sqlite"),
  });
}

function seedJob(
  database: ReturnType<typeof createDatabase>,
  jobId: string,
  dueDate: string | null,
  status: "DRAFT" | "IN_PROGRESS" = "DRAFT",
) {
  upsertLocalJobProjection(database, {
    id: jobId,
    jobId,
    organizationId: "org-1",
    unitId: 1,
    customerId: "customer-local",
    assetId: "asset-local",
    serviceId: "service-local",
    status,
    dueDate,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
  });
}

function seedStandard(
  database: ReturnType<typeof createDatabase>,
  id: string,
  nextCalibrationDate: string,
) {
  database
    .prepare(
      `
INSERT INTO reference_standards (
  id, organization_id, unit_id, name, serial_number, certificate_number,
  next_calibration_date, status, snapshot_json, pulled_at, sync_state
) VALUES (
  @id, 'org-1', 1, @id, @id, @id, @next, 'ACTIVE', @snapshot,
  '2026-10-01T10:00:00.000Z', 'synced'
)
`,
    )
    .run({
      id,
      next: nextCalibrationDate,
      snapshot: JSON.stringify({
        name: id,
        serialNumber: id,
        certificateNumber: id,
        nextCalibrationDate,
      }),
    });
}

describe("offline calendar-day comparisons (REQ-CAL-003)", () => {
  it("counts due-today and overdue jobs by laboratory day at 23:30 on the due day", () => {
    const database = createDatabase();
    seedJob(database, "J-TODAY-MIDNIGHT", "2026-10-15T00:00:00.000Z");
    seedJob(database, "J-TODAY-NOON", "2026-10-15T15:00:00.000Z");
    seedJob(database, "J-YESTERDAY", "2026-10-14T00:00:00.000Z");
    seedJob(database, "J-TOMORROW", "2026-10-16T00:00:00.000Z");
    seedJob(database, "J-NEXT-WEEK", "2026-10-22T00:00:00.000Z");
    seedJob(database, "J-LATER", "2026-10-30T00:00:00.000Z");

    const stats = getLocalDashboardStats(database, LAST_EVENING);

    expect(stats.overdueJobs).toBe(1); // yesterday only
    expect(stats.dueToday).toBe(2);
    expect(stats.dueNextSevenDays).toBe(2); // tomorrow and +7
    database.close();
  });

  it("flags a job overdue only once its due day is over in the laboratory", () => {
    const database = createDatabase();
    seedJob(database, "J-TODAY", "2026-10-15T00:00:00.000Z");
    seedJob(database, "J-YESTERDAY", "2026-10-14T00:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });

    vi.setSystemTime(LAST_EVENING);
    const evening = listLocalJobs(database, { page: 1, limit: 10 }).data;
    expect(
      Object.fromEntries(evening.map((job) => [job.jobId, job.isOverdue])),
    ).toEqual({ "J-TODAY": false, "J-YESTERDAY": true });

    // 00:10 on the 16th in Sao Paulo.
    vi.setSystemTime(new Date("2026-10-16T03:10:00.000Z"));
    const morning = listLocalJobs(database, { page: 1, limit: 10 }).data;
    expect(
      Object.fromEntries(morning.map((job) => [job.jobId, job.isOverdue])),
    ).toEqual({ "J-TODAY": true, "J-YESTERDAY": true });
    database.close();
  });

  it("keeps a standard valid through today on the watchlist at 23:30, and drops one that ended yesterday", () => {
    const database = createDatabase();
    seedStandard(database, "STD-LAST-DAY", "2026-10-15T00:00:00.000Z");
    seedStandard(database, "STD-ENDED", "2026-10-14T00:00:00.000Z");
    seedStandard(database, "STD-30", "2026-11-14T00:00:00.000Z");
    seedStandard(database, "STD-31", "2026-11-15T00:00:00.000Z");

    const stats = getLocalDashboardStats(database, LAST_EVENING);

    expect(stats.standardsWatchlist.map((standard) => standard.name)).toEqual([
      "STD-LAST-DAY",
      "STD-30",
    ]);
    database.close();
  });
});
