import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const desktopPackage = JSON.parse(
  readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"),
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

console.log("Desktop artifact release gate checks passed.");

function fail(message) {
  console.error(message);
  process.exit(1);
}
