import { createHash } from "node:crypto";
import { Client } from "pg";
import {
  getLogoKeyFromUrl,
  type OrgRef,
  type StorageBucket,
} from "@calibra-facil/shared/storage-keys";
import { type Env, type R2BucketBinding } from "./runtime-types.js";

/** Pick the concrete R2 binding for a logical storage bucket. */
export function bucketBinding(
  env: Env,
  bucket: StorageBucket,
): R2BucketBinding {
  return bucket === "media" ? env.MEDIA_BUCKET : env.CERTIFICATES_BUCKET;
}

/**
 * Read an object whose key is stored in the DB. The stored key tells us the key
 * but not which bucket the object physically lives in: during/after the bucket
 * split, newly written objects live in `preferred` while not-yet-backfilled
 * ones may still be in the other bucket. Try the preferred binding, then fall
 * back to the other so reads keep working across the migration window.
 */
export async function getStoredObject(
  env: Env,
  preferred: StorageBucket,
  key: string,
) {
  const primary = await bucketBinding(env, preferred).get(key);
  if (primary) return primary;
  const fallback: StorageBucket = preferred === "media" ? "documents" : "media";
  return bucketBinding(env, fallback).get(key);
}

/** Look up the stable org id + readable slug for org-scoped key building. */
export async function fetchOrgRefById(
  client: Client,
  organizationId: string,
): Promise<OrgRef> {
  const result = await client.query<{ id: string; slug: string | null }>(
    `SELECT id, slug FROM organization WHERE id = $1`,
    [organizationId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Organization not found: ${organizationId}`);
  }
  return { id: row.id, slug: row.slug ?? "" };
}

export function sha256Hex(bytes: Uint8Array | ArrayBuffer): string {
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

export async function resolveOrganizationLogoDataUrl(
  env: Env,
  logoUrl: string | null | undefined,
  jobId: number,
) {
  const key = getLogoKeyFromUrl(logoUrl);
  if (!key) return logoUrl ?? null;

  try {
    const logoObject = await getStoredObject(env, "media", key);
    if (!logoObject) return logoUrl ?? null;

    const logoBuffer = await logoObject.arrayBuffer();
    const contentType =
      logoObject.httpMetadata?.contentType ?? inferImageContentType(logoBuffer);
    const base64 = arrayBufferToBase64(logoBuffer);
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.warn(`[JOB ${jobId}] Failed to fetch organization logo:`, err);
    return logoUrl ?? null;
  }
}

function inferImageContentType(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  const textStart = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 256))
    .trimStart();
  if (textStart.startsWith("<svg") || textStart.startsWith("<?xml")) {
    return "image/svg+xml";
  }

  return "application/octet-stream";
}

/**
 * Convert ArrayBuffer to base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}
