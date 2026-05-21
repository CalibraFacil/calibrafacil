import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export function detectBundleEntryAssets(html) {
  const scriptTags = html.match(/<script\b[^>]*>/g) ?? []
  const moduleScript = scriptTags.find(
    (tag) => hasAttributeValue(tag, 'type', 'module') && jsSrc(tag),
  )
  const fallbackScript = scriptTags.find((tag) => jsSrc(tag))
  const cssMatch = html.match(/<link[^>]+href="([^"]+\.css)"/)
  const jsEntrySrc = jsSrc(moduleScript ?? fallbackScript ?? '')

  if (!jsEntrySrc || !cssMatch) {
    throw new Error('Could not detect entry JS/CSS assets in dist/index.html.')
  }

  return {
    jsEntrySrc,
    cssEntryHref: cssMatch[1],
  }
}

export function readBundleMetrics({ distDir, html }) {
  const { jsEntrySrc, cssEntryHref } = detectBundleEntryAssets(html)
  const jsAssetPath = path.join(distDir, jsEntrySrc.replace(/^\//, ''))
  const cssAssetPath = path.join(distDir, cssEntryHref.replace(/^\//, ''))
  const assetsDir = path.join(distDir, 'assets')

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

  return {
    jsBytes: statSync(jsAssetPath).size,
    cssBytes: statSync(cssAssetPath).size,
    entryJsFileName,
    jsChunks,
    appChunks,
  }
}

export function readBundleMetricsFromDist(distDir) {
  const indexHtmlPath = path.join(distDir, 'index.html')

  return readBundleMetrics({
    distDir,
    html: readFileSync(indexHtmlPath, 'utf8'),
  })
}

function jsSrc(tag) {
  return tag.match(/\bsrc="([^"]+\.js)"/)?.[1] ?? null
}

function hasAttributeValue(tag, attribute, value) {
  return new RegExp(`\\b${attribute}=["']${value}["']`).test(tag)
}
