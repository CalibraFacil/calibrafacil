import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { workerSigningEnv, type loadWorkerConfig } from "@calibra-facil/config";
import { resolveS3EndpointConfig } from "@calibra-facil/shared/storage-endpoint";
import type { Env, ObjectBucket } from "./runtime-types";

type WorkerConfig = ReturnType<typeof loadWorkerConfig>;
type StorageSettings = WorkerConfig["storage"];

/** One bucket of the configured S3-compatible store, reduced to the two calls the handlers make. */
export function createObjectBucket(
  storage: StorageSettings,
  bucketName: string,
): ObjectBucket {
  const { endpoint, region, forcePathStyle } = resolveS3EndpointConfig({
    R2_ACCOUNT_ID: storage.accountId,
    R2_ENDPOINT: storage.endpoint,
    R2_REGION: storage.region,
  });
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: storage.accessKeyId ?? "",
      secretAccessKey: storage.secretAccessKey ?? "",
    },
  });

  return {
    async get(key) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucketName, Key: key }),
      );
      if (!response.Body) return null;
      const bytes = await response.Body.transformToByteArray();
      return {
        async arrayBuffer() {
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          return copy.buffer;
        },
      };
    },
    async put(key, body, options) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body instanceof ArrayBuffer ? new Uint8Array(body) : body,
          ContentType: options?.contentType,
        }),
      );
    },
  };
}

/**
 * The handlers' `Env` from the validated worker configuration. The one mapping:
 * the always-on worker and the API's in-process runner (cron, the development
 * `local` mode) both build their environment here, so a field a handler starts to
 * need is added once and reaches both.
 */
export function createJobsEnv(config: WorkerConfig): Env {
  const { storage } = config;

  return {
    DATABASE_URL: config.database.url ?? "",
    DATABASE_OWNER_URL: config.database.ownerUrl,
    DATABASE_RLS_MODE: config.database.rlsMode,
    CERTIFICATES_BUCKET: createObjectBucket(storage, storage.bucketName ?? ""),
    MEDIA_BUCKET: createObjectBucket(storage, storage.mediaBucketName ?? ""),
    GOTENBERG_URL: config.rendering.gotenbergUrl,
    GOTENBERG_TOKEN: config.rendering.gotenbergToken,
    // The master key and every SIGNING_TSA_* variable.
    ...workerSigningEnv(config.signing),
    INTEGRATIONS_MASTER_KEY: config.integrations.masterKey,
    PUBLIC_API_MASTER_KEY: config.integrations.publicApiMasterKey,
    RESEND_API_KEY: config.email.resendApiKey,
    RESEND_FROM_EMAIL: config.email.resendFromEmail,
    EMAIL_FROM: config.email.emailFrom,
    EMAIL_LOGO_URL: config.email.emailLogoUrl,
    WEB_URL: config.origins.webUrl,
    APP_URL: config.origins.appUrl,
  };
}
