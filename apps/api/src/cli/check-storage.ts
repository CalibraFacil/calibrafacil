/**
 * Proves the object storage of a running API is wired up, end to end:
 *
 *   docker compose exec -T api bun src/cli/check-storage.ts
 *
 * Run inside the API container (it needs the container's environment and the
 * API on localhost). It fails, with a non-zero exit, unless:
 *
 *   1. GET /api/health reports the storage probe as ok and NOT skipped;
 *   2. the storage configuration resolves for code outside any request (what
 *      the drift cron, the e-mail drains and certificate approval use), and a
 *      probe object can be written, read back and deleted in both buckets;
 *   3. the certificate-drift cron answers 200 (in production it fails when
 *      storage is unconfigured) and does not report being skipped.
 *
 * The self-hosted CI job runs it after the stack is up; operators can run it
 * after changing the storage settings.
 */
import { readJobsConfig, readRuntimeConfig } from "@calibra-facil/config";

import {
  createR2Client,
  deleteFromR2,
  downloadFromR2,
  r2EnvFromStorageConfig,
  resolveBucketName,
  uploadToR2,
} from "../lib/storage";

const PROBE_BODY = "calibra-check-storage";

function fail(message: string): never {
  console.error(`check-storage failed: ${message}`);
  process.exit(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function checkHealth(apiUrl: string) {
  const response = await fetch(`${apiUrl}/api/health`);
  const body = await readJsonResponse(response);
  const checks = isRecord(body) ? body.checks : undefined;
  const storage = isRecord(checks) ? checks.storage : undefined;
  if (!isRecord(storage)) {
    fail(`/api/health (HTTP ${response.status}) has no storage check`);
  }
  if (storage.skipped === true) {
    fail("/api/health skipped the storage probe: storage is not configured");
  }
  if (storage.ok !== true) {
    fail(`/api/health storage probe failed: ${JSON.stringify(storage)}`);
  }
  console.log("health: storage probe ok");
}

async function checkRoundTrip() {
  const env = r2EnvFromStorageConfig();
  if (!env) {
    fail(
      "the storage configuration does not resolve (set R2_ACCOUNT_ID or R2_ENDPOINT, the access keys and both bucket names)",
    );
  }
  const client = createR2Client(env);
  const key = `check-storage/${crypto.randomUUID()}.txt`;
  for (const bucket of ["documents", "media"] as const) {
    const name = resolveBucketName(env, bucket);
    // oxlint-disable-next-line eslint/no-await-in-loop -- two buckets, in order, for readable output.
    await uploadToR2(
      client,
      name,
      key,
      new TextEncoder().encode(PROBE_BODY),
      "text/plain",
    );
    // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
    const bytes = await downloadFromR2(client, name, key);
    if (new TextDecoder().decode(bytes) !== PROBE_BODY) {
      fail(`${bucket} bucket returned different bytes than were written`);
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
    await deleteFromR2(client, name, key);
    console.log(`storage: ${bucket} bucket (${name}) write/read/delete ok`);
  }
}

async function checkDriftCron(apiUrl: string) {
  const secret = readJobsConfig().cronSecret;
  const response = await fetch(`${apiUrl}/api/cron/certificate-drift`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
  const body = await readJsonResponse(response);
  if (response.status !== 200 || !isRecord(body)) {
    fail(
      `certificate-drift cron answered HTTP ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  if (body.skipped === true) {
    fail(
      `certificate-drift cron did not run (${String(body.reason)}); run this check again in a few minutes`,
    );
  }
  if (typeof body.checked !== "number") {
    fail(`certificate-drift cron returned no result: ${JSON.stringify(body)}`);
  }
  if (body.drifted !== 0 || body.missing !== 0) {
    fail(`certificate-drift cron found drift: ${JSON.stringify(body)}`);
  }
  console.log(`drift: ran, checked ${body.checked} certificate(s), no drift`);
}

async function main() {
  const port = readRuntimeConfig().listenPort ?? 3000;
  const apiUrl = `http://127.0.0.1:${port}`;
  await checkHealth(apiUrl);
  await checkRoundTrip();
  await checkDriftCron(apiUrl);
  console.log("check-storage: ok");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("check-storage failed:", error);
    process.exit(1);
  });
