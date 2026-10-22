// Writes the generated .env.example files from the configuration schema:
//
//   pnpm config:env-example           rewrite apps/api/.env.example and deploy/.env.example
//   pnpm config:env-example --check   fail (exit 1) when either file is out of date
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderApiEnvExample,
  renderDeployEnvExample,
} from "../src/env-example.ts";

const args = process.argv.slice(2);
const check = args.includes("--check");
// `--root <dir>` points the script at another checkout (the tests use a copy).
const rootFlag = args.indexOf("--root");
const repoRoot =
  (rootFlag >= 0 ? args[rootFlag + 1] : undefined) ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const rootPackage: unknown = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
const version =
  typeof rootPackage === "object" &&
  rootPackage !== null &&
  "version" in rootPackage &&
  typeof rootPackage.version === "string"
    ? rootPackage.version
    : null;
if (!version) {
  console.error("package.json has no version");
  process.exit(1);
}

const files = [
  { path: "apps/api/.env.example", content: renderApiEnvExample() },
  { path: "deploy/.env.example", content: renderDeployEnvExample(version) },
];

let stale = 0;
for (const file of files) {
  const target = join(repoRoot, file.path);
  let current: string | null = null;
  try {
    current = readFileSync(target, "utf8");
  } catch {
    current = null;
  }
  if (current === file.content) {
    console.log(`${file.path} is up to date`);
  } else if (check) {
    console.error(
      `${file.path} is out of date: run \`pnpm config:env-example\` and commit the result`,
    );
    stale += 1;
  } else {
    writeFileSync(target, file.content);
    console.log(`wrote ${file.path}`);
  }
}

if (stale > 0) process.exit(1);
