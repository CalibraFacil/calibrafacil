import fs from "node:fs";
import path from "node:path";

const lock = fs.readFileSync("pnpm-lock.yaml", "utf8");
const packagesMatch = lock.match(/(?:^|\r?\n)packages:\r?\n([\s\S]*)/);
const packagesSection = packagesMatch?.[1] ?? lock;

const tanstackCompromiseReason =
  "Blocked due to TanStack npm supply-chain compromise on 2026-05-11";

const blocked = [
  ["axios@1.14.1", "Blocked due to compromised Axios release on 2026-03-31"],
  ["axios@0.30.4", "Blocked due to compromised Axios release on 2026-03-31"],
  [
    "plain-crypto-js",
    "Blocked due to malicious transitive package in Axios supply-chain attack",
  ],
  ["@tanstack/arktype-adapter@1.166.12", tanstackCompromiseReason],
  ["@tanstack/arktype-adapter@1.166.15", tanstackCompromiseReason],
  ["@tanstack/eslint-plugin-router@1.161.9", tanstackCompromiseReason],
  ["@tanstack/eslint-plugin-router@1.161.12", tanstackCompromiseReason],
  ["@tanstack/eslint-plugin-start@0.0.4", tanstackCompromiseReason],
  ["@tanstack/eslint-plugin-start@0.0.7", tanstackCompromiseReason],
  ["@tanstack/history@1.161.9", tanstackCompromiseReason],
  ["@tanstack/history@1.161.12", tanstackCompromiseReason],
  ["@tanstack/nitro-v2-vite-plugin@1.154.12", tanstackCompromiseReason],
  ["@tanstack/nitro-v2-vite-plugin@1.154.15", tanstackCompromiseReason],
  ["@tanstack/react-router@1.169.5", tanstackCompromiseReason],
  ["@tanstack/react-router@1.169.8", tanstackCompromiseReason],
  ["@tanstack/react-router-devtools@1.166.16", tanstackCompromiseReason],
  ["@tanstack/react-router-devtools@1.166.19", tanstackCompromiseReason],
  ["@tanstack/react-router-ssr-query@1.166.15", tanstackCompromiseReason],
  ["@tanstack/react-router-ssr-query@1.166.18", tanstackCompromiseReason],
  ["@tanstack/react-start@1.167.68", tanstackCompromiseReason],
  ["@tanstack/react-start@1.167.71", tanstackCompromiseReason],
  ["@tanstack/react-start-client@1.166.51", tanstackCompromiseReason],
  ["@tanstack/react-start-client@1.166.54", tanstackCompromiseReason],
  ["@tanstack/react-start-rsc@0.0.47", tanstackCompromiseReason],
  ["@tanstack/react-start-rsc@0.0.50", tanstackCompromiseReason],
  ["@tanstack/react-start-server@1.166.55", tanstackCompromiseReason],
  ["@tanstack/react-start-server@1.166.58", tanstackCompromiseReason],
  ["@tanstack/router-cli@1.166.46", tanstackCompromiseReason],
  ["@tanstack/router-cli@1.166.49", tanstackCompromiseReason],
  ["@tanstack/router-core@1.169.5", tanstackCompromiseReason],
  ["@tanstack/router-core@1.169.8", tanstackCompromiseReason],
  ["@tanstack/router-devtools@1.166.16", tanstackCompromiseReason],
  ["@tanstack/router-devtools@1.166.19", tanstackCompromiseReason],
  ["@tanstack/router-devtools-core@1.167.6", tanstackCompromiseReason],
  ["@tanstack/router-devtools-core@1.167.9", tanstackCompromiseReason],
  ["@tanstack/router-generator@1.166.45", tanstackCompromiseReason],
  ["@tanstack/router-generator@1.166.48", tanstackCompromiseReason],
  ["@tanstack/router-plugin@1.167.38", tanstackCompromiseReason],
  ["@tanstack/router-plugin@1.167.41", tanstackCompromiseReason],
  ["@tanstack/router-ssr-query-core@1.168.3", tanstackCompromiseReason],
  ["@tanstack/router-ssr-query-core@1.168.6", tanstackCompromiseReason],
  ["@tanstack/router-utils@1.161.11", tanstackCompromiseReason],
  ["@tanstack/router-utils@1.161.14", tanstackCompromiseReason],
  ["@tanstack/router-vite-plugin@1.166.53", tanstackCompromiseReason],
  ["@tanstack/router-vite-plugin@1.166.56", tanstackCompromiseReason],
  ["@tanstack/solid-router@1.169.5", tanstackCompromiseReason],
  ["@tanstack/solid-router@1.169.8", tanstackCompromiseReason],
  ["@tanstack/solid-router-devtools@1.166.16", tanstackCompromiseReason],
  ["@tanstack/solid-router-devtools@1.166.19", tanstackCompromiseReason],
  ["@tanstack/solid-router-ssr-query@1.166.15", tanstackCompromiseReason],
  ["@tanstack/solid-router-ssr-query@1.166.18", tanstackCompromiseReason],
  ["@tanstack/solid-start@1.167.65", tanstackCompromiseReason],
  ["@tanstack/solid-start@1.167.68", tanstackCompromiseReason],
  ["@tanstack/solid-start-client@1.166.50", tanstackCompromiseReason],
  ["@tanstack/solid-start-client@1.166.53", tanstackCompromiseReason],
  ["@tanstack/solid-start-server@1.166.54", tanstackCompromiseReason],
  ["@tanstack/solid-start-server@1.166.57", tanstackCompromiseReason],
  ["@tanstack/start-client-core@1.168.5", tanstackCompromiseReason],
  ["@tanstack/start-client-core@1.168.8", tanstackCompromiseReason],
  ["@tanstack/start-fn-stubs@1.161.9", tanstackCompromiseReason],
  ["@tanstack/start-fn-stubs@1.161.12", tanstackCompromiseReason],
  ["@tanstack/start-plugin-core@1.169.23", tanstackCompromiseReason],
  ["@tanstack/start-plugin-core@1.169.26", tanstackCompromiseReason],
  ["@tanstack/start-server-core@1.167.33", tanstackCompromiseReason],
  ["@tanstack/start-server-core@1.167.36", tanstackCompromiseReason],
  [
    "@tanstack/start-static-server-functions@1.166.44",
    tanstackCompromiseReason,
  ],
  [
    "@tanstack/start-static-server-functions@1.166.47",
    tanstackCompromiseReason,
  ],
  ["@tanstack/start-storage-context@1.166.38", tanstackCompromiseReason],
  ["@tanstack/start-storage-context@1.166.41", tanstackCompromiseReason],
  ["@tanstack/valibot-adapter@1.166.12", tanstackCompromiseReason],
  ["@tanstack/valibot-adapter@1.166.15", tanstackCompromiseReason],
  ["@tanstack/virtual-file-routes@1.161.10", tanstackCompromiseReason],
  ["@tanstack/virtual-file-routes@1.161.13", tanstackCompromiseReason],
  ["@tanstack/vue-router@1.169.5", tanstackCompromiseReason],
  ["@tanstack/vue-router@1.169.8", tanstackCompromiseReason],
  ["@tanstack/vue-router-devtools@1.166.16", tanstackCompromiseReason],
  ["@tanstack/vue-router-devtools@1.166.19", tanstackCompromiseReason],
  ["@tanstack/vue-router-ssr-query@1.166.15", tanstackCompromiseReason],
  ["@tanstack/vue-router-ssr-query@1.166.18", tanstackCompromiseReason],
  ["@tanstack/vue-start@1.167.61", tanstackCompromiseReason],
  ["@tanstack/vue-start@1.167.64", tanstackCompromiseReason],
  ["@tanstack/vue-start-client@1.166.46", tanstackCompromiseReason],
  ["@tanstack/vue-start-client@1.166.49", tanstackCompromiseReason],
  ["@tanstack/vue-start-server@1.166.50", tanstackCompromiseReason],
  ["@tanstack/vue-start-server@1.166.53", tanstackCompromiseReason],
  ["@tanstack/zod-adapter@1.166.12", tanstackCompromiseReason],
  ["@tanstack/zod-adapter@1.166.15", tanstackCompromiseReason],
];

const hits = blocked.filter(([pattern]) => packagesSection.includes(pattern));
if (hits.length) {
  console.error("Blocked dependencies detected in pnpm-lock.yaml:");
  for (const [pattern, reason] of hits) {
    console.error(`- ${pattern}: ${reason}`);
  }
  process.exit(1);
}

const excludedDirs = new Set([
  ".git",
  ".turbo",
  "dist",
  "node_modules",
  "out",
  ".output",
]);

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return excludedDirs.has(entry.name) ? [] : listFiles(filePath);
    }

    return entry.name === "package.json" || entry.name === "pnpm-lock.yaml"
      ? [filePath]
      : [];
  });
}

const iocs = [
  [
    "@tanstack/setup",
    "TanStack compromise IOC: malicious optional dependency package name",
  ],
  [
    "github:tanstack/router#79ac49eedf774dd4b0cfa308722bc463cfe5885c",
    "TanStack compromise IOC: malicious git dependency ref",
  ],
  ["router_init.js", "TanStack compromise IOC: malicious payload filename"],
  ["tanstack_runner.js", "TanStack compromise IOC: malicious helper filename"],
  ["filev2.getsession.org", "TanStack compromise IOC: exfiltration host"],
  ["seed1.getsession.org", "TanStack compromise IOC: exfiltration host"],
  ["seed2.getsession.org", "TanStack compromise IOC: exfiltration host"],
  ["seed3.getsession.org", "TanStack compromise IOC: exfiltration host"],
  ["litter.catbox.moe/h8nc9u.js", "TanStack compromise IOC: payload URL"],
  ["litter.catbox.moe/7rrc6l.mjs", "TanStack compromise IOC: payload URL"],
];

const manifestText = listFiles(process.cwd())
  .map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")])
  .filter(([, contents]) =>
    iocs.some(([pattern]) => contents.includes(pattern)),
  );

if (manifestText.length) {
  console.error("Blocked compromise indicators detected:");
  for (const [filePath, contents] of manifestText) {
    for (const [pattern, reason] of iocs) {
      if (contents.includes(pattern)) {
        console.error(`- ${filePath}: ${pattern}: ${reason}`);
      }
    }
  }
  process.exit(1);
}

console.log("Blocked dependency check passed.");
