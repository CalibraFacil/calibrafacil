#!/usr/bin/env node
// Type-check driver behind every package's `check-types` script.
//
//   node ../../scripts/typecheck.mjs --noEmit [tsc flags...]
//
// Runs `tsrs` (the Rust port of the TypeScript 7 compiler) by default. tsrs
// ships binaries only for linux x64/arm64 and macOS arm64 (no Windows, no Intel
// macOS), so other hosts fall back to the native `tsc` from `typescript@7`.
// Set CHECK_TYPES_CHECKER=tsc to force `tsc` (the parity check, and the
// fallback if a tsrs release regresses); `pnpm check-types:tsc` does that for
// the whole repo. The flags are shared: tsrs is a drop-in for the tsc CLI.
//
//   node scripts/typecheck.mjs --turbo   # run `turbo run check-types` with tsc

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const tsrsHosts = new Set(["linux-x64", "linux-arm64", "darwin-arm64"]);

function run(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
    shell: windows,
  });
  if (result.error) {
    console.error(
      `typecheck: could not run ${command}: ${result.error.message}`,
    );
    return 1;
  }
  return result.status ?? 1;
}

const args = process.argv.slice(2);

if (args[0] === "--turbo") {
  const turbo = path.join(
    root,
    "node_modules",
    ".bin",
    windows ? "turbo.cmd" : "turbo",
  );
  process.exit(
    run(turbo, ["run", "check-types", ...args.slice(1)], {
      ...process.env,
      CHECK_TYPES_CHECKER: "tsc",
    }),
  );
}

const requested = process.env.CHECK_TYPES_CHECKER ?? "tsrs";
if (requested !== "tsrs" && requested !== "tsc") {
  console.error(
    `typecheck: CHECK_TYPES_CHECKER must be "tsrs" or "tsc", got "${requested}"`,
  );
  process.exit(1);
}

const host = `${process.platform}-${process.arch}`;
const checker =
  requested === "tsrs" && !tsrsHosts.has(host) ? "tsc" : requested;
if (checker !== requested) {
  console.error(`typecheck: tsrs has no ${host} binary, using tsc`);
}

const bin = path.join(
  root,
  "node_modules",
  ".bin",
  windows ? `${checker}.cmd` : checker,
);
process.exit(run(bin, args, process.env));
