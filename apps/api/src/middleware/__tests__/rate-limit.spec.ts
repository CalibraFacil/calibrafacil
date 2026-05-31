import { describe, expect, it } from "vitest";

import { isBetterAuthSessionLookupPath } from "../rate-limit";

describe("rate limit helpers", () => {
  it("recognizes Better Auth session lookups", () => {
    expect(isBetterAuthSessionLookupPath("/api/auth/lab/get-session")).toBe(
      true,
    );
    expect(
      isBetterAuthSessionLookupPath("/api/auth/backoffice/get-session"),
    ).toBe(true);
    expect(isBetterAuthSessionLookupPath("/api/auth/portal/get-session")).toBe(
      true,
    );
  });

  it("does not skip mutation auth endpoints", () => {
    expect(isBetterAuthSessionLookupPath("/api/auth/lab/sign-in/email")).toBe(
      false,
    );
    expect(
      isBetterAuthSessionLookupPath("/api/auth/lab/admin/impersonate-user"),
    ).toBe(false);
  });
});
