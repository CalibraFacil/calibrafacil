/**
 * Key custody for the lab's BYOK Resend API key (issue #584).
 *
 * AES-256-GCM, mirroring the certificate-password pattern in
 * `packages/signing/src/encryption.ts`, but under its OWN master key
 * (EMAIL_DOMAIN_MASTER_KEY) so email credentials and signing secrets never
 * share key material. The encrypted key must never leave the server — API
 * responses expose only the last 4 characters (see maskResendApiKey).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;

export const EMAIL_DOMAIN_MASTER_KEY_ENV = "EMAIL_DOMAIN_MASTER_KEY";

export function getEmailDomainMasterKey(): string | undefined {
  const key = process.env[EMAIL_DOMAIN_MASTER_KEY_ENV]?.trim();
  return key || undefined;
}

function getValidatedKey(masterKey: string): Buffer {
  const key = Buffer.from(masterKey, "base64");
  if (key.length !== 32) {
    throw new Error(
      `${EMAIL_DOMAIN_MASTER_KEY_ENV} must be 256 bits (32 bytes, base64)`,
    );
  }
  return key;
}

/**
 * Encrypt a Resend API key. Returns the ciphertext (ciphertext + auth tag,
 * base64) and the IV (base64) for storage in separate columns.
 */
export function encryptResendApiKey(
  apiKey: string,
  masterKey: string,
): { encrypted: string; iv: string } {
  const key = getValidatedKey(masterKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  const combined = Buffer.concat([encrypted, cipher.getAuthTag()]);

  return {
    encrypted: combined.toString("base64"),
    iv: iv.toString("base64"),
  };
}

/** Decrypt a Resend API key stored by encryptResendApiKey. */
export function decryptResendApiKey(
  encrypted: string,
  iv: string,
  masterKey: string,
): string {
  const key = getValidatedKey(masterKey);
  const ivBuffer = Buffer.from(iv, "base64");
  const combined = Buffer.from(encrypted, "base64");

  const ciphertext = combined.subarray(0, combined.length - AUTH_TAG_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, ivBuffer);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * The only representation of the key that may appear in an API response,
 * log line, or audit detail.
 */
export function maskResendApiKey(apiKey: string): string {
  const last4 = apiKey.slice(-4);
  return `••••${last4}`;
}

export function resendApiKeyLast4(apiKey: string): string {
  return apiKey.slice(-4);
}

/** Generate a new base64 256-bit master key (operator utility). */
export function generateEmailDomainMasterKey(): string {
  return randomBytes(32).toString("base64");
}
