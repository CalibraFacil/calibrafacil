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
  /**
   * The version of this aggregate (`entityType` + `entityId`) the desktop expects
   * the cloud to be at when it applies this event: the `aggregateVersion` the
   * cloud answered for the aggregate's previous event, counted forward over the
   * earlier events of the same aggregate in this very batch. The cloud refuses a
   * write whose expected version is not the current one as a `stale_version`
   * conflict instead of overwriting.
   *
   * Absent or null means "no expectation" (a legacy build, or the first write to
   * a row this desktop only ever pulled): the cloud applies it with the
   * `baseUpdatedAt` check alone, as before this field existed.
   */
  expectedVersion: z.number().int().nonnegative().nullable().optional(),
});

export const syncPushResponseSchema = z.object({
  accepted: z.array(
    z.object({
      eventId: z.string(),
      remoteEntityId: z.union([z.number(), z.string()]).optional(),
      remoteEntity: z.unknown().optional(),
      remoteVersion: z.number().int().nonnegative(),
      /**
       * The aggregate's version after this event: the next event of the same
       * aggregate sends it as `expectedVersion`. Absent from a cloud that predates
       * versions (its `remoteVersion` is only `localVersion + 1`, not a version
       * the desktop may chain on).
       */
      aggregateVersion: z.number().int().nonnegative().optional(),
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
  /** The cloud clock when it answered (roadmap 2 E2); absent from older clouds. */
  serverTime: z.string().datetime().optional(),
  /** The push's `sentAt` minus `serverTime`, in ms (positive: the device clock is ahead). */
  clockSkewMs: z.number().int().optional(),
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
  "mass_composition_profile",
]);

export const cloudSyncEventSchema = z.object({
  cloudEventId: z.string(),
  entityType: cloudSyncEntityTypeSchema,
  entityId: z.union([z.number(), z.string()]),
  operation: z.enum(["upsert", "delete"]).default("upsert"),
  occurredAt: z.string(),
  payload: z.unknown(),
  /**
   * Protocol 3 only: the cursor that makes a pull return this event again. A
   * desktop keeps it for a row it skipped because of queued local changes.
   */
  resumeCursor: z.string().optional(),
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

/**
 * - `open`: waiting for a decision.
 * - `resolved`: the user kept the local change; it is sent again.
 * - `discarded_by_user`: the user gave the local change up. It is never sent, and
 *   the row records who decided, when and why. A regulated change (calibration
 *   readings) needs a reason.
 * - `ignored`: what older builds called the same action. Those builds marked the
 *   change `synced` although the cloud never received it. Rows with this status are
 *   kept as history and never written by this build.
 */
export const localSyncConflictStatusSchema = z.enum([
  "open",
  "resolved",
  "discarded_by_user",
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
  /** The signed-in user who resolved or discarded it (null while open, and for older rows). */
  resolvedBy: z.string().nullable().default(null),
  /** Why it was discarded (required for a regulated change). */
  resolutionReason: z.string().nullable().default(null),
  /** The queued change carries calibration readings: discarding it needs a reason. */
  regulated: z.boolean().default(false),
});

export const localSyncConflictsResponseSchema = z.object({
  data: z.array(localSyncConflictSchema),
  total: z.number().int().nonnegative(),
});

/**
 * What the user decides on a conflict. `ignored` is the name an older web build
 * sends for `discarded_by_user`; it is accepted and treated the same way.
 */
export const localSyncConflictResolutionSchema = z.object({
  status: z
    .enum(["resolved", "discarded_by_user", "ignored"])
    .default("resolved"),
  /** Required to discard a regulated change (calibration readings). */
  reason: z.string().trim().max(2000).optional(),
});

/**
 * An outbox event the cloud refused permanently. The code is the cloud's own
 * (`UNSUPPORTED_SYNC_OPERATION`, `STANDARD_EXPIRED`, ...); the UI maps it to a
 * pt-BR reason and keeps the cloud's message as detail.
 */
export const localDeadOutboxEventSchema = z.object({
  eventId: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  operation: z.string(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  attemptCount: z.number().int().nonnegative(),
  occurredAt: z.string(),
  deadAt: z.string().nullable(),
  /** Carries calibration readings: discarding leaves them only on this computer. */
  regulated: z.boolean(),
});

/**
 * A queued change that is not sent because the change it depends on (an earlier
 * edit of the same record, or the record's parent) was refused or is in
 * conflict. It leaves the queue on its own once that change is resolved.
 */
export const localBlockedOutboxEventSchema = z.object({
  eventId: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  operation: z.string(),
  occurredAt: z.string(),
  /** The event it waits for. */
  blockedByEventId: z.string(),
  blockedByOperation: z.string().nullable(),
  blockedByEntityType: z.string().nullable(),
  /** The code the blocking event was refused with, when it was refused. */
  blockedByErrorCode: z.string().nullable(),
  /** The blocking event is dead (`dead`), in conflict (`conflict`) or was discarded (`discarded`). */
  blockedByStatus: z.string().nullable(),
  /** Carries calibration readings: discarding it leaves them only on this computer. */
  regulated: z.boolean(),
});

export const localBlockedOutboxEventsResponseSchema = z.object({
  data: z.array(localBlockedOutboxEventSchema),
  total: z.number().int().nonnegative(),
});

export const localDeadOutboxEventsResponseSchema = z.object({
  data: z.array(localDeadOutboxEventSchema),
  total: z.number().int().nonnegative(),
});

export const syncConflictResolutionRequestSchema =
  localSyncConflictResolutionSchema;

export const syncConflictResolutionResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    status: z.enum(["resolved", "discarded_by_user", "ignored"]),
    resolvedAt: z.string().datetime(),
  }),
});

export type SyncEvent = z.infer<typeof syncEventSchema>;
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
export type LocalBlockedOutboxEvent = z.infer<
  typeof localBlockedOutboxEventSchema
>;
export type LocalBlockedOutboxEventsResponse = z.infer<
  typeof localBlockedOutboxEventsResponseSchema
>;
export type LocalSyncConflict = z.infer<typeof localSyncConflictSchema>;
export type LocalSyncConflictsResponse = z.infer<
  typeof localSyncConflictsResponseSchema
>;
export type LocalDeadOutboxEvent = z.infer<typeof localDeadOutboxEventSchema>;
export type LocalDeadOutboxEventsResponse = z.infer<
  typeof localDeadOutboxEventsResponseSchema
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

// ---------------------------------------------------------------------------
// Wire-format builders shared by both sides of the sync seam (cloud apply in
// apps/api, local outbox in packages/local-db). The conflict-id and push-cursor
// string formats are part of the sync wire contract, so they live beside the
// schemas that validate the payloads carrying them. Formerly packages/sync.
// ---------------------------------------------------------------------------

export type DesktopSyncConflictIdentity = {
  eventId: string;
  entityType: string;
  entityId: string;
};

export function buildDesktopSyncConflictId(input: DesktopSyncConflictIdentity) {
  return [
    "desktop-conflict",
    safeSyncIdSegment(input.entityType),
    safeSyncIdSegment(input.entityId),
    safeSyncIdSegment(input.eventId),
  ].join(":");
}

export function buildSyncPushCursor(
  clientBatchId: string,
  acceptedCount: number,
  conflictCount: number,
) {
  if (conflictCount === 0) {
    return `cursor:${clientBatchId}:${acceptedCount}`;
  }

  return `cursor:${clientBatchId}:${acceptedCount}:${conflictCount}`;
}

export function stringifySyncConflictPayload(value: unknown) {
  return JSON.stringify(value ?? {});
}

function safeSyncIdSegment(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "local"
  );
}
