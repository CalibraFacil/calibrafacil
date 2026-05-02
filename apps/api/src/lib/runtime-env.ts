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
  HYPERDRIVE: { connectionString: string };
  CERTIFICATES_BUCKET: {
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    put(
      key: string,
      body: Buffer | Uint8Array | ArrayBuffer,
      options?: { httpMetadata?: { contentType?: string } },
    ): Promise<void>;
  };
  CHROME_EXECUTABLE_PATH?: string;
  SIGNING_MASTER_KEY?: string;
  INTEGRATIONS_MASTER_KEY?: string;
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

function createR2Bucket() {
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  const bucket = requiredEnv("R2_BUCKET_NAME");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });

  return {
    async get(key: string) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
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
          Bucket: bucket,
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
  const env = {
    API_URL: process.env.API_URL,
    APP_URL: process.env.APP_URL,
    PORTAL_APP_URL: process.env.PORTAL_APP_URL,
    ...process.env,
    CACHE: createLocalKv(),
  } as ApiRuntimeEnv;

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
    HYPERDRIVE: { connectionString: databaseUrl },
    CERTIFICATES_BUCKET: createR2Bucket(),
    CHROME_EXECUTABLE_PATH: process.env.CHROME_EXECUTABLE_PATH,
    SIGNING_MASTER_KEY: requiredEnv("SIGNING_MASTER_KEY"),
    INTEGRATIONS_MASTER_KEY: requiredEnv("INTEGRATIONS_MASTER_KEY"),
  };
}
