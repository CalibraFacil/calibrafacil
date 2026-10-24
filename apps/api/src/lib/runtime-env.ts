import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  loadWorkerConfig,
  workerSigningEnv,
  type WorkerSigningEnv,
} from "@calibra-facil/config";
import { resolveS3EndpointConfig } from "@calibra-facil/shared/storage-endpoint";

export type WorkerRuntimeEnv = WorkerSigningEnv & {
  DATABASE_URL: string;
  DATABASE_OWNER_URL?: string;
  DATABASE_RLS_MODE?: "shadow" | "enforced";
  CERTIFICATES_BUCKET: {
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    put(
      key: string,
      body: Buffer | Uint8Array | ArrayBuffer,
      options?: { httpMetadata?: { contentType?: string } },
    ): Promise<void>;
  };
  MEDIA_BUCKET: {
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    put(
      key: string,
      body: Buffer | Uint8Array | ArrayBuffer,
      options?: { httpMetadata?: { contentType?: string } },
    ): Promise<void>;
  };
  GOTENBERG_URL?: string;
  GOTENBERG_TOKEN?: string;
  INTEGRATIONS_MASTER_KEY?: string;
  // Conta Azul syncs run with this environment and may refresh a token with
  // the server-supplied application (laboratories' own come from the database).
  API_URL?: string;
  CONTA_AZUL_CLIENT_ID?: string;
  CONTA_AZUL_CLIENT_SECRET?: string;
  CONTA_AZUL_OAUTH_REDIRECT_URI?: string;
  // Pepper for public quote approval-code HMACs (REQ-QPUB-011).
  QUOTE_APPROVAL_CODE_PEPPER?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  EMAIL_FROM?: string;
  EMAIL_LOGO_URL?: string;
  WEB_URL?: string;
  APP_URL?: string;
};

// The buckets come from the storage configuration: R2_BUCKET_NAME (documents)
// and R2_MEDIA_BUCKET_NAME (media). createR2Bucket binds one of them.
type StorageSettings = ReturnType<typeof loadWorkerConfig>["storage"];

type LocalS3Client = S3Client & {
  send(command: GetObjectCommand): Promise<{
    Body?: { transformToByteArray(): Promise<Uint8Array> };
  }>;
  send(command: PutObjectCommand): Promise<unknown>;
};

function createR2Bucket(storage: StorageSettings, bucketName: string) {
  const { endpoint, region, forcePathStyle } = resolveS3EndpointConfig({
    R2_ACCOUNT_ID: storage.accountId,
    R2_ENDPOINT: storage.endpoint,
    R2_REGION: storage.region,
  });
  // oxlint-disable-next-line typescript/consistent-type-assertions -- AWS S3Client has command-specific send overloads that are narrower than the base client type exposes.
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: storage.accessKeyId ?? "",
      secretAccessKey: storage.secretAccessKey ?? "",
    },
  }) as LocalS3Client;

  return {
    async get(key: string) {
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
    async put(
      key: string,
      body: Buffer | Uint8Array | ArrayBuffer,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body instanceof ArrayBuffer ? new Uint8Array(body) : body,
          ContentType: options?.httpMetadata?.contentType,
        }),
      );
    },
  };
}

/**
 * The worker's environment (cron handlers, the inline dev
 * runner). The worker cannot do any work without its database, storage and
 * keys, so a missing one throws one aggregated error.
 */
export function createWorkerRuntimeEnv(): WorkerRuntimeEnv {
  const config = loadWorkerConfig();
  const { storage } = config;

  return {
    DATABASE_URL: config.database.url ?? "",
    DATABASE_OWNER_URL: config.database.ownerUrl,
    DATABASE_RLS_MODE: config.database.rlsMode,
    CERTIFICATES_BUCKET: createR2Bucket(storage, storage.bucketName ?? ""),
    MEDIA_BUCKET: createR2Bucket(storage, storage.mediaBucketName ?? ""),
    // Gotenberg HTML/XLSX->PDF service (services/gotenberg on Cloudflare Containers).
    GOTENBERG_URL: config.rendering.gotenbergUrl,
    GOTENBERG_TOKEN: config.rendering.gotenbergToken,
    // The master key and every SIGNING_TSA_* variable, shared with createWorkerEnv.
    ...workerSigningEnv(config.signing),
    INTEGRATIONS_MASTER_KEY: config.integrations.masterKey,
    API_URL: config.origins.apiUrl,
    CONTA_AZUL_CLIENT_ID: config.integrations.contaAzulClientId,
    CONTA_AZUL_CLIENT_SECRET: config.integrations.contaAzulClientSecret,
    CONTA_AZUL_OAUTH_REDIRECT_URI:
      config.integrations.contaAzulOauthRedirectUri,
    RESEND_API_KEY: config.email.resendApiKey,
    RESEND_FROM_EMAIL: config.email.resendFromEmail,
    EMAIL_FROM: config.email.emailFrom,
    EMAIL_LOGO_URL: config.email.emailLogoUrl,
    WEB_URL: config.origins.webUrl,
    APP_URL: config.origins.appUrl,
  };
}
