import { describe, expect, it } from "vitest";

import {
  appBaseUrl,
  certificateVerificationUrl,
  portalBaseUrl,
  storedObjectUrl,
  verifyBaseUrl,
} from "./public-urls";

describe("public URLs", () => {
  it("falls back to the local development stack", () => {
    expect(appBaseUrl({})).toBe("http://localhost:5173");
    expect(portalBaseUrl({})).toBe("http://localhost:5174");
    expect(verifyBaseUrl({})).toBe("http://localhost:5174");
  });

  it("uses the configured deployment, without trailing slashes", () => {
    const env = {
      APP_URL: "https://lab.example.com/",
      PORTAL_APP_URL: "https://portal.example.com/",
    };
    expect(appBaseUrl(env)).toBe("https://lab.example.com");
    expect(portalBaseUrl(env)).toBe("https://portal.example.com");
    expect(certificateVerificationUrl("tok-1", env)).toBe(
      "https://portal.example.com/v/tok-1",
    );
  });

  it("lets VERIFY_URL move verification to its own host", () => {
    expect(
      certificateVerificationUrl("tok-2", {
        PORTAL_APP_URL: "https://portal.example.com",
        VERIFY_URL: "https://verify.example.com",
      }),
    ).toBe("https://verify.example.com/v/tok-2");
  });

  it("builds opaque stored-object references whose pathname is the key", () => {
    const url = storedObjectUrl("certificates/org-1/job-1.pdf");
    expect(new URL(url).pathname).toBe("/certificates/org-1/job-1.pdf");
  });
});
