import { Hono } from "hono";
import {
  syncAttachmentCompleteUploadRequestSchema,
  syncAttachmentCompleteUploadResponseSchema,
  syncAttachmentDownloadResponseSchema,
  syncAttachmentInitUploadRequestSchema,
  syncAttachmentInitUploadResponseSchema,
} from "@calibra-facil/contracts";
import {
  createR2Client,
  generatePresignedUploadUrl,
  generatePresignedUrl,
} from "../../lib/storage";
import { withLabPermission } from "../../middleware/permission";
import {
  buildSyncAttachmentObjectKey,
  encodeSyncAttachmentId,
  tryDecodeSyncAttachmentId,
} from "../../modules/sync/helpers";
import { type SyncRouterEnv, getMemberData } from "./env";

const SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS = 900;

export const attachmentRoutes = new Hono<SyncRouterEnv>()
  .post(
    "/attachments/init-upload",
    ...withLabPermission({ calibration: ["create"] }),
    async (c) => {
      const memberData = getMemberData(c);
      const body = syncAttachmentInitUploadRequestSchema.parse(
        await c.req.json(),
      );
      const objectKey = buildSyncAttachmentObjectKey(memberData, body);
      const uploadUrl = await generatePresignedUploadUrl(
        createR2Client(c.env),
        c.env.R2_BUCKET_NAME,
        objectKey,
        body.mimeType,
        SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS,
      );

      return c.json(
        syncAttachmentInitUploadResponseSchema.parse({
          attachmentId: encodeSyncAttachmentId(objectKey),
          objectKey,
          uploadUrl,
          expiresInSeconds: SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS,
          headers: {
            "content-type": body.mimeType,
          },
        }),
      );
    },
  )
  .post(
    "/attachments/complete-upload",
    ...withLabPermission({ calibration: ["create"] }),
    async (c) => {
      const body = syncAttachmentCompleteUploadRequestSchema.parse(
        await c.req.json(),
      );
      const objectKey = tryDecodeSyncAttachmentId(body.attachmentId);
      if (!objectKey) {
        return c.json({ error: "Invalid attachment id." }, 400);
      }

      if (objectKey !== body.objectKey) {
        return c.json(
          { error: "Attachment id does not match object key." },
          400,
        );
      }

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
      const attachmentId = c.req.param("attachmentId");
      const objectKey = tryDecodeSyncAttachmentId(attachmentId);
      if (!objectKey) {
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
