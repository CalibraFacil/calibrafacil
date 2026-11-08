import {
  SYNC_DESKTOP_VERSION_FLOOR,
  SYNC_PROTOCOL_VERSION,
} from "@calibra-facil/contracts";

/**
 * What a desktop build the cloud still serves puts in every push: the protocol it speaks and its
 * own version. A push that states neither is a build older than the floor (protocols 1 and 2) and
 * is answered "update required".
 */
export const CURRENT_DESKTOP_BUILD = {
  protocolVersion: SYNC_PROTOCOL_VERSION,
  desktopVersion: SYNC_DESKTOP_VERSION_FLOOR,
} as const;
