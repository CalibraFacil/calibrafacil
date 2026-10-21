// @vitest-environment jsdom

import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { loadPortalStartup, parsePortalSession } from "./portal-startup";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ORG_A = {
  id: "org-a",
  name: "Cliente A",
  slug: "a",
  logo: null,
  type: "CLIENT",
  createdAt: "2026-01-01T00:00:00.000Z",
  memberRole: "CLIENT_ADMIN",
};
const ORG_B = { ...ORG_A, id: "org-b", name: "Cliente B", slug: "b" };

function sessionFor(userId: string, activeOrganizationId: string | null) {
  return {
    user: { id: userId, name: "Ana" },
    session: { id: `s-${userId}`, activeOrganizationId },
  };
}

type Session = ReturnType<typeof sessionFor>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("portal startup", () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;
  let sessionRead: Deferred<{ data: Session | null }>;
  let organizationsRead: Deferred<Response>;
  let brandingRead: Deferred<Response>;
  let readSession: Mock<() => Promise<{ data: Session | null }>>;
  let setActiveOrganization: Mock<(organizationId: string) => Promise<unknown>>;

  function requestedUrls() {
    return fetchMock.mock.calls.map(([url]) => String(url));
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    sessionRead = deferred();
    organizationsRead = deferred();
    brandingRead = deferred();
    readSession = vi.fn(() => sessionRead.promise);
    setActiveOrganization = vi.fn(async () => undefined);
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: unknown) => {
      const target = String(url);
      if (target.includes("/api/portal/organizations")) {
        return organizationsRead.promise;
      }
      if (target.includes("/api/portal/branding")) return brandingRead.promise;
      return Promise.reject(new Error(`unexpected request ${target}`));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function start(storage = memoryStorage()) {
    return loadPortalStartup({
      queryClient,
      readSession,
      setActiveOrganization,
      storage,
    });
  }

  it("REQ-PORTAL-START-001: session, organizations and branding are requested concurrently", async () => {
    const result = start();

    // Nothing has resolved yet: every request must already be in flight.
    expect(readSession).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      const urls = requestedUrls();
      expect(
        urls.some((url) => url.includes("/api/portal/organizations")),
      ).toBe(true);
      expect(urls.some((url) => url.includes("/api/portal/branding"))).toBe(
        true,
      );
    });
    expect(setActiveOrganization).not.toHaveBeenCalled();

    // Resolve out of order: organizations first, session last, branding never
    // blocks the result.
    organizationsRead.resolve(jsonResponse([ORG_A, ORG_B]));
    sessionRead.resolve({ data: sessionFor("u1", "org-a") });

    const startup = await result;
    expect(startup.status).toBe("ready");
    if (startup.status !== "ready") return;
    expect(startup.organizationId).toBe("org-a");
    expect(startup.organizations.map((org) => org.id)).toEqual([
      "org-a",
      "org-b",
    ]);
  });

  it("REQ-PORTAL-START-002: when the session already points at the target organization no extra request is made", async () => {
    const result = start();
    organizationsRead.resolve(jsonResponse([ORG_A, ORG_B]));
    sessionRead.resolve({ data: sessionFor("u1", "org-a") });
    await result;

    expect(setActiveOrganization).not.toHaveBeenCalled();
    expect(requestedUrls()).toHaveLength(2);
  });

  it("REQ-PORTAL-START-003: a mismatched active organization is switched exactly once, after session and organizations settle", async () => {
    const storage = memoryStorage();
    const switched = deferred<undefined>();
    setActiveOrganization.mockImplementation(() => switched.promise);

    const result = start(storage);
    organizationsRead.resolve(jsonResponse([ORG_A, ORG_B]));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Session still pending: switching would be a guess.
    expect(setActiveOrganization).not.toHaveBeenCalled();

    // The session names no active organization, so the first client org wins.
    sessionRead.resolve({ data: sessionFor("u1", null) });
    await vi.waitFor(() =>
      expect(setActiveOrganization).toHaveBeenCalledWith("org-a"),
    );
    expect(setActiveOrganization).toHaveBeenCalledTimes(1);

    switched.resolve(undefined);
    const startup = await result;
    expect(startup.status === "ready" && startup.organizationId).toBe("org-a");
    expect(storage.getItem("portal-active-org")).toBe("org-a");
  });

  it("REQ-PORTAL-START-004: the stored organization preference wins over the session's active one", async () => {
    const result = start(memoryStorage({ "portal-active-org": "org-b" }));
    organizationsRead.resolve(jsonResponse([ORG_A, ORG_B]));
    sessionRead.resolve({ data: sessionFor("u1", "org-a") });

    const startup = await result;
    expect(setActiveOrganization).toHaveBeenCalledWith("org-b");
    expect(startup.status === "ready" && startup.organizationId).toBe("org-b");
  });

  it("REQ-PORTAL-START-005: a signed-out visitor is reported as signed-out without switching organizations", async () => {
    const result = start();
    organizationsRead.resolve(jsonResponse({ error: "unauthorized" }, 401));
    sessionRead.resolve({ data: null });

    const startup = await result;
    expect(startup.status).toBe("signed-out");
    expect(setActiveOrganization).not.toHaveBeenCalled();
  });

  it("REQ-PORTAL-START-006: an organizations failure for a signed-in user surfaces instead of rendering the wrong org", async () => {
    const result = start();
    organizationsRead.resolve(jsonResponse({ error: "boom" }, 500));
    sessionRead.resolve({ data: sessionFor("u1", "org-a") });

    await expect(result).rejects.toThrow();
    expect(setActiveOrganization).not.toHaveBeenCalled();
  });

  it("REQ-PORTAL-START-007: a different user signing in never sees the previous user's cached organizations", async () => {
    const first = start();
    organizationsRead.resolve(jsonResponse([ORG_A]));
    sessionRead.resolve({ data: sessionFor("u1", "org-a") });
    await first;

    // Second user, same SPA session (no reload): fresh deferreds.
    sessionRead = deferred();
    organizationsRead = deferred();
    brandingRead = deferred();
    const second = start();
    sessionRead.resolve({ data: sessionFor("u2", "org-b") });
    await vi.waitFor(() =>
      expect(
        requestedUrls().filter((url) =>
          url.includes("/api/portal/organizations"),
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
    organizationsRead.resolve(jsonResponse([ORG_B]));

    const startup = await second;
    expect(startup.status === "ready" && startup.organizations).toEqual([
      ORG_B,
    ]);
  });
});

describe("portal session parsing", () => {
  it("REQ-PORTAL-START-008: accepts a Better Auth session and rejects anything that is not one", () => {
    expect(parsePortalSession(sessionFor("u1", "org-a"))?.user.id).toBe("u1");
    expect(parsePortalSession({ user: { id: "u1" } })?.user.id).toBe("u1");
    expect(parsePortalSession(null)).toBeNull();
    expect(parsePortalSession({ user: { id: 7 } })).toBeNull();
    expect(parsePortalSession({})).toBeNull();
  });
});
