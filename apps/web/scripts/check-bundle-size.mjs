import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { readBundleMetricsFromDist } from './bundle-metrics.mjs'

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

const checks = [
  { name: 'entry-js', bytes: jsBytes, budget: jsBudget },
  { name: 'entry-css', bytes: cssBytes, budget: cssBudget },
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

const failures = [
  ...checks.filter((check) => check.bytes > check.budget),
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
