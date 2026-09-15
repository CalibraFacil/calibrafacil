/**
 * Pure, side-effect-free leaf helpers extracted VERBATIM from
 * `apps/api/src/routes/sync.ts` (Phase-2 behavior-preserving extraction).
 *
 * Scope: attachment object-key building/encoding/validation, pull
 * cursor/limit parsing, timestamp/date coercion, and small record/form
 * validators & extractors. These are deterministic and carry NO cut-line
 * authority — they do not enforce org/unit/actor scope, do not apply desktop
 * sync events, and do not resolve conflicts. The scope guards
 * (ORGANIZATION_SCOPE_MISMATCH / UNIT_SCOPE_MISMATCH / ACTOR_SCOPE_MISMATCH,
 * `validateSyncActorScope`), `applyDesktopSyncEvent`, and conflict resolution
 * remain inline in `sync.ts` and are intentionally NOT moved here.
 *
 * Behavior must match `sync.ts` exactly; sync.ts imports these back.
 */
import {
  safeR2Segment,
  syncAttachmentKey,
} from "@calibra-facil/shared/storage-keys";
import { type MemberData } from "../../middleware/permission";

export const DEFAULT_SYNC_PULL_LIMIT = 100;
export const MAX_SYNC_PULL_LIMIT = 500;

export function parseSyncPullCursor(cursor: string | null) {
  if (!cursor) return new Date(0);
  const parsed = new Date(cursor);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

export function parseSyncPullLimit(rawLimit: string | undefined) {
  if (!rawLimit) return DEFAULT_SYNC_PULL_LIMIT;
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SYNC_PULL_LIMIT;
  }
  return Math.min(parsed, MAX_SYNC_PULL_LIMIT);
}

export function toSyncTimestamp(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

export function buildSyncAttachmentObjectKey(
  memberData: MemberData,
  input: {
    eventId: string;
    entityType: string;
    entityId: string;
    fileName: string;
    contentHash: string;
  },
) {
  const fileIdentity = [
    input.contentHash.slice(0, 16),
    safeR2Segment(input.eventId),
  ].join("-");

  return syncAttachmentKey({
    org: { id: memberData.organizationId, slug: "" },
    entityType: input.entityType,
    entityId: input.entityId,
    fileIdentity,
    extension: safeAttachmentExtension(input.fileName),
  }).key;
}

export function encodeSyncAttachmentId(objectKey: string) {
  return Buffer.from(objectKey, "utf8").toString("base64url");
}

export function tryDecodeSyncAttachmentId(attachmentId: string) {
  const objectKey = Buffer.from(attachmentId, "base64url").toString("utf8");
  if (!isValidSyncAttachmentObjectKey(objectKey)) {
    return null;
  }

  return objectKey;
}

export function isValidSyncAttachmentObjectKey(objectKey: string) {
  return (
    objectKey.startsWith("org/") &&
    objectKey.includes("/sync-attachments/") &&
    !objectKey.includes("..") &&
    !objectKey.startsWith("/") &&
    !objectKey.endsWith("/")
  );
}

export function safeAttachmentExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) return "";

  const extension = fileName.slice(dotIndex, dotIndex + 16);
  return /^\.[a-zA-Z0-9]+$/.test(extension) ? extension : "";
}

export function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function formNumber(formData: FormData, key: string) {
  const value = formString(formData, key);
  return value ? Number(value) : Number.NaN;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

export function isIntegerNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return isIntegerNumber(value) && value > 0;
}

export function getNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getNullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getRecordOrNull(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

export function parseSnapshotDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
