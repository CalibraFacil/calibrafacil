#!/usr/bin/env node
// Run the GitHub CI gates locally — we're on the free plan and out of Actions
// minutes, so PRs are validated here instead. Mirrors .github/workflows/ci.yml
// (blocked-deps → frozen install → audit → lint → type-check → test) and runs
// under Node 22 + TZ=UTC to match the runners.
//
// Usage:
//   pnpm ci:local            # test only packages changed vs origin/main (like CI)
//   pnpm ci:local --all      # run every package's tests
//   pnpm ci:local --no-audit # skip the network security audit
//
// Runs every step (doesn't stop at the first failure) and prints a summary so
// you fix everything in one pass; exits non-zero if any gate failed.

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const runAllTests = args.has("--all");
const skipAudit = args.has("--no-audit");

const testFilter = runAllTests ? [] : ["--filter=[origin/main...HEAD]"];

const steps = [
  { name: "Blocked dependencies", cmd: "node", argv: ["scripts/check-blocked-deps.mjs"] },
  { name: "Install (frozen lockfile)", cmd: "pnpm", argv: ["install", "--frozen-lockfile"] },
  ...(skipAudit
    ? []
    : [
        {
          name: "Security audit (prod, high)",
          cmd: "pnpm",
          argv: ["audit", "--prod", "--audit-level", "high"],
        },
      ]),
  { name: "Lint", cmd: "pnpm", argv: ["run", "lint"] },
  { name: "Type check", cmd: "pnpm", argv: ["run", "check-types"] },
  {
    name: "Test",
    cmd: "pnpm",
    argv: ["exec", "turbo", "run", "test", ...testFilter],
  },
];

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== 22) {
  console.warn(
    `\x1b[33m⚠ Running on Node ${process.versions.node}; CI uses Node 22. ` +
      `Use the Node 22 toolchain (fnm/mise) for a faithful run.\x1b[0m`,
  );
}

const env = { ...process.env, TZ: "UTC", FORCE_COLOR: "1" };
const results = [];

for (const step of steps) {
  console.log(`\n\x1b[1m\x1b[36m▶ ${step.name}\x1b[0m  (${step.cmd} ${step.argv.join(" ")})`);
  const startedAt = Date.now();
  const result = spawnSync(step.cmd, step.argv, { stdio: "inherit", env });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const ok = result.status === 0 && result.error === undefined;
  results.push({ name: step.name, ok, seconds });
  console.log(
    ok
      ? `\x1b[32m✓ ${step.name} (${seconds}s)\x1b[0m`
      : `\x1b[31m✗ ${step.name} (${seconds}s)\x1b[0m`,
  );
}

console.log("\n\x1b[1m─ CI summary ─\x1b[0m");
for (const { name, ok, seconds } of results) {
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${name}\x1b[0m  ${seconds}s`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`\n\x1b[31m✗ ${failed.length} gate(s) failed.\x1b[0m`);
  process.exit(1);
}
console.log("\n\x1b[32m✓ All CI gates passed.\x1b[0m");
