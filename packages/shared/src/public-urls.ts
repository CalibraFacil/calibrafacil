/**
 * Public URLs the platform prints on documents (certificate and service-order
 * QR codes, verification links) and stores as opaque object references.
 *
 * They are derived from the deployment's own configuration, so a self-hosted
 * instance never points its documents at somebody else's domain:
 *
 *   APP_URL         lab web app                       default http://localhost:5173
 *   PORTAL_APP_URL  client portal                     default http://localhost:5174
 *   VERIFY_URL      public certificate verification   default PORTAL_APP_URL
 *                   (the portal serves the page at /v/:token)
 *
 * In the browser there is no process.env; callers there get the local defaults
 * unless they pass an explicit env.
 */
export type PublicUrlEnv = Record<string, string | undefined>;

const ENV_NAMES = [
  "APP_URL",
  "WEB_URL",
  "PORTAL_APP_URL",
  "PORTAL_URL",
  "VERIFY_URL",
] as const;

// Read through globalThis so the module also type-checks (and runs) in
// browser packages, where `process` does not exist.
function processEnv(): PublicUrlEnv {
  const proc: unknown = Reflect.get(globalThis, "process");
  const env: unknown =
    typeof proc === "object" && proc !== null
      ? Reflect.get(proc, "env")
      : undefined;
  const result: PublicUrlEnv = {};
  if (typeof env !== "object" || env === null) return result;
  for (const name of ENV_NAMES) {
    const value: unknown = Reflect.get(env, name);
    if (typeof value === "string") result[name] = value;
  }
  return result;
}

function baseUrl(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return (trimmed ? trimmed : fallback).replace(/\/+$/, "");
}

export function appBaseUrl(env: PublicUrlEnv = processEnv()): string {
  return baseUrl(env.APP_URL ?? env.WEB_URL, "http://localhost:5173");
}

export function portalBaseUrl(env: PublicUrlEnv = processEnv()): string {
  return baseUrl(env.PORTAL_APP_URL ?? env.PORTAL_URL, "http://localhost:5174");
}

export function verifyBaseUrl(env: PublicUrlEnv = processEnv()): string {
  return baseUrl(env.VERIFY_URL, portalBaseUrl(env));
}

/** Public page that verifies an issued certificate (encoded in its QR code). */
export function certificateVerificationUrl(
  verificationToken: string,
  env: PublicUrlEnv = processEnv(),
): string {
  return `${verifyBaseUrl(env)}/v/${verificationToken}`;
}

/**
 * Stored documents are referenced by an "URL" whose pathname is the storage
 * key (see `extractKeyFromUrl` in apps/api). Files are always served through
 * presigned URLs, never through this address, so its host uses the reserved
 * `.invalid` TLD: nothing can resolve it by accident.
 */
export const STORED_OBJECT_URL_BASE = "https://storage.invalid";

export function storedObjectUrl(key: string): string {
  return `${STORED_OBJECT_URL_BASE}/${key.replace(/^\/+/, "")}`;
}
