#!/usr/bin/env node
/**
 * Fetch + verify + extract the official ICP-Brasil AC trust bundle from ITI into
 * packages/signing/trust-store/.
 *
 * Run this where gov.br is reachable (a developer machine or CI) — the bundle is
 * NOT downloadable from the sandboxed build environment. It downloads ITI's
 * single consolidated bundle (AC-Raiz v1–v10 + all intermediates), verifies it
 * against the published SHA-512, extracts the `.crt` PEMs, and writes a
 * MANIFEST. Commit the resulting trust-store/ so chain validation has anchors.
 *
 * Requires: Node >=18 (global fetch) and the `unzip` CLI.
 *
 * Usage:  node scripts/fetch-icp-brasil-trust-store.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const BASE =
  "https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil";
const BUNDLE_URL = `${BASE}/ACcompactado.zip`;
const HASH_URL = `${BASE}/hashsha512.txt`;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "trust-store");
const tmpZip = join(here, "..", ".icp-bundle.zip");

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log(`Downloading ${BUNDLE_URL} ...`);
  const zip = await fetchBuffer(BUNDLE_URL);
  const sha512 = createHash("sha512").update(zip).digest("hex").toLowerCase();

  console.log("Verifying SHA-512 against ITI hashsha512.txt ...");
  const published = (await fetchBuffer(HASH_URL))
    .toString("utf8")
    .toLowerCase();
  if (!published.includes(sha512)) {
    throw new Error(
      `SHA-512 mismatch — downloaded bundle (${sha512}) is not listed in hashsha512.txt. Aborting.`,
    );
  }
  console.log(`SHA-512 OK: ${sha512}`);

  writeFileSync(tmpZip, zip);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  // -j: junk paths (flat), -o: overwrite
  execFileSync("unzip", ["-o", "-j", tmpZip, "-d", outDir], {
    stdio: "inherit",
  });
  rmSync(tmpZip, { force: true });

  const kept = readdirSync(outDir).filter((f) => /\.(crt|cer|pem)$/i.test(f));
  writeFileSync(
    join(outDir, "MANIFEST.txt"),
    [
      "ICP-Brasil AC trust store (vendored from ITI)",
      `Source:  ${BUNDLE_URL}`,
      `SHA-512: ${sha512}`,
      `Files:   ${kept.length}`,
      "",
      "Regenerate with: node scripts/fetch-icp-brasil-trust-store.mjs",
    ].join("\n") + "\n",
  );
  console.log(`Done — ${kept.length} certificate files in ${outDir}`);
}

main().catch((error) => {
  console.error("[fetch-icp-brasil-trust-store] failed:", error.message);
  process.exitCode = 1;
});
