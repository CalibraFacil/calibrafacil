import type { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthVariables } from "../permission";

const labHasPermission = vi.fn();
const portalHasPermission = vi.fn();

vi.mock("@calibra-facil/auth", () => ({
  createLabAuth: () => ({
    api: {
      hasPermission: labHasPermission,
    },
  }),
  createPortalAuth: () => ({
    api: {
      hasPermission: portalHasPermission,
    },
  }),
}));

function createMockContext(
  authSource?: "lab" | "portal",
): Context<{ Variables: AuthVariables }> {
  const store = new Map<string, unknown>();
  if (authSource) {
    store.set("authSource", authSource);
  }

  const context: unknown = {
    req: {
      raw: {
        headers: new Headers(),
      },
    },
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => {
      store.set(key, value);
    },
  };

  // oxlint-disable-next-line typescript/consistent-type-assertions -- Hono middleware tests only need this minimal Context surface.
  return context as Context<{ Variables: AuthVariables }>;
}

describe("requirePermission auth source isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses only lab auth when auth source is lab", async () => {
    const { requirePermission } = await import("../permission");
    const middleware = requirePermission({ client: ["read"] });

    labHasPermission.mockResolvedValue({ success: false });
    portalHasPermission.mockResolvedValue({ success: true });

    const next = vi.fn();

    await expect(
      middleware(createMockContext("lab"), next),
    ).rejects.toMatchObject({
      status: 403,
    });

    expect(labHasPermission).toHaveBeenCalledTimes(1);
    expect(portalHasPermission).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  }, 15_000);

  it("uses only portal auth when auth source is portal", async () => {
    const { requirePermission } = await import("../permission");
    const middleware = requirePermission({ equipment: ["read"] });

    portalHasPermission.mockResolvedValue({ success: true });

    const next = vi.fn();
    await middleware(createMockContext("portal"), next);

    expect(portalHasPermission).toHaveBeenCalledTimes(1);
    expect(labHasPermission).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("falls back to lab auth when auth source is missing", async () => {
    const { requirePermission } = await import("../permission");
    const middleware = requirePermission({ client: ["read"] });

    labHasPermission.mockResolvedValue({ success: true });

    const next = vi.fn();
    await middleware(createMockContext(undefined), next);

    expect(labHasPermission).toHaveBeenCalledTimes(1);
    expect(portalHasPermission).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  }, 15_000);
});
