import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTrustedAppUrl } from "./trusted-app-url";

describe("resolveTrustedAppUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("takes APP_URL from the runtime bag, trimmed, without a trailing slash", () => {
    expect(
      resolveTrustedAppUrl({ env: { APP_URL: " https://app.example.com// " } }),
    ).toBe("https://app.example.com");
  });

  it("falls back to the process environment, then to WEB_URL", () => {
    vi.stubEnv("APP_URL", "https://from-process.example.com/");
    expect(resolveTrustedAppUrl({ env: {} })).toBe(
      "https://from-process.example.com",
    );

    vi.stubEnv("APP_URL", "");
    vi.stubEnv("WEB_URL", "https://web.example.com");
    expect(resolveTrustedAppUrl({ env: {} })).toBe("https://web.example.com");
    expect(resolveTrustedAppUrl({ env: { APP_URL: "   " } })).toBe(
      "https://web.example.com",
    );
  });

  it("uses the deployment default when nothing is configured, and never the request", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("WEB_URL", "");
    const resolved = resolveTrustedAppUrl({
      env: { Origin: "https://attacker.example", Referer: "https://evil.test" },
    });
    expect(resolved).not.toContain("attacker");
    expect(resolved).not.toContain("evil");
    expect(resolved.length).toBeGreaterThan(0);
  });
});
