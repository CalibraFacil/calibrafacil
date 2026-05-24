import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import "./build-vercel-functions.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

if (process.env.VERCEL !== "1") {
  process.exit(0);
}

const deploymentOnlySource = [
  "src",
  "test",
  "vercel-src",
  "tsconfig.json",
  "tsconfig.build.json",
  "vitest.config.ts",
];

await Promise.all(
  deploymentOnlySource.map((path) =>
    rm(join(appRoot, path), { recursive: true, force: true }),
  ),
);

console.log("Pruned API source files after creating Vercel function bundles.");
