/**
 * Envelope encryption of the laboratories' signing credentials (roadmap 2 B4a,
 * Q44; review 3.1 "key custody").
 *
 * The P12 and its password used to be encrypted directly with one static master
 * key for every tenant: no key id, no rotation, nothing tying a ciphertext to the
 * row it belongs to. Now:
 *
 *   - each credential field (P12, password) gets its OWN random AES-256-GCM data
 *     key (DEK); the data is encrypted under it, and the DEK is wrapped by a key
 *     encryption key (KEK, the master key, identified by a `kekId`);
 *   - the AAD of both the wrap and the data encryption binds
 *     organization + unit + certificate serial + field, so a ciphertext copied to
 *     another organization, unit, certificate or field does not open;
 *   - the stored record carries the `kekId` and a format version, so a rotation
 *     (a current KEK plus the previous ones) can decrypt and re-wrap.
 *
 * Wire format of one field (all parts base64, `:` never occurs inside them):
 *
 *     enc:v2:<kekId>:<wrapped DEK = iv ‖ ciphertext ‖ tag>:<data = iv ‖ ciphertext ‖ tag>
 *
 * LEGACY rows (format 1: `enc:v1:` P12 + `encrypted_password`/`password_iv`, no
 * kek id) keep decrypting: with no key id they are tried against the current KEK
 * and then every previous one, so a deployment can rotate before it migrates.
 * `reencrypt-signing-credentials` (apps/api) migrates them.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { decryptBinary, decryptPassword } from "./encryption.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ENVELOPE_PREFIX = "enc:v2:";
const AAD_DOMAIN = "calibra:signing-credential:v2";

/** Legacy storage: P12 and password encrypted straight with the master key. */
export const CREDENTIAL_FORMAT_LEGACY = 1;
/** Envelope storage: per-field data keys wrapped by an identified KEK. */
export const CREDENTIAL_FORMAT_ENVELOPE = 2;

/**
 * `password_iv` is NOT NULL and meaningless in the envelope format (each blob
 * carries its own IVs); a visible placeholder keeps the column honest.
 */
export const ENVELOPE_PASSWORD_IV_PLACEHOLDER = "envelope:v2";

/** The id of the current KEK when `SIGNING_MASTER_KEY_ID` is not set. */
export const DEFAULT_KEK_ID = "k1";

const KEK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export interface SigningKeyring {
  /** Id of the KEK new credentials are sealed under. */
  readonly currentId: string;
  /** Every KEK that can still open something: the current one and the previous ones. */
  readonly keys: ReadonlyMap<string, Buffer>;
}

// Same shape the configuration accepts (packages/config): canonical base64, no
// trailing garbage after the padding.
const BASE64_KEY = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * NO error below ever echoes a value read from the environment: a key pasted
 * into the id setting, or an entry written `key:id` instead of `id:key`, must not
 * end up in a log. Errors name the variable (and the entry's position), never
 * its content.
 */
function parseKey(material: string, label: string): Buffer {
  const trimmed = material.trim();
  const key = BASE64_KEY.test(trimmed)
    ? Buffer.from(trimmed, "base64")
    : Buffer.alloc(0);
  if (key.length !== KEY_LENGTH) {
    throw new Error(`${label} must be a 256-bit key (32 bytes, base64)`);
  }
  return key;
}

function assertKekId(id: string, label: string): string {
  if (!KEK_ID_PATTERN.test(id)) {
    throw new Error(
      `${label} is not a valid KEK id: use 1-64 letters, digits, "_", "." or "-"`,
    );
  }
  return id;
}

export interface SigningKeyringInput {
  /** The current KEK, base64 (the `SIGNING_MASTER_KEY`). */
  currentKey: string;
  /** Its id (default {@link DEFAULT_KEK_ID}). */
  currentId?: string;
  /** Previous KEKs as `id:base64key`, comma separated. */
  previous?: string;
}

export function createSigningKeyring(
  input: SigningKeyringInput,
): SigningKeyring {
  const currentId = assertKekId(
    input.currentId?.trim() || DEFAULT_KEK_ID,
    "SIGNING_MASTER_KEY_ID",
  );
  const currentKey = parseKey(input.currentKey, "SIGNING_MASTER_KEY");
  const keys = new Map<string, Buffer>([[currentId, currentKey]]);

  const seen = new Set<string>();
  let position = 0;
  for (const raw of (input.previous ?? "").split(",")) {
    const entry = raw.trim();
    if (entry === "") continue;
    position += 1;
    const label = `SIGNING_MASTER_KEY_PREVIOUS entry ${position}`;
    const separator = entry.indexOf(":");
    if (separator === -1) {
      throw new Error(`${label} must look like id:base64key`);
    }
    const id = assertKekId(entry.slice(0, separator).trim(), `${label}'s id`);
    const key = parseKey(entry.slice(separator + 1), `${label}'s key`);
    if (seen.has(id)) {
      throw new Error(`${label} repeats the id of an earlier entry`);
    }
    seen.add(id);
    const existing = keys.get(id);
    if (existing && !existing.equals(key)) {
      throw new Error(
        `${label} has the current key's id but names a different key`,
      );
    }
    keys.set(id, key);
  }
  return { currentId, keys };
}

export interface SigningKeyringEnv {
  SIGNING_MASTER_KEY?: string | undefined;
  SIGNING_MASTER_KEY_ID?: string | undefined;
  SIGNING_MASTER_KEY_PREVIOUS?: string | undefined;
}

/** The keyring of an environment, or null when no master key is configured. */
export function signingKeyringFromEnv(
  env: SigningKeyringEnv,
): SigningKeyring | null {
  if (!env.SIGNING_MASTER_KEY) return null;
  return createSigningKeyring({
    currentKey: env.SIGNING_MASTER_KEY,
    ...(env.SIGNING_MASTER_KEY_ID
      ? { currentId: env.SIGNING_MASTER_KEY_ID }
      : {}),
    ...(env.SIGNING_MASTER_KEY_PREVIOUS
      ? { previous: env.SIGNING_MASTER_KEY_PREVIOUS }
      : {}),
  });
}

/** What binds a credential to the row it belongs to (the AAD). */
export interface SigningCredentialBinding {
  organizationId: string;
  unitId: number;
  serialNumber: string;
}

type Field = "p12" | "password";
type Part = "wrap" | "data";

function aad(
  binding: SigningCredentialBinding,
  field: Field,
  part: Part,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      AAD_DOMAIN,
      binding.organizationId,
      binding.unitId,
      binding.serialNumber,
      field,
      part,
    ]),
    "utf8",
  );
}

function gcmEncrypt(
  key: Buffer,
  plaintext: Buffer,
  associated: Buffer,
): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(associated);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]);
}

function gcmDecrypt(key: Buffer, payload: Buffer, associated: Buffer): Buffer {
  if (payload.length <= IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid encrypted credential payload");
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH, payload.length - TAG_LENGTH);
  const tag = payload.subarray(payload.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(associated);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function sealField(
  plaintext: Buffer,
  binding: SigningCredentialBinding,
  field: Field,
  kekId: string,
  kek: Buffer,
): string {
  const dek = randomBytes(KEY_LENGTH);
  const wrapped = gcmEncrypt(kek, dek, aad(binding, field, "wrap"));
  const data = gcmEncrypt(dek, plaintext, aad(binding, field, "data"));
  dek.fill(0);
  return `${ENVELOPE_PREFIX}${kekId}:${wrapped.toString("base64")}:${data.toString("base64")}`;
}

function parseEnvelope(blob: string): {
  kekId: string;
  wrapped: Buffer;
  data: Buffer;
} {
  if (!blob.startsWith(ENVELOPE_PREFIX)) {
    throw new Error("Unsupported credential format");
  }
  const [kekId, wrapped, data, ...rest] = blob
    .slice(ENVELOPE_PREFIX.length)
    .split(":");
  if (!kekId || !wrapped || !data || rest.length > 0) {
    throw new Error("Malformed credential envelope");
  }
  return {
    kekId,
    wrapped: Buffer.from(wrapped, "base64"),
    data: Buffer.from(data, "base64"),
  };
}

function openField(
  blob: string,
  binding: SigningCredentialBinding,
  field: Field,
  keyring: SigningKeyring,
): Buffer {
  const { kekId, wrapped, data } = parseEnvelope(blob);
  const kek = keyring.keys.get(kekId);
  if (!kek) {
    throw new Error(
      `The signing credential is sealed under KEK "${kekId}", which is not configured (SIGNING_MASTER_KEY_ID / SIGNING_MASTER_KEY_PREVIOUS)`,
    );
  }
  const dek = gcmDecrypt(kek, wrapped, aad(binding, field, "wrap"));
  try {
    return gcmDecrypt(dek, data, aad(binding, field, "data"));
  } finally {
    dek.fill(0);
  }
}

/** The credential columns of an `organization_signing_certificate` row. */
export interface StoredSigningCredential {
  encryptedP12: string;
  encryptedPassword: string;
  passwordIv: string;
  /** NULL for a legacy row. */
  kekId: string | null;
  formatVersion: number;
}

export function sealSigningCredential(
  credential: { p12: Buffer | Uint8Array; password: string },
  binding: SigningCredentialBinding,
  keyring: SigningKeyring,
): StoredSigningCredential {
  const kek = keyring.keys.get(keyring.currentId);
  if (!kek) throw new Error("The current KEK is not in the keyring");
  return {
    encryptedP12: sealField(
      Buffer.from(credential.p12),
      binding,
      "p12",
      keyring.currentId,
      kek,
    ),
    encryptedPassword: sealField(
      Buffer.from(credential.password, "utf8"),
      binding,
      "password",
      keyring.currentId,
      kek,
    ),
    passwordIv: ENVELOPE_PASSWORD_IV_PLACEHOLDER,
    kekId: keyring.currentId,
    formatVersion: CREDENTIAL_FORMAT_ENVELOPE,
  };
}

function isEnvelope(stored: StoredSigningCredential): boolean {
  return (
    stored.formatVersion === CREDENTIAL_FORMAT_ENVELOPE ||
    stored.encryptedP12.startsWith(ENVELOPE_PREFIX)
  );
}

export interface OpenedSigningCredential {
  p12: Buffer;
  password: string;
  format: number;
}

/**
 * Open a stored credential. Throws when the AAD (organization, unit, serial)
 * does not match what it was sealed with, when the ciphertext was altered, or
 * when its KEK is not in the keyring.
 */
export function openSigningCredential(
  stored: StoredSigningCredential,
  binding: SigningCredentialBinding,
  keyring: SigningKeyring,
): OpenedSigningCredential {
  if (isEnvelope(stored)) {
    return {
      p12: openField(stored.encryptedP12, binding, "p12", keyring),
      password: openField(
        stored.encryptedPassword,
        binding,
        "password",
        keyring,
      ).toString("utf8"),
      format: CREDENTIAL_FORMAT_ENVELOPE,
    };
  }

  // Legacy: no key id, so every KEK of the keyring is tried (current first).
  const ordered = [
    keyring.currentId,
    ...[...keyring.keys.keys()].filter((id) => id !== keyring.currentId),
  ];
  let lastError: unknown;
  for (const id of ordered) {
    const key = keyring.keys.get(id);
    if (!key) continue;
    const masterKey = key.toString("base64");
    try {
      return {
        p12: decryptBinary(stored.encryptedP12, masterKey),
        password: decryptPassword(
          stored.encryptedPassword,
          stored.passwordIv,
          masterKey,
        ),
        format: CREDENTIAL_FORMAT_LEGACY,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `The legacy signing credential does not open with any configured KEK: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * True when the record is not yet an envelope under the CURRENT KEK: a legacy
 * row, or an envelope sealed under a previous one. The re-encrypt CLI's filter.
 */
export function credentialNeedsRewrap(
  stored: StoredSigningCredential,
  keyring: SigningKeyring,
): boolean {
  if (!isEnvelope(stored)) return true;
  // The header of each blob is what decides which KEK opens it; the `kek_id`
  // column mirrors it for queries and is not trusted here.
  return [stored.encryptedP12, stored.encryptedPassword].some(
    (blob) => parseEnvelope(blob).kekId !== keyring.currentId,
  );
}
