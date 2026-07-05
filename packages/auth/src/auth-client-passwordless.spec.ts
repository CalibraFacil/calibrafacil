// SEC-09 (#669) rework: the lab surface is passwordless (REQ-PWDLESS-001), so
// its client no longer exposes password-reset methods. Backoffice keeps
// password + mandatory TOTP (REQ-PWDLESS-003), so its client is the one bound
// to the `apps/web/src/routes/reset-password` page (the only wired operator
// reset entry point, per `apps/backoffice`'s sign-in form).
//
// Better Auth's client actions are resolved through a dynamic path Proxy
// (`dist/client/proxy.mjs`): calling `client.requestPasswordReset(...)`
// derives the HTTP path from the accessed property chain and performs a real
// fetch against `<baseURL><basePath>/request-password-reset`. So the most
// direct, non-tautological proof that `requestBackofficePasswordReset` /
// `resetBackofficePassword` are bound to the BACKOFFICE surface (not the lab
// one) is to invoke them for real and inspect the outgoing request URL.
import { beforeAll, describe, expect, it } from "vitest";

let authClientModule: typeof import("./auth-client");
let fetchCalls: Array<string> = [];

beforeAll(async () => {
  // Stub fetch BEFORE importing the module: better-auth's react client issues
  // an automatic session-hydration request on construction, and the stub must
  // be in place before that happens, not just before this file's own calls.
  const fetchStub: typeof fetch = async (input) => {
    fetchCalls.push(String(input));
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
    // The reset-password page can only import names that exist on this
    // module; these three no longer exist at all (they used to be destructured
    // from labAuthClient), so a stale re-introduction of a lab-bound password
    // flow would fail at compile time, not just at runtime.
    expect("requestPasswordReset" in authClientModule).toBe(false);
    expect("resetPassword" in authClientModule).toBe(false);
    expect("changePassword" in authClientModule).toBe(false);
  });

  it("REQ-PWDLESS-003: requestBackofficePasswordReset issues a real request against the BACKOFFICE basePath, never the lab one", async () => {
    fetchCalls = [];

    await authClientModule.requestBackofficePasswordReset({
      email: "operador@calibrafacil.com",
      redirectTo: "http://localhost:5173/reset-password",
    });

    expect(fetchCalls.some((url) => url.includes("/api/auth/backoffice/"))).toBe(
      true,
    );
    expect(fetchCalls.some((url) => url.includes("/api/auth/lab/"))).toBe(
      false,
    );
  });

  it("REQ-PWDLESS-003: resetBackofficePassword issues a real request against the BACKOFFICE basePath, never the lab one", async () => {
    fetchCalls = [];

    await authClientModule.resetBackofficePassword({
      token: "reset-token-123",
      newPassword: "nova-senha-forte-123",
    });

    expect(fetchCalls.some((url) => url.includes("/api/auth/backoffice/"))).toBe(
      true,
    );
    expect(fetchCalls.some((url) => url.includes("/api/auth/lab/"))).toBe(
      false,
    );
  });
});
