// Build-output structural assertion for the Vercel deployment.
//
// The cron-routing-parity spec guards vercel.json <-> JOB_HANDLERS at the
// SOURCE level, but two prod outages came from the BUILT artifacts instead:
//   - the Vercel-managed Bun runtime rejecting the api/*.js default-export
//     shape (2026-06-04/05, fixed by locally-declared `{ fetch: (req) => ... }`),
//   - a routing/bundling change silently dropping paths the app still mounts.
// This script asserts the shape of what actually ships: the committed api/
// shims and the esbuild bundles in vercel-functions/. Run it AFTER
// scripts/build-vercel-functions.mjs (CI does both in one step).
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

function fail(message) {
  failures.push(message);
}

async function readText(relPath) {
  try {
    return await readFile(join(appRoot, relPath), "utf8");
  } catch {
    fail(`missing expected file: apps/api/${relPath}`);
    return null;
  }
}

function fileSize(relPath) {
  try {
    return statSync(join(appRoot, relPath)).size;
  } catch {
    return 0;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// 1. vercel.json declares a function config for every entrypoint we ship.
// ---------------------------------------------------------------------------
const vercelJsonText = await readText("vercel.json");
const vercelConfig = vercelJsonText ? JSON.parse(vercelJsonText) : {};
const functionKeys = Object.keys(vercelConfig.functions ?? {});

for (const requiredKey of [
  "api/index.js",
  "api/queues/background.js",
  "api/cron/*.js",
]) {
  if (!functionKeys.includes(requiredKey)) {
    fail(`vercel.json functions is missing an entry for "${requiredKey}"`);
  }
}

const crons = Array.isArray(vercelConfig.crons) ? vercelConfig.crons : [];
if (crons.length === 0) {
  fail("vercel.json declares no crons — the schedule block was dropped");
}
for (const cron of crons) {
  if (typeof cron.path !== "string" || !cron.path.startsWith("/api/cron/")) {
    fail(
      `cron path ${JSON.stringify(cron.path)} does not live under /api/cron/ — it would be swallowed by the Hono catch-all rewrite`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. The committed api/ shims keep the default-export shape the Vercel-managed
//    Bun runtime accepts: a locally-declared object literal with a `fetch`
//    function. Re-exported defaults and imported-binding `{ fetch: GET }` both
//    boot-crashed in prod (FUNCTION_INVOCATION_FAILED) — never regress to them.
// ---------------------------------------------------------------------------
const httpShims = ["api/index.js", "api/cron/[job].js"];
for (const shim of httpShims) {
  const text = await readText(shim);
  if (!text) continue;
  // A locally-declared `{ fetch: (request) => ... }` literal is the only shape
  // every Vercel-managed Bun roll has accepted; its presence also rules out the
  // two shapes that boot-crashed (`export { default } from` / `{ fetch: GET }`),
  // since a module can only have one default export.
  if (!/export default \{\s*fetch:\s*\(/.test(text)) {
    fail(
      `apps/api/${shim} default export must be a locally-declared \`{ fetch: (request) => ... }\` object (Vercel Bun runtime rejects re-exports and imported bindings)`,
    );
  }
}

const queueShim = await readText("api/queues/background.js");
if (queueShim && !/export\s*\{\s*POST\s*\}\s*from/.test(queueShim)) {
  fail(
    "apps/api/api/queues/background.js must re-export POST from the built queue bundle",
  );
}

// ---------------------------------------------------------------------------
// 3. The built bundles exist, are non-trivial, and export the handlers the
//    shims import. A wrong esbuild entry list or output path yields an empty
//    or missing bundle that only fails at Vercel cold start.
// ---------------------------------------------------------------------------
const bundles = {
  index: "vercel-functions/index.js",
  cron: "vercel-functions/cron/dispatch.js",
  queue: "vercel-functions/queues/background.js",
};

const bundleText = {};
for (const [name, relPath] of Object.entries(bundles)) {
  bundleText[name] = await readText(relPath);
  if (bundleText[name] !== null && fileSize(relPath) < 10_000) {
    fail(
      `apps/api/${relPath} is suspiciously small (${fileSize(relPath)} bytes) — the bundle is likely empty or mis-built`,
    );
  }
}

const requiredExports = [
  ["index", ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]],
  ["cron", ["GET"]],
  ["queue", ["POST"]],
];
for (const [name, exportNames] of requiredExports) {
  const text = bundleText[name];
  if (!text) continue;
  for (const exportName of exportNames) {
    // esbuild ESM output ends in `export{x as GET, ...}`; also accept a direct
    // `export const GET` in case minification is ever turned off.
    const pattern = new RegExp(
      `export\\s*\\{[^}]*\\b${exportName}\\b|export\\s+(const|function|async function)\\s+${exportName}\\b`,
    );
    if (!pattern.test(text)) {
      fail(`apps/api/${bundles[name]} does not export ${exportName}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Every route prefix mounted in src/server/route-mounts.ts survives into the
//    built index bundle. Hono route strings are literals, so they must appear
//    verbatim; a missing one means the built artifact no longer serves a route
//    the source claims to mount.
// ---------------------------------------------------------------------------
const routeMountsSource = await readText("src/server/route-mounts.ts");
if (routeMountsSource && bundleText.index) {
  const mountedPaths = [
    ...routeMountsSource.matchAll(/\.route\(\s*"([^"]+)"/g),
  ].map((match) => match[1]);
  if (mountedPaths.length < 20) {
    fail(
      `only found ${mountedPaths.length} .route(...) mounts in route-mounts.ts — the extraction regex is likely broken`,
    );
  }
  for (const path of mountedPaths) {
    if (!bundleText.index.includes(`"${path}"`)) {
      fail(
        `built index bundle is missing mounted route prefix "${path}" (present in src/server/route-mounts.ts)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Every scheduled cron has its handler key present in the BUILT dispatcher
//    bundle (the parity spec proves this at source level; this proves esbuild
//    did not tree-shake or mis-bundle the dispatch table).
// ---------------------------------------------------------------------------
if (bundleText.cron) {
  for (const cron of crons) {
    const segment = String(cron.path).split("/").filter(Boolean).at(-1) ?? "";
    const keyPattern = new RegExp(
      `["'\`]?${escapeRegExp(segment)}["'\`]?\\s*:`,
    );
    if (!keyPattern.test(bundleText.cron)) {
      fail(
        `built cron dispatcher bundle has no handler key for scheduled cron "${segment}"`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(
    `Vercel function bundle shape assertion FAILED (${failures.length} problem${failures.length === 1 ? "" : "s"}):`,
  );
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Vercel function bundle shape OK: ${crons.length} crons dispatchable, ${functionKeys.length} function configs, all shims + bundles structurally sound.`,
);
