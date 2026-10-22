import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  listPendingOutboxEvents,
  openLocalDatabase,
  upsertLocalJobProjection,
} from "@calibra-facil/local-db";
import { DESKTOP_EXECUTION_PAYLOAD_VERSION } from "@calibra-facil/schemas";
import { createLocalServer } from "./server";
import type { LocalServerConfig } from "./bootstrap";

// The desktop execution form posts the calibration location and the phase
// reasons to the local server; a submit without them is refused with the
// cloud's messages (REQ-P112-1), and what is posted is stored and queued for
// sync (REQ-P112-2).

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

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

function createAppWithJob() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-record-"));
  tempDirectories.push(directory);
  const dbPath = path.join(directory, "calibra.sqlite");
  const database = openLocalDatabase({ filePath: dbPath });
  const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
  const app = createLocalServer(createConfig(dbPath), database);

  database
    .prepare(
      "INSERT INTO customers (id, organization_id, unit_id, name, updated_at, sync_state) VALUES ('customer-local', 'org-1', 1, 'Acme Lab', @now, 'synced')",
    )
    .run({ now });
  database
    .prepare(
      "INSERT INTO asset_types (id, remote_id, organization_id, name, pulled_at, sync_state) VALUES ('asset-type-local', 456, 'org-1', 'Balance', @now, 'synced')",
    )
    .run({ now });
  database
    .prepare(
      `INSERT INTO assets (id, remote_id, organization_id, unit_id, customer_id, asset_type_id, name, serial_number, tag, status, updated_at, sync_state)
VALUES ('asset-local', 789, 'org-1', 1, 'customer-local', 'asset-type-local', 'Scale 01', 'SN-001', 'TAG-001', 'ACTIVE', @now, 'synced')`,
    )
    .run({ now });
  database
    .prepare(
      "INSERT INTO services (id, organization_id, name, status, pulled_at, sync_state) VALUES ('service-local', 'org-1', 'Mass calibration', 'ACTIVE', @now, 'synced')",
    )
    .run({ now });
  upsertLocalJobProjection(database, {
    id: "job-local",
    remoteId: 123,
    jobId: "CAL-2026-0001",
    organizationId: "org-1",
    unitId: 1,
    customerId: "customer-local",
    assetId: "asset-local",
    serviceId: "service-local",
    status: "IN_PROGRESS",
    createdAt: now,
    updatedAt: now,
  });

  return { app, database };
}

function post(
  app: ReturnType<typeof createLocalServer>,
  action: "execute" | "submit",
  body: Record<string, unknown>,
) {
  return app.request(`/api/jobs/123/${action}`, {
    method: "POST",
    body: JSON.stringify({ data: { indication: "10" }, ...body }),
    headers: { "Content-Type": "application/json" },
  });
}

describe("local server: the calibration record on execute and submit", () => {
  it("REQ-P112-1 [HIGH RISK]: refuses a submit with no calibration location (400, the cloud's message); the job stays open", async () => {
    const { app, database } = createAppWithJob();

    const response = await post(app, "submit", {});

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Local da calibração é obrigatório",
    });
    const job = await app.request("/api/jobs/123");
    await expect(job.json()).resolves.toMatchObject({ status: "IN_PROGRESS" });
    expect(listPendingOutboxEvents(database, 50)).toEqual([]);
    database.close();
  });

  it("REQ-P112-1 [HIGH RISK]: refuses a submit whose address is blank or whose phase block was not performed without a reason", async () => {
    const { app, database } = createAppWithJob();

    const blank = await post(app, "submit", {
      calibrationLocation: { type: "lab", addressText: "   " },
    });
    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toEqual({
      error: "Endereço/local da calibração é obrigatório",
    });

    const noReason = await post(app, "submit", {
      calibrationLocation: { type: "lab", addressText: "Laboratório" },
      calibrationPhases: {
        blocks: { ensaio_b: { mode: "not_performed", reason: "  " } },
      },
    });
    expect(noReason.status).toBe(400);
    await expect(noReason.json()).resolves.toEqual({
      error: "Informe o motivo para não executar o bloco ensaio_b",
    });
    expect(listPendingOutboxEvents(database, 50)).toEqual([]);
    database.close();
  });

  it("REQ-P112-2: a save stores the location and the phase reason offline and queues them, stamped with the payload version", async () => {
    const { app, database } = createAppWithJob();

    const response = await post(app, "execute", {
      calibrationLocation: { type: "customer_site", addressText: " Rua A, 1 " },
      calibrationPhases: {
        blocks: {
          ensaio_b: { mode: "not_performed", reason: " Sem acesso " },
        },
      },
    });
    expect(response.status, await response.clone().text()).toBe(200);

    const job = await app.request("/api/jobs/123");
    await expect(job.json()).resolves.toMatchObject({
      calibrationLocationSnapshot: {
        type: "customer_site",
        addressText: "Rua A, 1",
      },
      calibrationPhaseSnapshot: {
        blocks: { ensaio_b: { mode: "not_performed", reason: "Sem acesso" } },
      },
    });
    const [event] = listPendingOutboxEvents(database, 50, {
      includeDeferred: true,
    }).filter((entry) => entry.entityType === "calibration_job");
    expect(event?.operation).toBe("save_local_execution");
    expect(event?.payload).toMatchObject({
      calibrationLocationSnapshot: { addressText: "Rua A, 1" },
      calibrationPhaseSnapshot: {
        blocks: { ensaio_b: { reason: "Sem acesso" } },
      },
      executionPayloadVersion: DESKTOP_EXECUTION_PAYLOAD_VERSION,
    });
    database.close();
  });
});
