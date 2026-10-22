// Rewrites the generated block of docs/architecture/tenancy.md from
// src/schema.ts: `pnpm --dir packages/db tenancy:doc`.
// `--check` only compares (exit 1 when the document is stale).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { replaceTenancyBlock } from "../src/tenancy-doc";

const documentPath = fileURLToPath(
  new URL("../../../docs/architecture/tenancy.md", import.meta.url),
);

const current = readFileSync(documentPath, "utf8");
const next = await prettier.format(replaceTenancyBlock(current), {
  filepath: documentPath,
});

if (process.argv.includes("--check")) {
  if (next !== current) {
    console.error(
      "docs/architecture/tenancy.md is stale: run `pnpm --dir packages/db tenancy:doc`.",
    );
    process.exit(1);
  }
  console.log("tenancy.md is current.");
} else {
  writeFileSync(documentPath, next);
  console.log(`Wrote ${documentPath}`);
}
