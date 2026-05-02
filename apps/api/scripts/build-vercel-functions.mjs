import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(appRoot, "../..");
const outputRoot = join(repoRoot, ".vercel/output");
const functionsRoot = join(outputRoot, "functions");

const entries = [
  {
    source: "vercel-src/[...route].ts",
    functionPath: "api/[...route].func",
    maxDuration: 30,
  },
  {
    source: "vercel-src/index.ts",
    functionPath: "api/index.func",
    maxDuration: 30,
  },
  {
    source: "vercel-src/queues/background.ts",
    functionPath: "api/queues/background.func",
    maxDuration: 300,
    sourcemapSupport: true,
    experimentalTriggers: [
      {
        type: "queue/v2beta",
        topic: "calibra-facil-background-jobs",
        consumer: "api_Squeues_Sbackground_Djs",
      },
    ],
  },
  {
    source: "vercel-src/cron/integrations.ts",
    functionPath: "api/cron/integrations.func",
    maxDuration: 30,
  },
  {
    source: "vercel-src/cron/notifications.ts",
    functionPath: "api/cron/notifications.func",
    maxDuration: 30,
  },
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(functionsRoot, { recursive: true });

await build({
  entryPoints: Object.fromEntries(
    entries.map((entry) => [
      `${entry.functionPath}/index`,
      join(appRoot, entry.source),
    ]),
  ),
  outdir: functionsRoot,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  splitting: false,
  sourcemap: false,
  minify: true,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  outExtension: { ".js": ".js" },
  logLevel: "info",
});

const baseFunctionConfig = {
  handler: "index.js",
  runtime: "bun1.x",
  architecture: "arm64",
  regions: ["gru1"],
  environment: {},
  shouldDisableAutomaticFetchInstrumentation: false,
  launcherType: "Nodejs",
  shouldAddHelpers: true,
  awsLambdaHandler: "",
};

for (const entry of entries) {
  const functionDir = join(functionsRoot, entry.functionPath);
  await writeFile(
    join(functionDir, ".vc-config.json"),
    `${JSON.stringify(
      {
        ...baseFunctionConfig,
        maxDuration: entry.maxDuration,
        ...(entry.experimentalTriggers
          ? { experimentalTriggers: entry.experimentalTriggers }
          : {}),
        shouldAddSourcemapSupport: entry.sourcemapSupport ?? false,
      },
      null,
      2,
    )}\n`,
  );
}

await mkdir(join(outputRoot, "static"), { recursive: true });
await writeFile(join(outputRoot, "static/.gitkeep"), "");

await writeFile(
  join(outputRoot, "config.json"),
  `${JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: "filesystem" },
        {
          src: "^/api/cron/integrations$",
          dest: "/api/cron/integrations",
          check: true,
        },
        {
          src: "^/api/cron/notifications$",
          dest: "/api/cron/notifications",
          check: true,
        },
        {
          src: "^/api(?:/(.*))$",
          dest: "/api",
          check: true,
        },
        {
          src: "^/api/([^/]+)$",
          dest: "/api/[...route]?...route=$1",
          check: true,
        },
        {
          src: "^/api(/.*)?$",
          status: 404,
        },
        {
          src: "/(.*)",
          dest: "/",
        },
        { handle: "error" },
        {
          status: 404,
          src: "^(?!/api).*$",
          dest: "/404.html",
        },
        { handle: "miss" },
        {
          src: "^/api/(.+)(?:\\.(?:js))$",
          dest: "/api/$1",
          check: true,
        },
      ],
      crons: [
        {
          path: "/api/cron/integrations",
          schedule: "*/30 * * * *",
        },
        {
          path: "/api/cron/notifications",
          schedule: "0 8 * * *",
        },
      ],
    },
    null,
    2,
  )}\n`,
);
