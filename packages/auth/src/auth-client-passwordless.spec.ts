// SEC-09 (#669): the lab surface is passwordless (REQ-PWDLESS-001), so its
// client exposes no password-reset or password-change method at all.
import { beforeAll, describe, expect, it } from "vitest";

let authClientModule: typeof import("./auth-client");

beforeAll(async () => {
  // Stub fetch BEFORE importing the module: better-auth's react client issues
  // an automatic session-hydration request on construction, and the stub must
  // be in place before that happens, not just before this file's own calls.
  const fetchStub: typeof fetch = async () => {
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  globalThis.fetch = fetchStub;
  authClientModule = await import("./auth-client");
});

describe("SEC-09 password-reset client bindings", () => {
  it("REQ-PWDLESS-001: the lab client module no longer exposes any password-reset/change method", () => {
    // Callers can only import names that exist on this module; these three
    // no longer exist at all (they used to be destructured
    // from labAuthClient), so a stale re-introduction of a lab-bound password
    // flow would fail at compile time, not just at runtime.
    expect("requestPasswordReset" in authClientModule).toBe(false);
    expect("resetPassword" in authClientModule).toBe(false);
    expect("changePassword" in authClientModule).toBe(false);
  });
});
