import { afterEach, describe, expect, it, vi } from "vitest";
import { organizationInvitationLink, resolveWebBaseUrl } from "./app-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("organizationInvitationLink", () => {
  it("uses WEB_URL when the deployment sets only that (never localhost)", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("WEB_URL", "https://lab.example.com/");

    expect(organizationInvitationLink("inv-1", true)).toBe(
      "https://lab.example.com/accept-invitation/inv-1",
    );
  });

  it("prefers APP_URL over WEB_URL and drops trailing slashes", () => {
    vi.stubEnv("APP_URL", "https://app.example.com//");
    vi.stubEnv("WEB_URL", "https://web.example.com");

    expect(organizationInvitationLink("inv-2", false)).toBe(
      "https://app.example.com/accept-invitation/inv-2",
    );
  });

  it("falls back to localhost only outside production", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("WEB_URL", "");

    expect(resolveWebBaseUrl(false)).toBe("http://localhost:5173");
    expect(() => resolveWebBaseUrl(true)).toThrow("APP_URL");
  });
});
