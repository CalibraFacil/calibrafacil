// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPortalFleetAsset } from "@calibra-facil/contracts/portal-fixtures";
import { PortalOrgProvider } from "@/lib/portal-org-context";
import { useFleetAssets } from "./queries";

function pageOf(page: number, ids: Array<number>) {
  return {
    data: ids.map((id) => buildPortalFleetAsset({ id })),
    pagination: { page, limit: 20, total: 40, totalPages: 2 },
  };
}

type PendingRequest = { url: string; resolve: (response: Response) => void };

describe("useFleetAssets", () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;
  let pending: Array<PendingRequest>;
  // The wrapper re-renders on every `rerender`, so switching this value
  // switches the organization the way the sidebar switcher does.
  let activeOrganization: string;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PortalOrgProvider organizationId={activeOrganization}>
          {children}
        </PortalOrgProvider>
      </QueryClientProvider>
    );
  }

  function renderFleet(page: number) {
    return renderHook(
      ({ pageNumber }: { pageNumber: number }) =>
        useFleetAssets({
          page: pageNumber,
          limit: 20,
          sortBy: "tag",
          sortDir: "asc",
        }),
      { initialProps: { pageNumber: page }, wrapper: Wrapper },
    );
  }

  function answer(index: number, body: unknown) {
    pending[index]?.resolve(
      new Response(JSON.stringify(body), { status: 200 }),
    );
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    activeOrganization = "org-a";
    pending = [];
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      (url: unknown) =>
        new Promise<Response>((resolve) => {
          pending.push({ url: String(url), resolve });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("REQ-FE-LIST-010: keeps the previous page's rows while the next page loads", async () => {
    const { result, rerender } = renderFleet(1);
    await waitFor(() => expect(pending).toHaveLength(1));
    answer(0, pageOf(1, [1, 2]));
    await waitFor(() => expect(result.current.data?.data).toHaveLength(2));

    rerender({ pageNumber: 2 });
    await waitFor(() => expect(pending).toHaveLength(2));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.data.map((asset) => asset.id)).toEqual([1, 2]);

    answer(1, pageOf(2, [3]));
    await waitFor(() =>
      expect(result.current.data?.data.map((asset) => asset.id)).toEqual([3]),
    );
  });

  it("REQ-FE-LIST-011: drops the rows when the active organization changes", async () => {
    const { result, rerender } = renderFleet(1);
    await waitFor(() => expect(pending).toHaveLength(1));
    answer(0, pageOf(1, [1, 2]));
    await waitFor(() => expect(result.current.data?.data).toHaveLength(2));

    activeOrganization = "org-b";
    rerender({ pageNumber: 1 });
    await waitFor(() => expect(pending).toHaveLength(2));

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });
});
