import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { createPortalKeys } from "./portal-keys";
import { portalQueryKey } from "./portal-query-keys";

const orgA = createPortalKeys((...parts) => portalQueryKey("org-a", ...parts));
const orgB = createPortalKeys((...parts) => portalQueryKey("org-b", ...parts));

function startsWith(
  key: ReadonlyArray<unknown>,
  prefix: ReadonlyArray<unknown>,
) {
  return prefix.every((part, index) => Object.is(key[index], part));
}

describe("createPortalKeys", () => {
  it("scopes every key to the active organization", () => {
    const sample = [
      orgA.overview,
      orgA.asset("a-1"),
      orgA.fleetAssetsPage({ page: 1 }),
      orgA.certificate("c-1"),
      orgA.serviceOrderFinancialSummary("so-1"),
      orgA.commandAssets("x"),
    ];
    for (const key of sample)
      expect(key.slice(0, 2)).toEqual(["portal", "org-a"]);
    expect(orgA.asset("a-1")).not.toEqual(orgB.asset("a-1"));
  });

  it("keeps each list and detail under the prefix its invalidations use", () => {
    expect(startsWith(orgA.asset("a-1"), orgA.assetDetails)).toBe(true);
    expect(startsWith(orgA.intervalInsight("a-1"), orgA.intervalInsights)).toBe(
      true,
    );
    expect(
      startsWith(orgA.fleetAssetsPage({ page: 2 }), orgA.fleetAssets),
    ).toBe(true);
    expect(
      startsWith(
        orgA.certificatesPage({
          page: 1,
          limit: 10,
          search: "",
          dateFrom: "",
          dateTo: "",
          assetId: undefined,
        }),
        orgA.certificates,
      ),
    ).toBe(true);
    expect(
      startsWith(
        orgA.requestsPage({ page: 1, limit: 10, search: "", statusFilter: "" }),
        orgA.requests,
      ),
    ).toBe(true);
    expect(
      startsWith(
        orgA.serviceOrdersPage({
          page: 1,
          limit: 10,
          search: "",
          statusFilter: "",
        }),
        orgA.serviceOrders,
      ),
    ).toBe(true);
    expect(startsWith(orgA.ootEventsByStatus("OPEN"), orgA.ootEvents)).toBe(
      true,
    );
  });

  it("invalidating a prefix marks the matching cached queries stale and no other organization's", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(orgA.asset("a-1"), "A");
    queryClient.setQueryData(orgB.asset("a-1"), "B");

    await queryClient.invalidateQueries({ queryKey: orgA.assetDetails });

    expect(queryClient.getQueryState(orgA.asset("a-1"))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(orgB.asset("a-1"))?.isInvalidated).toBe(
      false,
    );
  });
});
