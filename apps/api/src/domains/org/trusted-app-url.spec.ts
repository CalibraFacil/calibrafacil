import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_URL } from "@calibra-facil/config/origin-defaults";
import { resolveTrustedAppUrl } from "./trusted-app-url";

describe("resolveTrustedAppUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("takes APP_URL from the configuration, trimmed, without a trailing slash", () => {
    vi.stubEnv("APP_URL", " https://app.example.com// ");
    expect(resolveTrustedAppUrl()).toBe("https://app.example.com");
  });

  it("falls back to WEB_URL, then to the deployment default (the config package's one default)", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("WEB_URL", "https://web.example.com");
    expect(resolveTrustedAppUrl()).toBe("https://web.example.com");

    vi.stubEnv("WEB_URL", "");
    expect(resolveTrustedAppUrl()).toBe(DEFAULT_APP_URL);
  });
});
