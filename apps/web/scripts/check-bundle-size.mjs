import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(scriptDir, '..')
const distDir = path.join(appDir, 'dist')
const indexHtmlPath = path.join(distDir, 'index.html')

const jsBudget = Number(process.env.WEB_BUNDLE_BUDGET_JS ?? 650_000)
const cssBudget = Number(process.env.WEB_BUNDLE_BUDGET_CSS ?? 230_000)
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

let html

try {
  html = readFileSync(indexHtmlPath, 'utf8')
} catch {
  fail(
    'Missing apps/web/dist/index.html. Run `pnpm --filter @calibra-facil/web build` first.',
  )
}

const jsMatch = html.match(/<script[^>]+src="([^"]+\.js)"/)
const cssMatch = html.match(/<link[^>]+href="([^"]+\.css)"/)

if (!jsMatch || !cssMatch) {
  fail('Could not detect entry JS/CSS assets in dist/index.html.')
}

const jsAssetPath = path.join(distDir, jsMatch[1].replace(/^\//, ''))
const cssAssetPath = path.join(distDir, cssMatch[1].replace(/^\//, ''))
const assetsDir = path.join(distDir, 'assets')

const jsBytes = statSync(jsAssetPath).size
const cssBytes = statSync(cssAssetPath).size
const entryJsFileName = path.basename(jsAssetPath)
const jsChunks = readdirSync(assetsDir)
  .filter((fileName) => fileName.endsWith('.js'))
  .map((fileName) => {
    const filePath = path.join(assetsDir, fileName)
    return {
      name: fileName,
      bytes: statSync(filePath).size,
    }
  })
  .sort((left, right) => right.bytes - left.bytes)
const appChunks = jsChunks
  .filter((chunk) => chunk.name !== entryJsFileName)
  .filter((chunk) => !chunk.name.startsWith('vendor-'))
  .sort((left, right) => right.bytes - left.bytes)

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
