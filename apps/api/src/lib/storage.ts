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
  CERTIFICATES_BUCKET?: R2BucketLike;
  NODE_ENV?: string;
  API_URL?: string;
}

export interface R2ObjectBodyLike {
  body: BodyInit | null;
  httpMetadata?: {
    contentType?: string;
  };
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
}

type R2S3Client = S3Client & {
  send(command: GetObjectCommand): Promise<unknown>;
  send(command: PutObjectCommand | DeleteObjectCommand): Promise<unknown>;
};

export function createR2Client(env: R2Env): R2S3Client {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- AWS S3Client exposes command-specific send overloads through the concrete client.
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  }) as R2S3Client;
}

export async function generatePresignedUrl(
  client: R2S3Client,
  bucket: string,
  key: string,
  expiresIn: number = 900, // 15 minutes
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn });
}

export async function generatePresignedUploadUrl(
  client: R2S3Client,
  bucket: string,
  key: string,
  contentType: string,
  expiresIn: number = 900,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
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
  client: R2S3Client,
  bucket: string,
  key: string,
  body: Buffer | Uint8Array | ArrayBuffer,
  contentType: string,
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
 * Download an object from R2.
 */
export async function downloadFromR2(
  client: R2S3Client,
  bucket: string,
  key: string,
): Promise<Uint8Array> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await client.send(command);
  const responseRecord =
    response && typeof response === "object" && !Array.isArray(response)
      ? Object.fromEntries(Object.entries(response))
      : {};
  const body = responseRecord.Body;
  const bodyRecord =
    body && typeof body === "object" && !Array.isArray(body)
      ? Object.fromEntries(Object.entries(body))
      : {};

  if (!body) {
    throw new Error(`R2 object not found: ${key}`);
  }

  if (typeof bodyRecord.transformToByteArray === "function") {
    return bodyRecord.transformToByteArray();
  }

  if (typeof bodyRecord.transformToString === "function") {
    return new TextEncoder().encode(await bodyRecord.transformToString());
  }

  throw new Error(`R2 object body is not readable: ${key}`);
}

/**
 * Delete a file from R2 bucket
 */
export async function deleteFromR2(
  client: R2S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  await client.send(command);
}
