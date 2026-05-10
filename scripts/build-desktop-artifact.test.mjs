import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builderSource = readFileSync(
  path.join(root, "scripts/build-desktop-artifact.mjs"),
  "utf8",
);
const rootPackage = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const desktopPackage = JSON.parse(
  readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"),
);

assertSourceOrder(
  "validateDesktopReleaseSignoff();",
  'run("pnpm", ["--dir", "apps/local-server", "run", "bundle"]);',
  "release sign-off must run before local-server bundle work",
);
assertIncludes(
  'run("pnpm", ["check:offline-release-signoff"]);',
  "builder must invoke the release sign-off checker",
);
assertIncludes(
  'arg === "--dir"',
  "only explicit directory builds may skip the release sign-off checker",
);
assertNotIncludes(
  'startsWith("--dir=")',
  "directory build detection must not accept --dir=... installer-like arguments",
);

for (const scriptName of [
  "dist:desktop:artifact",
  "dist:desktop:linux",
  "dist:desktop:mac",
  "dist:desktop:win",
]) {
  const script = rootPackage.scripts?.[scriptName];
  if (!script?.startsWith("node scripts/build-desktop-artifact.mjs")) {
    fail(`${scriptName} must run scripts/build-desktop-artifact.mjs`);
  }
}

if (
  rootPackage.scripts?.["build:desktop"] !==
  "node scripts/build-desktop-artifact.mjs --dir"
) {
  fail("build:desktop must remain a directory build for local verification");
}

if (
  desktopPackage.scripts?.package !==
  "node ../../scripts/build-desktop-artifact.mjs --dir"
) {
  fail("@calibra-facil/desktop package script must remain a directory build");
}

if (
  desktopPackage.scripts?.make !==
  "node ../../scripts/build-desktop-artifact.mjs"
) {
  fail(
    "@calibra-facil/desktop make script must run the guarded installer builder",
  );
}

assertBlockedInstallerBuild(["scripts/build-desktop-artifact.mjs"]);
assertBlockedInstallerBuild([
  "scripts/build-desktop-artifact.mjs",
  "--dir=false",
]);
assertBlockedInstallerBuild([
  "scripts/build-desktop-artifact.mjs",
  "--dir=dist",
]);

console.log("Desktop artifact release gate checks passed.");

function assertBlockedInstallerBuild(args) {
  const blockedInstallerBuild = spawnSync("node", args, {
    cwd: root,
    encoding: "utf8",
  });

  if (blockedInstallerBuild.status !== 1) {
    fail(
      `${args.join(" ")} should stop at release sign-off; got exit ${blockedInstallerBuild.status}`,
    );
  }

  const output = `${blockedInstallerBuild.stdout}\n${blockedInstallerBuild.stderr}`;
  if (!output.includes("Offline/local-first release sign-off is incomplete.")) {
    fail(`${args.join(" ")} did not surface the release sign-off failure`);
  }
  if (output.includes("apps/local-server")) {
    fail(
      `${args.join(" ")} reached local-server build work before sign-off passed`,
    );
  }
}

function assertIncludes(needle, message) {
  if (!builderSource.includes(needle)) {
    fail(message);
  }
}

function assertNotIncludes(needle, message) {
  if (builderSource.includes(needle)) {
    fail(message);
  }
}

function assertSourceOrder(first, second, message) {
  const firstIndex = builderSource.indexOf(first);
  const secondIndex = builderSource.indexOf(second);
  if (firstIndex === -1 || secondIndex === -1 || firstIndex > secondIndex) {
    fail(message);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
