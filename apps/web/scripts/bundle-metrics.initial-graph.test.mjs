import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'

import {
  detectInitialGraphAssets,
  evaluateInitialGraph,
  readBundleMetrics,
} from './bundle-metrics.mjs'

const html = `
  <script src="/theme-init.js" integrity="sha256-test"></script>
  <script src="https://cdn.example.com/analytics.js"></script>
  <script type="module" crossorigin src="/assets/index-AAA.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/vendor-react-BBB.js">
  <link rel="modulepreload" crossorigin href="/assets/vendor-charts-CCC.js">
  <link rel="modulepreload" crossorigin href="/assets/vendor-react-BBB.js">
  <link rel="stylesheet" crossorigin href="/assets/index-DDD.css">
  <link rel="icon" href="/favicon.ico">
`

describe('initial graph detection', () => {
  it('collects the entry script, every modulepreload and the stylesheets', () => {
    expect(detectInitialGraphAssets(html)).toEqual({
      js: [
        '/theme-init.js',
        '/assets/index-AAA.js',
        '/assets/vendor-react-BBB.js',
        '/assets/vendor-charts-CCC.js',
      ],
      css: ['/assets/index-DDD.css'],
    })
  })
})

describe('initial graph measurement', () => {
  const dirs = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true })
  })

  function buildDist(files) {
    const distDir = mkdtempSync(path.join(tmpdir(), 'bundle-metrics-'))
    dirs.push(distDir)
    mkdirSync(path.join(distDir, 'assets'))
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(distDir, name), content)
    }
    return distDir
  }

  it('counts modulepreloaded chunks, not just the entry file, raw and gzipped', () => {
    const entry = 'console.log("entry");'.repeat(50)
    const charts = 'chart-code-'.repeat(2000)
    const distDir = buildDist({
      'theme-init.js': '',
      'assets/index-AAA.js': entry,
      'assets/vendor-react-BBB.js': 'react'.repeat(100),
      'assets/vendor-charts-CCC.js': charts,
      'assets/index-DDD.css': 'a{}',
      // Not referenced by index.html: a lazy route chunk.
      'assets/route-lazy.js': 'lazy'.repeat(5000),
    })

    const metrics = readBundleMetrics({ distDir, html })

    expect(metrics.jsBytes).toBe(entry.length)
    expect(metrics.initialJs.files.map((file) => file.name).sort()).toEqual([
      'index-AAA.js',
      'theme-init.js',
      'vendor-charts-CCC.js',
      'vendor-react-BBB.js',
    ])
    expect(metrics.initialJs.bytes).toBe(
      entry.length + 'react'.repeat(100).length + charts.length,
    )
    expect(metrics.initialJs.gzipBytes).toBe(
      gzipSync('').length +
        gzipSync(entry).length +
        gzipSync('react'.repeat(100)).length +
        gzipSync(charts).length,
    )
    expect(metrics.initialCss.bytes).toBe(3)
  })

  it('flags forbidden chunks in the initial graph and over-budget totals', () => {
    const distDir = buildDist({
      'theme-init.js': '',
      'assets/index-AAA.js': 'x'.repeat(1000),
      'assets/vendor-react-BBB.js': 'y'.repeat(1000),
      'assets/vendor-charts-CCC.js': 'z'.repeat(1000),
      'assets/index-DDD.css': 'a{}',
    })
    const metrics = readBundleMetrics({ distDir, html })

    const failing = evaluateInitialGraph(metrics, {
      jsBudget: 2500,
      jsGzipBudget: 1_000_000,
      forbiddenChunks: ['vendor-charts'],
    })
    expect(failing.forbidden).toEqual(['vendor-charts-CCC.js'])
    expect(
      failing.checks.find((check) => check.name === 'initial-js')?.ok,
    ).toBe(false)

    const passing = evaluateInitialGraph(metrics, {
      jsBudget: 3500,
      jsGzipBudget: 1_000_000,
      forbiddenChunks: ['vendor-motion'],
    })
    expect(passing.forbidden).toEqual([])
    expect(passing.checks.every((check) => check.ok)).toBe(true)
  })
})
