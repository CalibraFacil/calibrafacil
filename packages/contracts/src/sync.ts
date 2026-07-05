import { z } from "zod";

export const syncEventSchema = z.object({
  eventId: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  operation: z.string(),
  payload: z.unknown(),
  occurredAt: z.string(),
  actorUserId: z.string(),
  organizationId: z.string(),
  unitId: z.number().int().nullable(),
  idempotencyKey: z.string(),
  localVersion: z.number().int().nonnegative(),
  // Base version the local edit was made against: the cloud row's `updatedAt`
  // captured at pull time. Optional so pushes from older desktop builds (which
  // never emit it) stay valid; nullable for rows that were never pulled. The
  // server treats a missing/null base as "cannot check" (current behavior).
  baseUpdatedAt: z.string().nullable().optional(),
});

export const syncPushRequestSchema = z.object({
  deviceId: z.string(),
  clientBatchId: z.string(),
  baseCursor: z.string().nullable(),
  events: z.array(syncEventSchema),
});

export const syncPushResponseSchema = z.object({
  accepted: z.array(
    z.object({
      eventId: z.string(),
      remoteEntityId: z.union([z.number(), z.string()]).optional(),
      remoteEntity: z.unknown().optional(),
      remoteVersion: z.number().int().nonnegative(),
      cloudEventId: z.string(),
    }),
  ),
  rejected: z.array(
    z.object({
      eventId: z.string(),
      reason: z.string(),
      code: z.string(),
    }),
  ),
  conflicts: z.array(
    z.object({
      id: z.string(),
      eventId: z.string().optional(),
      entityType: z.string(),
      entityId: z.string(),
      conflictType: z.string(),
      status: z.string(),
      localPayload: z.unknown().optional(),
      remotePayload: z.unknown().optional(),
    }),
  ),
  newCursor: z.string().optional(),
});

export const syncBootstrapResponseSchema = z.object({
  serverTime: z.string(),
  user: z.object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
  organization: z.object({
    id: z.string(),
    type: z.string(),
  }),
  activeUnits: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      role: z.string().nullable(),
    }),
  ),
  permissions: z.object({
    role: z.string(),
    unitRole: z.string().nullable(),
    activeUnitId: z.number().int().nullable(),
    accessibleUnitIds: z.array(z.number().int()),
    canAccessAllUnits: z.boolean(),
  }),
  featureFlags: z.object({
    offlineApprovals: z.boolean(),
    offlineCertificatePublication: z.boolean(),
  }),
  syncCursor: z.string().nullable(),
  publishedMethods: z.array(z.unknown()),
  assetTypes: z.array(z.unknown()),
  customers: z.array(z.unknown()),
  assets: z.array(z.unknown()),
  services: z.array(z.unknown()),
  standards: z.array(z.unknown()),
  massCompositionProfiles: z.array(z.unknown()).optional(),
  environmentalLimits: z.array(z.unknown()),
  jobs: z.array(z.unknown()),
  serviceOrders: z.array(z.unknown()).default([]),
});

export const localSessionSnapshotResponseSchema = z.object({
  data: syncBootstrapResponseSchema.nullable(),
});

export const cloudSyncEntityTypeSchema = z.enum([
  "asset_type",
  "customer",
  "asset",
  "service",
  "published_method",
  "reference_standard",
  "environmental_limit",
  "calibration_job",
  "service_order",
]);

export const cloudSyncEventSchema = z.object({
  cloudEventId: z.string(),
  entityType: cloudSyncEntityTypeSchema,
  entityId: z.union([z.number(), z.string()]),
  operation: z.enum(["upsert", "delete"]).default("upsert"),
  occurredAt: z.string(),
  payload: z.unknown(),
});

export const syncPullResponseSchema = z.object({
  cursor: z.string().nullable(),
  hasMore: z.boolean(),
  events: z.array(cloudSyncEventSchema),
});

export const syncAckRequestSchema = z.object({
  deviceId: z.string().min(1),
  cursor: z.string().min(1),
  appliedCloudEventIds: z.array(z.string().min(1)).default([]),
});

export const syncAckResponseSchema = z.object({
  ok: z.boolean(),
  cursor: z.string(),
  acknowledgedAt: z.string().datetime(),
});

export const syncAttachmentInitUploadRequestSchema = z.object({
  deviceId: z.string().min(1),
  eventId: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  fileName: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export const syncAttachmentInitUploadResponseSchema = z.object({
  attachmentId: z.string(),
  objectKey: z.string(),
  uploadUrl: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
  headers: z.record(z.string(), z.string()),
});

export const syncAttachmentCompleteUploadRequestSchema = z.object({
  deviceId: z.string().min(1),
  eventId: z.string().min(1),
  attachmentId: z.string().min(1),
  objectKey: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export const syncAttachmentCompleteUploadResponseSchema = z.object({
  ok: z.boolean(),
  attachmentId: z.string(),
  objectKey: z.string(),
  completedAt: z.string().datetime(),
});

export const syncAttachmentDownloadResponseSchema = z.object({
  attachmentId: z.string(),
  objectKey: z.string(),
  downloadUrl: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
});

export const localSyncConflictStatusSchema = z.enum([
  "open",
  "resolved",
  "ignored",
]);

export const localSyncConflictSchema = z.object({
  id: z.string(),
  eventId: z.string().nullable().default(null),
  entityType: z.string(),
  entityId: z.string(),
  conflictType: z.string(),
  status: localSyncConflictStatusSchema,
  localPayload: z.unknown(),
  remotePayload: z.unknown(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});

export const localSyncConflictsResponseSchema = z.object({
  data: z.array(localSyncConflictSchema),
  total: z.number().int().nonnegative(),
});

export const localSyncConflictResolutionSchema = z.object({
  status: z.enum(["resolved", "ignored"]).default("resolved"),
});

export const syncConflictResolutionRequestSchema =
  localSyncConflictResolutionSchema;

export const syncConflictResolutionResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    status: z.enum(["resolved", "ignored"]),
    resolvedAt: z.string().datetime(),
  }),
});

export type SyncEvent = z.infer<typeof syncEventSchema>;
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;
export type SyncBootstrapResponse = z.infer<typeof syncBootstrapResponseSchema>;
export type LocalSessionSnapshotResponse = z.infer<
  typeof localSessionSnapshotResponseSchema
>;
export type CloudSyncEvent = z.infer<typeof cloudSyncEventSchema>;
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;
export type SyncAckRequest = z.infer<typeof syncAckRequestSchema>;
export type SyncAckResponse = z.infer<typeof syncAckResponseSchema>;
export type SyncAttachmentInitUploadRequest = z.infer<
  typeof syncAttachmentInitUploadRequestSchema
>;
export type SyncAttachmentInitUploadResponse = z.infer<
  typeof syncAttachmentInitUploadResponseSchema
>;
export type SyncAttachmentCompleteUploadRequest = z.infer<
  typeof syncAttachmentCompleteUploadRequestSchema
>;
export type SyncAttachmentCompleteUploadResponse = z.infer<
  typeof syncAttachmentCompleteUploadResponseSchema
>;
export type SyncAttachmentDownloadResponse = z.infer<
  typeof syncAttachmentDownloadResponseSchema
>;
export type LocalSyncConflict = z.infer<typeof localSyncConflictSchema>;
export type LocalSyncConflictsResponse = z.infer<
  typeof localSyncConflictsResponseSchema
>;
export type LocalSyncConflictResolution = z.infer<
  typeof localSyncConflictResolutionSchema
>;
export type SyncConflictResolutionRequest = z.infer<
  typeof syncConflictResolutionRequestSchema
>;
export type SyncConflictResolutionResponse = z.infer<
  typeof syncConflictResolutionResponseSchema
>;
