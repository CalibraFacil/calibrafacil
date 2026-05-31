import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

type LocalKvValue = {
  value: string;
  expiresAt?: number;
};

type LocalKvNamespace = {
  get(key: string, type?: "text"): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
};

export type ApiRuntimeEnv = Record<string, unknown> & {
  CACHE: LocalKvNamespace;
};

export type WorkerRuntimeEnv = {
  DATABASE_URL: string;
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
  RUNTIME_ASSETS_BUCKET?: {
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  };
  CHROME_EXECUTABLE_PATH?: string;
  CHROMIUM_PACK_R2_KEY?: string;
  CHROMIUM_PACK_URL?: string;
  GOTENBERG_URL?: string;
  GOTENBERG_TOKEN?: string;
  SIGNING_MASTER_KEY?: string;
  INTEGRATIONS_MASTER_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  EMAIL_FROM?: string;
  EMAIL_LOGO_URL?: string;
  WEB_URL?: string;
  APP_URL?: string;
};

const requiredProductionEnv = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "ASAAS_API_KEY",
  "ASAAS_ENVIRONMENT",
  "ASAAS_WEBHOOK_TOKEN",
  "BACKOFFICE_BOOTSTRAP_TOKEN",
  "INTERNAL_OPERATOR_EMAILS",
  "PUBLIC_API_MASTER_KEY",
  "INTEGRATIONS_MASTER_KEY",
  "SIGNING_MASTER_KEY",
  "PORTAL_SERVICE_USER_ID",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_MEDIA_BUCKET_NAME",
  "RESEND_API_KEY",
] as const;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function createLocalKv(): LocalKvNamespace {
  const values = new Map<string, LocalKvValue>();

  return {
    async get(key) {
      const item = values.get(key);
      if (!item) return null;

      if (item.expiresAt !== undefined && item.expiresAt <= Date.now()) {
        values.delete(key);
        return null;
      }

      return item.value;
    },
    async put(key, value, options) {
      values.set(key, {
        value,
        expiresAt: options?.expirationTtl
          ? Date.now() + options.expirationTtl * 1000
          : undefined,
      });
    },
    async delete(key) {
      values.delete(key);
    },
  };
}

const apiRuntimeCache = createLocalKv();

// R2 buckets are resolved from env: R2_BUCKET_NAME (documents) and
// R2_MEDIA_BUCKET_NAME (media). createR2Bucket binds the documents bucket.
type LocalS3Client = S3Client & {
  send(command: GetObjectCommand): Promise<{
    Body?: { transformToByteArray(): Promise<Uint8Array> };
  }>;
  send(command: PutObjectCommand): Promise<unknown>;
};

function createR2Bucket(bucketName = requiredEnv("R2_BUCKET_NAME")) {
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  // oxlint-disable-next-line typescript/consistent-type-assertions -- AWS S3Client has command-specific send overloads that are narrower than the base client type exposes.
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
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

export function createApiRuntimeEnv(): ApiRuntimeEnv {
  const isProduction =
    process.env.VERCEL === "1" || process.env.VERCEL_ENV === "production";

  if (isProduction) {
    for (const key of requiredProductionEnv) {
      requiredEnv(key);
    }
  }

  if (process.env.VERCEL) {
    process.env.DATABASE_POOL_MAX ??= "1";
  }

  const databaseUrl = process.env.DATABASE_URL;
  const env: ApiRuntimeEnv = {
    API_URL: process.env.API_URL,
    APP_URL: process.env.APP_URL,
    PORTAL_APP_URL: process.env.PORTAL_APP_URL,
    ...process.env,
    CACHE: apiRuntimeCache,
  };

  if (databaseUrl) {
    env.HYPERDRIVE = { connectionString: databaseUrl };
  }

  return env;
}

export function createWorkerRuntimeEnv(): WorkerRuntimeEnv {
  const databaseUrl = requiredEnv("DATABASE_URL");

  if (process.env.VERCEL) {
    process.env.DATABASE_POOL_MAX ??= "1";
  }

  return {
    DATABASE_URL: databaseUrl,
    CERTIFICATES_BUCKET: createR2Bucket(),
    MEDIA_BUCKET: createR2Bucket(requiredEnv("R2_MEDIA_BUCKET_NAME")),
    RUNTIME_ASSETS_BUCKET: process.env.CHROMIUM_PACK_R2_BUCKET
      ? createR2Bucket(process.env.CHROMIUM_PACK_R2_BUCKET)
      : undefined,
    CHROME_EXECUTABLE_PATH: process.env.CHROME_EXECUTABLE_PATH,
    CHROMIUM_PACK_R2_KEY: process.env.CHROMIUM_PACK_R2_KEY,
    CHROMIUM_PACK_URL: process.env.CHROMIUM_PACK_URL,
    GOTENBERG_URL: process.env.GOTENBERG_URL,
    GOTENBERG_TOKEN: process.env.GOTENBERG_TOKEN,
    SIGNING_MASTER_KEY: requiredEnv("SIGNING_MASTER_KEY"),
    INTEGRATIONS_MASTER_KEY: requiredEnv("INTEGRATIONS_MASTER_KEY"),
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_LOGO_URL: process.env.EMAIL_LOGO_URL,
    WEB_URL: process.env.WEB_URL,
    APP_URL: process.env.APP_URL,
  };
}
