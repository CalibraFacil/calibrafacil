import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  resolveS3EndpointConfig,
  resolveS3EndpointConfigFromProcess,
} from "@calibra-facil/shared/storage-endpoint";
import type { StorageBucket } from "@calibra-facil/shared/storage-keys";

export interface R2Env {
  R2_ACCOUNT_ID: string;
  /** S3-compatible endpoint override (non-R2 stores, local dev). */
  R2_ENDPOINT?: string;
  R2_REGION?: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  /** Documents bucket: regulated lab records (certs, SO docs, standards, sync). */
  R2_BUCKET_NAME: string;
  /** Media bucket: branding/media (logos, signatures, avatars, template sources). */
  R2_MEDIA_BUCKET_NAME: string;
  CERTIFICATES_BUCKET?: R2BucketLike;
  MEDIA_BUCKET?: R2BucketLike;
  NODE_ENV?: string;
  API_URL?: string;
}

/** Resolve a logical bucket to its concrete (env-configured) bucket name. */
export function resolveBucketName(env: R2Env, bucket: StorageBucket): string {
  return bucket === "media" ? env.R2_MEDIA_BUCKET_NAME : env.R2_BUCKET_NAME;
}

/**
 * Build a Content-Disposition header value that forces a descriptive download
 * filename. Includes both an ASCII fallback and an RFC 5987 UTF-8 form.
 */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
    filename,
  )}`;
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
  send(command: HeadObjectCommand): Promise<unknown>;
};

/** True if the object exists in the given bucket (HEAD returns 200). */
export async function objectExists(
  client: R2S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve which concrete bucket actually holds an object. During the bucket
 * split an object may live in `preferred` (new writes / after backfill), the
 * other bucket (legacy, pre-backfill), or both (post-copy, pre delete-old).
 * HEAD the preferred bucket first, then the other; default to preferred so a
 * genuinely-missing object 404s consistently.
 */
export async function resolveReadBucketName(
  client: R2S3Client,
  env: R2Env,
  preferred: StorageBucket,
  key: string,
): Promise<string> {
  const preferredName = resolveBucketName(env, preferred);
  if (await objectExists(client, preferredName, key)) return preferredName;
  const otherName = resolveBucketName(
    env,
    preferred === "media" ? "documents" : "media",
  );
  if (await objectExists(client, otherName, key)) return otherName;
  return preferredName;
}

export function createR2Client(env: R2Env): R2S3Client {
  // The R2 S3 endpoint is derived from the account id unless R2_ENDPOINT points
  // at another S3-compatible store; credentials are the S3 key pair (access key
  // id + secret). Rotating it requires updating R2_ACCESS_KEY_ID /
  // R2_SECRET_ACCESS_KEY and redeploying.
  const { endpoint, region, forcePathStyle } =
    resolveS3EndpointConfigFromProcess(env);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- AWS S3Client exposes command-specific send overloads through the concrete client.
  return new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  }) as R2S3Client;
}

let publicPresignClient: { endpoint: string; client: R2S3Client } | undefined;

/**
 * The client presigned URLs are signed with. Browsers open those URLs
 * directly, so when the API reaches the store at an internal address
 * (R2_ENDPOINT=http://s3:7070 in docker-compose.prod.yml), R2_PUBLIC_ENDPOINT
 * names the address browsers use instead. Signing is local: nothing is sent
 * to that address from here.
 */
export function presignClientFor(client: R2S3Client): R2S3Client {
  const endpoint = process.env.R2_PUBLIC_ENDPOINT?.trim().replace(/\/+$/, "");
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return client;

  if (publicPresignClient?.endpoint !== endpoint) {
    const config = resolveS3EndpointConfig({
      R2_ENDPOINT: endpoint,
      R2_REGION: process.env.R2_REGION,
    });
    // oxlint-disable-next-line typescript/consistent-type-assertions -- AWS S3Client exposes command-specific send overloads through the concrete client.
    const presigner = new S3Client({
      ...config,
      credentials: { accessKeyId, secretAccessKey },
    }) as R2S3Client;
    publicPresignClient = { endpoint, client: presigner };
  }
  return publicPresignClient.client;
}

export interface PresignedUrlOptions {
  expiresIn?: number; // seconds; default 900 (15 minutes)
  /** Sets Content-Disposition on the response (e.g. a descriptive filename). */
  responseContentDisposition?: string;
}

export async function generatePresignedUrl(
  client: R2S3Client,
  bucket: string,
  key: string,
  options: number | PresignedUrlOptions = 900,
): Promise<string> {
  const opts: PresignedUrlOptions =
    typeof options === "number" ? { expiresIn: options } : options;
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: opts.responseContentDisposition,
  });
  return getSignedUrl(presignClientFor(client), command, {
    expiresIn: opts.expiresIn ?? 900,
  });
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
  return getSignedUrl(presignClientFor(client), command, { expiresIn });
}

/**
 * Extract R2 key from stored certificateUrl
 * Format: https://storage.invalid/job-123.pdf -> job-123.pdf (see storedObjectUrl)
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
