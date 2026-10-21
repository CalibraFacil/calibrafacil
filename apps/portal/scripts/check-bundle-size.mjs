import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  evaluateInitialGraph,
  readBundleMetricsFromDist,
  toKb,
} from "../../../scripts/bundle-metrics.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(scriptDir, "..", "dist");

// Budgets sit ~2-3% above the measured sizes after route code splitting and
// the vendor chunk policy (initial graph 1799 -> 520 KiB raw, 527 -> 162 KiB
// gzip; it used to be a single 1.84 MB entry). A regression that pulls
// recharts, motion or the shader panel back into the initial graph fails here.
const initialJsBudget = Number(
  process.env.PORTAL_BUNDLE_BUDGET_INITIAL_JS ?? 545_000,
);
const initialJsGzipBudget = Number(
  process.env.PORTAL_BUNDLE_BUDGET_INITIAL_JS_GZIP ?? 172_000,
);
const entryJsBudget = Number(
  process.env.PORTAL_BUNDLE_BUDGET_ENTRY_JS ?? 135_000,
);
const cssBudget = Number(process.env.PORTAL_BUNDLE_BUDGET_CSS ?? 130_000);
const jsChunkBudget = Number(
  process.env.PORTAL_BUNDLE_BUDGET_JS_CHUNK ?? 320_000,
);
// Chunks that only chart/decorative screens may fetch.
const forbiddenInitialChunks = [
  "vendor-charts",
  "vendor-motion",
  "vendor-sentry",
  "sign-in-shader-panel",
];
// Lazy vendor chunks that are big by nature and fetched on demand: they are
// held to "never in the initial graph" (above) instead of the per-chunk size.
// The Sentry SDK only loads when VITE_SENTRY_DSN is set (src/lib/sentry.ts).
const lazyVendorChunks = ["vendor-sentry"];

function fail(message) {
  console.error(`\n[bundle-budget] ${message}`);
  process.exit(1);
}

let metrics;
try {
  metrics = readBundleMetricsFromDist(distDir);
} catch (error) {
  fail(
    `${error instanceof Error ? error.message : "Could not read bundle metrics."} Run \`pnpm --filter @calibra-facil/portal build\` first.`,
  );
}

const initialGraph = evaluateInitialGraph(metrics, {
  jsBudget: initialJsBudget,
  jsGzipBudget: initialJsGzipBudget,
  forbiddenChunks: forbiddenInitialChunks,
});

const checks = [
  { name: "entry-js", bytes: metrics.jsBytes, budget: entryJsBudget },
  { name: "entry-css", bytes: metrics.cssBytes, budget: cssBudget },
  ...initialGraph.checks,
];
const chunkFailures = metrics.jsChunks
  .filter(
    (chunk) =>
      !lazyVendorChunks.some((name) => chunk.name.startsWith(name)) &&
      chunk.bytes > jsChunkBudget,
  )
  .map((chunk) => ({
    name: `chunk:${chunk.name}`,
    bytes: chunk.bytes,
    budget: jsChunkBudget,
  }));
const forbiddenFailures = initialGraph.forbidden.map((name) => ({
  name: `initial-graph-includes:${name}`,
}));

const failures = [
  ...checks.filter((check) => check.bytes > check.budget),
  ...chunkFailures,
  ...forbiddenFailures,
];

for (const check of checks) {
  const status = check.bytes > check.budget ? "FAIL" : "OK";
  console.log(
    `[bundle-budget] ${status} ${check.name}: ${toKb(check.bytes)} (budget ${toKb(check.budget)})`,
  );
}
for (const check of chunkFailures) {
  console.log(
    `[bundle-budget] FAIL ${check.name}: ${toKb(check.bytes)} (budget ${toKb(check.budget)})`,
  );
}
for (const failure of forbiddenFailures) {
  console.log(
    `[bundle-budget] FAIL ${failure.name}: loaded by index.html on every page`,
  );
}

console.log(
  `[bundle-budget] initial-graph: ${metrics.initialJs.files.length} JS files, ${toKb(metrics.initialJs.bytes)} raw / ${toKb(metrics.initialJs.gzipBytes)} gzip`,
);
console.log(
  `[bundle-budget] largest-initial-js: ${metrics.initialJs.files
    .slice(0, 5)
    .map((file) => `${file.name}=${toKb(file.bytes)}`)
    .join(", ")}`,
);
console.log(
  `[bundle-budget] largest-js-chunks: ${metrics.jsChunks
    .slice(0, 5)
    .map((chunk) => `${chunk.name}=${toKb(chunk.bytes)}`)
    .join(", ")}`,
);

if (failures.length > 0) {
  fail(
    `Bundle budget exceeded for ${failures.map((failure) => failure.name).join(", ")}.`,
  );
}
