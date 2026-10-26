import {
  SYNC_ATTACHMENT_MAX_BYTES,
  type SyncAttachmentMimeType,
  normalizeSyncAttachmentMimeType,
} from "@calibra-facil/contracts";
import { organizationEventLog } from "@calibra-facil/db/schema";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import { and, desc, eq } from "drizzle-orm";
import { writeOrganizationAuditEvent } from "../../lib/audit";
import { orgDb } from "../../lib/org-db";
import { withOrgReader } from "../../lib/org-transaction";
import {
  type R2Env,
  createR2Client,
  deleteFromR2,
  hashObjectSha256,
  headObject,
} from "../../lib/storage";
import { type MemberData } from "../../middleware/permission";
import { asRecord } from "./helpers";

/**
 * The cloud half of the offline attachment upload leg (roadmap P0-5).
 *
 * `init-upload` hands out a presigned PUT bound to the declared size and type;
 * `complete-upload` does not trust that: it reads the stored object back (HEAD
 * for size and type, then the bytes for the SHA-256) and, only when all three
 * match what the desktop declared, writes the audit row that says "this blob is
 * present and verified" (action `sync_attachment.upload_completed`, entity
 * `sync_attachment`, entity id the object key, with the ETag it was verified
 * at). The `create_local_attachment` event is applied only when that row exists
 * and the object still has the ETag it was verified at, so an event can never
 * record an attachment whose bytes were not confirmed, nor one overwritten
 * through the still-valid presigned URL after the check.
 */

export const SYNC_ATTACHMENT_UPLOAD_COMPLETED_ACTION =
  "sync_attachment.upload_completed";

/** What the desktop declares about the bytes it uploads. */
export type SyncAttachmentDeclaration = {
  mimeType: string;
  sizeBytes: number;
};

/**
 * A refusal of the upload leg. `code` is the one a pushed event is refused with
 * (the outbox rejection table, which says whether the desktop retries);
 * `apiCode` is the same refusal in the registry of the upload endpoints' bodies.
 */
export type SyncAttachmentRefusal = {
  code:
    | "SYNC_ATTACHMENT_TYPE_NOT_ALLOWED"
    | "SYNC_ATTACHMENT_TOO_LARGE"
    | "SYNC_ATTACHMENT_NOT_UPLOADED"
    | "SYNC_ATTACHMENT_INTEGRITY_FAILED";
  apiCode:
    | "sync_attachment_type_not_allowed"
    | "sync_attachment_too_large"
    | "sync_attachment_not_uploaded"
    | "sync_attachment_integrity_failed";
  status: 409 | 422;
  reason: string;
};

export type SyncAttachmentDeclarationCheck =
  | { ok: true; mimeType: SyncAttachmentMimeType }
  | { ok: false; refusal: SyncAttachmentRefusal };

/** A declaration offline capture could not have produced is refused before anything is stored. */
export function checkSyncAttachmentDeclaration(
  declaration: SyncAttachmentDeclaration,
): SyncAttachmentDeclarationCheck {
  const mimeType = normalizeSyncAttachmentMimeType(declaration.mimeType);
  if (mimeType === null) {
    return {
      ok: false,
      refusal: {
        code: "SYNC_ATTACHMENT_TYPE_NOT_ALLOWED",
        apiCode: "sync_attachment_type_not_allowed",
        status: 422,
        reason: "This file type is not accepted as an offline attachment.",
      },
    };
  }
  if (declaration.sizeBytes > SYNC_ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      refusal: {
        code: "SYNC_ATTACHMENT_TOO_LARGE",
        apiCode: "sync_attachment_too_large",
        status: 422,
        reason: `An offline attachment is at most ${SYNC_ATTACHMENT_MAX_BYTES} bytes.`,
      },
    };
  }
  return { ok: true, mimeType };
}

export type StoredAttachmentCheck =
  | { ok: true; etag: string | null }
  | { ok: false; refusal: SyncAttachmentRefusal; discard: boolean };

/**
 * Reads the object under `objectKey` back and compares it with the declaration.
 * `discard` is set when the stored bytes are not the declared ones: the object
 * is removed so the next attempt starts from nothing.
 */
export async function checkStoredSyncAttachment(
  env: R2Env,
  objectKey: string,
  declared: SyncAttachmentDeclaration & { contentHash: string },
): Promise<StoredAttachmentCheck> {
  const client = createR2Client(env);
  const head = await headObject(client, env.R2_BUCKET_NAME, objectKey);
  if (!head) return notUploaded();

  const expectedType = normalizeSyncAttachmentMimeType(declared.mimeType);
  const storedType = head.contentType?.split(";")[0]?.trim().toLowerCase();
  if (head.sizeBytes !== declared.sizeBytes || storedType !== expectedType) {
    return integrityFailure(
      "The stored attachment does not match its declared size or type.",
    );
  }

  // Streamed (never whole in memory) and conditional on the ETag the HEAD read:
  // an object overwritten in between is "changed", not silently hashed.
  const hashed = await hashObjectSha256(client, env.R2_BUCKET_NAME, objectKey, {
    etag: head.etag,
    maxBytes: SYNC_ATTACHMENT_MAX_BYTES,
  });
  if (!hashed.ok) {
    if (hashed.reason === "missing") {
      return notUploaded();
    }
    return integrityFailure(
      "The stored attachment changed while it was being verified.",
    );
  }
  if (hashed.sizeBytes !== declared.sizeBytes) {
    return integrityFailure(
      "The stored attachment does not match its declared size or type.",
    );
  }
  if (hashed.sha256 !== declared.contentHash) {
    return integrityFailure(
      "The stored attachment does not match its declared SHA-256.",
    );
  }

  return { ok: true, etag: head.etag };
}

function notUploaded(): StoredAttachmentCheck {
  return {
    ok: false,
    discard: false,
    refusal: {
      code: "SYNC_ATTACHMENT_NOT_UPLOADED",
      apiCode: "sync_attachment_not_uploaded",
      status: 409,
      reason: "The attachment bytes were not uploaded.",
    },
  };
}

function integrityFailure(reason: string): StoredAttachmentCheck {
  return {
    ok: false,
    discard: true,
    refusal: {
      code: "SYNC_ATTACHMENT_INTEGRITY_FAILED",
      apiCode: "sync_attachment_integrity_failed",
      status: 422,
      reason,
    },
  };
}

export async function discardStoredSyncAttachment(
  env: R2Env,
  objectKey: string,
) {
  await deleteFromR2(createR2Client(env), env.R2_BUCKET_NAME, objectKey).catch(
    (error: unknown) => {
      console.error("[Sync] Could not remove a rejected attachment:", error);
    },
  );
}

/**
 * Whether an object key is the one `buildSyncAttachmentObjectKey` makes for this
 * declaration: the key is bound to the laboratory, the target entity, the SHA-256
 * and the event, so a completion cannot vouch for a key built from other facts.
 */
export function syncAttachmentObjectKeyMatches(
  objectKey: string,
  expectedKeyWithoutExtension: string,
): boolean {
  if (!objectKey.startsWith(expectedKeyWithoutExtension)) return false;
  const extension = objectKey.slice(expectedKeyWithoutExtension.length);
  return extension === "" || /^\.[a-zA-Z0-9]{1,15}$/.test(extension);
}

/** Records that the blob under `objectKey` was verified (the proof `create_local_attachment` needs). */
export async function recordSyncAttachmentUploadCompleted(input: {
  member: MemberData;
  actorUserId: string;
  deviceId: string;
  eventId: string;
  objectKey: string;
  entityType: string;
  entityId: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  etag: string | null;
}) {
  await orgDb(input.member.organizationId).transaction((o) =>
    writeOrganizationAuditEvent(
      {
        organizationId: input.member.organizationId,
        unitId: input.member.activeUnitId,
        actorUserId: input.actorUserId,
        actorMemberId: input.member.id,
        action: SYNC_ATTACHMENT_UPLOAD_COMPLETED_ACTION,
        entityType: "sync_attachment",
        entityId: input.objectKey,
        details: {
          objectKey: input.objectKey,
          eventId: input.eventId,
          deviceId: input.deviceId,
          targetEntityType: input.entityType,
          targetEntityId: input.entityId,
          contentHash: input.contentHash,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          etag: input.etag,
        },
      },
      o,
    ),
  );
}

export type CompletedSyncAttachment = {
  etag: string | null;
  contentHash: string | null;
  sizeBytes: number | null;
};

/** The latest verification recorded for `objectKey`, or null when it was never completed. */
export async function findCompletedSyncAttachment(
  organizationId: string,
  objectKey: string,
  executor?: Pick<OrgExecutor, "select">,
): Promise<CompletedSyncAttachment | null> {
  const [row] = await withOrgReader(organizationId, executor, (reader) =>
    reader
      .select({ details: organizationEventLog.details })
      .from(organizationEventLog)
      .where(
        and(
          eq(organizationEventLog.organizationId, organizationId),
          eq(
            organizationEventLog.action,
            SYNC_ATTACHMENT_UPLOAD_COMPLETED_ACTION,
          ),
          eq(organizationEventLog.entityId, objectKey),
        ),
      )
      .orderBy(desc(organizationEventLog.id))
      .limit(1),
  );
  if (!row) return null;

  const details = asRecord(row.details);
  return {
    etag: typeof details.etag === "string" ? details.etag : null,
    contentHash:
      typeof details.contentHash === "string" ? details.contentHash : null,
    sizeBytes: typeof details.sizeBytes === "number" ? details.sizeBytes : null,
  };
}
