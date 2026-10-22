import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncBootstrapResponse } from "@calibra-facil/contracts";
import { applySyncBootstrap, openLocalDatabase } from "@calibra-facil/local-db";
import { createLocalServer } from "./server";
import type { LocalServerConfig } from "./bootstrap";

// P1-11 on the desktop: the local draft save runs the cloud's rule. A standard
// already in the job's saved snapshot that went stale is kept and reported in
// `warnings`; a standard the save adds is refused; the submit stays the gate.

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function createConfig(dbPath: string): LocalServerConfig {
  return {
    host: "127.0.0.1",
    port: 4317,
    appVersion: "test",
    localServerVersion: "test",
    dbPath,
    storageRoot: path.join(path.dirname(dbPath), "files"),
    deviceId: "device-test",
    tenantId: null,
    organizationId: "org-1",
    unitId: 1,
    userId: "user-1",
    syncEnabled: true,
    bootstrapToken: null,
    cloudApiUrl: null,
    cloudAuthToken: null,
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
  };
}

function createApp() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-p111-srv-"));
  tempDirectories.push(directory);
  const dbPath = path.join(directory, "calibra.sqlite");
  const database = openLocalDatabase({ filePath: dbPath });
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
  const app = createLocalServer(createConfig(dbPath), database);
  return { app, database };
}

function addStandard(
  database: ReturnType<typeof openLocalDatabase>,
  input: { id: number; name: string },
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
      nextCalibrationDate: daysFromNow(90),
      now: "2026-01-15T11:00:00.000Z",
    });
}

function executeWith(
  app: ReturnType<typeof createApp>["app"],
  selectedStandardIds: number[],
  reading: number,
) {
  return app.request("/api/jobs/789/execute", {
    method: "POST",
    body: JSON.stringify({
      data: { reading },
      selectedStandardIds,
    }),
    headers: { "Content-Type": "application/json" },
  });
}

describe("local server draft save with a standard that went stale (P1-11)", () => {
  it("REQ-P111-2 [HIGH RISK]: a saved standard that expired is kept and answered as a warning; the readings are saved", async () => {
    const { app, database } = createApp();
    addStandard(database, { id: 999, name: "Massa A" });
    const first = await executeWith(app, [999], 1);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ warnings: [] });
    database
      .prepare(
        "UPDATE reference_standards SET next_calibration_date = @date WHERE remote_id = 999",
      )
      .run({ date: daysFromNow(-3) });

    const second = await executeWith(app, [999], 2);

    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      data: { data: { reading: 2 } },
      warnings: [
        {
          code: "standard_no_longer_valid",
          reason: "standard_expired",
          standardIds: [999],
          standardNames: ["Massa A"],
        },
      ],
    });
    database.close();
  });

  it("REQ-P111-1 [HIGH RISK]: a standard the save adds that is expired is refused (422); the saved readings stay", async () => {
    const { app, database } = createApp();
    addStandard(database, { id: 999, name: "Massa A" });
    addStandard(database, { id: 998, name: "Massa B" });
    await executeWith(app, [999], 1);
    database
      .prepare(
        "UPDATE reference_standards SET next_calibration_date = @date WHERE remote_id IN (999, 998)",
      )
      .run({ date: daysFromNow(-3) });

    const refused = await executeWith(app, [999, 998], 3);

    expect(refused.status).toBe(422);
    await expect(refused.json()).resolves.toMatchObject({
      error: "Padrao Massa B esta com certificado vencido",
    });
    const detail = await app.request("/api/jobs/789");
    await expect(detail.json()).resolves.toMatchObject({
      data: { reading: 1 },
    });
    database.close();
  });
});
