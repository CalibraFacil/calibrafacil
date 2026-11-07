import type { DesktopUpdater } from "../updater";
import type { HandlersFor } from "./handler-types";

/** The in-app updater. */
export function updateHandlers(
  updater: Pick<
    DesktopUpdater,
    "getState" | "checkForUpdate" | "downloadUpdate" | "installUpdate"
  >,
): HandlersFor<
  "getUpdateState" | "checkForUpdate" | "downloadUpdate" | "installUpdate"
> {
  return {
    getUpdateState: () => updater.getState(),
    checkForUpdate: () => updater.checkForUpdate(),
    downloadUpdate: () => updater.downloadUpdate(),
    installUpdate: () => updater.installUpdate(),
  };
}
