// Prints the initial-graph size and largest chunks of a built Vite app.
// Usage: node scripts/report-bundle.mjs <path-to-dist>
import path from "node:path";
import process from "node:process";

import { readBundleMetricsFromDist, toKb } from "./bundle-metrics.mjs";

const distDir = path.resolve(process.argv[2] ?? "dist");
const metrics = readBundleMetricsFromDist(distDir);

console.log(`dist: ${distDir}`);
console.log(
  `initial JS: ${metrics.initialJs.files.length} files, ${toKb(metrics.initialJs.bytes)} raw / ${toKb(metrics.initialJs.gzipBytes)} gzip`,
);
console.log(
  `initial CSS: ${metrics.initialCss.files.length} files, ${toKb(metrics.initialCss.bytes)} raw / ${toKb(metrics.initialCss.gzipBytes)} gzip`,
);
console.log("largest initial JS files:");
for (const file of metrics.initialJs.files.slice(0, 8)) {
  console.log(
    `  ${file.name}  ${toKb(file.bytes)} / ${toKb(file.gzipBytes)} gzip`,
  );
}
console.log("largest chunks overall:");
for (const chunk of metrics.jsChunks.slice(0, 8)) {
  console.log(`  ${chunk.name}  ${toKb(chunk.bytes)}`);
}
