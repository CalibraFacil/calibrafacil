#!/usr/bin/env node
// Generate the fumadocs `.source` index and verify it is complete before the
// type-check proceeds.
//
// `next typegen` runs the fumadocs-mdx generator through the Next plugin, which
// truncates `.source/server.ts` and then writes it back asynchronously without
// awaiting the flush. On slower/cold CI runners `tsc` can read the file mid-
// write and fail with "File '.../.source/server.ts' is not a module" (plus the
// downstream PageData property errors) — which is why it looked flaky.
//
// IMPORTANT: this must run *after* `next typegen` (see the check-types script).
// It regenerates `.source` synchronously (execFileSync waits for the child to
// exit, so the writes are flushed) and confirms the output actually exports
// `docs` (the symbol `lib/source.ts` imports), retrying a few times before
// giving up. Being the last writer before `tsc`, it makes check-types
// deterministic regardless of the typegen race.

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
