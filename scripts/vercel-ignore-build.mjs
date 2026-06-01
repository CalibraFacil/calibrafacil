import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const projects = new Map([
  ["api", "@calibra-facil/api"],
  ["web", "@calibra-facil/web"],
  ["portal", "@calibra-facil/portal"],
  ["docs", "@calibra-facil/docs"],
  ["cms", "@calibra-facil/cms"],
  ["backoffice", "@calibra-facil/backoffice"],
]);

const globalBuildInputs = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  ".npmrc",
  ".vercelignore",
  "scripts/setup-private-git-ssh.mjs",
  "scripts/vercel-ignore-build.mjs",
]);

const projectName = process.argv[2];

if (!projects.has(projectName)) {
  console.error(
    `Usage: vercel-ignore-build.mjs <${[...projects.keys()].join("|")}>`,
  );
  process.exit(1);
}

const currentSha =
  process.env.VERCEL_GIT_COMMIT_SHA || git(["rev-parse", "HEAD"]);
const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA;

if (!previousSha) {
  console.log("No previous successful Vercel SHA available: build required.");
  process.exit(1);
}

if (!gitObjectExists(previousSha) || !gitObjectExists(currentSha)) {
  console.log("Could not inspect Vercel diff range locally: build required.");
  process.exit(1);
}

const changedFiles = git(["diff", "--name-only", previousSha, currentSha, "--"])
  .split("\n")
  .map((file) => file.trim())
  .filter(Boolean);

if (changedFiles.length === 0) {
  console.log("No changed files in Vercel diff range: build ignored.");
  process.exit(0);
}

const relevantPrefixes = collectWorkspacePrefixes(projects.get(projectName));
const relevantFiles = changedFiles.filter((file) => isRelevant(file));

if (relevantFiles.length === 0) {
  console.log(
    `No ${projectName} deploy inputs changed. Changed files:\n${changedFiles
      .map((file) => `- ${file}`)
      .join("\n")}`,
  );
  process.exit(0);
}

console.log(
  `${projectName} deploy inputs changed:\n${relevantFiles
    .map((file) => `- ${file}`)
    .join("\n")}`,
);
process.exit(1);

function isRelevant(file) {
  if (globalBuildInputs.has(file)) {
    return true;
  }

  return relevantPrefixes.some(
    (prefix) => file === prefix || file.startsWith(`${prefix}/`),
  );
}

function collectWorkspacePrefixes(rootPackageName) {
  const workspacePackages = new Map();

  for (const scope of ["apps", "packages"]) {
    const entries = git(["ls-files", `${scope}/*/package.json`])
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean);

    for (const packageJsonPath of entries) {
      const packageJson = readJson(packageJsonPath);
      if (packageJson?.name) {
        workspacePackages.set(packageJson.name, {
          dir: dirname(packageJsonPath),
          packageJson,
        });
      }
    }
  }

  const visited = new Set();
  const prefixes = new Set();

  visit(rootPackageName);

  return [...prefixes].sort();

  function visit(packageName) {
    if (visited.has(packageName)) {
      return;
    }

    const workspacePackage = workspacePackages.get(packageName);
    if (!workspacePackage) {
      return;
    }

    visited.add(packageName);
    prefixes.add(workspacePackage.dir);

    for (const dependencyName of localDependencyNames(
      workspacePackage.packageJson,
    )) {
      visit(dependencyName);
    }
  }

  function localDependencyNames(packageJson) {
    return [
      packageJson.dependencies,
      packageJson.devDependencies,
      packageJson.peerDependencies,
      packageJson.optionalDependencies,
    ]
      .flatMap((dependencies) => Object.keys(dependencies || {}))
      .filter((dependencyName) => workspacePackages.has(dependencyName));
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitObjectExists(ref) {
  if (!ref) {
    return false;
  }

  try {
    execFileSync("git", ["cat-file", "-e", `${ref}^{commit}`], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}
