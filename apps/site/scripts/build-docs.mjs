// Publishes the user documentation with the site: apps/docs is a static
// Next.js export with basePath /docs, copied into dist/docs so the site's
// Worker serves it at calibrafacil.com/docs (with this site's _headers and
// _redirects).
//
// Under Turborepo (`pnpm build`), turbo.json builds the docs first, so this
// only copies them. Run on its own (the Workers Build runs this package's
// `build` from apps/site), it installs the docs' dependencies (pinned by the
// workspace lockfile) when they are missing and builds them.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const docsDir = fileURLToPath(new URL("../../docs/", import.meta.url));
const exported = fileURLToPath(new URL("../../docs/out/", import.meta.url));
const target = fileURLToPath(new URL("../dist/docs/", import.meta.url));
const nextBin = fileURLToPath(
  new URL("../../docs/node_modules/next/dist/bin/next", import.meta.url),
);

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function hasCommand(command) {
  try {
    execFileSync(command, ["--version"], {
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    return true;
  } catch {
    return false;
  }
}

if (!process.env.TURBO_HASH || !existsSync(exported)) {
  if (!existsSync(nextBin)) {
    // pnpm from PATH, or through corepack (bundled with Node 24), which runs
    // the version package.json's "packageManager" names.
    const [command, prefix] = hasCommand("pnpm")
      ? ["pnpm", []]
      : ["corepack", ["pnpm"]];
    run(
      command,
      [
        ...prefix,
        "install",
        "--frozen-lockfile",
        "--filter",
        "@calibra-facil/docs",
      ],
      repoRoot,
    );
  }
  run(process.execPath, [nextBin, "build"], docsDir);
}

rmSync(target, { recursive: true, force: true });
cpSync(exported, target, { recursive: true });
console.log("Copied the documentation into dist/docs.");
