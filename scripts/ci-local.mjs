#!/usr/bin/env node
// Run the GitHub CI gates locally — we're on the free plan and out of Actions
// minutes, so PRs are validated here instead. Mirrors .github/workflows/ci.yml
// (blocked-deps → frozen install → audit → lint → type-check → test) under
// Node 22 + TZ=UTC to match the runners.
//
// It is intentionally a SUPERSET of GitHub CI: it also type-checks apps/api and
// apps/worker, which `turbo run check-types` (and thus CI) silently skip because
// they declare no `check-types` task — so type errors there ship undetected.
//
// Usage:
//   pnpm ci:local            # test only packages changed vs origin/main (like CI)
//   pnpm ci:local --all      # run every package's tests
//   pnpm ci:local --no-audit # skip the network security audit
//
// Runs every gate (doesn't stop at the first failure) and prints a summary so
// you fix everything in one pass; exits non-zero if any gate failed.

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const runAllTests = args.has("--all");
const skipAudit = args.has("--no-audit");
const testFilter = runAllTests ? [] : ["--filter=[origin/main...HEAD]"];

const env = { ...process.env, TZ: "UTC", FORCE_COLOR: "1" };

function shell(cmd, argv) {
  const result = spawnSync(cmd, argv, { stdio: "inherit", env });
  return result.status === 0 && result.error === undefined;
}

// Apps with no `check-types` turbo task → invisible to CI. Type-check them here.
// `allowed` is a documented baseline of pre-existing errors to tolerate (we fail
// only on NEW errors); keep it empty for apps that are clean.
const UNTRACKED_TYPECHECKS = [
  // apps/api/src/routes/backoffice.ts has 2 pre-existing drizzle `.returning()`
  // type errors (PR #7; confirmed by both tsgo and tsc). Baseline until fixed.
  { dir: "apps/api", allowed: /backoffice\.ts.*error TS2554/ },
  { dir: "apps/worker", allowed: null },
];

function typeCheckUntrackedApps() {
  let ok = true;
  for (const { dir, allowed } of UNTRACKED_TYPECHECKS) {
    const result = spawnSync(
      "pnpm",
      ["--dir", dir, "exec", "tsgo", "--noEmit", "-p", "tsconfig.json"],
      { encoding: "utf8", env },
    );
    const errorLines = `${result.stdout ?? ""}${result.stderr ?? ""}`
      .split("\n")
      .filter((line) => line.includes("error TS"));
    const unexpected = errorLines.filter(
      (line) => !(allowed && allowed.test(line)),
    );
    const baseline = errorLines.length - unexpected.length;

    if (unexpected.length > 0) {
      ok = false;
      console.log(`\x1b[31m  ${dir}: ${unexpected.length} unexpected error(s)\x1b[0m`);
      for (const line of unexpected) console.log(`    ${line.trim()}`);
    } else if (baseline > 0) {
      console.log(
        `\x1b[33m  ${dir}: ok (${baseline} known/baseline error(s) tolerated — see UNTRACKED_TYPECHECKS)\x1b[0m`,
      );
    } else {
      console.log(`\x1b[32m  ${dir}: ok\x1b[0m`);
    }
  }
  return ok;
}

const steps = [
  { name: "Blocked dependencies", run: () => shell("node", ["scripts/check-blocked-deps.mjs"]) },
  { name: "Install (frozen lockfile)", run: () => shell("pnpm", ["install", "--frozen-lockfile"]) },
  ...(skipAudit
    ? []
    : [
        {
          name: "Security audit (prod, high)",
          run: () => shell("pnpm", ["audit", "--prod", "--audit-level", "high"]),
        },
      ]),
  { name: "Lint", run: () => shell("pnpm", ["run", "lint"]) },
  { name: "Type check (turbo)", run: () => shell("pnpm", ["run", "check-types"]) },
  { name: "Type check (api + worker — turbo skips these)", run: typeCheckUntrackedApps },
  {
    name: "Test",
    run: () => shell("pnpm", ["exec", "turbo", "run", "test", ...testFilter]),
  },
];

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== 22) {
  console.warn(
    `\x1b[33m⚠ Running on Node ${process.versions.node}; CI uses Node 22. ` +
      `Use the Node 22 toolchain (fnm/mise) for a faithful run.\x1b[0m`,
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
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${name}\x1b[0m  ${seconds}s`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`\n\x1b[31m✗ ${failed.length} gate(s) failed.\x1b[0m`);
  process.exit(1);
}
console.log("\n\x1b[32m✓ All CI gates passed.\x1b[0m");
