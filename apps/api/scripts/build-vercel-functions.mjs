import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const entries = [
  ["vercel-src/[...route].ts", "api/[...route].js"],
  ["vercel-src/index.ts", "api/index.js"],
  ["vercel-src/queues/background.ts", "api/queues/background.js"],
  ["vercel-src/cron/integrations.ts", "api/cron/integrations.js"],
  ["vercel-src/cron/notifications.ts", "api/cron/notifications.js"],
];

await rm(join(appRoot, "api"), { recursive: true, force: true });

for (const [, outfile] of entries) {
  await mkdir(dirname(join(appRoot, outfile)), { recursive: true });
}

const build = await Bun.build({
  entrypoints: entries.map(([entry]) => join(appRoot, entry)),
  outdir: join(appRoot, "api"),
  root: join(appRoot, "vercel-src"),
  target: "node",
  format: "esm",
  splitting: false,
  sourcemap: "none",
  minify: true,
});

if (!build.success) {
  for (const log of build.logs) {
    console.error(log);
  }
  process.exit(1);
}
