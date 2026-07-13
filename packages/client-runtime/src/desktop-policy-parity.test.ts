import { describe, expect, it } from "vitest";

import { createDesktopApiClient, listCalibraApiPolicyEntries } from "./index";
import type { CalibraApi } from "./index";
import { composeDesktopHybridApi } from "./transport/desktop-client";

/**
 * These specs pin the guarantee the registry-driven composition exists to
 * provide: `calibraApiPolicyRegistry` is the single source of truth for
 * "where does this method run on desktop", and both the pure desktop adapter
 * and the hybrid client agree with it for every method.
 */

function invokeApiMethod(
  api: CalibraApi,
  namespace: string,
  method: string,
): Promise<unknown> {
  const namespaceObject: unknown = Reflect.get(api, namespace);
  const candidate: unknown =
    namespaceObject !== null && typeof namespaceObject === "object"
      ? Reflect.get(namespaceObject, method)
      : undefined;

  if (typeof candidate !== "function") {
    throw new Error(`Missing API method ${namespace}.${method}`);
  }

  const result: unknown = candidate();
  return Promise.resolve(result);
}

function hasApiMethod(
  api: CalibraApi,
  namespace: string,
  method: string,
): boolean {
  const namespaceObject: unknown = Reflect.get(api, namespace);
  if (namespaceObject === null || typeof namespaceObject !== "object") {
    return false;
  }

  return typeof Reflect.get(namespaceObject, method) === "function";
}

type FakeApiOptions = {
  bootstrappedLocalCache?: boolean;
};

function buildFakeCalibraApi(tag: string, options: FakeApiOptions = {}) {
  const api: Record<string, Record<string, unknown>> = {};

  for (const entry of listCalibraApiPolicyEntries()) {
    const namespace = (api[entry.namespace] ??= {});
    namespace[entry.method] = async () =>
      `${tag}:${entry.namespace}.${entry.method}`;
  }

  if (options.bootstrappedLocalCache) {
    const sync = (api["sync"] ??= {});
    sync["getSession"] = async () => ({
      data: { syncCursor: "cursor-1" },
    });
  }

  const fake: unknown = api;
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the fake is built from the policy registry, which is type-total over every CalibraApi method the composition can touch; nested backoffice sub-objects are irrelevant to routing.
  return fake as CalibraApi;
}

describe("desktop policy parity", () => {
  it("implements every registry method on the pure desktop adapter", () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    const missing = listCalibraApiPolicyEntries()
      .filter((entry) => !hasApiMethod(client, entry.namespace, entry.method))
      .map((entry) => `${entry.namespace}.${entry.method}`);

    expect(missing).toEqual([]);
  });

  it("keeps the generated cloud-only stub messages verbatim", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(client.finance.getOverview()).rejects.toThrow(
      "Financeiro requer a API web/nuvem neste momento.",
    );
    await expect(invokeApiMethod(client, "jobs", "approve")).rejects.toThrow(
      "Aprovação de job requer a API web/nuvem neste momento.",
    );
    await expect(
      invokeApiMethod(client, "serviceOrders", "deliver"),
    ).rejects.toThrow(
      "Registro de entrega requer a API web/nuvem neste momento.",
    );
    await expect(invokeApiMethod(client, "sso", "start")).rejects.toThrow(
      "Login SSO requer a API web/nuvem neste momento.",
    );
    await expect(client.profileMedia.uploadAvatar(new Blob())).rejects.toThrow(
      "Avatar requer sincronização com a nuvem neste momento.",
    );
    await expect(
      invokeApiMethod(client, "signingCertificates", "setPolicy"),
    ).rejects.toThrow(
      "Política de assinatura requer sincronização com a nuvem neste momento.",
    );
    await expect(client.backoffice.stopImpersonation()).rejects.toThrow(
      "Impersonação backoffice requer a API web/nuvem neste momento.",
    );
  });

  it("routes every method per its registry policy in the hybrid client", async () => {
    const cloud = buildFakeCalibraApi("cloud");
    const local = buildFakeCalibraApi("local", {
      bootstrappedLocalCache: true,
    });
    const hybrid = composeDesktopHybridApi(cloud, local, () => {});

    for (const entry of listCalibraApiPolicyEntries()) {
      if (entry.namespace === "sync" && entry.method === "getSession") {
        // Replaced by the bootstrap fixture above; covered by policy anyway.
        continue;
      }

      const result = await invokeApiMethod(
        hybrid,
        entry.namespace,
        entry.method,
      );
      const qualified = `${entry.namespace}.${entry.method}`;

      switch (entry.policy) {
        case "local-command-sync":
        case "local-only":
        case "local-first-read-through-sync":
          // Read-through methods hit the local adapter once the local cache
          // has bootstrapped (the fixture above bootstraps it).
          expect(result, qualified).toBe(`local:${qualified}`);
          break;
        case "cloud-only":
        case "cloud-first-read-fallback":
          expect(result, qualified).toBe(`cloud:${qualified}`);
          break;
      }
    }
  });

  it("falls back to the cloud for read-through methods before local bootstrap", async () => {
    const cloud = buildFakeCalibraApi("cloud");
    const local = buildFakeCalibraApi("local");
    const hybrid = composeDesktopHybridApi(cloud, local, () => {});

    await expect(hybrid.dashboard.getStats()).resolves.toBe(
      "cloud:dashboard.getStats",
    );
    await expect(invokeApiMethod(hybrid, "customers", "list")).resolves.toBe(
      "cloud:customers.list",
    );
  });

  it("requests a background sync after serving a read-through from the local cache", async () => {
    const cloud = buildFakeCalibraApi("cloud");
    const local = buildFakeCalibraApi("local", {
      bootstrappedLocalCache: true,
    });
    let backgroundSyncRequests = 0;
    const hybrid = composeDesktopHybridApi(cloud, local, () => {
      backgroundSyncRequests += 1;
    });

    await expect(hybrid.standards.list({})).resolves.toBe(
      "local:standards.list",
    );
    expect(backgroundSyncRequests).toBe(1);
  });
});
