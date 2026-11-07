import { powerMonitor } from "electron";
import type { LocalServerClient } from "./local-server-client";

/**
 * Host-level reasons to sync that the local server cannot observe on its own.
 *
 * A technician who finishes work on a train, closes the lid, and opens it at
 * the lab gets `resume`; the OS network stack coming back gets `online`. Both
 * are coalesced by the scheduler, so a flapping connection produces one sync,
 * not one per event.
 */
export function registerSyncWakeTriggers(
  client: Pick<LocalServerClient, "wakeSync">,
) {
  powerMonitor.on("resume", () => {
    void client.wakeSync("reconnect");
  });

  // `unlock-screen` is not emitted on every platform; Electron ignores an
  // unknown listener rather than throwing, so no platform branch is needed.
  powerMonitor.on("unlock-screen", () => {
    void client.wakeSync("reconnect");
  });
}
