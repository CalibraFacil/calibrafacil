import { DomainError } from "../../lib/domain-errors";
import { reportServerError } from "../../lib/observability";
import {
  DESKTOP_EVENT_APPLY_FAILED_REASON,
  type ApplyDesktopSyncEventInput,
  type ApplyDesktopSyncEventResult,
} from "./desktop-event-support";
import { applyCreateLocalAsset } from "./apply-asset-create";
import { applyCreateLocalAttachment } from "./apply-attachment";
import { applyLocalJobExecution } from "./apply-job-execution";
import { applyCreateLocalServiceOrderIntake } from "./apply-service-order-intake";

export async function applyDesktopSyncEvent(
  input: ApplyDesktopSyncEventInput,
): Promise<ApplyDesktopSyncEventResult> {
  // The recorded actor (performedBy / createdBy / approver) is ALWAYS the
  // authenticated pushing user. The actor id inside the pushed event is a
  // client assertion the server cannot verify, so it never becomes an identity
  // in the regulated trail; it is kept only as audit metadata
  // (`claimedActorUserId`, see writeDesktopSyncAudit).
  const actorUserId = input.sessionUserId;

  try {
    // One case per member of the typed push protocol (packages/contracts
    // sync-protocol.ts): adding an operation there fails to compile here until
    // the cloud says what it does with it.
    switch (input.event.operation) {
      case "create_local_asset":
        return await applyCreateLocalAsset(input, actorUserId);
      case "save_local_execution":
      case "submit_local_execution":
        return await applyLocalJobExecution(input, actorUserId);
      case "create_local_service_order_intake":
        return await applyCreateLocalServiceOrderIntake(input, actorUserId);
      // The attachment's bytes travel through the attachment endpoints; the event
      // is recorded only once they were verified (prepareCreateLocalAttachment
      // refused it before this point otherwise).
      case "create_local_attachment":
        return await applyCreateLocalAttachment(input, actorUserId);
      default:
        return assertNever(input.event);
    }
  } catch (error) {
    const code = applyFailureCode(error);
    // A `DomainError` words its refusal for the client: that is the reason the device
    // shows. Anything else is an unexpected failure (a failed query's message carries the
    // bound row values): the device gets a fixed reason, the cause goes to the redacted
    // reporter.
    if (error instanceof DomainError) {
      return { ok: false, code, reason: error.message };
    }
    reportServerError(error, {
      surface: "sync",
      tags: {
        step: "apply-event",
        organizationId: input.memberData.organizationId,
        eventId: input.event.eventId,
      },
    });
    return {
      ok: false,
      code,
      reason: DESKTOP_EVENT_APPLY_FAILED_REASON,
    };
  }
}

/**
 * A typed refusal (a 4xx `DomainError` other than "slow down") can never
 * succeed on retry: permanent. Anything else is an internal fault the desktop
 * retries. The refusal's wording is never the signal.
 */
export function applyFailureCode(
  error: unknown,
): "DOMAIN_VALIDATION_FAILED" | "DESKTOP_SYNC_APPLY_FAILED" {
  return error instanceof DomainError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
    ? "DOMAIN_VALIDATION_FAILED"
    : "DESKTOP_SYNC_APPLY_FAILED";
}

function assertNever(command: never): never {
  throw new Error(
    `Unhandled sync command: ${JSON.stringify(command, (key, value) => (key === "payload" ? undefined : value))}`,
  );
}
