import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listLocalJobs,
  openLocalDatabase,
  upsertLocalJobProjection,
} from "./index";

// REQ-CAL-003, offline: a job's due date and a standard's validity are
// CALENDAR DAYS. The desktop's job list judges them by the laboratory's
// (Sao Paulo) day, also from 21:00 to 24:00 when the UTC day is already
// tomorrow, so it agrees with the cloud. (The offline dashboard and its
// standards watchlist are online-only since Q13.)

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

describe("offline calendar-day comparisons (REQ-CAL-003)", () => {
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
});
