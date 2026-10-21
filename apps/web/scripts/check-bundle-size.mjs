import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  evaluateInitialGraph,
  readBundleMetricsFromDist,
} from './bundle-metrics.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(scriptDir, '..')
const distDir = path.join(appDir, 'dist')

const jsBudget = Number(process.env.WEB_BUNDLE_BUDGET_JS ?? 650_000)
// Bumped from 230_000 for the landing-page redesign (feat/conta-azul-native):
// the new marketing page introduces its own Tailwind utility vocabulary
// (blueprint grids, spreadsheet/agenda mocks, image-hero). Arbitrary classes
// were normalized to the standard scale and the old landing's dead components
// were removed first; the remainder is the page's real styling cost.
const cssBudget = Number(process.env.WEB_BUNDLE_BUDGET_CSS ?? 236_000)
const jsChunkBudget = Number(process.env.WEB_BUNDLE_BUDGET_JS_CHUNK ?? 850_000)
const appChunkBudget = Number(
  process.env.WEB_BUNDLE_BUDGET_APP_CHUNK ?? 180_000,
)
const failAppChunkBudget = process.env.WEB_BUNDLE_FAIL_APP_CHUNKS === 'true'
// The initial graph is everything index.html loads before any route code runs:
// the entry module plus its modulepreload closure. Measured after splitting
// recharts/d3 out of it (2256 -> 1908 KiB raw, 662 -> 562 KiB gzip); the
// budgets sit ~1.5-2% above that so a shared helper leaking a heavy chunk into
// the closure again fails the build.
const initialJsBudget = Number(
  process.env.WEB_BUNDLE_BUDGET_INITIAL_JS ?? 1_980_000,
)
const initialJsGzipBudget = Number(
  process.env.WEB_BUNDLE_BUDGET_INITIAL_JS_GZIP ?? 585_000,
)
// Chunks that must only be fetched by the routes that use them.
const forbiddenInitialChunks = ['vendor-charts']

function fail(message) {
  console.error(`\n[bundle-budget] ${message}`)
  process.exit(1)
}

function toKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

let metrics
try {
  metrics = readBundleMetricsFromDist(distDir)
} catch (error) {
  fail(
    `${error instanceof Error ? error.message : 'Could not read bundle metrics.'} Run \`pnpm --filter @calibra-facil/web build\` first.`,
  )
}

const { jsBytes, cssBytes, jsChunks, appChunks } = metrics

const initialGraph = evaluateInitialGraph(metrics, {
  jsBudget: initialJsBudget,
  jsGzipBudget: initialJsGzipBudget,
  forbiddenChunks: forbiddenInitialChunks,
})

const checks = [
  { name: 'entry-js', bytes: jsBytes, budget: jsBudget },
  { name: 'entry-css', bytes: cssBytes, budget: cssBudget },
  ...initialGraph.checks,
]
const chunkFailures = jsChunks
  .filter((chunk) => chunk.bytes > jsChunkBudget)
  .map((chunk) => ({
    name: `chunk:${chunk.name}`,
    bytes: chunk.bytes,
    budget: jsChunkBudget,
  }))
const appChunkFailures = appChunks
  .filter((chunk) => chunk.bytes > appChunkBudget)
  .map((chunk) => ({
    name: `app-chunk:${chunk.name}`,
    bytes: chunk.bytes,
    budget: appChunkBudget,
  }))

const forbiddenFailures = initialGraph.forbidden.map((name) => ({
  name: `initial-graph-includes:${name}`,
}))

const failures = [
  ...checks.filter((check) => check.bytes > check.budget),
  ...forbiddenFailures,
  ...chunkFailures,
  ...(failAppChunkBudget ? appChunkFailures : []),
]

for (const check of checks) {
  const status = check.bytes > check.budget ? 'FAIL' : 'OK'
  console.log(
    `[bundle-budget] ${status} ${check.name}: ${toKb(check.bytes)} (budget ${toKb(check.budget)})`,
  )
}

for (const check of chunkFailures) {
  console.log(
    `[bundle-budget] FAIL ${check.name}: ${toKb(check.bytes)} (budget ${toKb(check.budget)})`,
  )
}

for (const check of appChunkFailures) {
  console.log(
    `[bundle-budget] ${failAppChunkBudget ? 'FAIL' : 'WARN'} ${check.name}: ${toKb(check.bytes)} (budget ${toKb(check.budget)})`,
  )
}

for (const failure of forbiddenFailures) {
  console.log(
    `[bundle-budget] FAIL ${failure.name}: loaded by index.html on every page`,
  )
}

console.log(
  `[bundle-budget] initial-graph: ${metrics.initialJs.files.length} JS files, ${toKb(metrics.initialJs.bytes)} raw / ${toKb(metrics.initialJs.gzipBytes)} gzip`,
)
console.log(
  `[bundle-budget] largest-initial-js: ${metrics.initialJs.files
    .slice(0, 5)
    .map((file) => `${file.name}=${toKb(file.bytes)}`)
    .join(', ')}`,
)

console.log(
  `[bundle-budget] largest-js-chunks: ${jsChunks
    .slice(0, 5)
    .map((chunk) => `${chunk.name}=${toKb(chunk.bytes)}`)
    .join(', ')}`,
)
console.log(
  `[bundle-budget] largest-app-route-chunks: ${appChunks
    .slice(0, 10)
    .map((chunk) => `${chunk.name}=${toKb(chunk.bytes)}`)
    .join(', ')}`,
)

if (failures.length > 0) {
  fail(
    `Bundle budget exceeded for ${failures.map((failure) => failure.name).join(', ')}.`,
  )
}
