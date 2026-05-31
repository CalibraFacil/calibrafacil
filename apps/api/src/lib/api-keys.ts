import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const API_KEY_PREFIX = "cf_live";

export type PublicApiScope =
  | "customers:read"
  | "customers:write"
  | "assets:read"
  | "assets:write"
  | "requests:read"
  | "requests:write"
  | "jobs:read"
  | "jobs:write"
  | "services:read"
  | "units:read"
  | "reports:read"
  | "certificates:read"
  | "webhooks:manage";

export const DEFAULT_PUBLIC_API_SCOPES: PublicApiScope[] = [
  "customers:read",
  "assets:read",
  "requests:read",
  "jobs:read",
  "services:read",
  "units:read",
  "reports:read",
  "certificates:read",
];

export const ALL_PUBLIC_API_SCOPES: PublicApiScope[] = [
  "customers:read",
  "customers:write",
  "assets:read",
  "assets:write",
  "requests:read",
  "requests:write",
  "jobs:read",
  "jobs:write",
  "services:read",
  "units:read",
  "reports:read",
  "certificates:read",
  "webhooks:manage",
];

export function createApiKeySecret() {
  const raw = randomBytes(24).toString("base64url");
  const key = `${API_KEY_PREFIX}_${raw}`;
  return {
    key,
    keyPrefix: key.slice(0, 15),
    keyHash: hashApiKey(key),
  };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function safeEqualHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function extractApiKeyFromRequest(request: Request): string | null {
  const fromHeader = request.headers.get("x-api-key")?.trim();
  if (fromHeader) return fromHeader;

  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return null;

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;

  return token.trim();
}
