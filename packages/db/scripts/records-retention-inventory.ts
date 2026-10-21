// Rewrites the generated block of docs/architecture/records-retention.md from
// src/schema.ts: `pnpm --dir packages/db retention:inventory`.
// `--check` only compares (exit 1 when the document is stale).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { replaceInventoryBlock } from "../src/records-retention-doc";

const documentPath = fileURLToPath(
  new URL("../../../docs/architecture/records-retention.md", import.meta.url),
);

const current = readFileSync(documentPath, "utf8");
const next = await prettier.format(replaceInventoryBlock(current), {
  filepath: documentPath,
});

if (process.argv.includes("--check")) {
  if (next !== current) {
    console.error(
      "docs/architecture/records-retention.md is stale: run `pnpm --dir packages/db retention:inventory`.",
    );
    process.exit(1);
  }
  console.log("records-retention.md is current.");
} else {
  writeFileSync(documentPath, next);
  console.log(`Wrote ${documentPath}`);
}
