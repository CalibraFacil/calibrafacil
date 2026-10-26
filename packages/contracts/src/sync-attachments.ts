/**
 * The offline attachment upload leg (roadmap P0-5): what the desktop may upload.
 *
 * An attachment travels in two parts. The bytes go to the object store through
 * `POST /api/sync/attachments/init-upload` (a presigned PUT bound to the declared
 * size and content type), then `.../complete-upload` (the cloud checks the stored
 * object against the declared size, type and SHA-256 and records it). Only then is
 * the `create_local_attachment` event pushed; the cloud refuses an event whose
 * blob was never completed, and the desktop marks the attachment `synced` only
 * after the cloud accepted it (apps/local-server/src/attachment-upload.ts).
 *
 * The upload endpoints refuse with `{ error, code }` bodies. The codes
 * (`SYNC_ATTACHMENT_TYPE_NOT_ALLOWED`, `SYNC_ATTACHMENT_TOO_LARGE`,
 * `SYNC_ATTACHMENT_NOT_UPLOADED`, `SYNC_ATTACHMENT_INTEGRITY_FAILED`) are classified
 * in outbox-rejections.ts: the desktop reads `code` to choose between retrying
 * and a dead attachment.
 */

/**
 * What offline capture produces: camera photos, scanned or exported PDFs and plain
 * text notes. Anything else (SVG and HTML included: both execute in a browser) is
 * refused by the cloud and, up front, by the desktop.
 */
export const SYNC_ATTACHMENT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
] as const;

export type SyncAttachmentMimeType =
  (typeof SYNC_ATTACHMENT_ALLOWED_MIME_TYPES)[number];

/** 25 MiB: a full-resolution phone photo or a long scanned PDF, not a video. */
export const SYNC_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * The content type as it must be signed and sent (trimmed, lower case), or null
 * when it is not one offline capture produces.
 */
export function normalizeSyncAttachmentMimeType(
  mimeType: string,
): SyncAttachmentMimeType | null {
  const normalized = mimeType.trim().toLowerCase();
  return (
    SYNC_ATTACHMENT_ALLOWED_MIME_TYPES.find(
      (allowed) => allowed === normalized,
    ) ?? null
  );
}
