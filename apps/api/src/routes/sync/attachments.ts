import { type Context, Hono } from "hono";
import {
  syncAttachmentCompleteUploadRequestSchema,
  syncAttachmentCompleteUploadResponseSchema,
  syncAttachmentDownloadResponseSchema,
  syncAttachmentInitUploadRequestSchema,
  syncAttachmentInitUploadResponseSchema,
} from "@calibra-facil/contracts";
import {
  createR2Client,
  generateBoundPresignedUploadUrl,
  generatePresignedUrl,
} from "../../lib/storage";
import {
  DomainError,
  domainErrorResponse,
  invalid,
} from "../../lib/domain-errors";
import { withLabPermission } from "../../middleware/permission";
import {
  checkStoredSyncAttachment,
  checkSyncAttachmentDeclaration,
  discardStoredSyncAttachment,
  recordSyncAttachmentUploadCompleted,
  syncAttachmentObjectKeyMatches,
  type SyncAttachmentRefusal,
} from "../../modules/sync/attachment-uploads";
import {
  buildSyncAttachmentObjectKey,
  encodeSyncAttachmentId,
  syncAttachmentObjectKeyBelongsToOrganization,
  tryDecodeSyncAttachmentId,
} from "../../modules/sync/helpers";
import { SYNC_ATTACHMENT_PERMISSION } from "../../modules/sync/operation-permissions";
import { type SyncRouterEnv, getMemberData } from "./env";

const SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS = 900;

/** A refusal of the upload leg as the endpoints' `{ error, code }` body. */
function refusalResponse(
  c: Context<SyncRouterEnv>,
  refusal: SyncAttachmentRefusal,
) {
  return domainErrorResponse(
    c,
    new DomainError({
      code: refusal.apiCode,
      status: refusal.status,
      message: refusal.reason,
    }),
  );
}

export const attachmentRoutes = new Hono<SyncRouterEnv>()
  .post(
    "/attachments/init-upload",
    ...withLabPermission(SYNC_ATTACHMENT_PERMISSION),
    async (c) => {
      const memberData = getMemberData(c);
      const body = syncAttachmentInitUploadRequestSchema.parse(
        await c.req.json(),
      );
      const declaration = checkSyncAttachmentDeclaration(body);
      if (!declaration.ok) {
        return refusalResponse(c, declaration.refusal);
      }
      const { mimeType } = declaration;

      const objectKey = buildSyncAttachmentObjectKey(memberData, body);
      // The URL is bound to the declared size and type: the store refuses any
      // other body, so the key can only ever hold what the desktop declared.
      // complete-upload still verifies the stored object, bytes included.
      const uploadUrl = await generateBoundPresignedUploadUrl(
        createR2Client(c.env),
        c.env.R2_BUCKET_NAME,
        objectKey,
        { contentType: mimeType, contentLength: body.sizeBytes },
        SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS,
      );

      return c.json(
        syncAttachmentInitUploadResponseSchema.parse({
          attachmentId: encodeSyncAttachmentId(objectKey),
          objectKey,
          uploadUrl,
          expiresInSeconds: SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS,
          headers: {
            "content-type": mimeType,
          },
        }),
      );
    },
  )
  .post(
    "/attachments/complete-upload",
    ...withLabPermission(SYNC_ATTACHMENT_PERMISSION),
    async (c) => {
      const memberData = getMemberData(c);
      const session = c.get("session");
      const body = syncAttachmentCompleteUploadRequestSchema.parse(
        await c.req.json(),
      );
      const objectKey = tryDecodeSyncAttachmentId(body.attachmentId);
      if (
        !objectKey ||
        !syncAttachmentObjectKeyBelongsToOrganization(
          objectKey,
          memberData.organizationId,
        )
      ) {
        return c.json({ error: "Invalid attachment id." }, 400);
      }

      if (objectKey !== body.objectKey) {
        return c.json(
          { error: "Attachment id does not match object key." },
          400,
        );
      }

      // The key is made of the laboratory, the target entity, the SHA-256 and
      // the event: a completion may only vouch for the key those facts produce.
      const expectedKey = buildSyncAttachmentObjectKey(memberData, {
        eventId: body.eventId,
        entityType: body.entityType,
        entityId: body.entityId,
        fileName: "",
        contentHash: body.contentHash,
      });
      if (!syncAttachmentObjectKeyMatches(objectKey, expectedKey)) {
        return domainErrorResponse(
          c,
          invalid(
            "invalid_request",
            "Attachment does not match its declaration.",
          ),
        );
      }

      const declaration = checkSyncAttachmentDeclaration(body);
      if (!declaration.ok) {
        return refusalResponse(c, declaration.refusal);
      }

      // Nothing is recorded as present until the stored object is read back and
      // matches the declared size, type and SHA-256.
      const stored = await checkStoredSyncAttachment(c.env, objectKey, body);
      if (!stored.ok) {
        if (stored.discard) {
          await discardStoredSyncAttachment(c.env, objectKey);
        }
        return refusalResponse(c, stored.refusal);
      }

      await recordSyncAttachmentUploadCompleted({
        member: memberData,
        actorUserId: session.user.id,
        deviceId: body.deviceId,
        eventId: body.eventId,
        objectKey,
        entityType: body.entityType,
        entityId: body.entityId,
        contentHash: body.contentHash,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        etag: stored.etag,
      });

      return c.json(
        syncAttachmentCompleteUploadResponseSchema.parse({
          ok: true,
          attachmentId: body.attachmentId,
          objectKey: body.objectKey,
          completedAt: new Date().toISOString(),
        }),
      );
    },
  )
  .get(
    "/attachments/:attachmentId/download",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = getMemberData(c);
      const attachmentId = c.req.param("attachmentId");
      const objectKey = tryDecodeSyncAttachmentId(attachmentId);
      // The id is the object key in base64 and carries no authority: only the
      // laboratory's own partition of the bucket is served.
      if (
        !objectKey ||
        !syncAttachmentObjectKeyBelongsToOrganization(
          objectKey,
          memberData.organizationId,
        )
      ) {
        return c.json({ error: "Invalid attachment id." }, 400);
      }

      const downloadUrl = await generatePresignedUrl(
        createR2Client(c.env),
        c.env.R2_BUCKET_NAME,
        objectKey,
        SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS,
      );

      return c.json(
        syncAttachmentDownloadResponseSchema.parse({
          attachmentId,
          objectKey,
          downloadUrl,
          expiresInSeconds: SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS,
        }),
      );
    },
  );
