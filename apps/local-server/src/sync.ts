import {
  syncConflictResolutionResponseSchema,
  syncPullResponseSchema,
  syncBootstrapResponseSchema,
  syncPushResponseSchema,
  type SyncPushResponse,
  type SyncStatusSnapshot,
} from "@calibra-facil/contracts";
import {
  applySyncPullResponse,
  applySyncBootstrap,
  applySyncPushResult,
  countOpenSyncConflicts,
  countPendingOutbox,
  getSyncCursor,
  getSyncCursorUpdatedAt,
  listPendingOutboxEvents,
  markOutboxEventsFailedForRetry,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LocalServerConfig } from "./bootstrap";

export type LocalSyncRuntime = {
  getStatus(): SyncStatusSnapshot;
  runInitialSync(): Promise<SyncStatusSnapshot>;
  runPushSync(): Promise<SyncStatusSnapshot>;
};

export type CloudConflictResolutionStatus =
  | { state: "skipped"; reason: string }
  | { state: "recorded"; resolvedAt: string }
  | { state: "failed"; reason: string };

export type LocalSyncRuntimeOptions = {
  fetch?: typeof fetch;
};

export function createLocalSyncRuntime(
  config: LocalServerConfig,
  database: LocalDatabase,
  options: LocalSyncRuntimeOptions = {},
): LocalSyncRuntime {
  const fetchImpl = options.fetch ?? fetch;
  let status: SyncStatusSnapshot = {
    state: config.syncEnabled ? "idle" : "offline",
    pendingOutboxCount: countPendingOutbox(database),
    conflictCount: countOpenSyncConflicts(database),
    lastSyncedAt: getSyncCursorUpdatedAt(database),
    activeRunId: null,
    lastRunId: null,
    lastError: null,
  };
  let syncQueue: Promise<unknown> = Promise.resolve();

  return {
    getStatus() {
      status = withLocalCounts(database, status);
      return status;
    },
    runInitialSync() {
      return enqueueSync(runInitialSyncOnce);
    },
    runPushSync() {
      return enqueueSync(runPushSyncOnce);
    },
  };

  function enqueueSync(
    run: () => Promise<SyncStatusSnapshot>,
  ): Promise<SyncStatusSnapshot> {
    const queuedRun = syncQueue.catch(() => undefined).then(run);
    syncQueue = queuedRun.catch(() => undefined);
    return queuedRun;
  }

  async function runInitialSyncOnce() {
    const runId = createSyncRunId("initial");
    if (!config.syncEnabled) {
      status = {
        ...withLocalCounts(database, status),
        state: "offline",
        activeRunId: null,
        lastRunId: runId,
      };
      return status;
    }

    if (!config.cloudApiUrl) {
      status = {
        ...withLocalCounts(database, status),
        state: "error",
        activeRunId: null,
        lastRunId: runId,
        lastError: "Cloud API URL is not configured for local sync",
      };
      throw new Error("Cloud API URL is not configured for local sync");
    }

    status = {
      ...withLocalCounts(database, status),
      state: "syncing",
      activeRunId: runId,
      lastError: null,
    };
    console.log(
      `[sync:${runId}] starting initial sync for local-server ${config.localServerRunId}`,
    );

    try {
      await pushPendingOutbox(config, database, fetchImpl, {
        includeDeferred: true,
      });

      const bootstrapUrl = new URL("/api/sync/bootstrap", config.cloudApiUrl);
      const headers = new Headers({
        "Content-Type": "application/json",
      });

      applyCloudAuthHeaders(config, headers);

      const response = await fetchImpl(bootstrapUrl, {
        method: "POST",
        headers,
      });

      if (!response.ok) {
        throw new Error(`Cloud bootstrap failed with HTTP ${response.status}`);
      }

      const bootstrap = syncBootstrapResponseSchema.parse(
        await response.json(),
      );
      const syncedAt = new Date().toISOString();
      applySyncBootstrap(database, bootstrap, syncedAt);
      await pullCloudChanges(config, database, fetchImpl);

      status = {
        ...withLocalCounts(database, status),
        state:
          countOpenSyncConflicts(database) > 0
            ? "conflict"
            : countPendingOutbox(database) > 0
              ? "error"
              : "idle",
        lastSyncedAt: syncedAt,
        activeRunId: null,
        lastRunId: runId,
        lastError: null,
      };
      console.log(`[sync:${runId}] initial sync finished with ${status.state}`);
      return status;
    } catch (error) {
      status = {
        ...withLocalCounts(database, status),
        state: "error",
        activeRunId: null,
        lastRunId: runId,
        lastError: error instanceof Error ? error.message : "Sync failed",
      };
      console.error(`[sync:${runId}] initial sync failed: ${status.lastError}`);
      throw error;
    }
  }

  async function runPushSyncOnce() {
    const runId = createSyncRunId("push");
    if (!config.syncEnabled) {
      status = {
        ...withLocalCounts(database, status),
        state: "offline",
        activeRunId: null,
        lastRunId: runId,
      };
      return status;
    }

    if (!config.cloudApiUrl) {
      status = {
        ...withLocalCounts(database, status),
        state: "error",
        activeRunId: null,
        lastRunId: runId,
        lastError: "Cloud API URL is not configured for local sync",
      };
      throw new Error("Cloud API URL is not configured for local sync");
    }

    status = {
      ...withLocalCounts(database, status),
      state: "syncing",
      activeRunId: runId,
      lastError: null,
    };
    console.log(
      `[sync:${runId}] starting push sync for local-server ${config.localServerRunId}`,
    );

    try {
      await pushPendingOutbox(config, database, fetchImpl, {
        includeDeferred: true,
      });
      await pullCloudChanges(config, database, fetchImpl);
      status = {
        ...withLocalCounts(database, status),
        state:
          countOpenSyncConflicts(database) > 0
            ? "conflict"
            : countPendingOutbox(database) > 0
              ? "error"
              : "idle",
        lastSyncedAt: new Date().toISOString(),
        activeRunId: null,
        lastRunId: runId,
        lastError: null,
      };
      console.log(`[sync:${runId}] push sync finished with ${status.state}`);
      return status;
    } catch (error) {
      status = {
        ...withLocalCounts(database, status),
        state: "error",
        activeRunId: null,
        lastRunId: runId,
        lastError: error instanceof Error ? error.message : "Sync failed",
      };
      console.error(`[sync:${runId}] push sync failed: ${status.lastError}`);
      throw error;
    }
  }
}

function createSyncRunId(kind: "initial" | "push") {
  return `${kind}-${randomUUID()}`;
}

export async function notifyCloudConflictResolution(
  config: LocalServerConfig,
  conflictId: string,
  status: "resolved" | "ignored",
  fetchImpl: typeof fetch = fetch,
): Promise<CloudConflictResolutionStatus> {
  if (!config.syncEnabled) {
    return { state: "skipped", reason: "sync disabled" };
  }

  if (!config.cloudApiUrl) {
    return { state: "skipped", reason: "cloud API URL not configured" };
  }

  const url = new URL(
    `/api/sync/conflicts/${encodeURIComponent(conflictId)}/resolve`,
    config.cloudApiUrl,
  );
  const headers = new Headers({
    "Content-Type": "application/json",
  });

  applyCloudAuthHeaders(config, headers);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      return {
        state: "failed",
        reason: `cloud conflict resolution failed with HTTP ${response.status}`,
      };
    }

    const body = syncConflictResolutionResponseSchema.parse(
      await response.json(),
    );
    return { state: "recorded", resolvedAt: body.data.resolvedAt };
  } catch (error) {
    return {
      state: "failed",
      reason:
        error instanceof Error
          ? error.message
          : "cloud conflict resolution failed",
    };
  }
}

async function pullCloudChanges(
  config: LocalServerConfig,
  database: LocalDatabase,
  fetchImpl: typeof fetch,
) {
  if (!config.cloudApiUrl) {
    throw new Error("Cloud API URL is not configured for local sync");
  }

  for (let page = 0; page < 20; page += 1) {
    const pullUrl = new URL("/api/sync/pull", config.cloudApiUrl);
    const cursor = getSyncCursor(database);
    if (cursor) {
      pullUrl.searchParams.set("cursor", cursor);
    }

    const headers = new Headers();
    applyCloudAuthHeaders(config, headers);

    const response = await fetchImpl(pullUrl, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      throw new Error(`Cloud pull failed with HTTP ${response.status}`);
    }

    const body = syncPullResponseSchema.parse(await response.json());
    applySyncPullResponse(database, body);

    if (!body.hasMore) {
      return;
    }
  }

  throw new Error("Cloud pull did not converge after 20 pages");
}

async function pushPendingOutbox(
  config: LocalServerConfig,
  database: LocalDatabase,
  fetchImpl: typeof fetch,
  options: { includeDeferred?: boolean } = {},
) {
  if (!config.cloudApiUrl) {
    throw new Error("Cloud API URL is not configured for local sync");
  }
  const cloudApiUrl = config.cloudApiUrl;

  const pending = listPendingOutboxEvents(database, 50, {
    includeDeferred: options.includeDeferred,
  });
  if (pending.length === 0) return;

  const certificatePdfEvents = pending.filter(
    (event) => event.operation === "generate_local_certificate_pdf",
  );
  const regularEvents = pending.filter(
    (event) => event.operation !== "generate_local_certificate_pdf",
  );

  if (regularEvents.length > 0) {
    await pushOutboxEvents(
      config,
      database,
      fetchImpl,
      regularEvents,
      cloudApiUrl,
    );
  }

  if (certificatePdfEvents.length > 0) {
    await uploadPendingCertificatePdfs(
      config,
      database,
      fetchImpl,
      certificatePdfEvents,
      cloudApiUrl,
    );
  }
}

async function pushOutboxEvents(
  config: LocalServerConfig,
  database: LocalDatabase,
  fetchImpl: typeof fetch,
  pending: ReturnType<typeof listPendingOutboxEvents>,
  cloudApiUrl: string,
) {
  if (pending.length === 0) return;

  const context = getLocalSyncContext(config, database);
  const pushUrl = new URL("/api/sync/push", cloudApiUrl);
  const headers = new Headers({
    "Content-Type": "application/json",
  });

  applyCloudAuthHeaders(config, headers);

  let response: Response;
  try {
    response = await fetchImpl(pushUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        deviceId: config.deviceId,
        clientBatchId: `batch:${crypto.randomUUID()}`,
        baseCursor: getSyncCursor(database),
        events: pending.map((event) => ({
          eventId: event.eventId,
          entityType: event.entityType,
          entityId: event.entityId,
          operation: event.operation,
          payload: event.payload,
          occurredAt: event.occurredAt,
          actorUserId: event.actorUserId ?? context.userId ?? "local",
          organizationId: context.organizationId ?? "",
          unitId: context.unitId,
          idempotencyKey: event.idempotencyKey,
          localVersion: event.localVersion,
        })),
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cloud push request failed";
    markOutboxEventsFailedForRetry(
      database,
      pending.map((event) => event.eventId),
      message,
    );
    throw error;
  }

  if (!response.ok) {
    markOutboxEventsFailedForRetry(
      database,
      pending.map((event) => event.eventId),
      `Cloud push failed with HTTP ${response.status}`,
    );
    throw new Error(`Cloud push failed with HTTP ${response.status}`);
  }

  applySyncPushResult(
    database,
    syncPushResponseSchema.parse(await response.json()),
  );
}

async function uploadPendingCertificatePdfs(
  config: LocalServerConfig,
  database: LocalDatabase,
  fetchImpl: typeof fetch,
  pending: ReturnType<typeof listPendingOutboxEvents>,
  cloudApiUrl: string,
) {
  const uploadUrl = new URL("/api/sync/certificate-pdfs", cloudApiUrl);
  const context = getLocalSyncContext(config, database);
  const accepted: SyncPushResponse["accepted"] = [];
  const rejected: SyncPushResponse["rejected"] = [];

  for (const event of pending) {
    const payload = asRecord(event.payload);
    const localPath = getString(payload, "localPath");
    const localJobId = getString(payload, "jobId");
    const remoteJobId = getNumber(payload, "remoteJobId");
    const draftId = getString(payload, "draftId");
    const contentHash = getString(payload, "contentHash");
    const sizeBytes = getNumber(payload, "sizeBytes");

    if (!localPath || !localJobId || !draftId || !contentHash || !sizeBytes) {
      rejected.push({
        eventId: event.eventId,
        code: "INVALID_LOCAL_CERTIFICATE_PDF_EVENT",
        reason: "Local certificate PDF sync event is missing metadata.",
      });
      continue;
    }

    const absolutePath = resolveLocalStoragePath(config.storageRoot, localPath);
    const bytes = await readFile(absolutePath);
    const formData = new FormData();
    formData.set("eventId", event.eventId);
    formData.set("entityId", event.entityId);
    formData.set("operation", event.operation);
    formData.set("idempotencyKey", event.idempotencyKey);
    formData.set("localVersion", String(event.localVersion));
    formData.set("occurredAt", event.occurredAt);
    formData.set("actorUserId", event.actorUserId ?? context.userId ?? "local");
    formData.set("organizationId", context.organizationId ?? "");
    formData.set(
      "unitId",
      context.unitId === null ? "" : String(context.unitId),
    );
    formData.set("localJobId", localJobId);
    if (remoteJobId !== null) {
      formData.set("remoteJobId", String(remoteJobId));
    }
    formData.set("draftId", draftId);
    formData.set("contentHash", contentHash);
    formData.set("sizeBytes", String(sizeBytes));
    formData.set(
      "file",
      new Blob([toArrayBuffer(bytes)], { type: "application/pdf" }),
      `${draftId}.pdf`,
    );

    const headers = new Headers();
    applyCloudAuthHeaders(config, headers);

    const response = await fetchImpl(uploadUrl, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      rejected.push({
        eventId: event.eventId,
        code: "CERTIFICATE_PDF_UPLOAD_FAILED",
        reason: `Cloud certificate PDF upload failed with HTTP ${response.status}.`,
      });
      continue;
    }

    const body = syncPushResponseSchema.parse(await response.json());
    accepted.push(...body.accepted);
    rejected.push(...body.rejected);
  }

  applySyncPushResult(
    database,
    syncPushResponseSchema.parse({
      accepted,
      rejected,
      conflicts: [],
    }),
  );
}

function getLocalSyncContext(
  config: LocalServerConfig,
  database: LocalDatabase,
) {
  const snapshot = database
    .prepare<
      [],
      {
        organization_id: string;
        active_unit_id: number | null;
        user_id: string;
      }
    >(
      `
SELECT organization_id, active_unit_id, user_id
FROM tenant_snapshot
ORDER BY pulled_at DESC
LIMIT 1
`,
    )
    .get();

  return {
    organizationId: config.organizationId ?? snapshot?.organization_id ?? null,
    unitId: config.unitId ?? snapshot?.active_unit_id ?? null,
    userId: config.userId ?? snapshot?.user_id ?? null,
  };
}

function resolveLocalStoragePath(storageRoot: string, localPath: string) {
  const root = path.resolve(storageRoot);
  const target = path.resolve(root, localPath);

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Caminho local invalido");
  }

  return target;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function getString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function applyCloudAuthHeaders(config: LocalServerConfig, headers: Headers) {
  if (config.cloudAuthToken) {
    headers.set("Authorization", `Bearer ${config.cloudAuthToken}`);
  }

  if (config.cloudProxyToken) {
    headers.set("x-calibra-desktop-cloud-proxy-token", config.cloudProxyToken);
  }
}

function withLocalCounts(
  database: LocalDatabase,
  snapshot: SyncStatusSnapshot,
): SyncStatusSnapshot {
  return {
    ...snapshot,
    pendingOutboxCount: countPendingOutbox(database),
    conflictCount: countOpenSyncConflicts(database),
    lastSyncedAt: snapshot.lastSyncedAt ?? getSyncCursorUpdatedAt(database),
  };
}
