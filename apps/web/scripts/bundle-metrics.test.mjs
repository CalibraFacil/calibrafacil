import { describe, expect, it } from 'vitest'

import { detectBundleEntryAssets } from './bundle-metrics.mjs'

describe('bundle metrics', () => {
  it('uses the Vite module script as the JS entry when theme-init is present first', () => {
    expect(
      detectBundleEntryAssets(`
        <script src="/theme-init.js" integrity="sha256-test"></script>
        <script type="module" crossorigin src="/assets/index-Cyy7MdFQ.js"></script>
        <link rel="stylesheet" crossorigin href="/assets/index-CoThOidB.css">
      `),
    ).toEqual({
      jsEntrySrc: '/assets/index-Cyy7MdFQ.js',
      cssEntryHref: '/assets/index-CoThOidB.css',
    })
  })

  it('falls back to the first JS script when no module script is present', () => {
    expect(
      detectBundleEntryAssets(`
        <script src="/assets/legacy-entry.js"></script>
        <link rel="stylesheet" href="/assets/index.css">
      `),
    ).toEqual({
      jsEntrySrc: '/assets/legacy-entry.js',
      cssEntryHref: '/assets/index.css',
    })
  })
})
