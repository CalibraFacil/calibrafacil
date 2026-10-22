import { readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { countRawPaletteClasses } from "../src/lib/palette.ts";
import { PALETTE_BASELINE } from "../src/lib/palette-baseline.ts";
import { collectFeatureFiles } from "../src/lib/palette-scan.ts";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-raw-palette-color-classes";

// Each case spawns the real oxlint binary; under a parallel `turbo test` the
// default 5s is not enough.
vi.setConfig({ testTimeout: 30_000 });

const repoRoot = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
);

describe("calibra/no-raw-palette-color-classes (real oxlint)", () => {
  it("REQ-UI-4: reports a raw palette class in an unlisted web feature file", async () => {
    const output = await expectViolation(RULE, {
      "apps/web/src/features/jobs/brand-new.tsx":
        'export const c = <span className="text-red-500">x</span>;\n',
    });
    expect(output).toContain("status-tone");
  });

  it("REQ-UI-4: reports it in portal features too, with variants and opacity", async () => {
    await expectViolation(RULE, {
      "apps/portal/src/features/fleet/brand-new.tsx":
        'export const c = "dark:hover:bg-emerald-600/10 border-amber-400";\n',
    });
  });

  it("REQ-UI-4: counts bg, border and ring too", async () => {
    for (const cls of ["bg-blue-100", "border-yellow-300", "ring-green-500"]) {
      await expectViolation(RULE, {
        "apps/web/src/features/x/y.tsx": `export const c = "${cls}";\n`,
      });
    }
  });

  it("REQ-UI-4: allows theme tokens and status-tone classes", async () => {
    await expectClean(RULE, {
      "apps/web/src/features/jobs/ok.tsx":
        'export const c = "text-destructive bg-primary/10 text-muted-foreground bg-signal-ok/10 border-border";\n',
    });
  });

  it("REQ-UI-4: only guards feature code, and exempts tests", async () => {
    await expectClean(RULE, {
      "apps/web/src/components/legacy.tsx":
        'export const c = "text-red-500";\n',
      "apps/web/src/routes/legacy.tsx": 'export const c = "text-red-500";\n',
      "apps/api/src/features/legacy.ts": 'export const c = "text-red-500";\n',
      "apps/web/src/features/jobs/page.test.tsx":
        'export const c = "text-red-500";\n',
    });
  });

  it("REQ-UI-4: grandfathers the exact baseline count and fails above it", async () => {
    const [entry] = [...PALETTE_BASELINE].filter(([, count]) => count === 1);
    if (!entry) throw new Error("expected a baselined file with a single use");
    const [path] = entry;

    await expectClean(RULE, { [path]: 'export const c = "text-red-500";\n' });
    await expectViolation(RULE, {
      [path]: 'export const c = "text-red-500 bg-red-500";\n',
    });
  });
});

describe("palette baseline", () => {
  it("REQ-UI-4: every baselined count equals the file's real count (the allowance can only shrink)", () => {
    const real = new Map(
      collectFeatureFiles(repoRoot)
        .map(
          (file) =>
            [
              relative(repoRoot, file).replaceAll("\\", "/"),
              countRawPaletteClasses(readFileSync(file, "utf8")),
            ] as const,
        )
        .filter(([, count]) => count > 0),
    );

    expect(Object.fromEntries(PALETTE_BASELINE)).toEqual(
      Object.fromEntries(real),
    );
  });

  it("REQ-UI-4: the counter sees the classes the rule is about", () => {
    expect(
      countRawPaletteClasses(
        'a "text-red-500" b `bg-emerald-600/10` c dark:border-amber-400 ring-blue-50 text-red-5',
      ),
    ).toBe(4);
    expect(
      countRawPaletteClasses("context-red-500 text-destructive bg-muted/45"),
    ).toBe(0);
  });
});
