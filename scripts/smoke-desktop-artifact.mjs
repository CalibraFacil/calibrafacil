import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const rendererOutDir = path.join(root, "apps/desktop/dist/renderer");
const rendererIndexPath = path.join(rendererOutDir, "index.html");
const rendererManifestPath = path.join(
  rendererOutDir,
  "calibra-renderer-build.json",
);
const desktopMainBundlePath = path.join(
  root,
  "apps/desktop/dist/main/main.cjs",
);
const desktopPreloadBundlePath = path.join(
  root,
  "apps/desktop/dist/preload/preload.cjs",
);
const stagedLocalServerPath = path.join(
  root,
  "apps/desktop/dist/local-server/server.cjs",
);
const stagedLocalServerMapPath = `${stagedLocalServerPath}.map`;

assertFile(rendererIndexPath, "desktop renderer index");
assertFile(rendererManifestPath, "desktop renderer build manifest");
assertFile(desktopMainBundlePath, "desktop main bundle");
assertFile(desktopPreloadBundlePath, "desktop preload bundle");
assertFile(stagedLocalServerPath, "desktop local-server bundle");
assertFile(stagedLocalServerMapPath, "desktop local-server source map");

const manifest = JSON.parse(fs.readFileSync(rendererManifestPath, "utf8"));
assert(
  manifest.schemaVersion === 1,
  "desktop renderer manifest has unsupported schema",
);
assert(
  manifest.sourcePackage === "@calibra-facil/web",
  "desktop renderer manifest has unexpected source package",
);
assert(
  manifest.indexSha256 === sha256(fs.readFileSync(rendererIndexPath)),
  "desktop renderer manifest hash does not match staged index.html",
);

const indexHtml = fs.readFileSync(rendererIndexPath, "utf8");
const assetReferences = [...indexHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((reference) => isLocalAssetReference(reference));
assert(assetReferences.length > 0, "desktop renderer index has no assets");

for (const reference of assetReferences) {
  const localPath = path.join(rendererOutDir, reference.replace(/^\.\//, ""));
  assertFile(localPath, `desktop renderer asset ${reference}`);
}

const stagedAt = Date.parse(manifest.stagedAt);
assert(Number.isFinite(stagedAt), "desktop renderer manifest stagedAt invalid");
assert(
  stagedAt >= newestMtimeMs(artifactSourcePaths()),
  "desktop renderer artifact is older than key web/runtime source files; rerun pnpm build:desktop",
);
assert(
  fs.statSync(desktopMainBundlePath).mtimeMs >= newestMtimeMs(mainSourcePaths()),
  "desktop main bundle is older than key main-process source files; rerun pnpm build:desktop",
);
assert(
  fs.statSync(desktopPreloadBundlePath).mtimeMs >=
    newestMtimeMs(preloadSourcePaths()),
  "desktop preload bundle is older than key preload source files; rerun pnpm build:desktop",
);
assert(
  fs.statSync(stagedLocalServerPath).mtimeMs >=
    newestMtimeMs(localServerSourcePaths()),
  "desktop local-server bundle is older than key local-server source files; rerun pnpm build:desktop",
);

console.log(
  `Desktop artifact smoke passed with ${assetReferences.length} renderer assets, desktop main/preload bundles, and staged local-server bundle.`,
);

function artifactSourcePaths() {
  return [
    "apps/web/package.json",
    "apps/web/src/router.tsx",
    "apps/web/src/routeTree.gen.ts",
    "apps/web/src/utils/api.ts",
    "apps/web/src/runtime/desktop.ts",
    "packages/client-runtime/src/index.ts",
    "packages/client-runtime/src/data-policy.ts",
  ].map((relativePath) => path.join(root, relativePath));
}

function mainSourcePaths() {
  return [
    "apps/desktop/src/main/main.ts",
    "apps/desktop/src/main/ipc-contracts.ts",
    "apps/desktop/src/main/local-server-manager.ts",
    "apps/desktop/src/main/channels.ts",
  ].map((relativePath) => path.join(root, relativePath));
}

function preloadSourcePaths() {
  return [
    "apps/desktop/src/preload/preload.ts",
    "apps/desktop/src/main/channels.ts",
  ].map((relativePath) => path.join(root, relativePath));
}

function localServerSourcePaths() {
  return [
    "apps/local-server/src/server.ts",
    "apps/local-server/src/certificates.ts",
    "apps/local-server/src/sync.ts",
    "packages/local-db/src/index.ts",
  ].map((relativePath) => path.join(root, relativePath));
}

function newestMtimeMs(paths) {
  return Math.max(...paths.map((filePath) => fs.statSync(filePath).mtimeMs));
}

function assertFile(filePath, label) {
  assert(fs.existsSync(filePath), `${label} is missing at ${filePath}`);
}

function isLocalAssetReference(reference) {
  return (
    !reference.startsWith("http://") &&
    !reference.startsWith("https://") &&
    !reference.startsWith("data:") &&
    !reference.startsWith("#")
  );
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
