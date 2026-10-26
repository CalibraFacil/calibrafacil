import { describe, expect, it } from "vitest";
import {
  isAllowedAuthRoute,
  listAllowedAuthRoutes,
} from "./auth-route-allowlist";

describe("Better Auth route allowlist (P0-1)", () => {
  it("allows what the lab app calls", () => {
    for (const [method, path] of [
      ["GET", "/get-session"],
      ["POST", "/sign-out"],
      ["POST", "/sign-in/magic-link"],
      ["GET", "/magic-link/verify"],
      ["POST", "/sign-in/email-otp"],
      ["POST", "/email-otp/send-verification-otp"],
      ["GET", "/passkey/generate-authenticate-options"],
      ["POST", "/passkey/verify-authentication"],
      ["GET", "/passkey/generate-register-options"],
      ["POST", "/passkey/verify-registration"],
      ["GET", "/passkey/list-user-passkeys"],
      ["POST", "/organization/set-active"],
      ["GET", "/organization/list"],
      ["GET", "/organization/get-full-organization"],
      ["POST", "/organization/update"],
      ["POST", "/organization/invite-member"],
      ["GET", "/sso/callback/acme-oidc"],
    ] as const) {
      expect(isAllowedAuthRoute("lab", method, path), `${method} ${path}`).toBe(
        true,
      );
    }
  });

  it("allows what the portal calls and nothing of the lab-only surface", () => {
    for (const [method, path] of [
      ["GET", "/get-session"],
      ["POST", "/sign-out"],
      ["POST", "/sign-in/magic-link"],
      ["GET", "/magic-link/verify"],
      ["GET", "/organization/list"],
      ["POST", "/organization/set-active"],
      ["POST", "/organization/accept-invitation"],
      ["POST", "/update-user"],
    ] as const) {
      expect(
        isAllowedAuthRoute("portal", method, path),
        `${method} ${path}`,
      ).toBe(true);
    }
    for (const [method, path] of [
      ["POST", "/sign-in/email-otp"],
      ["GET", "/passkey/list-user-passkeys"],
      ["POST", "/organization/invite-member"],
      ["POST", "/organization/update"],
      ["POST", "/organization/remove-member"],
      ["GET", "/organization/list-members"],
      ["GET", "/sso/callback/acme-oidc"],
      ["GET", "/list-sessions"],
    ] as const) {
      expect(
        isAllowedAuthRoute("portal", method, path),
        `${method} ${path}`,
      ).toBe(false);
    }
  });

  it("denies the endpoints no surface calls, on both surfaces", () => {
    const denied: Array<[string, string]> = [
      ["POST", "/organization/create"],
      ["POST", "/organization/delete"],
      ["POST", "/organization/update-member-role"],
      ["POST", "/organization/leave"],
      ["POST", "/organization/check-slug"],
      ["POST", "/organization/has-permission"],
      ["GET", "/organization/get-invitation"],
      ["GET", "/organization/list-user-invitations"],
      ["GET", "/admin/list-users"],
      ["GET", "/admin/get-user"],
      ["POST", "/admin/set-role"],
      ["POST", "/admin/create-user"],
      ["POST", "/admin/impersonate-user"],
      ["POST", "/admin/ban-user"],
      ["POST", "/sso/register"],
      ["POST", "/sso/update-provider"],
      ["POST", "/sso/delete-provider"],
      ["GET", "/sso/providers"],
      ["POST", "/sign-in/sso"],
      ["GET", "/sso/saml2/sp/metadata"],
      ["POST", "/sso/saml2/sp/acs/acme"],
      ["POST", "/sign-in/email"],
      ["POST", "/sign-up/email"],
      ["POST", "/sign-in/social"],
      ["POST", "/link-social"],
      ["POST", "/unlink-account"],
      ["GET", "/list-accounts"],
      ["POST", "/delete-user"],
      ["POST", "/change-email"],
      ["POST", "/change-password"],
      ["POST", "/request-password-reset"],
      ["POST", "/reset-password"],
      ["POST", "/revoke-session"],
      ["POST", "/get-access-token"],
      ["POST", "/passkey/delete-passkey-x"],
    ];
    for (const surface of ["lab", "portal"] as const) {
      for (const [method, path] of denied) {
        expect(
          isAllowedAuthRoute(surface, method, path),
          `${surface} ${method} ${path}`,
        ).toBe(false);
      }
    }
  });

  it("matches exactly: method, trailing slash, case, encoding, extra segments and the empty path", () => {
    for (const [method, path] of [
      ["POST", "/get-session/"],
      ["GET", "/Get-Session"],
      ["GET", "//get-session"],
      ["GET", "/organization%2Fcreate"],
      ["GET", "/get-session/extra"],
      ["GET", "/sso/callback"],
      ["GET", "/sso/callback/"],
      ["GET", "/sso/callback/a/b"],
      ["GET", "/sso/callback/acme%2Fx"],
      ["GET", "/sso/callback/.."],
      ["GET", ""],
      ["GET", "/"],
      ["PUT", "/get-session"],
      ["DELETE", "/sign-out"],
      ["GET", "/sign-out"],
      ["POST", "/passkey/list-user-passkeys"],
    ] as const) {
      expect(
        isAllowedAuthRoute("lab", method, path),
        `${method} ${JSON.stringify(path)}`,
      ).toBe(false);
    }
  });

  it("lists every allowed route once per surface", () => {
    for (const surface of ["lab", "portal"] as const) {
      const routes = listAllowedAuthRoutes(surface);
      expect(new Set(routes).size).toBe(routes.length);
    }
    // The portal is a strict subset of the lab surface.
    const lab = new Set(listAllowedAuthRoutes("lab"));
    for (const route of listAllowedAuthRoutes("portal")) {
      expect(lab.has(route), route).toBe(true);
    }
  });
});
