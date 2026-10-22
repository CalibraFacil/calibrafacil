import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncBootstrapResponse } from "@calibra-facil/contracts";
import {
  applySyncBootstrap,
  getLocalJobDetail,
  listPendingOutboxEvents,
  openLocalDatabase,
  resolveLocalDraftStandards,
  saveLocalJobExecution,
} from "./index";

// P1-11, offline: a standard that went stale mid-job must not make every draft
// save fail on the desktop either. The desktop applies the cloud's rule: a
// standard already in the job's saved snapshot is kept (with a warning), one
// the save adds is judged strictly, and the submit is still the hard gate.

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

type Database = ReturnType<typeof openLocalDatabase>;

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function createDatabase(): Database {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-p111-"));
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
  return database;
}

function addStandard(
  database: Database,
  input: { id: number; name: string; validThrough?: string },
) {
  database
    .prepare(
      `
INSERT INTO reference_standards (
  id, remote_id, organization_id, unit_id, name, serial_number,
  certificate_number, next_calibration_date, status, snapshot_json,
  pulled_at, sync_state
) VALUES (
  @localId, @id, 'org-1', 1, @name, @serial,
  @certificate, @nextCalibrationDate, 'ACTIVE', '{}', @now, 'synced'
)
`,
    )
    .run({
      localId: `standard:${input.id}`,
      id: input.id,
      name: input.name,
      serial: `STD-${input.id}`,
      certificate: `CERT-${input.id}`,
      nextCalibrationDate: input.validThrough ?? daysFromNow(90),
      now: "2026-01-15T11:00:00.000Z",
    });
}

function expire(database: Database, id: number) {
  database
    .prepare(
      "UPDATE reference_standards SET next_calibration_date = @date WHERE remote_id = @id",
    )
    .run({ id, date: daysFromNow(-3) });
}

function deactivate(database: Database, id: number) {
  database
    .prepare(
      "UPDATE reference_standards SET status = 'INACTIVE' WHERE remote_id = @id",
    )
    .run({ id });
}

const save = (
  database: Database,
  selectedStandardIds: number[] | undefined,
  extra: { requireResults?: boolean; reading?: number } = {},
) =>
  saveLocalJobExecution(database, {
    routeId: "789",
    actorUserId: "user-1",
    deviceId: "device-1",
    data: { reading: extra.reading ?? 1 },
    selectedStandardIds,
    ...(extra.requireResults
      ? {
          requireResults: true,
          calibrationLocationSnapshot: {
            type: "lab",
            addressText: "Laboratório",
            recordedAt: "2026-01-15T10:00:00.000Z",
            recordedBy: "user-1",
          },
        }
      : {}),
  });

describe("offline draft save with a standard that went stale (P1-11)", () => {
  it("REQ-P111-2 [HIGH RISK]: a standard already in the saved snapshot that became expired or inactive is kept; the readings are saved", () => {
    const database = createDatabase();
    addStandard(database, { id: 999, name: "Massa A" });
    addStandard(database, { id: 998, name: "Massa B" });
    save(database, [999, 998]);
    const saved = getLocalJobDetail(database, "789");
    expire(database, 999);
    deactivate(database, 998);

    const job = save(database, [999, 998], { reading: 2 });

    expect(job?.data).toEqual({ reading: 2 });
    // The entries the technician picked are kept as frozen.
    expect(job?.standardsSnapshot).toEqual(saved?.standardsSnapshot);
    expect(job?.status).toBe("IN_PROGRESS");
    database.close();
  });

  it("REQ-P111-2: the warning names every stale standard with its reason, once per reason", () => {
    const database = createDatabase();
    addStandard(database, { id: 999, name: "Massa A" });
    addStandard(database, { id: 998, name: "Massa B" });
    addStandard(database, { id: 997, name: "Massa C" });
    save(database, [999, 998, 997]);
    const savedSnapshot = getLocalJobDetail(database, "789")?.standardsSnapshot;
    expire(database, 999);
    deactivate(database, 998);

    const draft = resolveLocalDraftStandards(database, {
      selectedStandardIds: [999, 998, 997],
      data: {},
      performedAt: new Date(),
      savedStandardsSnapshot: savedSnapshot,
    });

    expect(draft.warnings).toEqual([
      {
        code: "standard_no_longer_valid",
        reason: "standard_inactive",
        standardIds: [998],
        standardNames: ["Massa B"],
      },
      {
        code: "standard_no_longer_valid",
        reason: "standard_expired",
        standardIds: [999],
        standardNames: ["Massa A"],
      },
    ]);
    expect(draft.snapshot?.map((standard) => standard.id)).toEqual([
      999, 998, 997,
    ]);
    database.close();
  });

  it("REQ-P111-1 [HIGH RISK]: a draft that ADDS an expired or inactive standard is refused, even while a saved one is stale; nothing is written", () => {
    const database = createDatabase();
    addStandard(database, { id: 999, name: "Massa A" });
    save(database, [999]);
    expire(database, 999);
    // The stale one alone is accepted ...
    save(database, [999]);
    addStandard(database, {
      id: 996,
      name: "Massa D",
      validThrough: daysFromNow(-5),
    });
    addStandard(database, { id: 995, name: "Massa E" });
    deactivate(database, 995);
    const before = getLocalJobDetail(database, "789");
    const outboxBefore = listPendingOutboxEvents(database).length;

    // ... but a standard the save adds must be valid.
    expect(() => save(database, [999, 996], { reading: 3 })).toThrow(
      "Massa D esta com certificado vencido",
    );
    expect(() => save(database, [999, 995], { reading: 3 })).toThrow(
      "Massa E nao esta ativo",
    );

    expect(getLocalJobDetail(database, "789")).toEqual(before);
    expect(listPendingOutboxEvents(database)).toHaveLength(outboxBefore);
    database.close();
  });

  it("REQ-P111-1: a standard that is not in the cache at all is refused even when the saved snapshot named it", () => {
    const database = createDatabase();
    addStandard(database, { id: 999, name: "Massa A" });
    save(database, [999]);
    database.prepare("DELETE FROM reference_standards").run();

    expect(() => save(database, [999], { reading: 2 })).toThrow(
      "Padrao 999 nao encontrado no cache local",
    );
    database.close();
  });

  it("REQ-P111-3 [HIGH RISK]: the submit still refuses a saved standard that went stale", () => {
    const database = createDatabase();
    addStandard(database, { id: 999, name: "Massa A" });
    save(database, [999]);
    expire(database, 999);
    // The draft keeps saving ...
    save(database, [999], { reading: 2 });
    const before = getLocalJobDetail(database, "789");

    // ... the submit does not, naming the standard again or not.
    expect(() => save(database, [999], { requireResults: true })).toThrow(
      "Massa A esta com certificado vencido",
    );
    expect(() => save(database, undefined, { requireResults: true })).toThrow(
      "Massa A esta com certificado vencido",
    );
    expect(getLocalJobDetail(database, "789")).toEqual(before);
    database.close();
  });
});
