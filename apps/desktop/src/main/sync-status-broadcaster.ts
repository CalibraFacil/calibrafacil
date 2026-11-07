import { syncStatusSnapshotSchema } from "@calibra-facil/contracts";
import { broadcastBridgeEvent } from "./ipc/bridge-ipc";
import type { LocalServerClient } from "./local-server-client";

type Windows = Parameters<typeof broadcastBridgeEvent>[0];

/** Pushes the local sync status to every open window. */
export class SyncStatusBroadcaster {
  constructor(
    private readonly client: Pick<LocalServerClient, "syncStatus">,
    private readonly windows: Windows,
  ) {}

  async publish() {
    broadcastBridgeEvent(
      this.windows,
      "onSyncStatus",
      syncStatusSnapshotSchema.parse(await this.client.syncStatus()),
    );
  }

  /** The status as it is, but showing "syncing" while an action is in flight. */
  async publishSyncing() {
    const current = await this.client.syncStatus();
    broadcastBridgeEvent(
      this.windows,
      "onSyncStatus",
      syncStatusSnapshotSchema.parse({ ...current, state: "syncing" }),
    );
  }
}
