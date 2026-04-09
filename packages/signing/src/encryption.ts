/**
 * Encryption utilities for secure storage of certificate passwords
 * Uses AES-256-GCM for encryption
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_BLOB_PREFIX = "enc:v1:";

function getValidatedKey(masterKey: string): Buffer {
  const key = Buffer.from(masterKey, "base64");
  if (key.length !== 32) {
    throw new Error("Master key must be 256 bits (32 bytes)");
  }
  return key;
}

/**
 * Encrypt a password using AES-256-GCM
 *
 * @param password - The password to encrypt
 * @param masterKey - 256-bit master key (32 bytes, base64 encoded)
 * @returns Object containing encrypted password and IV (both base64 encoded)
 */
export function encryptPassword(
  password: string,
  masterKey: string,
): { encryptedPassword: string; iv: string } {
  const key = getValidatedKey(masterKey);

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Combine encrypted data and auth tag
  const combined = Buffer.concat([encrypted, authTag]);

  return {
    encryptedPassword: combined.toString("base64"),
    iv: iv.toString("base64"),
  };
}

/**
 * Decrypt a password using AES-256-GCM
 *
 * @param encryptedPassword - The encrypted password (base64 encoded)
 * @param iv - The initialization vector (base64 encoded)
 * @param masterKey - 256-bit master key (32 bytes, base64 encoded)
 * @returns The decrypted password
 */
export function decryptPassword(
  encryptedPassword: string,
  iv: string,
  masterKey: string,
): string {
  const key = getValidatedKey(masterKey);

  const ivBuffer = Buffer.from(iv, "base64");
  const combined = Buffer.from(encryptedPassword, "base64");

  // Extract encrypted data and auth tag
  const encrypted = combined.subarray(0, combined.length - AUTH_TAG_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, ivBuffer);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Encrypt binary data using AES-256-GCM.
 *
 * Output format: `enc:v1:<base64(iv + ciphertext + authTag)>`
 */
export function encryptBinary(
  data: Buffer | Uint8Array,
  masterKey: string,
): string {
  const key = getValidatedKey(masterKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(data)),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, encrypted, authTag]).toString("base64");

  return `${ENCRYPTED_BLOB_PREFIX}${payload}`;
}

/**
 * Decrypt binary data produced by `encryptBinary`.
 */
export function decryptBinary(
  encryptedBlob: string,
  masterKey: string,
): Buffer {
  if (!encryptedBlob.startsWith(ENCRYPTED_BLOB_PREFIX)) {
    throw new Error("Unsupported encrypted blob format");
  }

  const key = getValidatedKey(masterKey);
  const payloadBase64 = encryptedBlob.slice(ENCRYPTED_BLOB_PREFIX.length);
  const payload = Buffer.from(payloadBase64, "base64");

  if (payload.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted blob payload");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const encrypted = payload.subarray(
    IV_LENGTH,
    payload.length - AUTH_TAG_LENGTH,
  );
  const authTag = payload.subarray(payload.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Generate a new 256-bit master key
 * Use this to generate a key for SIGNING_MASTER_KEY secret
 *
 * @returns Base64 encoded 256-bit key
 */
export function generateMasterKey(): string {
  return randomBytes(32).toString("base64");
}
