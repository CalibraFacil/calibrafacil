import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = path.join(root, "apps/desktop");
const electronBuilderConfigPath = path.join(desktopDir, "electron-builder.yml");
const rendererOutDir = path.join(desktopDir, "dist/renderer");
const rendererManifestPath = path.join(
  rendererOutDir,
  "calibra-renderer-build.json",
);
const localServerBundle = path.join(root, "apps/local-server/dist/server.cjs");
const stagedLocalServerDir = path.join(desktopDir, "dist/local-server");
// electron-builder looks for the repository only in apps/desktop (its
// package.json or a .git directory there), so in this monorepo it finds none
// and cannot write the update feed into the app. Name it here instead: the
// GitHub repository CI builds in, else this checkout's origin, so a fork's
// installers update from the fork's own releases. The release workflow uploads
// the files itself, so electron-builder never publishes.
const electronBuilderArgs = [
  ...process.argv.slice(2),
  ...updateFeedArgs(),
  "--publish=never",
];
const requireFromDesktop = createRequire(path.join(desktopDir, "package.json"));
const rendererBuildStartedAt = new Date().toISOString();
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

validateLinuxPackagePrerequisites();

run(pnpmCommand, ["--dir", "apps/local-server", "run", "bundle"]);
run(pnpmCommand, ["--dir", "apps/desktop", "run", "build"]);
run(pnpmCommand, [
  "--dir",
  "apps/web",
  "exec",
  "vite",
  "build",
  "--base=./",
  "--outDir",
  "../desktop/dist/renderer",
  "--emptyOutDir",
]);

writeRendererBuildManifest();

fs.rmSync(stagedLocalServerDir, { force: true, recursive: true });
fs.mkdirSync(stagedLocalServerDir, { recursive: true });
fs.copyFileSync(
  localServerBundle,
  path.join(stagedLocalServerDir, "server.cjs"),
);
fs.copyFileSync(
  `${localServerBundle}.map`,
  path.join(stagedLocalServerDir, "server.cjs.map"),
);

validateRendererAssets();
validateRendererBuildManifest();
validateLocalServerBundle();

let builderError;
try {
  run(pnpmCommand, [
    "--dir",
    "apps/desktop",
    "exec",
    "electron-builder",
    ...electronBuilderArgs,
  ]);
} catch (error) {
  builderError = error;
} finally {
  restoreNodeBetterSqliteBuild();
}

if (builderError) {
  throw builderError;
}

function updateFeedArgs() {
  const [owner, repo] = (
    process.env.GITHUB_REPOSITORY ||
    originRepository() ||
    ""
  ).split("/");
  if (!owner || !repo) return [];

  return [`-c.publish.owner=${owner}`, `-c.publish.repo=${repo}`];
}

function originRepository() {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    return url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function validateRendererAssets() {
  const indexPath = path.join(rendererOutDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Desktop renderer index was not staged: ${indexPath}`);
  }

  const indexHtml = fs.readFileSync(indexPath, "utf8");
  const assetReferences = [
    ...indexHtml.matchAll(/\b(?:src|href)="([^"]+)"/g),
  ].map((match) => match[1]);

  for (const reference of assetReferences) {
    if (
      reference.startsWith("http://") ||
      reference.startsWith("https://") ||
      reference.startsWith("data:") ||
      reference.startsWith("#")
    ) {
      continue;
    }

    const localPath = path.join(rendererOutDir, reference.replace(/^\.\//, ""));
    if (!fs.existsSync(localPath)) {
      throw new Error(
        `Desktop renderer asset reference is missing: ${reference}`,
      );
    }
  }
}

function writeRendererBuildManifest() {
  const indexPath = path.join(rendererOutDir, "index.html");
  const indexHtml = fs.readFileSync(indexPath, "utf8");
  const webPackageJson = JSON.parse(
    fs.readFileSync(path.join(root, "apps/web/package.json"), "utf8"),
  );

  fs.writeFileSync(
    rendererManifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourcePackage: webPackageJson.name,
        buildCommand:
          "pnpm --dir apps/web exec vite build --base=./ --outDir ../desktop/dist/renderer --emptyOutDir",
        buildStartedAt: rendererBuildStartedAt,
        stagedAt: new Date().toISOString(),
        indexSha256: sha256(indexHtml),
      },
      null,
      2,
    )}\n`,
  );
}

function validateRendererBuildManifest() {
  if (!fs.existsSync(rendererManifestPath)) {
    throw new Error(
      `Desktop renderer build manifest is missing: ${rendererManifestPath}`,
    );
  }

  const manifest = JSON.parse(fs.readFileSync(rendererManifestPath, "utf8"));
  const indexHtml = fs.readFileSync(path.join(rendererOutDir, "index.html"));

  if (manifest.schemaVersion !== 1) {
    throw new Error("Desktop renderer build manifest schema is unsupported");
  }

  if (manifest.sourcePackage !== "@calibra-facil/web") {
    throw new Error("Desktop renderer build manifest source is invalid");
  }

  if (manifest.indexSha256 !== sha256(indexHtml)) {
    throw new Error("Desktop renderer build manifest hash is stale");
  }
}

function validateLocalServerBundle() {
  const stagedServer = path.join(stagedLocalServerDir, "server.cjs");
  if (!fs.existsSync(stagedServer)) {
    throw new Error(`Local server bundle was not staged: ${stagedServer}`);
  }
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function validateLinuxPackagePrerequisites() {
  if (process.platform !== "linux" || !isLinuxDebBuildRequested()) {
    return;
  }

  if (hasSharedLibrary("libcrypt.so.1")) {
    return;
  }

  throw new Error(
    [
      "Linux desktop packaging requires libcrypt.so.1 for electron-builder fpm.",
      `Install the compatibility package, then rerun: ${linuxCryptInstallCommand()}`,
    ].join("\n"),
  );
}

function isLinuxDebBuildRequested() {
  const linuxArgIndex = electronBuilderArgs.findIndex(
    (arg) => arg === "--linux" || arg.startsWith("--linux="),
  );

  if (linuxArgIndex === -1) {
    return false;
  }

  const linuxArg = electronBuilderArgs[linuxArgIndex];
  const inlineTargets = linuxArg.includes("=")
    ? linuxArg.split("=").slice(1).join("=").trim()
    : "";
  const targets = inlineTargets
    ? inlineTargets.split(/[,\s]+/)
    : electronBuilderArgs
        .slice(linuxArgIndex + 1)
        .filter((arg) => !arg.startsWith("-"));

  if (targets.length === 0) {
    return electronBuilderConfigIncludesDeb();
  }

  return targets.some((target) => target.toLowerCase() === "deb");
}

function electronBuilderConfigIncludesDeb() {
  try {
    return /(?:^|\n)\s*-\s*deb\s*(?:\n|$)/.test(
      fs.readFileSync(electronBuilderConfigPath, "utf8"),
    );
  } catch {
    return true;
  }
}

function hasSharedLibrary(name) {
  const libraryPaths = [
    "/lib",
    "/lib64",
    "/usr/lib",
    "/usr/lib64",
    "/usr/lib/x86_64-linux-gnu",
  ];

  if (
    libraryPaths.some((libraryPath) =>
      fs.existsSync(path.join(libraryPath, name)),
    )
  ) {
    return true;
  }

  try {
    return execFileSync("ldconfig", ["-p"], { encoding: "utf8" }).includes(
      name,
    );
  } catch {
    return false;
  }
}

function linuxCryptInstallCommand() {
  const osRelease = readOsRelease();
  const osId = osRelease.ID;
  const osLike = osRelease.ID_LIKE ?? "";

  if (osId === "arch" || osId === "manjaro" || osLike.includes("arch")) {
    return "sudo pacman -S --needed libxcrypt-compat";
  }

  if (
    osId === "debian" ||
    osId === "ubuntu" ||
    osLike.includes("debian") ||
    osLike.includes("ubuntu")
  ) {
    return "sudo apt install libcrypt1";
  }

  if (
    osId === "fedora" ||
    osId === "rhel" ||
    osId === "centos" ||
    osLike.includes("fedora") ||
    osLike.includes("rhel")
  ) {
    return "sudo dnf install libxcrypt-compat";
  }

  return "install the package that provides libcrypt.so.1";
}

function readOsRelease() {
  try {
    return Object.fromEntries(
      fs
        .readFileSync("/etc/os-release", "utf8")
        .split("\n")
        .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
        .filter(Boolean)
        .map((match) => [
          match[1],
          match[2].replace(/^"|"$/g, "").toLowerCase(),
        ]),
    );
  } catch {
    return {};
  }
}

// electron-builder's npmRebuild compiles native modules to Electron's ABI, but
// the local-server runs as plain Node (ELECTRON_RUN_AS_NODE). better-sqlite3 is
// a node-gyp single-binding module, so we must rebuild it back to the Node ABI.
//
// usb and serialport (@serialport/bindings-cpp) are intentionally NOT handled
// here: they are N-API modules shipping napi prebuilds, and node-gyp-build
// selects the napi prebuild at require time for either ABI — so they load
// correctly under ELECTRON_RUN_AS_NODE without a rebuild.
function restoreNodeBetterSqliteBuild() {
  const packageJsonPath = requireFromDesktop.resolve(
    "better-sqlite3/package.json",
  );
  run(npmCommand, ["run", "build-release"], {
    cwd: path.dirname(packageJsonPath),
  });
}
