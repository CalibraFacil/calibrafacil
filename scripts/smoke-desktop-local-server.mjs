import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import Database from "better-sqlite3";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stagedServerPath = path.join(
  root,
  "apps/desktop/dist/local-server/server.cjs",
);
const readinessPath = "/.well-known/calibra/local-environment";
const localToken = "local-smoke-token";
const desktopRunId = "desktop-smoke-run";
const localServerRunId = "local-server-smoke-run";
// A fresh database must reach the newest local migration.
const expectedLocalDbSchemaVersion = Math.max(
  ...readdirSync(path.join(root, "packages/local-db/src/migrations")).map(
    (name) => Number(name.match(/^(\d{4})_/)?.[1] ?? 0),
  ),
);

const checks = [
  {
    name: "auth service orders",
    path: "/api/service-orders",
    auth: true,
    expectedStatus: 200,
  },
  {
    name: "diagnostics",
    path: "/api/local/diagnostics",
    auth: true,
    expectedStatus: 200,
    verify: (body) => {
      assert(
        body.runtime?.desktopRunId === desktopRunId,
        "expected diagnostics desktop run id",
      );
      assert(
        body.runtime?.localServerRunId === localServerRunId,
        "expected diagnostics local-server run id",
      );
      assert(
        body.sync?.state === "offline",
        "expected offline sync diagnostic",
      );
      assert(
        body.database?.schemaVersion === expectedLocalDbSchemaVersion,
        `expected schema version ${expectedLocalDbSchemaVersion}`,
      );
      assert(body.database?.integrity?.ok === true, "expected DB integrity ok");
      assert(
        body.database?.activeCalibrationJobCount === 0,
        "expected no active calibration jobs",
      );
      assert(
        body.database?.activeServiceOrderWorkflowCount === 0,
        "expected no active service order workflows",
      );
    },
  },
  {
    name: "jobs",
    path: "/api/jobs",
    auth: true,
    expectedStatus: 200,
  },
  {
    name: "standards",
    path: "/api/standards",
    auth: true,
    expectedStatus: 200,
  },
  {
    name: "environmental limits",
    path: "/api/environmental-limits/effective/1?unitId=1",
    auth: true,
    expectedStatus: 200,
  },
];

const tempDir = await mkdtemp(path.join(os.tmpdir(), "calibra-desktop-smoke-"));
const serverLogPath = path.join(tempDir, "server.log");
const dbPath = path.join(tempDir, "calibra.sqlite");
const port = await getAvailablePort();
const logChunks = [];
let server = spawnLocalServer();

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  const readiness = await waitForReadiness(`${baseUrl}${readinessPath}`);
  assert(
    readiness.dbSchemaVersion === expectedLocalDbSchemaVersion,
    "readiness schema version mismatch",
  );
  assert(readiness.syncState === "offline", "expected offline sync state");
  assert(readiness.httpBaseUrl === baseUrl, "readiness base URL mismatch");

  const unauth = await fetch(`${baseUrl}/api/service-orders`);
  assert(
    unauth.status === 401,
    "unauthorized local API request was not denied",
  );
  seedCatalog(dbPath);

  for (const check of checks) {
    const response = await fetch(`${baseUrl}${check.path}`, {
      headers: check.auth
        ? { Authorization: `Bearer ${localToken}` }
        : undefined,
    });
    assert(
      response.status === check.expectedStatus,
      `${check.name} returned HTTP ${response.status}`,
    );

    if (check.verify) {
      check.verify(await response.json());
    }
  }

  await runConflictQueueSmoke(baseUrl);
  const workflow = await runOfflineWorkflowSmoke(baseUrl);
  await restartLocalServer(baseUrl);
  await verifyOfflineWorkflowPersisted(baseUrl, workflow);

  console.log(
    `Desktop local-server smoke passed on ${baseUrl} (${checks.length + 15} checks).`,
  );
} catch (error) {
  await writeCapturedLog();
  console.error(await readLogTail());
  throw error;
} finally {
  await stopLocalServer();
  await rm(tempDir, { force: true, recursive: true });
}

function spawnLocalServer() {
  const child = spawn(process.execPath, [stagedServerPath], {
    cwd: root,
    env: {
      ...process.env,
      CALIBRA_LOCAL_DB_PATH: dbPath,
      CALIBRA_LOCAL_STORAGE_DIR: path.join(tempDir, "files"),
      CALIBRA_LOCAL_PORT: String(port),
      CALIBRA_SYNC_ENABLED: "false",
      CALIBRA_LOCAL_BOOTSTRAP_TOKEN: localToken,
      CALIBRA_ORGANIZATION_ID: "org-1",
      CALIBRA_UNIT_ID: "1",
      CALIBRA_USER_ID: "user-1",
      CALIBRA_DESKTOP_RUN_ID: desktopRunId,
      CALIBRA_LOCAL_SERVER_RUN_ID: localServerRunId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logChunks.push(chunk));
  child.stderr.on("data", (chunk) => logChunks.push(chunk));
  return child;
}

async function stopLocalServer() {
  if (!server || server.exitCode !== null) return;
  server.kill();
  await new Promise((resolve) => {
    server.once("exit", resolve);
    setTimeout(resolve, 500).unref();
  });
}

async function restartLocalServer(baseUrl) {
  await stopLocalServer();
  server = spawnLocalServer();
  const readiness = await waitForReadiness(`${baseUrl}${readinessPath}`);
  assert(
    readiness.dbSchemaVersion === expectedLocalDbSchemaVersion,
    "restart readiness schema version mismatch",
  );
}

async function waitForReadiness(url) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < 15_000) {
    if (server.exitCode !== null) {
      throw new Error(`local server exited early with code ${server.exitCode}`);
    }

    try {
      // The bootstrap names the signed-in user, so it takes the same token as
      // /api/* (the desktop main process sends it on its readiness probe).
      const response = await fetch(url, { headers: authHeaders() });
      if (response.ok) {
        return response.json();
      }
      lastError = new Error(`readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError ?? new Error("local server did not become ready");
}

async function runOfflineWorkflowSmoke(baseUrl) {
  const customer = await postJson(baseUrl, "/api/customers", {
    name: "Cliente Smoke Offline",
    taxId: "12345678000199",
    email: "smoke@example.test",
    phone: "51999999999",
  });
  assert(customer.id, "customer creation did not return an id");

  const asset = await postJson(baseUrl, "/api/assets", {
    customerId: customer.id,
    assetTypeId: 10,
    name: "Balanca Smoke",
    manufacturer: "Calibra",
    model: "CF-10",
    serialNumber: "SMOKE-SN-001",
    tag: "SMOKE-TAG-001",
    status: "ACTIVE",
    baseMeasurementUnit: "g",
    specifications: {
      capacity: "10 kg",
      resolution: "0.1 g",
    },
  });
  assert(asset.id, "asset creation did not return an id");

  const serviceOrder = await postJson(baseUrl, "/api/service-orders", {
    customerId: customer.id,
    assetId: asset.id,
    intakeType: "counter",
    priority: "normal",
    claimedDefect: "Smoke offline intake",
    intakeCondition: "Recebida sem danos aparentes",
    accessories: "Fonte",
    deliveryMethod: "pickup_at_lab",
    assetSnapshot: {
      observedIdentification: "Etiqueta conferida",
      photos: [],
    },
  });
  assert(
    serviceOrder.data?.id,
    "service-order creation did not return a data.id",
  );
  assert(
    serviceOrder.data?.status === "awaiting_tech_evaluation",
    "service-order did not enter the expected intake status",
  );

  const attachment = await uploadAttachment(baseUrl, {
    entityType: "service_order",
    entityId: String(serviceOrder.data.id),
    content: "smoke attachment",
    fileName: "smoke-note.txt",
  });
  assert(attachment.id, "attachment upload did not return an id");

  const attachmentResponse = await fetch(
    `${baseUrl}/api/attachments/${encodeURIComponent(attachment.id)}`,
    {
      headers: authHeaders(),
    },
  );
  assert(
    attachmentResponse.status === 200,
    `attachment download returned HTTP ${attachmentResponse.status}`,
  );
  assert(
    (await attachmentResponse.text()) === "smoke attachment",
    "attachment download content mismatch",
  );

  const listedOrders = await getJson(
    baseUrl,
    "/api/service-orders?query=Smoke",
  );
  assert(
    listedOrders.data?.length === 1,
    "created offline service order was not listed",
  );

  const diagnostics = await getJson(baseUrl, "/api/local/diagnostics");
  assert(
    diagnostics.database?.pendingOutboxCount >= 4,
    "offline workflow did not queue expected outbox events",
  );
  assert(
    diagnostics.database?.integrity?.ok === true,
    "database integrity failed after offline workflow",
  );

  return {
    serviceOrderId: serviceOrder.data.id,
    attachmentId: attachment.id,
  };
}

async function verifyOfflineWorkflowPersisted(baseUrl, workflow) {
  const serviceOrder = await getJson(
    baseUrl,
    `/api/service-orders/${encodeURIComponent(String(workflow.serviceOrderId))}`,
  );
  assert(
    serviceOrder.data?.id === workflow.serviceOrderId,
    "offline service order did not survive local-server restart",
  );

  const attachmentResponse = await fetch(
    `${baseUrl}/api/attachments/${encodeURIComponent(workflow.attachmentId)}`,
    {
      headers: authHeaders(),
    },
  );
  assert(
    attachmentResponse.status === 200,
    `persisted attachment download returned HTTP ${attachmentResponse.status}`,
  );
}

async function runConflictQueueSmoke(baseUrl) {
  const conflictId = "smoke-conflict:calibration_job:job-smoke:event-smoke";
  seedSyncConflict(dbPath, conflictId);

  const list = await getJson(baseUrl, "/api/local/sync/conflicts?status=open");
  assert(list.total === 1, "seeded sync conflict was not listed");
  assert(list.data?.[0]?.id === conflictId, "listed sync conflict id mismatch");
  assert(
    list.data?.[0]?.eventId === "event-smoke-conflict",
    "listed sync conflict event id mismatch",
  );
  assert(
    list.data?.[0]?.localPayload?.status === "REVIEW",
    "listed sync conflict local payload mismatch",
  );
  assert(
    list.data?.[0]?.remotePayload?.status === "APPROVED",
    "listed sync conflict remote payload mismatch",
  );

  const resolved = await postJson(
    baseUrl,
    `/api/local/sync/conflicts/${encodeURIComponent(conflictId)}/resolve`,
    { status: "resolved" },
  );
  assert(
    resolved.data?.status === "resolved",
    "sync conflict did not resolve through local API",
  );

  const openAfterResolve = await getJson(
    baseUrl,
    "/api/local/sync/conflicts?status=open",
  );
  assert(
    openAfterResolve.total === 0,
    "resolved conflict still listed as open",
  );

  const row = readConflictOutboxState(dbPath);
  assert(row?.outbox_status === "pending", "conflict outbox was not retried");
  assert(
    row?.sync_state === "pending",
    "conflict domain event was not marked pending",
  );

  const diagnostics = await getJson(baseUrl, "/api/local/diagnostics");
  assert(
    diagnostics.database?.conflictCount === 0,
    "diagnostics still reported open conflicts after resolve",
  );
}

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    headers: authHeaders(),
  });
  assert(response.ok, `${pathName} returned HTTP ${response.status}`);
  return response.json();
}

async function postJson(baseUrl, pathName, body) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${pathName} returned HTTP ${response.status}: ${await response.text()}`,
    );
  }
  return response.json();
}

async function uploadAttachment(baseUrl, input) {
  const form = new FormData();
  form.set("entityType", input.entityType);
  form.set("entityId", input.entityId);
  form.set(
    "file",
    new Blob([input.content], { type: "text/plain" }),
    input.fileName,
  );

  const response = await fetch(`${baseUrl}/api/attachments`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!response.ok) {
    throw new Error(
      `/api/attachments returned HTTP ${response.status}: ${await response.text()}`,
    );
  }
  return response.json();
}

function authHeaders() {
  return { Authorization: `Bearer ${localToken}` };
}

function seedCatalog(filePath) {
  const database = new Database(filePath);
  const now = new Date().toISOString();

  try {
    database
      .prepare(
        `
INSERT INTO asset_types (
  id,
  remote_id,
  organization_id,
  name,
  specifications_schema_json,
  pulled_at,
  sync_state
) VALUES (
  'asset-type:10',
  10,
  'org-1',
  'Balanca',
  '{}',
  @now,
  'synced'
)
ON CONFLICT(id) DO NOTHING
`,
      )
      .run({ now });
  } finally {
    database.close();
  }
}

function seedSyncConflict(filePath, conflictId) {
  const database = new Database(filePath);
  const now = new Date().toISOString();

  try {
    database.transaction(() => {
      database
        .prepare(
          `
INSERT INTO domain_events (
  event_id,
  aggregate_kind,
  aggregate_id,
  aggregate_version,
  event_type,
  payload_json,
  metadata_json,
  actor_user_id,
  device_id,
  occurred_at,
  sync_state
) VALUES (
  'event-smoke-conflict',
  'calibration_job',
  'job-smoke',
  1,
  'submit_local_execution',
  '{"status":"REVIEW","data":{"readings":[]}}',
  '{}',
  'user-1',
  'device-smoke',
  @now,
  'conflict'
)
ON CONFLICT(event_id) DO NOTHING
`,
        )
        .run({ now });

      database
        .prepare(
          `
INSERT INTO outbox (
  id,
  event_id,
  operation,
  payload_json,
  idempotency_key,
  status,
  last_error,
  created_at
) VALUES (
  'outbox:event-smoke-conflict',
  'event-smoke-conflict',
  'submit_local_execution',
  '{"status":"REVIEW","data":{"readings":[]}}',
  'local:event-smoke-conflict',
  'conflict',
  'status_transition: conflict requires review',
  @now
)
ON CONFLICT(id) DO NOTHING
`,
        )
        .run({ now });

      database
        .prepare(
          `
INSERT INTO sync_conflicts (
  id,
  event_id,
  entity_type,
  entity_id,
  local_payload_json,
  remote_payload_json,
  conflict_type,
  status,
  created_at
) VALUES (
  @conflictId,
  'event-smoke-conflict',
  'calibration_job',
  'job-smoke',
  '{"status":"REVIEW","data":{"readings":[]}}',
  '{"status":"APPROVED"}',
  'status_transition',
  'open',
  @now
)
ON CONFLICT(id) DO NOTHING
`,
        )
        .run({ conflictId, now });
    })();
  } finally {
    database.close();
  }
}

function readConflictOutboxState(filePath) {
  const database = new Database(filePath, { readonly: true });
  try {
    return database
      .prepare(
        `
SELECT outbox.status AS outbox_status, domain_events.sync_state
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE outbox.event_id = 'event-smoke-conflict'
LIMIT 1
`,
      )
      .get();
  } finally {
    database.close();
  }
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("failed to allocate local port"));
        }
      });
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function writeCapturedLog() {
  if (logChunks.length === 0) return;
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(serverLogPath, Buffer.concat(logChunks)),
  );
}

async function readLogTail() {
  try {
    const log = await readFile(serverLogPath, "utf8");
    return log.split("\n").slice(-80).join("\n");
  } catch {
    return "No local-server log output captured.";
  }
}
