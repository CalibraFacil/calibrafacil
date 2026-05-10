import { z } from "zod";

export const localAttachmentSchema = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  localPath: z.string(),
  contentHash: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  remoteKey: z.string().nullable(),
  uploadStatus: z.string(),
  createdAt: z.string().datetime(),
  fileUrl: z.string(),
});

export const localAttachmentsResponseSchema = z.object({
  data: z.array(localAttachmentSchema),
});

export type LocalAttachment = z.infer<typeof localAttachmentSchema>;
export type LocalAttachmentsResponse = z.infer<
  typeof localAttachmentsResponseSchema
>;
