// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PORTAL_ORG_KEY } from "@calibra-facil/shared/client-storage-keys";

import { portalQueryKey } from "./portal-query-keys";
import { watchOtherTabOrganization } from "./portal-org-sync";

/** What the browser does in a tab that did NOT write the key. */
function otherTabWrites(key: string, newValue: string | null) {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
}

describe("watchOtherTabOrganization", () => {
  let queryClient: QueryClient;
  let stop: () => void;
  const setActive = vi.fn();
  const keyA = portalQueryKey("org-a", "assets");
  const keyB = portalQueryKey("org-b", "assets");

  beforeEach(() => {
    setActive.mockReset();
    setActive.mockResolvedValue({ data: {}, error: null });
    queryClient = new QueryClient();
    queryClient.setQueryData(keyA, ["asset of A"]);
    queryClient.setQueryData(keyB, ["asset of B"]);
    stop = watchOtherTabOrganization(queryClient, setActive);
  });

  afterEach(() => stop());

  it("refreshes the session atom and drops the other organizations' entries when another tab switches", async () => {
    otherTabWrites(PORTAL_ORG_KEY, "org-b");

    await vi.waitFor(() =>
      expect(queryClient.getQueryData(keyA)).toBeUndefined(),
    );
    expect(setActive).toHaveBeenCalledWith({ organizationId: "org-b" });
    expect(queryClient.getQueryData(keyB)).toEqual(["asset of B"]);
  });

  it("still drops the stale entries when setActive throws", async () => {
    setActive.mockRejectedValue(new Error("offline"));
    otherTabWrites(PORTAL_ORG_KEY, "org-b");

    await vi.waitFor(() =>
      expect(queryClient.getQueryData(keyA)).toBeUndefined(),
    );
  });

  it("ignores unrelated keys and removals", async () => {
    otherTabWrites("theme", "dark");
    otherTabWrites(PORTAL_ORG_KEY, null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setActive).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(keyA)).toEqual(["asset of A"]);
  });

  it("stops listening once unsubscribed", async () => {
    stop();
    otherTabWrites(PORTAL_ORG_KEY, "org-b");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setActive).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(keyA)).toEqual(["asset of A"]);
  });
});
