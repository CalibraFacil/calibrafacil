/**
 * One-shot setup for an install: `pnpm --dir apps/api init`, or the `init`
 * service of docker-compose.prod.yml, which runs it before the API starts.
 *
 *  1. Database: create the schema on an empty database, or apply pending
 *     migrations (packages/db/scripts/bootstrap.mjs).
 *  2. Reference data: the asset-type catalog and the legal-metrology
 *     regulations.
 *  3. Object storage: the documents and media buckets, when missing.
 *  4. The client-portal service account (PORTAL_SERVICE_USER_ID).
 *
 * Every step is idempotent, so it is safe to run on every start.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { seedAssetTypes } from "@calibra-facil/db/seed-asset-types";
import { resolveS3EndpointConfigFromProcess } from "@calibra-facil/shared/storage-endpoint";

import { ensurePortalServiceUser } from "../lib/portal-service-account";

const bootstrapScript = fileURLToPath(
  new URL("../../../../packages/db/scripts/bootstrap.mjs", import.meta.url),
);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const metadata: unknown = Reflect.get(error, "$metadata");
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const status: unknown = Reflect.get(metadata, "httpStatusCode");
  return typeof status === "number" ? status : undefined;
}

async function ensureBucket(client: S3Client, bucket: string) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`  ${bucket}: exists`);
    return;
  } catch (error) {
    if (httpStatus(error) !== 404) {
      // Hosted stores (R2, S3) often hand out keys that may use a bucket but
      // not inspect or create one; the bucket is then the operator's job.
      console.warn(
        `  ${bucket}: could not check it (${error instanceof Error ? error.message : String(error)}); make sure it exists`,
      );
      return;
    }
  }
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`  ${bucket}: created`);
}

async function main() {
  console.log("Database schema");
  execFileSync(process.execPath, [bootstrapScript], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: requiredEnv("DATABASE_URL") },
  });

  console.log("Reference data");
  await seedAssetTypes();
  console.log("  asset types and legal-metrology regulations: up to date");

  console.log("Object storage");
  const { endpoint, region, forcePathStyle } =
    resolveS3EndpointConfigFromProcess();
  const s3 = new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  for (const bucket of [
    requiredEnv("R2_BUCKET_NAME"),
    requiredEnv("R2_MEDIA_BUCKET_NAME"),
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- two buckets, in order, for readable output.
    await ensureBucket(s3, bucket);
  }

  console.log("Portal service account");
  const service = await ensurePortalServiceUser();
  console.log(`  ${service.id}: ${service.created ? "created" : "exists"}`);

  console.log("Ready.");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("init failed:", error);
    process.exit(1);
  });
