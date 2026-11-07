import { describe, expect, it } from "vitest";

import { sanitizeInternalRedirect } from "./internal-redirect";

const OPTIONS = {
  fallback: "/",
  allowedPrefixes: ["/", "/assets", "/requests"],
  blockedPrefixes: ["/sign-in"],
};

describe("sanitizeInternalRedirect", () => {
  it("keeps a path under an allowed prefix, with its query and hash", () => {
    expect(sanitizeInternalRedirect("/assets?page=2#top", OPTIONS)).toBe(
      "/assets?page=2#top",
    );
    expect(sanitizeInternalRedirect("/requests/10", OPTIONS)).toBe(
      "/requests/10",
    );
  });

  it("falls back for a missing value and for protocol-relative or foreign targets", () => {
    expect(sanitizeInternalRedirect(undefined, OPTIONS)).toBe("/");
    expect(sanitizeInternalRedirect("//evil.example/assets", OPTIONS)).toBe(
      "/",
    );
    expect(
      sanitizeInternalRedirect("https://evil.example/assets", OPTIONS),
    ).toBe("/");
  });

  it("falls back for a blocked or unlisted prefix", () => {
    const strict = { ...OPTIONS, allowedPrefixes: ["/assets", "/sign-in"] };
    expect(sanitizeInternalRedirect("/sign-in?x=1", strict)).toBe("/");
    expect(sanitizeInternalRedirect("/other", strict)).toBe("/");
    expect(sanitizeInternalRedirect("/assets-extra", strict)).toBe("/");
  });

  it("uses the options' own fallback", () => {
    expect(
      sanitizeInternalRedirect("/x", {
        fallback: "/dashboard",
        allowedPrefixes: ["/dashboard"],
      }),
    ).toBe("/dashboard");
  });
});
