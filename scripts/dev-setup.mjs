#!/usr/bin/env node
// One-command local setup: `pnpm setup:dev` (add `--reset` to start from scratch).
//
//   1. checks the toolchain (Node 24+, pnpm, Bun, Docker Compose)
//   2. creates apps/api/.env and packages/db/.env from their examples, with
//      freshly generated secrets (existing files are never overwritten)
//   3. starts docker-compose.yml (Postgres, S3, Mailpit, Resend relay, Gotenberg)
//   4. applies the database migrations
//   5. creates the storage buckets
//   6. seeds the catalogs and a demo laboratory you can sign in to
//
// Safe to re-run: every step is idempotent.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reset = process.argv.includes("--reset");
const isWindows = process.platform === "win32";

const step = (message) => console.log(`\n▸ ${message}`);
const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWindows,
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed (exit ${result.status ?? "?"})`);
  }
}

function hasCommand(command, args = ["--version"]) {
  try {
    execFileSync(command, args, { stdio: "ignore", shell: isWindows });
    return true;
  } catch {
    return false;
  }
}

function parseEnvFile(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

// ── 1. toolchain ──────────────────────────────────────────────────────────────
step("Checking the toolchain");
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 24) {
  fail(`Node.js 24+ is required (found ${process.versions.node}).`);
}
if (!hasCommand(isWindows ? "pnpm.cmd" : "pnpm")) {
  fail(
    "pnpm is required: `corepack enable` (or https://pnpm.io/installation).",
  );
}
if (!hasCommand("bun")) {
  fail("Bun is required to run the API: https://bun.sh/docs/installation");
}
if (!hasCommand("docker", ["compose", "version"])) {
  fail(
    "Docker with the Compose plugin is required: https://docs.docker.com/get-docker/",
  );
}
console.log("  Node, pnpm, Bun and Docker Compose found.");

if (!existsSync(path.join(root, "node_modules"))) {
  step("Installing dependencies");
  run(isWindows ? "pnpm.cmd" : "pnpm", ["install"]);
}

// ── 2. env files ──────────────────────────────────────────────────────────────
step("Preparing environment files");
const base64Key = () => randomBytes(32).toString("base64");
const generated = {
  BETTER_AUTH_SECRET: () => randomBytes(48).toString("base64url"),
  CRON_SECRET: () => randomBytes(32).toString("base64url"),
  SIGNING_MASTER_KEY: base64Key,
  INTEGRATIONS_MASTER_KEY: base64Key,
  PUBLIC_API_MASTER_KEY: base64Key,
  EMAIL_DOMAIN_MASTER_KEY: base64Key,
  QUOTE_APPROVAL_CODE_PEPPER: () => randomBytes(32).toString("base64url"),
};

for (const [example, target] of [
  ["apps/api/.env.example", "apps/api/.env"],
  ["packages/db/.env.example", "packages/db/.env"],
]) {
  const targetPath = path.join(root, target);
  if (existsSync(targetPath)) {
    console.log(`  ${target} already exists — left untouched.`);
    continue;
  }
  copyFileSync(path.join(root, example), targetPath);
  const filled = readFileSync(targetPath, "utf8").replace(
    /^([A-Z0-9_]+)=$/gm,
    (line, key) => (generated[key] ? `${key}=${generated[key]()}` : line),
  );
  writeFileSync(targetPath, filled);
  console.log(`  created ${target}`);
}

const apiEnv = parseEnvFile(path.join(root, "apps/api/.env"));
const dbEnv = parseEnvFile(path.join(root, "packages/db/.env"));

// The optional worker (`pnpm dev:worker`) must share the API's encryption keys.
{
  const workerEnvPath = path.join(root, "apps/worker/.env");
  if (existsSync(workerEnvPath)) {
    console.log("  apps/worker/.env already exists — left untouched.");
  } else {
    const filled = readFileSync(
      path.join(root, "apps/worker/.env.example"),
      "utf8",
    ).replace(/^([A-Z0-9_]+)=$/gm, (line, key) =>
      apiEnv[key] ? `${key}=${apiEnv[key]}` : line,
    );
    writeFileSync(workerEnvPath, filled);
    console.log("  created apps/worker/.env");
  }
}

// ── 3. services ───────────────────────────────────────────────────────────────
if (reset) {
  step("Removing containers and volumes (--reset)");
  run("docker", ["compose", "down", "--volumes", "--remove-orphans"]);
}
step("Starting Docker services");
run("docker", ["compose", "up", "--detach", "--wait"]);

// ── 4. migrations ─────────────────────────────────────────────────────────────
step("Applying database migrations");
run(isWindows ? "pnpm.cmd" : "pnpm", ["--dir", "packages/db", "db:migrate"], {
  env: { ...process.env, DATABASE_URL: dbEnv.DATABASE_URL },
});

// ── 5. buckets ────────────────────────────────────────────────────────────────
step("Creating storage buckets");
{
  const requireFromApi = createRequire(
    path.join(root, "apps/api/package.json"),
  );
  const { S3Client, CreateBucketCommand, HeadBucketCommand } =
    requireFromApi("@aws-sdk/client-s3");
  const client = new S3Client({
    endpoint: apiEnv.R2_ENDPOINT,
    region: apiEnv.R2_REGION || "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: apiEnv.R2_ACCESS_KEY_ID,
      secretAccessKey: apiEnv.R2_SECRET_ACCESS_KEY,
    },
  });

  for (const bucket of [apiEnv.R2_BUCKET_NAME, apiEnv.R2_MEDIA_BUCKET_NAME]) {
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        ready = true;
        console.log(`  ${bucket} already exists`);
      } catch (error) {
        const status = error?.$metadata?.httpStatusCode;
        if (status === 404 || error?.name === "NotFound") {
          await client.send(new CreateBucketCommand({ Bucket: bucket }));
          ready = true;
          console.log(`  created ${bucket}`);
        } else {
          // The storage container may still be booting.
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
    if (!ready) fail(`Could not reach the S3 service at ${apiEnv.R2_ENDPOINT}`);
  }
}

// ── 6. seeds ──────────────────────────────────────────────────────────────────
step("Seeding catalogs and the demo laboratory");
const seedEnv = { ...process.env, DATABASE_URL: dbEnv.DATABASE_URL };
run("bun", ["src/seed-asset-types.ts"], {
  cwd: path.join(root, "packages/db"),
  env: seedEnv,
});
run("bun", ["scripts/seed-dev-lab.ts"], {
  cwd: path.join(root, "packages/db"),
  env: seedEnv,
});

console.log(`
✓ Local environment ready.

  pnpm dev                     start the API (:3000), lab app (:5173) and portal (:5174)

  Lab app      http://localhost:5173   sign in as admin@laboratorio.test
  Inbox        http://localhost:8025   every email (magic links included) lands here
  Storage      ${apiEnv.R2_ENDPOINT}
  Postgres     ${dbEnv.DATABASE_URL}

  pnpm services:down           stop the containers (data is kept)
  pnpm setup:dev --reset       wipe the containers' data and start over
`);
