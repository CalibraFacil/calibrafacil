// @vitest-environment jsdom

import { useSyncExternalStore } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny external store stands in for better-auth's active-organization atom
// and for the server-side session cookie (which decides which org the API
// answers for).
const orgs = [
  { id: "org-a", name: "Cliente A", slug: "a", type: "CLIENT" },
  { id: "org-b", name: "Cliente B", slug: "b", type: "CLIENT" },
];
const store = {
  activeId: "org-a",
  listeners: new Set<() => void>(),
  set(id: string) {
    store.activeId = id;
    for (const listener of store.listeners) listener();
  },
  subscribe(listener: () => void) {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  },
  get() {
    return store.activeId;
  },
};

vi.mock("@calibra-facil/auth/client", () => ({
  usePortalListOrganizations: () => ({ data: orgs, isPending: false }),
  usePortalActiveOrganization: () => {
    const id = useSyncExternalStore(store.subscribe, store.get);
    return { data: orgs.find((org) => org.id === id) };
  },
  portalOrganization: {
    setActive: vi.fn(async ({ organizationId }: { organizationId: string }) => {
      store.set(organizationId);
    }),
  },
}));

vi.mock("@/lib/runtime-env", () => ({
  getWebAppUrl: () => "http://localhost:5173",
}));

import { useOverview } from "@/features/dashboard/queries";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PortalOrgProvider } from "@/lib/portal-org-context";
import { PortalOrgSwitcher } from "./portal-org-switcher";

function Overview() {
  const { data } = useOverview();
  return (
    <p data-testid="overview">
      {data ? String(Reflect.get(data, "organizationName")) : "carregando"}
    </p>
  );
}

function Harness() {
  const activeId = useSyncExternalStore(store.subscribe, store.get);
  return (
    <PortalOrgProvider organizationId={activeId}>
      <SidebarProvider>
        <PortalOrgSwitcher />
        <Overview />
      </SidebarProvider>
    </PortalOrgProvider>
  );
}

type Deferred = { orgId: string; resolve: () => void };

describe("PortalOrgSwitcher cache isolation", () => {
  let queryClient: QueryClient;
  let overviewRequests: Array<string>;
  let deferred: Array<Deferred>;
  let holdFirstRequest: boolean;

  beforeEach(() => {
    store.activeId = "org-a";
    queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 5 * 60_000, retry: false } },
    });
    overviewRequests = [];
    deferred = [];
    holdFirstRequest = false;
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.endsWith("/api/portal/overview")) {
          return new Response("{}", { status: 404 });
        }
        // The API answers for whichever org the session cookie names *when
        // the request reaches it*.
        const orgId = store.activeId;
        overviewRequests.push(orgId);
        if (holdFirstRequest && overviewRequests.length === 1) {
          await new Promise<void>((resolve) => {
            deferred.push({ orgId, resolve });
          });
        }
        return new Response(
          JSON.stringify({ organizationName: `Painel ${orgId}` }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function switchTo(name: string) {
    fireEvent.click(screen.getByRole("button", { name: /Cliente A/ }));
    fireEvent.click(await screen.findByText(name));
  }

  function renderHarness() {
    return render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
  }

  it("fetches for the new organization and never renders the previous org's cached data", async () => {
    renderHarness();
    await waitFor(() =>
      expect(screen.getByTestId("overview").textContent).toBe("Painel org-a"),
    );
    expect(overviewRequests).toEqual(["org-a"]);

    // Record every value the overview slot shows from here on.
    const seen: Array<string> = [];
    const observer = new MutationObserver(() => {
      seen.push(screen.getByTestId("overview").textContent ?? "");
    });
    observer.observe(screen.getByTestId("overview"), {
      childList: true,
      characterData: true,
      subtree: true,
    });

    await switchTo("Cliente B");

    await waitFor(() =>
      expect(screen.getByTestId("overview").textContent).toBe("Painel org-b"),
    );
    observer.disconnect();

    expect(overviewRequests).toEqual(["org-a", "org-b"]);
    expect(seen).not.toContain("Painel org-a");
  });

  it("drops the previous org's queries from the cache on switch", async () => {
    renderHarness();
    await waitFor(() =>
      expect(screen.getByTestId("overview").textContent).toBe("Painel org-a"),
    );

    await switchTo("Cliente B");
    await waitFor(() =>
      expect(screen.getByTestId("overview").textContent).toBe("Painel org-b"),
    );

    const cachedOrgIds = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey[1]);
    expect(cachedOrgIds).not.toContain("org-a");
    expect(cachedOrgIds).toContain("org-b");
  });

  it("cancels an in-flight request of the previous org so it cannot land in the cache", async () => {
    holdFirstRequest = true;
    renderHarness();
    await waitFor(() => expect(deferred).toHaveLength(1));

    await switchTo("Cliente B");
    // The stale request finally answers after the switch.
    deferred[0]?.resolve();

    await waitFor(() =>
      expect(screen.getByTestId("overview").textContent).toBe("Painel org-b"),
    );
    const orgA = queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[1] === "org-a");
    expect(orgA).toEqual([]);
  });
});
