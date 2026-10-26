// Reads the Electron fuse wire of a packaged desktop binary and fails when a
// fuse is not in the state apps/desktop/electron-builder.yml (`electronFuses`)
// promises. The expectations are repeated here on purpose: a check that reads
// the same config it verifies would pass when someone relaxes it.
//
//   node scripts/check-desktop-fuses.mjs [path/to/binary]
//
// Without an argument it looks for the unpacked build `pnpm --dir apps/desktop
// package` leaves in apps/desktop/out (linux-unpacked, win-unpacked, or the mac
// app bundle).
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const requireFromDesktop = createRequire(
  path.join(root, "apps/desktop/package.json"),
);
const { FuseV1Options, getCurrentFuseWire } =
  requireFromDesktop("@electron/fuses");

// The byte @electron/fuses stores per fuse (its `FuseState` enum is not part of
// the package's public exports).
const FuseState = { DISABLE: 0x30, ENABLE: 0x31, REMOVED: 0x72, INHERIT: 0x90 };

// RunAsNode stays enabled until the local server moves to utilityProcess.
const expectedFuses = [
  [FuseV1Options.RunAsNode, FuseState.ENABLE],
  [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE],
];

const binaryPath = path.resolve(process.argv[2] ?? findBuiltBinary());
if (!fs.existsSync(binaryPath)) {
  fail(`Electron binary not found: ${binaryPath}`);
}

const wire = await getCurrentFuseWire(binaryPath);
const failures = [];

for (const [fuse, expected] of expectedFuses) {
  const actual = wire[fuse];
  const ok = actual === expected;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${FuseV1Options[fuse]}: ${describe(actual)}` +
      (ok ? "" : ` (expected ${describe(expected)})`),
  );
  if (!ok) failures.push(FuseV1Options[fuse]);
}

if (failures.length > 0) {
  fail(`Fuse check failed for ${binaryPath}: ${failures.join(", ")}`);
}

console.log(`Desktop fuse check passed for ${binaryPath}`);

function describe(state) {
  switch (state) {
    case FuseState.ENABLE:
      return "enabled";
    case FuseState.DISABLE:
      return "disabled";
    case FuseState.REMOVED:
      return "removed";
    case FuseState.INHERIT:
      return "inherit";
    default:
      return `unknown (${state})`;
  }
}

function findBuiltBinary() {
  const out = path.join(root, "apps/desktop/out");
  const candidates = [
    path.join(out, "linux-unpacked/calibrafacil"),
    path.join(out, "win-unpacked/CalibraFácil.exe"),
    path.join(out, "mac-arm64/CalibraFácil.app/Contents/MacOS/CalibraFácil"),
    path.join(out, "mac/CalibraFácil.app/Contents/MacOS/CalibraFácil"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    fail(
      `No unpacked desktop build under ${out}. Run \`pnpm --dir apps/desktop package\` first, or pass the binary path.`,
    );
  }

  return found;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
