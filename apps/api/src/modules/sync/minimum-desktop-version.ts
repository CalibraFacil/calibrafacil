import { readSyncConfig } from "@calibra-facil/config";
import {
  buildSyncUpdateRequiredResponse,
  effectiveMinimumDesktopVersion,
} from "@calibra-facil/contracts";

/**
 * The oldest desktop build the cloud serves: `SYNC_DESKTOP_VERSION_FLOOR`, or the
 * operator's `SYNC_MIN_DESKTOP_VERSION` when that is higher. Always defined: a
 * desktop below it is told to update, never served by a retired path.
 */
export function minimumDesktopVersion(): string {
  return effectiveMinimumDesktopVersion(readSyncConfig().minDesktopVersion);
}

/**
 * The "update required" answer (HTTP 426) to a request of a desktop the cloud no
 * longer serves. A pull or a bootstrap carries no desktop version, so it is null there.
 */
export function updateRequiredBody(desktopVersion: string | null) {
  return buildSyncUpdateRequiredResponse({
    minimumVersion: minimumDesktopVersion(),
    desktopVersion,
  });
}
