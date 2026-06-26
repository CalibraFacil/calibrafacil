import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Inbound Resend webhooks are Svix-signed. This module is pure (no I/O): the
 * route handler does the persistence/suppression side effects.
 */

const SVIX_PREFIX = "whsec_";
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export interface ResendSignatureInput {
  /** RESEND_WEBHOOK_SECRET (the `whsec_…` base64 endpoint secret). */
  secret: string;
  svixId: string | null;
  svixTimestamp: string | null;
  /** The raw `svix-signature` header (space-separated `v1,<b64>` entries). */
  svixSignature: string | null;
  /** The RAW request body, byte-for-byte. */
  body: string;
  now?: Date;
  toleranceSeconds?: number;
}

/** Base64-decode the signing key from the `whsec_`-prefixed secret. */
function svixSecretKey(secret: string): Buffer | null {
  const raw = secret.startsWith(SVIX_PREFIX)
    ? secret.slice(SVIX_PREFIX.length)
    : secret;
  if (!raw) return null;
  const bytes = Buffer.from(raw, "base64");
  return bytes.length > 0 ? bytes : null;
}

function timestampWithinTolerance(
  svixTimestamp: string,
  now: Date,
  toleranceSeconds: number,
): boolean {
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  return Math.abs(nowSeconds - ts) <= toleranceSeconds;
}

/**
 * Verify a Svix signature. Signed content is `${svix-id}.${svix-timestamp}.${body}`,
 * HMAC-SHA256 with the base64-decoded secret. The header may carry several
 * space-separated `v1,<b64sig>` entries — accept if ANY matches (timing-safe).
 * Stale timestamps (outside the tolerance window) are rejected.
 */
export function verifyResendSignature(input: ResendSignatureInput): boolean {
  const { secret, svixId, svixTimestamp, svixSignature, body } = input;
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return false;

  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!timestampWithinTolerance(svixTimestamp, input.now ?? new Date(), tolerance)) {
    return false;
  }

  const key = svixSecretKey(secret);
  if (!key) return false;

  const expected = createHmac("sha256", key)
    .update(`${svixId}.${svixTimestamp}.${body}`)
    .digest();

  for (const entry of svixSignature.split(" ")) {
    const separatorIndex = entry.indexOf(",");
    if (separatorIndex === -1) continue;
    const version = entry.slice(0, separatorIndex);
    const candidate = entry.slice(separatorIndex + 1);
    if (version !== "v1" || !candidate) continue;

    const candidateBytes = Buffer.from(candidate, "base64");
    if (
      candidateBytes.length === expected.length &&
      timingSafeEqual(candidateBytes, expected)
    ) {
      return true;
    }
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface ResendEvent {
  type: string;
  data: Record<string, unknown>;
}

/** Parse a Resend webhook body into a `{ type, data }` event, or null. */
export function parseResendEvent(payload: unknown): ResendEvent | null {
  if (!isRecord(payload)) return null;
  const type = payload.type;
  if (typeof type !== "string") return null;
  return { type, data: isRecord(payload.data) ? payload.data : {} };
}

/** Recipient addresses from a Resend event `data.to` (string or array). */
export function resendEventRecipients(data: Record<string, unknown>): string[] {
  const to = data.to;
  if (typeof to === "string") return [to];
  if (Array.isArray(to)) {
    return to.filter((value): value is string => typeof value === "string");
  }
  return [];
}

/**
 * A HARD bounce is a permanent delivery failure. Resend mirrors SES bounce
 * classification — `data.bounce.type === "Permanent"`. Transient/Undetermined
 * bounces are soft and must NOT suppress the address.
 */
export function resendBounceIsHard(data: Record<string, unknown>): boolean {
  const bounce = isRecord(data.bounce) ? data.bounce : undefined;
  const type = bounce?.type;
  return typeof type === "string" && type.toLowerCase() === "permanent";
}
