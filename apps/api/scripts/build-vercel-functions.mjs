import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const entries = [
  // Only one HTTP entrypoint (index) is built: the vercel.json rewrite
  // `/api/(.*)` -> `/api` routes every request to api/index.js, so a separate
  // catch-all `[...route]` function was an unreachable, byte-identical
  // duplicate. Removing it drops one bundle from Vercel's per-function
  // packaging step.
  ["vercel-src/index.ts", "vercel-functions/index.js"],
  ["vercel-src/queues/background.ts", "vercel-functions/queues/background.js"],
  // One dispatcher bundle for all three cron jobs (integrations, notifications,
  // operator-alerts). The dynamic shim api/cron/[job].js routes every
  // /api/cron/* path to it, so Vercel packages one cron function instead of three.
  ["vercel-src/cron/dispatch.ts", "vercel-functions/cron/dispatch.js"],
];

for (const [, outfile] of entries) {
  const outputPath = join(appRoot, outfile);
  await rm(outputPath, { force: true });
  await mkdir(dirname(outputPath), { recursive: true });
}

await build({
  entryPoints: Object.fromEntries(
    entries.map(([entry, outfile]) => [
      outfile.replace(/^vercel-functions\//, "").replace(/\.js$/, ""),
      join(appRoot, entry),
    ]),
  ),
  outdir: join(appRoot, "vercel-functions"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["@resvg/resvg-js"],
  splitting: false,
  sourcemap: false,
  minify: true,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  outExtension: { ".js": ".js" },
  logLevel: "info",
});
