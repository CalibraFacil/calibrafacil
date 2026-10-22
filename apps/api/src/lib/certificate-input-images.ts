import { readRuntimeConfig } from "@calibra-facil/config";
import type { CertificateImageReader } from "@calibra-facil/db/certificate-input";
import type { StorageBucket } from "@calibra-facil/shared/storage-keys";
import {
  createR2Client,
  downloadFromR2,
  r2EnvFromStorageConfig,
  resolveBucketName,
  type R2Env,
} from "./storage";

/** One storage read may not hold the approval for longer than this. */
export const CERTIFICATE_IMAGE_READ_TIMEOUT_MS = 10_000;

/**
 * Object storage could not give the image (a failure, a stalled call, or no
 * storage configured in a deployment that needs it). The approval fails and is
 * retried: a certificate is never frozen without an image it should carry.
 */
export class CertificateImageStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CertificateImageStorageError";
  }
}

function isMissingObject(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "NoSuchKey" || error.name === "NotFound")
  );
}

/** The read, or a `CertificateImageStorageError` once `timeoutMs` has passed. */
async function withTimeout<T>(
  read: Promise<T>,
  key: string,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new CertificateImageStorageError(
            `Reading ${key} from object storage took longer than ${timeoutMs} ms`,
          ),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([read, stalled]);
  } finally {
    clearTimeout(timer);
  }
}

async function downloadIfPresent(
  env: R2Env,
  bucket: StorageBucket,
  key: string,
): Promise<Uint8Array | null> {
  try {
    return await withTimeout(
      downloadFromR2(createR2Client(env), resolveBucketName(env, bucket), key),
      key,
      CERTIFICATE_IMAGE_READ_TIMEOUT_MS,
    );
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
}

/**
 * Reads the images a certificate embeds (the lab logo, the approver's drawn
 * signature) so they can be frozen with the certificate input as data URIs:
 * the logo object is deleted when the lab uploads another one, so a key stored
 * in the input would not survive a re-render. Called before the approval
 * transaction, never inside it.
 *
 * Outcomes, on purpose:
 *   - bytes: the object exists;
 *   - null: no object backs the key (it is frozen as absent), or, in
 *     development and test only, no storage is configured;
 *   - throws: storage failed or stalled, or no storage is configured where
 *     there must be one (production). The approval fails and is retried
 *     instead of freezing a certificate missing an image forever.
 */
export const readCertificateImage: CertificateImageReader = async (key) => {
  const env = r2EnvFromStorageConfig();
  if (!env) {
    if (readRuntimeConfig().isProduction) {
      throw new CertificateImageStorageError(
        `Object storage is not configured: cannot read ${key} for the certificate`,
      );
    }
    return null;
  }
  // Objects written during the bucket split may still sit in the other bucket:
  // the media bucket first, then the documents bucket.
  return (
    (await downloadIfPresent(env, "media", key)) ??
    (await downloadIfPresent(env, "documents", key))
  );
};
