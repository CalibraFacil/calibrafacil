import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncBootstrapResponse } from "@calibra-facil/contracts";
import { DESKTOP_EXECUTION_PAYLOAD_VERSION } from "@calibra-facil/schemas";
import {
  applySyncBootstrap,
  getLocalJobDetail,
  listPendingOutboxEvents,
  openLocalDatabase,
  saveLocalJobExecution,
} from "./index";

// A submit on the desktop carries the calibration location and a written
// reason for every phase block not performed, exactly as the cloud submit does
// (REQ-P112-1). The location and the reasons are collected and stored offline,
// and travel in the outbox events (REQ-P112-2).

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

type Database = ReturnType<typeof openLocalDatabase>;

const BOOTSTRAP: SyncBootstrapResponse = {
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

function createDatabaseWithJob(): Database {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-record-"));
  tempDirectories.push(directory);
  const database = openLocalDatabase({
    filePath: path.join(directory, "calibra.sqlite"),
  });
  applySyncBootstrap(database, BOOTSTRAP, "2026-01-15T11:00:00.000Z");
  return database;
}

const RECORDED = {
  recordedAt: "2026-01-15T12:00:00.000Z",
  recordedBy: "user-1",
};
const LOCATION = {
  type: "customer_site",
  addressText: "Rua de Teste, 123",
  ...RECORDED,
};

const baseInput = {
  routeId: "789",
  actorUserId: "user-1",
  deviceId: "device-1",
  data: { reading: 1 },
};

function submit(
  database: Database,
  extra: Partial<Parameters<typeof saveLocalJobExecution>[1]> = {},
) {
  return saveLocalJobExecution(database, {
    ...baseInput,
    requireResults: true,
    ...extra,
  });
}

function queuedExecutions(database: Database) {
  return listPendingOutboxEvents(database, 50, {
    includeDeferred: true,
  })
    .filter((event) => event.entityType === "calibration_job")
    .map((event) => ({
      operation: event.operation,
      payload:
        event.payload && typeof event.payload === "object"
          ? Object.fromEntries(Object.entries(event.payload))
          : {},
    }));
}

function storedStatus(database: Database) {
  return database
    .prepare<
      [],
      { status: string }
    >("SELECT status FROM calibration_jobs WHERE id = 'job:789'")
    .get()?.status;
}

describe("desktop submit: the calibration record rule (REQ-P112-1)", () => {
  it("REQ-P112-1 [HIGH RISK]: refuses a submit with no calibration location; the job stays open and nothing is queued", () => {
    const database = createDatabaseWithJob();

    expect(() => submit(database)).toThrow("Local da calibração é obrigatório");

    expect(storedStatus(database)).toBe("DRAFT");
    expect(queuedExecutions(database)).toEqual([]);
    database.close();
  });

  it("REQ-P112-1 [HIGH RISK]: refuses a submit whose location has a blank address or an unknown type", () => {
    const database = createDatabaseWithJob();

    expect(() =>
      submit(database, {
        calibrationLocationSnapshot: { ...LOCATION, addressText: "  " },
      }),
    ).toThrow("Endereço/local da calibração é obrigatório");
    expect(() =>
      submit(database, {
        calibrationLocationSnapshot: { ...LOCATION, type: "moon" },
      }),
    ).toThrow("Tipo de local da calibração é inválido");

    expect(storedStatus(database)).toBe("DRAFT");
    expect(queuedExecutions(database)).toEqual([]);
    database.close();
  });

  it("REQ-P112-1 [HIGH RISK]: refuses a submit with a phase block not performed and no reason", () => {
    const database = createDatabaseWithJob();

    expect(() =>
      submit(database, {
        calibrationLocationSnapshot: LOCATION,
        calibrationPhaseSnapshot: {
          blocks: { ensaio_b: { mode: "not_performed" } },
          ...RECORDED,
        },
      }),
    ).toThrow("Informe o motivo para não executar o bloco ensaio_b");

    expect(storedStatus(database)).toBe("DRAFT");
    expect(queuedExecutions(database)).toEqual([]);
    database.close();
  });

  it("REQ-P112-1: accepts a submit with the location and a justified block, and freezes both", () => {
    const database = createDatabaseWithJob();

    const job = submit(database, {
      calibrationLocationSnapshot: LOCATION,
      calibrationPhaseSnapshot: {
        blocks: {
          ensaio_b: { mode: "not_performed", reason: "Sem acesso ao ponto" },
        },
        ...RECORDED,
      },
    });

    expect(job?.status).toBe("REVIEW");
    expect(job?.calibrationLocationSnapshot).toMatchObject({
      type: "customer_site",
      addressText: "Rua de Teste, 123",
    });
    expect(job?.calibrationPhaseSnapshot).toMatchObject({
      blocks: {
        ensaio_b: { mode: "not_performed", reason: "Sem acesso ao ponto" },
      },
    });
    database.close();
  });

  it("REQ-P112-1: a location saved on an earlier draft is enough for the submit", () => {
    const database = createDatabaseWithJob();

    saveLocalJobExecution(database, {
      ...baseInput,
      calibrationLocationSnapshot: LOCATION,
    });
    const job = submit(database);

    expect(job?.status).toBe("REVIEW");
    database.close();
  });

  it("REQ-P112-1: a draft save does not need the record yet", () => {
    const database = createDatabaseWithJob();

    const job = saveLocalJobExecution(database, baseInput);

    expect(job?.status).toBe("IN_PROGRESS");
    database.close();
  });
});

describe("desktop execution events carry the record (REQ-P112-2)", () => {
  it("REQ-P112-2: a draft save stores the location and the reasons, and queues them with the payload version", () => {
    const database = createDatabaseWithJob();
    const phases = {
      blocks: {
        ensaio_b: { mode: "not_performed", reason: "Sem acesso ao ponto" },
      },
      ...RECORDED,
    };

    saveLocalJobExecution(database, {
      ...baseInput,
      calibrationLocationSnapshot: LOCATION,
      calibrationPhaseSnapshot: phases,
    });

    const detail = getLocalJobDetail(database, "789");
    expect(detail?.calibrationLocationSnapshot).toEqual(LOCATION);
    expect(detail?.calibrationPhaseSnapshot).toEqual(phases);
    const [event] = queuedExecutions(database);
    expect(event?.operation).toBe("save_local_execution");
    expect(event?.payload).toMatchObject({
      calibrationLocationSnapshot: LOCATION,
      calibrationPhaseSnapshot: phases,
      executionPayloadVersion: DESKTOP_EXECUTION_PAYLOAD_VERSION,
    });
    database.close();
  });

  it("REQ-P112-2: the submit event carries the location, the reasons and the payload version", () => {
    const database = createDatabaseWithJob();
    const phases = {
      blocks: {
        ensaio_b: { mode: "not_performed", reason: "Sem acesso ao ponto" },
      },
      ...RECORDED,
    };

    submit(database, {
      calibrationLocationSnapshot: LOCATION,
      calibrationPhaseSnapshot: phases,
    });

    const [event] = queuedExecutions(database);
    expect(event?.operation).toBe("submit_local_execution");
    expect(event?.payload).toMatchObject({
      calibrationLocationSnapshot: LOCATION,
      calibrationPhaseSnapshot: phases,
      executionPayloadVersion: DESKTOP_EXECUTION_PAYLOAD_VERSION,
    });
    database.close();
  });
});

// REQ-P112-4: this change adds no column. The record already had its columns
// (migrations 0006 and 0007) and the version rides in the event payload, so the
// upgrade is a build change, not a schema one. What an upgrade must NOT do is
// touch what an older build left in the outbox: a submit it queued without the
// record stays exactly as written (no version), which is how the cloud knows to
// apply it as before.
describe("upgrading a local database with a legacy submit queued (REQ-P112-4)", () => {
  it("REQ-P112-4: a legacy submit event is still pending after reopening, unchanged and unstamped", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-legacy-"));
    tempDirectories.push(directory);
    const filePath = path.join(directory, "calibra.sqlite");

    const before = openLocalDatabase({ filePath });
    applySyncBootstrap(before, BOOTSTRAP, "2026-01-15T11:00:00.000Z");
    const legacyPayload = {
      data: { reading: 1 },
      results: null,
      calibrationLocationSnapshot: null,
      calibrationPhaseSnapshot: null,
      status: "REVIEW",
    };
    before
      .prepare(
        `INSERT INTO domain_events (
  event_id, aggregate_kind, aggregate_id, aggregate_version, event_type,
  payload_json, metadata_json, actor_user_id, device_id, occurred_at, sync_state
) VALUES ('event:legacy', 'calibration_job', 'job:789', 0,
  'submit_local_execution', @payloadJson, '{}', 'user-1', 'device-1',
  '2026-01-15T12:00:00.000Z', 'pending')`,
      )
      .run({ payloadJson: JSON.stringify(legacyPayload) });
    before
      .prepare(
        `INSERT INTO outbox (
  id, event_id, operation, payload_json, idempotency_key, status, created_at
) VALUES ('outbox:legacy', 'event:legacy', 'submit_local_execution',
  @payloadJson, 'local:event:legacy', 'pending', '2026-01-15T12:00:00.000Z')`,
      )
      .run({ payloadJson: JSON.stringify(legacyPayload) });
    before.close();

    const after = openLocalDatabase({ filePath });

    const [event] = queuedExecutions(after);
    expect(event?.operation).toBe("submit_local_execution");
    expect(event?.payload).toEqual(legacyPayload);
    expect(event?.payload).not.toHaveProperty("executionPayloadVersion");
    after.close();
  });
});
