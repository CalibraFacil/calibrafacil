#!/usr/bin/env node
// Run the GitHub CI gates locally — we're on the free plan and out of Actions
// minutes, so PRs are validated here instead. The gates are the `run` steps of
// the `ci` job of .github/workflows/ci.yml, read from it (scripts/lib/ci-steps.mjs),
// under Node 24 + TZ=UTC to match the runners.
//
// Usage:
//   pnpm ci:local            # test packages changed vs origin/main and their dependents (like CI)
//   pnpm ci:local --all      # run every package's tests
//   pnpm ci:local --no-audit # skip the network security audit
//
// Runs every gate (doesn't stop at the first failure) and prints a summary so
// you fix everything in one pass; exits non-zero if any gate failed.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { localCommand, readJobRunSteps } from "./lib/ci-steps.mjs";

const args = new Set(process.argv.slice(2));
const runAllTests = args.has("--all");
const skipAudit = args.has("--no-audit");

// A pull request tests what it touches (and its dependents); a push to main,
// and `--all`, test everything. The workflow's Test step reads $EVENT for that.
const env = {
  ...process.env,
  TZ: "UTC",
  FORCE_COLOR: "1",
  EVENT: runAllTests ? "push" : "pull_request",
};

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

const steps = readJobRunSteps(workflow, "ci")
  .filter((step) => !(skipAudit && /\bpnpm audit\b/.test(step.run)))
  .map((step) => ({
    name: step.name,
    run: () => {
      const result = spawnSync(localCommand(step.run), {
        stdio: "inherit",
        env,
        shell: true,
      });
      return result.status === 0 && result.error === undefined;
    },
  }));

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== 24) {
  console.warn(
    `\x1b[33m⚠ Running on Node ${process.versions.node}; CI uses Node 24. ` +
      `Use the Node 24 toolchain (fnm/mise) for a faithful run.\x1b[0m`,
  );
}

const results = [];
for (const step of steps) {
  console.log(`\n\x1b[1m\x1b[36m▶ ${step.name}\x1b[0m`);
  const startedAt = Date.now();
  const ok = step.run();
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  results.push({ name: step.name, ok, seconds });
  console.log(
    ok
      ? `\x1b[32m✓ ${step.name} (${seconds}s)\x1b[0m`
      : `\x1b[31m✗ ${step.name} (${seconds}s)\x1b[0m`,
  );
}

console.log("\n\x1b[1m─ CI summary ─\x1b[0m");
for (const { name, ok, seconds } of results) {
  console.log(
    `  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${name}\x1b[0m  ${seconds}s`,
  );
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`\n\x1b[31m✗ ${failed.length} gate(s) failed.\x1b[0m`);
  process.exit(1);
}
console.log("\n\x1b[32m✓ All CI gates passed.\x1b[0m");
