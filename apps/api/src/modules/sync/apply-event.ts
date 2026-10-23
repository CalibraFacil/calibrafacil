import { jobCreationClientErrors } from "../../lib/jobs";
import {
  type ApplyDesktopSyncEventInput,
  type ApplyDesktopSyncEventResult,
} from "./desktop-event-support";
import {
  applyCreateLocalAsset,
  applyCreateLocalJobDraft,
} from "./apply-job-draft-and-asset-create";
import { applyUpdateLocalAsset } from "./apply-asset-update";
import {
  applyCreateLocalCustomer,
  applyUpdateLocalCustomer,
  applyUpdateLocalCustomerCompliance,
} from "./apply-customers";
import { applyLocalJobExecution } from "./apply-job-execution";
import {
  applyCreateLocalNonConformance,
  applyCreateLocalServiceOrderIntake,
} from "./apply-service-order-intake";
import {
  applyCreateLocalServiceOrderDeliveryDocumentDraft,
  applyCreateLocalServiceOrderQuoteDraft,
  applyLocalServiceOrderExecutionNotes,
} from "./apply-service-order-documents";
import { writeDesktopSyncAudit } from "./desktop-sync-support";

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
      case "create_local_job_draft":
        return await applyCreateLocalJobDraft(input, actorUserId);
      case "create_local_asset":
        return await applyCreateLocalAsset(input, actorUserId);
      case "update_local_asset":
        return await applyUpdateLocalAsset(input, actorUserId);
      case "create_local_customer":
        return await applyCreateLocalCustomer(input, actorUserId);
      case "update_local_customer":
        return await applyUpdateLocalCustomer(input, actorUserId);
      case "update_local_customer_compliance":
        return await applyUpdateLocalCustomerCompliance(input, actorUserId);
      case "save_local_execution":
      case "submit_local_execution":
        return await applyLocalJobExecution(input, actorUserId);
      case "create_local_service_order_intake":
        return await applyCreateLocalServiceOrderIntake(input, actorUserId);
      case "create_local_non_conformance":
        return await applyCreateLocalNonConformance(input, actorUserId);
      case "create_local_service_order_quote_draft":
        return await applyCreateLocalServiceOrderQuoteDraft(input, actorUserId);
      case "save_local_service_order_execution_notes":
        return await applyLocalServiceOrderExecutionNotes(input, actorUserId);
      case "create_local_service_order_delivery_document_draft":
        return await applyCreateLocalServiceOrderDeliveryDocumentDraft(
          input,
          actorUserId,
        );
      // Certificates are issued online only: the cloud worker renders and signs
      // them after the cloud approval. A queued offline "publish certificate
      // PDF" event (an older desktop build) is refused with its own code, never
      // applied, never acknowledged, so the desktop keeps showing it as refused.
      case "generate_local_certificate_pdf":
        return {
          ok: false,
          code: "OFFLINE_CERTIFICATE_PUBLICATION_NOT_SUPPORTED",
          reason:
            "Certificates are issued online only: approve the job in the cloud app and the certificate is generated and signed there. Client-rendered certificate PDFs are not accepted.",
        };
      // Audit-only events: the desktop records them in its outbox, but the
      // cloud has nothing to apply (attachment bytes travel through the
      // attachment endpoints, the legacy certificate-draft marker carries no
      // data).
      case "create_local_attachment":
      case "create_local_certificate_draft":
        await writeDesktopSyncAudit(input, actorUserId);
        return { ok: true };
      default:
        return assertNever(input.event);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Desktop sync event failed.";
    const code = jobCreationClientErrors.has(message)
      ? "DOMAIN_VALIDATION_FAILED"
      : "DESKTOP_SYNC_APPLY_FAILED";
    return {
      ok: false,
      code,
      reason: message,
    };
  }
}

function assertNever(command: never): never {
  throw new Error(
    `Unhandled sync command: ${JSON.stringify(command, (key, value) => (key === "payload" ? undefined : value))}`,
  );
}
