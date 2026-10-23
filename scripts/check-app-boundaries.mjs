// Guard: no app (apps/*) may depend on another app.
//
// An app depending on another app couples their builds and deploys and lets one
// reach into the other's internals (apps/api once ran apps/worker in process).
// Code two apps share belongs in a package (packages/*): e.g. the background-job
// handlers live in @calibra-facil/jobs-core, which apps/api and apps/worker both
// import. This script reads every apps/*/package.json and fails when a dependency
// name is another app's workspace name.
//
// Run: node scripts/check-app-boundaries.mjs   (pnpm check:app-boundaries)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/**
 * @param {Array<{ dir: string, manifest: Record<string, unknown> }>} apps
 * @returns {string[]} one human-readable violation per offending dependency
 */
export function findAppToAppDependencies(apps) {
  const appNames = new Map();
  for (const { dir, manifest } of apps) {
    if (typeof manifest.name === "string") appNames.set(manifest.name, dir);
  }

  const violations = [];
  for (const { dir, manifest } of apps) {
    for (const field of DEPENDENCY_FIELDS) {
      const deps = manifest[field];
      if (typeof deps !== "object" || deps === null) continue;
      for (const dependency of Object.keys(deps)) {
        const target = appNames.get(dependency);
        if (target === undefined || target === dir) continue;
        violations.push(
          `${dir} depends on ${dependency} (${target}) in ${field}: move the shared code into a package under packages/ instead`,
        );
      }
    }
  }
  return violations;
}

export function readApps(root) {
  const appsDir = path.join(root, "apps");
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const manifestPath = path.join(appsDir, entry.name, "package.json");
      if (!fs.existsSync(manifestPath)) return [];
      return [
        {
          dir: `apps/${entry.name}`,
          manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")),
        },
      ];
    });
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const violations = findAppToAppDependencies(readApps(root));
  if (violations.length > 0) {
    console.error("App boundary violations:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exit(1);
  }
  console.log("App boundary check passed: no app depends on another app.");
}
