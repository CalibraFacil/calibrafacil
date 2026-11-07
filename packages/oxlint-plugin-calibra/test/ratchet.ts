import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintFixtures, lintRepoPaths } from "./harness.ts";

const repoRoot = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
);

/**
 * The tests every LEGACY_BASELINE ratchet owes, written against the COMMITTED
 * baseline (never an injected one): each entry allows exactly its count (one more
 * fails, one fewer is a stale entry that fails), every entry names a file that
 * exists, and the real files match their entries (no entry stale, no file above it).
 */
export function ratchetSuite(options: {
  rule: string;
  baseline: ReadonlyMap<string, number>;
  /** A source with exactly `count` occurrences of what the rule bans. */
  source: (count: number) => string;
}) {
  const { rule, baseline, source } = options;
  const entries = [...baseline];

  describe(`${rule}: the committed baseline`, () => {
    it("names only files that exist", () => {
      const missing = entries
        .map(([file]) => file)
        .filter((file) => !existsSync(join(repoRoot, file)));
      expect(missing).toEqual([]);
    });

    it("allows each file exactly its count: one more fails, one fewer is stale", async () => {
      const tree = (delta: number) =>
        Object.fromEntries(
          entries.map(([file, count]) => [file, source(count + delta)]),
        );

      const exact = await lintFixtures(rule, tree(0));
      expect(exact.output).not.toContain(`calibra(${rule})`);
      expect(exact.exitCode).toBe(0);

      const above = await lintFixtures(rule, tree(1));
      const below = await lintFixtures(rule, tree(-1));
      for (const [file] of entries) {
        expect(above.output, `${file} +1`).toContain(file);
        expect(below.output, `${file} -1`).toContain(file);
      }
      if (entries.length > 0) {
        expect(below.output).toMatch(/entry for this file allows/);
      }
    }, 120_000);

    it("matches the real files exactly (no entry stale, no file above it)", async () => {
      if (entries.length === 0) return;
      const { exitCode, output } = await lintRepoPaths(
        rule,
        entries.map(([file]) => file),
      );
      expect(output).not.toContain(`calibra(${rule})`);
      expect(exitCode).toBe(0);
    }, 120_000);
  });
}
