import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncBootstrapResponse } from "@calibra-facil/contracts";
import {
  applySyncBootstrap,
  listLocalStandards,
  openLocalDatabase,
  saveLocalJobExecution,
} from "./index";

// REQ-CAL-004 (Q12), offline: a reference standard is valid THROUGH the day its
// certificate names, judged on the Sao Paulo day the calibration was performed.
// The desktop must accept and refuse exactly what the cloud does.

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

type Database = ReturnType<typeof openLocalDatabase>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The standard's last valid day: three days ago, as a stored calendar date. */
const VALID_THROUGH = new Date(Date.now() - 3 * DAY_MS)
  .toISOString()
  .slice(0, 10);

function atUtc(day: string, offsetDays: number, time: string) {
  const base = new Date(`${day}T00:00:00.000Z`);
  const shifted = new Date(base.getTime() + offsetDays * DAY_MS);
  return `${shifted.toISOString().slice(0, 10)}T${time}Z`;
}

function createDatabase(validThrough: string = VALID_THROUGH): Database {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-std-valid-"));
  tempDirectories.push(directory);
  const database = openLocalDatabase({
    filePath: path.join(directory, "calibra.sqlite"),
  });
  const bootstrap: SyncBootstrapResponse = {
    serverTime: "2026-01-15T10:00:00.000Z",
    user: { id: "user-1", name: "User One", email: "user@example.com" },
    organization: { id: "org-1", type: "LAB" },
    activeUnits: [{ id: 1, name: "Matriz", role: "technician" }],
    permissions: {
      role: "technician",
      unitRole: "technician",
      activeUnitId: 1,
      accessibleUnitIds: [1],
      canAccessAllUnits: false,
    },
    featureFlags: {
      offlineApprovals: false,
      offlineCertificatePublication: false,
    },
    syncCursor: "2026-01-15T10:00:00.000Z",
    publishedMethods: [],
    assetTypes: [],
    customers: [],
    assets: [],
    services: [],
    standards: [],
    massCompositionProfiles: [],
    environmentalLimits: [],
    jobs: [
      {
        id: 789,
        jobId: "J-789",
        customerId: 123,
        assetId: 456,
        serviceId: 5,
        unitId: 1,
        status: "DRAFT",
        data: {},
        createdAt: "2026-01-15T10:00:00.000Z",
        updatedAt: "2026-01-15T10:00:00.000Z",
      },
    ],
    serviceOrders: [],
  };
  applySyncBootstrap(database, bootstrap, "2026-01-15T11:00:00.000Z");
  database
    .prepare(
      `
INSERT INTO reference_standards (
  id, remote_id, organization_id, unit_id, name, serial_number,
  certificate_number, next_calibration_date, status, snapshot_json,
  pulled_at, sync_state
) VALUES (
  'standard:999', 999, 'org-1', 1, 'Massa Padrao', 'STD-999',
  'CERT-999', @nextCalibrationDate, 'ACTIVE', '{}', @now, 'synced'
)
`,
    )
    .run({
      nextCalibrationDate: `${validThrough}T00:00:00.000Z`,
      now: "2026-01-15T11:00:00.000Z",
    });
  return database;
}

const baseInput = {
  routeId: "789",
  actorUserId: "user-1",
  deviceId: "device-1",
  data: { reading: 1 },
  selectedStandardIds: [999],
};

describe("offline standard validity at the performed date (REQ-CAL-004)", () => {
  it("REQ-CAL-004: accepts a standard on its last valid day, performed at 23:30 in Sao Paulo", () => {
    const database = createDatabase();
    // 23:30 on VALID_THROUGH in Sao Paulo (UTC-3) is 02:30Z the next day.
    const performedAt = atUtc(VALID_THROUGH, 1, "02:30:00.000");

    const job = saveLocalJobExecution(database, {
      ...baseInput,
      performedAt,
    });

    expect(job?.standardsSnapshot).toEqual([
      expect.objectContaining({ id: 999, name: "Massa Padrao" }),
    ]);
    database.close();
  });

  it("REQ-CAL-004: refuses the same standard for work performed at 00:10 the next day", () => {
    const database = createDatabase();
    const performedAt = atUtc(VALID_THROUGH, 1, "03:10:00.000");

    expect(() =>
      saveLocalJobExecution(database, { ...baseInput, performedAt }),
    ).toThrow(/certificado vencido/);
    database.close();
  });

  it("REQ-CAL-004: accepts work performed before the standard expired even though it is past today", () => {
    const database = createDatabase();
    const performedAt = atUtc(VALID_THROUGH, -1, "15:00:00.000");

    const job = saveLocalJobExecution(database, {
      ...baseInput,
      performedAt,
      backdateReason: "Lancamento tardio",
    });

    expect(job?.standardsSnapshot).toEqual([
      expect.objectContaining({ id: 999 }),
    ]);
    database.close();
  });

  it("REQ-CAL-004: a draft keeps judging a standard by the date already saved", () => {
    const database = createDatabase();
    saveLocalJobExecution(database, {
      ...baseInput,
      performedAt: atUtc(VALID_THROUGH, 0, "15:00:00.000"),
    });

    // A later draft save without a date (an auto-save) must not re-judge the
    // standard against today: the job's date is the day the work was done.
    const job = saveLocalJobExecution(database, baseInput);

    expect(job?.standardsSnapshot).toEqual([
      expect.objectContaining({ id: 999 }),
    ]);
    database.close();
  });

  it("REQ-CAL-004: the standards list calls a standard expired only after its last valid day", () => {
    const labToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
    }).format(new Date());

    const onLastDay = createDatabase(labToday);
    const [validToday] = listLocalStandards(onLastDay, {
      page: 1,
      limit: 10,
    }).data;
    expect(validToday?.isExpired).toBe(false);
    expect(validToday?.daysUntilExpiry).toBe(0);
    onLastDay.close();

    const threeDaysAfter = createDatabase();
    const [expired] = listLocalStandards(threeDaysAfter, {
      page: 1,
      limit: 10,
    }).data;
    expect(expired?.isExpired).toBe(true);
    expect(expired?.daysUntilExpiry).toBeLessThan(0);
    threeDaysAfter.close();
  });
});
