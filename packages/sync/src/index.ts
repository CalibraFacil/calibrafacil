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
