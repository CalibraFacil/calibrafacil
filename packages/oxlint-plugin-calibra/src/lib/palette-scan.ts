import { readdirSync } from "node:fs";
import { join } from "node:path";

import { isTestFile } from "./rule-support.ts";

const SOURCE_FILE = /\.(ts|tsx)$/;

/**
 * Every non-test source file under apps/web/src/features and
 * apps/portal/src/features: the files the palette ratchet covers.
 */
export function collectFeatureFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (SOURCE_FILE.test(entry.name) && !isTestFile(path)) {
        files.push(path);
      }
    }
  };
  for (const app of ["web", "portal"]) {
    visit(join(repoRoot, "apps", app, "src", "features"));
  }
  return files;
}
