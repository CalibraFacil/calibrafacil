import type { SyncActionResult } from "@calibra-facil/contracts";
import type { LocalServerClient } from "../local-server-client";
import type { SyncStatusBroadcaster } from "../sync-status-broadcaster";
import type { HandlersFor } from "./handler-types";

type SyncHandlerDeps = {
  client: Pick<LocalServerClient, "syncStatus" | "postSyncAction" | "wakeSync">;
  broadcaster: Pick<SyncStatusBroadcaster, "publish" | "publishSyncing">;
};

/** Reading and driving the continuous sync loop of the local server. */
export function syncHandlers(
  deps: SyncHandlerDeps,
): HandlersFor<
  | "getSyncState"
  | "getSyncStatus"
  | "startSync"
  | "pauseSync"
  | "resumeSync"
  | "retrySync"
  | "wakeSync"
> {
  const { client, broadcaster } = deps;

  /** Run an action, then tell the renderers where the status ended up. */
  const act = async (
    pathname: string,
    options: { showSyncing: boolean },
  ): Promise<SyncActionResult> => {
    if (options.showSyncing) await broadcaster.publishSyncing();
    const result = await client.postSyncAction(pathname);
    await broadcaster.publish();
    return result;
  };

  return {
    getSyncState: async () => (await client.syncStatus()).state,
    getSyncStatus: () => client.syncStatus(),
    startSync: () => act("/api/local/sync/start", { showSyncing: true }),
    pauseSync: () => act("/api/local/sync/pause", { showSyncing: false }),
    resumeSync: () => act("/api/local/sync/resume", { showSyncing: false }),
    retrySync: () => act("/api/local/sync/retry", { showSyncing: true }),
    wakeSync: async (trigger) => {
      const result = await client.wakeSync(trigger);
      await broadcaster.publish();
      return result;
    },
  };
}
