import {
  SYNC_ATTACHMENT_UPLOAD_PROTOCOL_VERSION,
  type SyncCommand,
} from "@calibra-facil/contracts";
import { z } from "zod";
import { createR2Client, headObject, type R2Env } from "../../lib/storage";
import { type MemberData } from "../../middleware/permission";
import {
  type ApplyDesktopSyncEventInput,
  type ApplyDesktopSyncEventResult,
  type PreparedDesktopEventSideEffects,
} from "./desktop-event-support";
import {
  checkSyncAttachmentDeclaration,
  findCompletedSyncAttachment,
} from "./attachment-uploads";
import {
  findAppliedDesktopSyncEvent,
  writeDesktopSyncAudit,
} from "./desktop-sync-support";
import { buildSyncAttachmentObjectKey } from "./helpers";

/**
 * `create_local_attachment` (roadmap P0-5). The event used to be audit-only: the
 * cloud acknowledged it whether or not the bytes ever arrived, and the desktop
 * marked the attachment synced. It is now recorded only when the blob it names was
 * uploaded and verified through the attachment endpoints
 * (modules/sync/attachment-uploads.ts), and the acknowledgement carries the object
 * key, which the desktop stores as the attachment's `remote_key`.
 */

/** The fields the cloud needs; the protocol schema keeps them optional for old outboxes. */
const attachmentEventPayloadSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  localPath: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

type AttachmentEventPayload = z.infer<typeof attachmentEventPayloadSchema>;

function objectKeyOf(
  memberData: MemberData,
  eventId: string,
  payload: AttachmentEventPayload,
) {
  return buildSyncAttachmentObjectKey(memberData, {
    eventId,
    entityType: payload.entityType,
    entityId: payload.entityId,
    fileName: payload.localPath.split("/").pop() ?? "",
    contentHash: payload.contentHash,
  });
}

/**
 * Before the event's transaction: refuses the event (with a stable code) unless its
 * blob is present, completed and unchanged since it was verified. Runs outside the
 * transaction because it talks to the object store.
 */
export async function prepareCreateLocalAttachment(
  command: SyncCommand,
  memberData: MemberData,
  context: { env: R2Env | undefined; protocolVersion: number },
): Promise<PreparedDesktopEventSideEffects> {
  if (command.operation !== "create_local_attachment") return {};

  // Already applied (a retried push): the transaction answers from its record.
  if (await findAppliedDesktopSyncEvent(memberData.organizationId, command)) {
    return {};
  }

  // A build that predates the upload leg has no bytes to send: the event can
  // only ever name a blob that does not exist.
  if (context.protocolVersion < SYNC_ATTACHMENT_UPLOAD_PROTOCOL_VERSION) {
    return {
      refusal: {
        code: "SYNC_ATTACHMENT_UPLOAD_UNSUPPORTED",
        reason:
          "This desktop version does not upload attachment files. Update the app, then send the attachment again.",
      },
    };
  }

  const parsed = attachmentEventPayloadSchema.safeParse(command.payload);
  if (!parsed.success) {
    return {
      refusal: {
        code: "INVALID_DESKTOP_EVENT_PAYLOAD",
        reason: "Desktop attachment event is missing its file description.",
      },
    };
  }
  const payload = parsed.data;

  const declaration = checkSyncAttachmentDeclaration(payload);
  if (!declaration.ok) {
    return {
      refusal: {
        code: declaration.refusal.code,
        reason: declaration.refusal.reason,
      },
    };
  }

  if (!context.env) {
    throw new Error("Object storage is not configured.");
  }
  const objectKey = objectKeyOf(memberData, command.eventId, payload);

  const completed = await findCompletedSyncAttachment(
    memberData.organizationId,
    objectKey,
  );
  const stored = completed
    ? await headObject(
        createR2Client(context.env),
        context.env.R2_BUCKET_NAME,
        objectKey,
      )
    : null;
  if (!completed || !stored) {
    return {
      refusal: {
        code: "SYNC_ATTACHMENT_NOT_UPLOADED",
        reason:
          "The attachment file was not uploaded (or its upload was never completed).",
      },
    };
  }

  // The object is not the one that was verified: it was overwritten through the
  // presigned URL after the check, or the declaration changed.
  if (
    completed.contentHash !== payload.contentHash ||
    completed.sizeBytes !== payload.sizeBytes ||
    stored.sizeBytes !== payload.sizeBytes ||
    (completed.etag !== null && stored.etag !== completed.etag)
  ) {
    return {
      refusal: {
        code: "SYNC_ATTACHMENT_INTEGRITY_FAILED",
        reason:
          "The stored attachment is not the file that was verified when its upload was completed.",
      },
    };
  }

  return {};
}

export async function applyCreateLocalAttachment(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const parsed = attachmentEventPayloadSchema.safeParse(input.event.payload);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason: "Desktop attachment event is missing its file description.",
    };
  }
  const payload = parsed.data;
  const objectKey = objectKeyOf(input.memberData, input.event.eventId, payload);

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: objectKey,
    objectKey,
    contentHash: payload.contentHash,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes,
  });

  return {
    ok: true,
    remoteEntityId: objectKey,
    remoteEntity: {
      objectKey,
      contentHash: payload.contentHash,
      sizeBytes: payload.sizeBytes,
    },
  };
}
