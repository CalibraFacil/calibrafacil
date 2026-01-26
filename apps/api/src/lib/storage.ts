import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface R2Env {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
}

export function createR2Client(env: R2Env): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

export async function generatePresignedUrl(
  client: S3Client,
  bucket: string,
  key: string,
  expiresIn: number = 900 // 15 minutes
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Extract R2 key from stored certificateUrl
 * Format: https://certificates.calibrafacil.com/job-123.pdf -> job-123.pdf
 */
export function extractKeyFromUrl(certificateUrl: string): string {
  const url = new URL(certificateUrl);
  return url.pathname.slice(1); // Remove leading slash
}

/**
 * Upload a file to R2 bucket
 */
export async function uploadToR2(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer | Uint8Array | ArrayBuffer,
  contentType: string
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body instanceof ArrayBuffer ? new Uint8Array(body) : body,
    ContentType: contentType,
  });
  await client.send(command);
}

/**
 * Delete a file from R2 bucket
 */
export async function deleteFromR2(
  client: S3Client,
  bucket: string,
  key: string
): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  await client.send(command);
}
