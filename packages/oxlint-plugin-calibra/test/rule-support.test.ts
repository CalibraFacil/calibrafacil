import { describe, expect, it } from "vitest";
import {
  baselineFor,
  createRatchet,
  resolveRelativeImport,
} from "../src/lib/rule-support.ts";

// The live rules all ship with EMPTY baselines (the boundaries are clean), so
// the grandfathering mechanics are proven here at the unit level: a listed
// file gets exactly its allowance and not one more; unlisted files get zero.

describe("baseline ratchet", () => {
  const baseline = new Map<string, number>([
    ["apps/web/src/features/legacy/page.tsx", 2],
  ]);

  it("grandfathers exactly the listed count, then fails net-new occurrences", () => {
    const ratchet = createRatchet(
      baseline,
      "/repo/apps/web/src/features/legacy/page.tsx",
    );
    expect(ratchet.exceeds()).toBe(false); // 1st occurrence — grandfathered
    expect(ratchet.exceeds()).toBe(false); // 2nd — grandfathered
    expect(ratchet.exceeds()).toBe(true); // 3rd — net-new, fails
  });

  it("gives unlisted files zero allowance", () => {
    const ratchet = createRatchet(
      baseline,
      "/repo/apps/web/src/features/fresh/page.tsx",
    );
    expect(ratchet.exceeds()).toBe(true);
  });

  it("matches by repo-relative suffix and normalizes windows separators", () => {
    expect(
      baselineFor(
        baseline,
        "C:\\repo\\apps\\web\\src\\features\\legacy\\page.tsx",
      ),
    ).toBe(2);
  });
});

describe("resolveRelativeImport", () => {
  it("resolves an escape from apps/web into apps/api", () => {
    expect(
      resolveRelativeImport(
        "/repo/apps/web/src/lib/sneaky.ts",
        "../../../api/src/lib/db",
      ),
    ).toBe("/repo/apps/api/src/lib/db");
  });

  it("returns null for bare specifiers", () => {
    expect(
      resolveRelativeImport("/repo/apps/web/src/a.ts", "@calibra-facil/api"),
    ).toBeNull();
  });
});
