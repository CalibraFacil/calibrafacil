import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveApiBaseUrl } from "./api-base-url";

describe("resolveApiBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers the configured URL", () => {
    vi.stubGlobal("location", { origin: "https://app.example" });
    expect(
      resolveApiBaseUrl({
        configuredUrl: "https://api.example",
        fallbackUrl: "http://localhost:3000",
      }),
    ).toBe("https://api.example");
  });

  it("reaches the API on the page's own origin when nothing is configured", () => {
    vi.stubGlobal("location", { origin: "https://app.example" });
    expect(
      resolveApiBaseUrl({
        configuredUrl: undefined,
        fallbackUrl: "http://localhost:3000",
      }),
    ).toBe("https://app.example");
  });

  it("uses the fallback where there is no page", () => {
    expect(
      resolveApiBaseUrl({
        configuredUrl: "",
        fallbackUrl: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000");
  });
});
