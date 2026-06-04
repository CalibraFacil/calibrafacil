#!/usr/bin/env node
// Generate the fumadocs `.source` index and verify it is complete before the
// type-check proceeds.
//
// `fumadocs-mdx` occasionally returns before its write to
// `.source/index.ts` is flushed, leaving an empty/partial file. When `tsc`
// then reads it, the build fails intermittently in CI with
// "File '.../.source/index.ts' is not a module" (and the downstream
// PageData property errors). It only reproduced on cold CI checkouts, which is
// why it looked flaky.
//
// This script runs the generator and confirms the output actually exports
// `docs` (the symbol `lib/source.ts` imports), retrying a few times before
// giving up. Deterministic output in, deterministic check-types out.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceIndex = join(appDir, ".source", "server.ts");
const REQUIRED_EXPORT = "export const docs";
const MAX_ATTEMPTS = 3;

function generate() {
  execFileSync("pnpm", ["exec", "fumadocs-mdx"], {
    cwd: appDir,
    stdio: "inherit",
  });
}

function isComplete() {
  if (!existsSync(sourceIndex)) return false;
  const contents = readFileSync(sourceIndex, "utf8");
  return contents.includes(REQUIRED_EXPORT);
}

let lastError;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    generate();
  } catch (error) {
    lastError = error;
  }

  if (isComplete()) {
    process.exit(0);
  }

  console.warn(
    `ensure-source: .source/index.ts missing "${REQUIRED_EXPORT}" after ` +
      `attempt ${attempt}/${MAX_ATTEMPTS}; regenerating…`,
  );
}

console.error(
  `ensure-source: failed to generate a complete .source/index.ts after ` +
    `${MAX_ATTEMPTS} attempts.`,
);
if (lastError) console.error(lastError);
process.exit(1);
