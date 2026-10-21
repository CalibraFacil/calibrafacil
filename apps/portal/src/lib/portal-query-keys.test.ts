import { describe, expect, it } from "vitest";

import { portalQueryKey } from "./portal-query-keys";

describe("portalQueryKey", () => {
  it("prefixes every key with the active organization id", () => {
    expect(portalQueryKey("org-a", "portal-overview")).toEqual([
      "portal",
      "org-a",
      "portal-overview",
    ]);
    expect(portalQueryKey("org-a", "portal-assets", { page: 2 })).toEqual([
      "portal",
      "org-a",
      "portal-assets",
      { page: 2 },
    ]);
  });

  it("never produces the same key for two organizations", () => {
    expect(portalQueryKey("org-a", "portal-certificate", "7")).not.toEqual(
      portalQueryKey("org-b", "portal-certificate", "7"),
    );
  });

  it("keeps the portal prefix when there is no active organization yet", () => {
    const [root, org] = portalQueryKey(null, "portal-overview");
    expect(root).toBe("portal");
    expect(org).not.toBe("org-a");
  });
});
