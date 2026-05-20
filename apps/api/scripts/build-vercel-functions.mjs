import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const entries = [
  ["vercel-src/[...route].ts", "vercel-functions/[...route].js"],
  ["vercel-src/index.ts", "vercel-functions/index.js"],
  ["vercel-src/queues/background.ts", "vercel-functions/queues/background.js"],
  ["vercel-src/cron/integrations.ts", "vercel-functions/cron/integrations.js"],
  ["vercel-src/cron/notifications.ts", "vercel-functions/cron/notifications.js"],
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
