import { type SyncCommand } from "@calibra-facil/contracts";
import { type MemberData } from "../../middleware/permission";
import { type R2Env } from "../../lib/storage";
import { prepareCreateLocalAttachment } from "./apply-attachment";
import { type PreparedDesktopEventSideEffects } from "./desktop-event-support";

/**
 * What an event needs before its own transaction (see PreparedDesktopEventSideEffects):
 * only an attachment does (its bytes were uploaded through the attachment endpoints and are
 * verified here); every other operation gets nothing.
 */
export async function prepareDesktopEventSideEffects(
  command: SyncCommand,
  memberData: MemberData,
  context: { env: R2Env | undefined; protocolVersion: number },
): Promise<PreparedDesktopEventSideEffects> {
  return prepareCreateLocalAttachment(command, memberData, context);
}
