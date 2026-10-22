import type { CertificateImageReader } from "@calibra-facil/db/certificate-input";
import type { StorageBucket } from "@calibra-facil/shared/storage-keys";
import {
  createR2Client,
  downloadFromR2,
  r2EnvFromStorageConfig,
  resolveBucketName,
  type R2Env,
} from "./storage";

function isMissingObject(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "NoSuchKey" || error.name === "NotFound")
  );
}

async function downloadIfPresent(
  env: R2Env,
  bucket: StorageBucket,
  key: string,
): Promise<Uint8Array | null> {
  try {
    return await downloadFromR2(
      createR2Client(env),
      resolveBucketName(env, bucket),
      key,
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
 * in the input would not survive a re-render.
 *
 * Three outcomes, on purpose:
 *   - bytes: the object exists;
 *   - null: no object backs the key, or storage is not configured (a
 *     development setup without a bucket) — the certificate then renders
 *     without that image, exactly as it did before;
 *   - throws: storage failed. The approval must fail and be retried rather
 *     than freeze a certificate missing an image forever.
 */
export const readCertificateImage: CertificateImageReader = async (key) => {
  const env = r2EnvFromStorageConfig();
  if (!env) return null;
  // Objects written during the bucket split may still sit in the other bucket:
  // the media bucket first, then the documents bucket.
  return (
    (await downloadIfPresent(env, "media", key)) ??
    (await downloadIfPresent(env, "documents", key))
  );
};
