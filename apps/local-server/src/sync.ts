import {
  SYNC_CHANGE_SEQ_PROTOCOL_VERSION,
  SYNC_PROTOCOL_VERSION,
  SYNC_PULL_PROTOCOL_PARAM,
  desktopUpdateRequiredMessage,
  syncBootstrapPageResponseSchema,
  syncConflictResolutionResponseSchema,
  syncResyncRequiredResponseSchema,
  syncProtocolUnsupportedResponseSchema,
  syncUpdateRequiredResponseSchema,
  syncPullResponseSchema,
  syncBootstrapResponseSchema,
  syncPushResponseSchema,
  type SyncPushRequest,
  type SyncResyncRequiredResponse,
  type SyncStatusSnapshot,
} from "@calibra-facil/contracts";
import {
  applySyncPullResponse,
  applySyncBootstrap,
  applySyncBootstrapPage,
  applySyncPushResult,
  countDeadOutbox,
  countDeferredOutbox,
  countOpenSyncConflicts,
  countPendingOutbox,
  countPendingOutboxForOtherUsers,
  discardBootstrapProgress,
  getBootstrapPageToken,
  getSyncCursor,
  getSyncCursorUpdatedAt,
  hasIncompleteBootstrap,
  listPendingOutboxEvents,
  releaseSettledSkippedRows,
  markOutboxEventsFailedForRetry,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import { randomUUID } from "node:crypto";
import { uploadAttachmentsBeforePush } from "./attachment-upload";
import type { LocalServerConfig } from "./bootstrap";

export type LocalSyncRuntime = {
  getStatus(): SyncStatusSnapshot;
  runInitialSync(): Promise<SyncStatusSnapshot>;
  /**
   * Push and pull. A scheduled run respects each queued event's retry delay;
   * a deliberate one (the user pressing sync, a reconnect) passes
   * `includeDeferred` to try the events that are still backing off too, after
   * the ones that are due.
   */
  runPushSync(options?: PushSyncOptions): Promise<SyncStatusSnapshot>;
};

type PushSyncOptions = { includeDeferred?: boolean };

/**
 * The cloud will not take pushes from this build any more (its minimum desktop
 * version is higher). Nothing was applied and nothing is changed locally: the
 * queued events wait for the update.
 */
export class DesktopUpdateRequiredError extends Error {
  readonly minimumVersion: string;

  constructor(minimumVersion: string) {
    super(desktopUpdateRequiredMessage(minimumVersion));
    this.name = "DesktopUpdateRequiredError";
    this.minimumVersion = minimumVersion;
  }
}

function updateRequiredVersionOf(error: unknown): string | null {
  return error instanceof DesktopUpdateRequiredError
    ? error.minimumVersion
    : null;
}

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
    pendingForOtherUserCount: countPendingOutboxForOtherUsers(
      database,
      getLocalSyncContext(config, database).userId,
    ),
    deferredOutboxCount: countDeferredOutbox(database),
    deadOutboxCount: countDeadOutbox(database),
    conflictCount: countOpenSyncConflicts(database),
    lastSyncedAt: getSyncCursorUpdatedAt(database),
    activeRunId: null,
    lastRunId: null,
    lastError: null,
  };
  let syncQueue: Promise<unknown> = Promise.resolve();

  return {
    getStatus() {
      status = withLocalCounts(config, database, status);
      return status;
    },
    runInitialSync() {
      return enqueueSync(runInitialSyncOnce);
    },
    runPushSync(pushOptions = {}) {
      return enqueueSync(() => runPushSyncOnce(pushOptions));
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
        ...withLocalCounts(config, database, status),
        state: "offline",
        activeRunId: null,
        lastRunId: runId,
      };
      return status;
    }

    if (!config.cloudApiUrl) {
      status = {
        ...withLocalCounts(config, database, status),
        state: "error",
        activeRunId: null,
        lastRunId: runId,
        lastError: "Cloud API URL is not configured for local sync",
      };
      throw new Error("Cloud API URL is not configured for local sync");
    }

    status = {
      ...withLocalCounts(config, database, status),
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

      const syncedAt = new Date().toISOString();
      await bootstrapFromCloud(config, database, fetchImpl, syncedAt);
      await pullCloudChangesOrBootstrap(config, database, fetchImpl);

      status = {
        ...withLocalCounts(config, database, status),
        state:
          countOpenSyncConflicts(database) > 0
            ? "conflict"
            : hasUnsentOwnChanges(config, database)
              ? "error"
              : "idle",
        lastSyncedAt: syncedAt,
        activeRunId: null,
        lastRunId: runId,
        lastError: null,
        updateRequiredVersion: null,
      };
      console.log(`[sync:${runId}] initial sync finished with ${status.state}`);
      return status;
    } catch (error) {
      status = {
        ...withLocalCounts(config, database, status),
        state: "error",
        activeRunId: null,
        lastRunId: runId,
        lastError: error instanceof Error ? error.message : "Sync failed",
        updateRequiredVersion: updateRequiredVersionOf(error),
      };
      console.error(`[sync:${runId}] initial sync failed: ${status.lastError}`);
      throw error;
    }
  }

  async function runPushSyncOnce(pushOptions: PushSyncOptions) {
    // A delta sync against a database that was never bootstrapped cannot
    // succeed: the pull either throws because no snapshot exists, or records a
    // cursor without creating one, leaving automatic retries unable to ever
    // establish a usable cache. This happens for real — an authenticated
    // desktop whose local data was reset or newly partitioned while the cloud
    // session persisted. Fall back to the full bootstrap rather than looping.
    if (
      config.syncEnabled &&
      config.cloudApiUrl &&
      (!hasBootstrapSnapshot() || hasIncompleteBootstrap(database))
    ) {
      // A bootstrap that was interrupted between two pages is resumed, not pulled over.
      return runInitialSyncOnce();
    }

    const runId = createSyncRunId("push");
    if (!config.syncEnabled) {
      status = {
        ...withLocalCounts(config, database, status),
        state: "offline",
        activeRunId: null,
        lastRunId: runId,
      };
      return status;
    }

    if (!config.cloudApiUrl) {
      status = {
        ...withLocalCounts(config, database, status),
        state: "error",
        activeRunId: null,
        lastRunId: runId,
        lastError: "Cloud API URL is not configured for local sync",
      };
      throw new Error("Cloud API URL is not configured for local sync");
    }

    status = {
      ...withLocalCounts(config, database, status),
      state: "syncing",
      activeRunId: runId,
      lastError: null,
    };
    console.log(
      `[sync:${runId}] starting push sync for local-server ${config.localServerRunId}`,
    );

    try {
      await pushPendingOutbox(config, database, fetchImpl, {
        includeDeferred: pushOptions.includeDeferred === true,
      });
      await pullCloudChangesOrBootstrap(config, database, fetchImpl);
      status = {
        ...withLocalCounts(config, database, status),
        state:
          countOpenSyncConflicts(database) > 0
            ? "conflict"
            : hasUnsentOwnChanges(config, database)
              ? "error"
              : "idle",
        lastSyncedAt: new Date().toISOString(),
        activeRunId: null,
        lastRunId: runId,
        lastError: null,
        updateRequiredVersion: null,
      };
      console.log(`[sync:${runId}] push sync finished with ${status.state}`);
      return status;
    } catch (error) {
      status = {
        ...withLocalCounts(config, database, status),
        state: "error",
        activeRunId: null,
        lastRunId: runId,
        lastError: error instanceof Error ? error.message : "Sync failed",
        updateRequiredVersion: updateRequiredVersionOf(error),
      };
      console.error(`[sync:${runId}] push sync failed: ${status.lastError}`);
      throw error;
    }
  }

  function hasBootstrapSnapshot() {
    const row = database
      .prepare<
        [],
        { total: number }
      >("SELECT COUNT(*) AS total FROM tenant_snapshot")
      .get();

    return (row?.total ?? 0) > 0;
  }
}

const MAX_PULL_PAGES = 200;

/** The push protocol an older cloud told this process it speaks, per cloud URL. */
const cloudPushProtocol = new Map<string, number>();
/** A bootstrap page is at most 1000 rows (SYNC_BOOTSTRAP_MAX_PAGE_SIZE): 100k pages is a loop, not a laboratory. */
const MAX_BOOTSTRAP_PAGES = 100_000;

/**
 * The cloud cannot serve this desktop's pull cursor (SYNC_RESYNC_REQUIRED): there is
 * none, it is of the `updatedAt` protocols, or it is older than the change log is kept.
 */
export class ResyncRequiredError extends Error {
  readonly reason: SyncResyncRequiredResponse["reason"];

  constructor(reason: SyncResyncRequiredResponse["reason"]) {
    super(`Cloud asked for a new bootstrap (${reason})`);
    this.name = "ResyncRequiredError";
    this.reason = reason;
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

/**
 * The initial sync: the paged bootstrap of protocol 3, resuming at the page after the
 * last one that was applied when a previous run was cut short (the token is stored with
 * the page's rows, atomically). A cloud that predates protocol 3 ignores the request's
 * `protocolVersion` and answers the whole bootstrap at once, which is applied as before.
 */
async function bootstrapFromCloud(
  config: LocalServerConfig,
  database: LocalDatabase,
  fetchImpl: typeof fetch,
  syncedAt: string,
) {
  if (!config.cloudApiUrl) {
    throw new Error("Cloud API URL is not configured for local sync");
  }
  const bootstrapUrl = new URL("/api/sync/bootstrap", config.cloudApiUrl);

  let token = getBootstrapPageToken(database);
  let discardedStaleToken = false;
  for (let page = 0; page < MAX_BOOTSTRAP_PAGES; page += 1) {
    const headers = new Headers({ "Content-Type": "application/json" });
    applyCloudAuthHeaders(config, headers);

    const response = await fetchImpl(bootstrapUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        protocolVersion: SYNC_CHANGE_SEQ_PROTOCOL_VERSION,
        pageToken: token,
      }),
    });

    if (response.status === 400 && token !== null && !discardedStaleToken) {
      // The cloud no longer accepts the token (it was cut by another build): start over.
      discardBootstrapProgress(database);
      token = null;
      discardedStaleToken = true;
      continue;
    }
    if (!response.ok) {
      throw new Error(`Cloud bootstrap failed with HTTP ${response.status}`);
    }

    const body: unknown = await response.json();
    const paged = syncBootstrapPageResponseSchema.safeParse(body);
    if (!paged.success) {
      // Protocol 1/2 cloud: the whole thing in one response.
      discardBootstrapProgress(database);
      applySyncBootstrap(
        database,
        syncBootstrapResponseSchema.parse(body),
        syncedAt,
      );
      return;
    }

    applySyncBootstrapPage(
      database,
      paged.data,
      { first: token === null },
      syncedAt,
    );
    token = paged.data.page.nextToken;
    if (token === null) return;
  }

  throw new Error(
    `Cloud bootstrap did not finish after ${MAX_BOOTSTRAP_PAGES} pages`,
  );
}

/**
 * Pull; when the cloud says the cursor cannot be served (a desktop that just upgraded
 * from protocol 2, one offline longer than the change log is kept), bootstrap again and
 * pull once more. Its queued local changes are untouched by a bootstrap.
 */
async function pullCloudChangesOrBootstrap(
  config: LocalServerConfig,
  database: LocalDatabase,
  fetchImpl: typeof fetch,
) {
  try {
    await pullCloudChanges(config, database, fetchImpl);
  } catch (error) {
    if (!(error instanceof ResyncRequiredError)) throw error;
    console.log(`[sync] ${error.message}`);
    discardBootstrapProgress(database);
    await bootstrapFromCloud(
      config,
      database,
      fetchImpl,
      new Date().toISOString(),
    );
    await pullCloudChanges(config, database, fetchImpl);
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

  // Rows a previous pull skipped because of queued local changes that have
  // since settled (a conflict ignored, say) are fetched again: rewind first.
  releaseSettledSkippedRows(database);

  // The server pages the pull (`hasMore`) and the cursor it returns is the
  // position the next page resumes from: keep asking until it says it is done.
  // The cursor is persisted after every page, so a run cut short by the page
  // cap (or a network failure) resumes where it stopped instead of restarting.
  for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
    const pullUrl = new URL("/api/sync/pull", config.cloudApiUrl);
    // States the protocol this desktop pulls with: a cloud of protocol 3 or later serves
    // the commit-ordered change log, an older one ignores it and serves `updatedAt`.
    pullUrl.searchParams.set(
      SYNC_PULL_PROTOCOL_PARAM,
      String(SYNC_CHANGE_SEQ_PROTOCOL_VERSION),
    );
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

    if (response.status === 409) {
      const answer = syncResyncRequiredResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (answer.success) throw new ResyncRequiredError(answer.data.reason);
    }

    if (!response.ok) {
      throw new Error(`Cloud pull failed with HTTP ${response.status}`);
    }

    const body = syncPullResponseSchema.parse(await response.json());
    applySyncPullResponse(database, body);

    if (!body.hasMore) {
      return;
    }

    // A server that keeps saying "more" without moving the cursor would make
    // this loop re-download the same page until the cap.
    if (getSyncCursor(database) === cursor) {
      throw new Error("Cloud pull made no progress: cursor did not advance");
    }
  }

  throw new Error(`Cloud pull did not converge after ${MAX_PULL_PAGES} pages`);
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

  // Only what the signed-in user authored (or nobody did): the cloud records
  // the pushing session as the actor, so a colleague's offline work must not be
  // sent under this session. It stays queued until its author signs in.
  const pending = listPendingOutboxEvents(database, 50, {
    includeDeferred: options.includeDeferred,
    actorUserId: getLocalSyncContext(config, database).userId,
  });
  if (pending.length === 0) return;

  // An attachment's file goes to the cloud before its event does (init-upload,
  // PUT, complete-upload: attachment-upload.ts); an event whose file is not on
  // the cloud yet stays out of this push and is retried or dead, as the cause
  // decides. Every other event travels as an event: there is no side channel for
  // certificate bytes (certificates are rendered and signed in the cloud after an
  // online approval, so a queued `generate_local_certificate_pdf` from an older
  // build is pushed like any other and the cloud refuses it with a precise code).
  const ready = await uploadAttachmentsBeforePush(
    {
      config,
      database,
      fetchImpl,
      cloudApiUrl,
      applyCloudAuthHeaders: (headers) =>
        applyCloudAuthHeaders(config, headers),
    },
    pending,
  );
  await pushOutboxEvents(config, database, fetchImpl, ready, cloudApiUrl);
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

  const buildRequest = (protocolVersion: number) =>
    ({
      deviceId: config.deviceId,
      clientBatchId: `batch:${crypto.randomUUID()}`,
      baseCursor: getSyncCursor(database),
      // Which protocol and which build this push comes from: the cloud
      // answers "update required" to a build below its minimum.
      protocolVersion,
      desktopVersion: config.appVersion,
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
        baseUpdatedAt: event.baseUpdatedAt ?? null,
      })),
    }) satisfies SyncPushRequest;

  // The push wire format did not change with protocol 3 (only the pull and the
  // bootstrap did), so a cloud that predates it can read this push; it only refuses
  // the number. Such a cloud names the newest protocol it speaks
  // (SYNC_PROTOCOL_UNSUPPORTED): ask again with that one, once, and remember it.
  let pushProtocol =
    cloudPushProtocol.get(cloudApiUrl) ?? SYNC_PROTOCOL_VERSION;
  let response: Response;
  try {
    response = await fetchImpl(pushUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(buildRequest(pushProtocol)),
    });
    if (response.status === 400) {
      const unsupported = syncProtocolUnsupportedResponseSchema.safeParse(
        await response
          .clone()
          .json()
          .catch(() => null),
      );
      if (
        unsupported.success &&
        unsupported.data.supportedProtocolVersion < pushProtocol
      ) {
        pushProtocol = unsupported.data.supportedProtocolVersion;
        cloudPushProtocol.set(cloudApiUrl, pushProtocol);
        response = await fetchImpl(pushUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(buildRequest(pushProtocol)),
        });
      }
    }
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

  if (response.status === 426) {
    // "Update required" is not a failed attempt: the cloud looked at nothing,
    // so the events are neither failed nor backing off. They stay exactly as
    // they are until the app is updated.
    const answer = syncUpdateRequiredResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (answer.success) {
      throw new DesktopUpdateRequiredError(answer.data.minimumVersion);
    }
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

function applyCloudAuthHeaders(config: LocalServerConfig, headers: Headers) {
  if (config.cloudAuthToken) {
    headers.set("Authorization", `Bearer ${config.cloudAuthToken}`);
  }

  if (config.cloudProxyToken) {
    headers.set("x-calibra-desktop-cloud-proxy-token", config.cloudProxyToken);
  }
}

/**
 * Changes the signed-in user could still send. Another user's queued events are
 * not a failure of this run: they wait for their author.
 */
function hasUnsentOwnChanges(
  config: LocalServerConfig,
  database: LocalDatabase,
) {
  return (
    countPendingOutbox(database) -
      countPendingOutboxForOtherUsers(
        database,
        getLocalSyncContext(config, database).userId,
      ) >
    0
  );
}

function withLocalCounts(
  config: LocalServerConfig,
  database: LocalDatabase,
  snapshot: SyncStatusSnapshot,
): SyncStatusSnapshot {
  return {
    ...snapshot,
    pendingOutboxCount: countPendingOutbox(database),
    pendingForOtherUserCount: countPendingOutboxForOtherUsers(
      database,
      getLocalSyncContext(config, database).userId,
    ),
    deferredOutboxCount: countDeferredOutbox(database),
    deadOutboxCount: countDeadOutbox(database),
    conflictCount: countOpenSyncConflicts(database),
    lastSyncedAt: snapshot.lastSyncedAt ?? getSyncCursorUpdatedAt(database),
  };
}
