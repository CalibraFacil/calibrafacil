// Shared bundle measurement for the Vite apps (apps/web, apps/portal).
//
// The number that matters for first paint is the *initial graph*: the entry
// module plus every file `dist/index.html` makes the browser fetch up front
// (module scripts, `modulepreload` links, stylesheets). Vite lists the entry's
// whole static-import closure as modulepreload, so a heavy library that is
// pulled into a shared chunk shows up there even when no first-paint code
// uses it. The entry file alone hides exactly that.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

export function detectBundleEntryAssets(html) {
  const scriptTags = html.match(/<script\b[^>]*>/g) ?? [];
  const moduleScript = scriptTags.find(
    (tag) => hasAttributeValue(tag, "type", "module") && jsSrc(tag),
  );
  const fallbackScript = scriptTags.find((tag) => jsSrc(tag));
  const cssMatch = html.match(/<link[^>]+href="([^"]+\.css)"/);
  const jsEntrySrc = jsSrc(moduleScript ?? fallbackScript ?? "");

  if (!jsEntrySrc || !cssMatch) {
    throw new Error("Could not detect entry JS/CSS assets in dist/index.html.");
  }

  return {
    jsEntrySrc,
    cssEntryHref: cssMatch[1],
  };
}

/**
 * Every local JS/CSS file `index.html` loads before any route code runs:
 * `<script src>`, `<link rel="modulepreload">` and `<link rel="stylesheet">`.
 * Returned as unique, root-relative URLs in document order.
 */
export function detectInitialGraphAssets(html) {
  const js = [];
  const css = [];

  for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
    const src = jsSrc(tag);
    if (src && isLocal(src)) js.push(src);
  }

  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    const href = attributeValue(tag, "href");
    if (!href || !isLocal(href)) continue;
    const rel = attributeValue(tag, "rel");
    if (rel === "modulepreload" && href.endsWith(".js")) js.push(href);
    if (rel === "stylesheet" && href.endsWith(".css")) css.push(href);
  }

  return { js: [...new Set(js)], css: [...new Set(css)] };
}

export function measureFiles(distDir, urls) {
  const files = urls
    .map((url) => {
      const filePath = path.join(distDir, url.replace(/^\//, ""));
      const content = readFileSync(filePath);
      return {
        name: path.basename(filePath),
        bytes: content.length,
        gzipBytes: gzipSync(content).length,
      };
    })
    .sort((left, right) => right.bytes - left.bytes);

  return {
    files,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    gzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0),
  };
}

export function readBundleMetrics({ distDir, html }) {
  const { jsEntrySrc, cssEntryHref } = detectBundleEntryAssets(html);
  const jsAssetPath = path.join(distDir, jsEntrySrc.replace(/^\//, ""));
  const cssAssetPath = path.join(distDir, cssEntryHref.replace(/^\//, ""));
  const assetsDir = path.join(distDir, "assets");

  const entryJsFileName = path.basename(jsAssetPath);
  const jsChunks = readdirSync(assetsDir)
    .filter((fileName) => fileName.endsWith(".js"))
    .map((fileName) => {
      const filePath = path.join(assetsDir, fileName);
      return {
        name: fileName,
        bytes: statSync(filePath).size,
      };
    })
    .sort((left, right) => right.bytes - left.bytes);
  const appChunks = jsChunks
    .filter((chunk) => chunk.name !== entryJsFileName)
    .filter((chunk) => !chunk.name.startsWith("vendor-"))
    .sort((left, right) => right.bytes - left.bytes);

  const initial = detectInitialGraphAssets(html);

  return {
    jsBytes: statSync(jsAssetPath).size,
    cssBytes: statSync(cssAssetPath).size,
    entryJsFileName,
    jsChunks,
    appChunks,
    initialJs: measureFiles(distDir, initial.js),
    initialCss: measureFiles(distDir, initial.css),
  };
}

export function readBundleMetricsFromDist(distDir) {
  const indexHtmlPath = path.join(distDir, "index.html");

  return readBundleMetrics({
    distDir,
    html: readFileSync(indexHtmlPath, "utf8"),
  });
}

/**
 * Budget checks over the initial graph (what `index.html` loads up front).
 * `forbiddenChunks` are chunk-name prefixes that must never be in it: charts
 * once leaked in through a shared helper and put 100 kB gzip on every page.
 * Returns `{ name, bytes, budget, ok }` rows plus the forbidden offenders.
 */
export function evaluateInitialGraph(
  metrics,
  { jsBudget, jsGzipBudget, forbiddenChunks = [] },
) {
  const checks = [
    {
      name: "initial-js",
      bytes: metrics.initialJs.bytes,
      budget: jsBudget,
    },
    {
      name: "initial-js-gzip",
      bytes: metrics.initialJs.gzipBytes,
      budget: jsGzipBudget,
    },
  ].map((check) => ({ ...check, ok: check.bytes <= check.budget }));

  const forbidden = metrics.initialJs.files
    .filter((file) =>
      forbiddenChunks.some((prefix) => file.name.startsWith(prefix)),
    )
    .map((file) => file.name);

  return { checks, forbidden };
}

export function toKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function isLocal(url) {
  return !/^([a-z][a-z0-9+.-]*:)?\/\//i.test(url) && !url.startsWith("data:");
}

function jsSrc(tag) {
  return tag.match(/\bsrc="([^"]+\.js)"/)?.[1] ?? null;
}

function attributeValue(tag, attribute) {
  return tag.match(new RegExp(`\\b${attribute}="([^"]*)"`))?.[1] ?? null;
}

function hasAttributeValue(tag, attribute, value) {
  return new RegExp(`\\b${attribute}=["']${value}["']`).test(tag);
}
