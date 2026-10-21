// Fails when a workspace's source has an import cycle (`madge --circular`).
//
// madge is run through `pnpm dlx` with an explicit TypeScript 5.x rather than as
// a devDependency: madge parses with the TypeScript compiler API, which the
// native TypeScript 7 this repo type-checks with does not ship. Pinning both
// versions here keeps the check reproducible without touching the lockfile.
//
// It runs once per workspace so each gets its own tsconfig (the `@/` aliases in
// apps/web and apps/portal only resolve against their own tsconfig). Edges that
// cross a package boundary go through node_modules and are not followed, which
// is the point: a cycle inside one package is a design smell, while the package
// graph itself is a DAG enforced by the workspace dependencies.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MADGE_VERSION = "8.0.0";
const TYPESCRIPT_VERSION = "5.9.3";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function sourceDirs() {
  const dirs = [];
  for (const group of ["apps", "packages"]) {
    for (const entry of readdirSync(path.join(repoRoot, group), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(group, entry.name);
      if (existsSync(path.join(repoRoot, dir, "src"))) dirs.push(dir);
    }
  }
  return dirs.sort();
}

const failures = [];

for (const dir of sourceDirs()) {
  const tsconfig = path.join(dir, "tsconfig.json");
  const args = [
    "dlx",
    `--package=madge@${MADGE_VERSION}`,
    `--package=typescript@${TYPESCRIPT_VERSION}`,
    "madge",
    "--circular",
    "--no-spinner",
    "--extensions",
    "ts,tsx",
    // Declaration files and generated route trees are not source of truth.
    "--exclude",
    String.raw`\.d\.ts$|routeTree\.gen\.ts$`,
    ...(existsSync(path.join(repoRoot, tsconfig))
      ? ["--ts-config", tsconfig]
      : []),
    path.join(dir, "src"),
  ];

  const result = spawnSync("pnpm", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status === 0) {
    console.log(`ok    ${dir}`);
  } else {
    console.log(`FAIL  ${dir}`);
    console.log(output);
    failures.push(dir);
  }
}

if (failures.length > 0) {
  console.error(`\nImport cycles found in: ${failures.join(", ")}`);
  process.exit(1);
}

console.log("\nNo import cycles.");
