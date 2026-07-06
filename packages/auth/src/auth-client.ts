// oxlint-disable-next-line typescript/triple-slash-reference -- package-local Vite globals are provided by this declaration file.
/// <reference path="./vite-env.d.ts" />
import {
  adminClient,
  emailOTPClient,
  magicLinkClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { ssoClient } from "@better-auth/sso/client";
import { ac, platformAc, platformRoles, roles } from "./access";

function getApiBaseURL(): string {
  if (typeof window !== "undefined") {
    if (isDesktopRuntime()) {
      return (
        import.meta.env.VITE_DESKTOP_AUTH_API_URL ??
        "https://api.calibrafacil.com"
      );
    }

    if (import.meta.env.VITE_API_URL) {
      return import.meta.env.VITE_API_URL;
    }

    const host = window.location.hostname;
    if (host === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      return `http://${host}:3000`;
    }

    if (/^dev-(portal|web|api|ops)\.calibrafacil\.com$/.test(host)) {
      return window.location.origin;
    }

    return "https://api.calibrafacil.com";
  }

  // Fallback for local development
  return "http://localhost:3000";
}

function isDesktopRuntime() {
  return (
    typeof window !== "undefined" &&
    ((typeof window.calibraBridge === "object" &&
      window.calibraBridge != null) ||
      window.navigator.userAgent.includes("Electron"))
  );
}

async function desktopAuthFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (!isDesktopRuntime() || !window.calibraBridge?.authFetch) {
    return fetch(input, init);
  }

  const request = new Request(input, init);
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? null
      : await request.clone().text();
  const response = await window.calibraBridge.authFetch({
    url: request.url,
    method: request.method,
    headers: [...request.headers.entries()],
    body,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// Shared organization plugin config
const organizationPluginConfig = organizationClient({
  ac,
  roles,
  schema: {
    organization: {
      additionalFields: {
        type: {
          type: "string",
          defaultValue: "LAB",
          input: true,
        },
        // ISO 17025 / RBC compliance fields
        cnpj: { type: "string", input: true },
        accreditationNumber: { type: "string", input: true },
        accreditationBody: { type: "string", input: true },
        accreditationActive: {
          type: "boolean",
          input: true,
          required: false,
          defaultValue: false,
        },
        // #647: vigência window (nullable)
        accreditationValidFrom: { type: "date", input: true, required: false },
        accreditationValidUntil: { type: "date", input: true, required: false },
        street: { type: "string", input: true },
        number: { type: "string", input: true },
        complement: { type: "string", input: true },
        neighbourhood: { type: "string", input: true },
        city: { type: "string", input: true },
        state: { type: "string", input: true },
        cep: { type: "string", input: true },
        phone: { type: "string", input: true },
        email: { type: "string", input: true },
        website: { type: "string", input: true },
        technicalManagerName: { type: "string", input: true },
        technicalManagerTitle: { type: "string", input: true },
      },
    },
  },
});

/**
 * Lab Auth Client - for the main dashboard application (apps/web)
 * Connects to: /api/auth/lab/*
 */
export const labAuthClient = createBetterAuthClient({
  baseURL: getApiBaseURL(),
  basePath: "/api/auth/lab",
  fetchOptions: {
    credentials: "include",
    customFetchImpl: desktopAuthFetch,
  },
  sessionOptions: {
    refetchOnWindowFocus: false,
  },
  plugins: [
    passkeyClient(),
    magicLinkClient(),
    emailOTPClient(),
    adminClient({
      ac: platformAc,
      roles: platformRoles,
    }),
    organizationPluginConfig,
    ssoClient({ domainVerification: { enabled: true } }),
  ],
});

/**
 * Portal Auth Client - for the client portal application (apps/portal)
 * Connects to: /api/auth/portal/*
 */
export const portalAuthClient = createBetterAuthClient({
  baseURL: getApiBaseURL(),
  basePath: "/api/auth/portal",
  fetchOptions: {
    credentials: "include",
    customFetchImpl: desktopAuthFetch,
  },
  sessionOptions: {
    refetchOnWindowFocus: false,
  },
  plugins: [magicLinkClient(), organizationPluginConfig],
});

/**
 * Backoffice Auth Client - for the internal operations workspace (apps/web /backoffice)
 * Connects to: /api/auth/backoffice/*
 */
export const backofficeAuthClient = createBetterAuthClient({
  baseURL: getApiBaseURL(),
  basePath: "/api/auth/backoffice",
  fetchOptions: {
    credentials: "include",
    customFetchImpl: desktopAuthFetch,
  },
  // Parity with the lab/portal clients: don't refetch the session on every tab
  // refocus. Without this the backoffice fires /get-session on each refocus.
  sessionOptions: {
    refetchOnWindowFocus: false,
  },
  plugins: [
    // Mandatory two-factor for internal operators. The form reads
    // `data.twoFactorRedirect` from sign-in directly, so no redirect callback
    // is configured here; the plugin's session-signal listeners keep
    // `useBackofficeSession` in sync after enable/verify.
    twoFactorClient(),
    adminClient({
      ac: platformAc,
      roles: platformRoles,
    }),
  ],
});

// Keep the original 'authClient' export for backwards compatibility (uses lab auth)
export const authClient = labAuthClient;

// Lab auth exports (for apps/web)
export const {
  signIn,
  signUp,
  signOut,
  useSession,
  useListOrganizations,
  useActiveOrganization,
  organization,
  // Settings page methods
  updateUser,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  revokeSessions,
  deleteUser,
} = labAuthClient;

// Portal-specific exports (for apps/portal)
export const portalSignIn = portalAuthClient.signIn;
export const portalSignUp = portalAuthClient.signUp;
export const portalSignOut = portalAuthClient.signOut;
export const usePortalSession = portalAuthClient.useSession;
let inflightPortalSession: ReturnType<
  typeof portalAuthClient.getSession
> | null = null;
// Deduped one-off read so concurrent portal route guards share a single
// /get-session request instead of each firing their own.
export const getPortalSession = () => {
  inflightPortalSession ??= portalAuthClient.getSession().finally(() => {
    inflightPortalSession = null;
  });
  return inflightPortalSession;
};
export const usePortalListOrganizations = portalAuthClient.useListOrganizations;
export const usePortalActiveOrganization =
  portalAuthClient.useActiveOrganization;
export const portalOrganization = portalAuthClient.organization;
export const labAdmin = labAuthClient.admin;
export const labPasskey = labAuthClient.passkey;
export const labEmailOtp = labAuthClient.emailOtp;

// Backoffice-specific exports (for apps/web /backoffice)
export const backofficeSignIn = backofficeAuthClient.signIn;
export const backofficeSignOut = backofficeAuthClient.signOut;
export const useBackofficeSession = backofficeAuthClient.useSession;
// SEC-09 (#669): the lab surface is passwordless — password/reset methods are
// no longer exposed from labAuthClient. The backoffice operations surface
// keeps password + mandatory TOTP, so its own password-reset request/consume
// methods live here. The shared `apps/web/src/routes/reset-password` page
// (linked from the backoffice sign-in form) binds to these, not to the lab
// client.
export const requestBackofficePasswordReset =
  backofficeAuthClient.requestPasswordReset;
export const resetBackofficePassword = backofficeAuthClient.resetPassword;
let inflightBackofficeSession: ReturnType<
  typeof backofficeAuthClient.getSession
> | null = null;
// Deduped one-off read so concurrent backoffice route guards share a single
// /get-session request instead of each firing their own.
export const getBackofficeSession = () => {
  inflightBackofficeSession ??= backofficeAuthClient
    .getSession()
    .finally(() => {
      inflightBackofficeSession = null;
    });
  return inflightBackofficeSession;
};
export const backofficeAdmin = backofficeAuthClient.admin;
export const backofficeTwoFactor = backofficeAuthClient.twoFactor;

// =============================================================================
// PERMISSION CHECKING UTILITIES
// =============================================================================

/**
 * Check if the current user has specific permissions.
 * Uses the active organization context.
 *
 * @example
 * const canApprove = await hasPermission({ calibration: ["approve"] });
 */
export async function hasPermission(
  permissions: Parameters<
    typeof authClient.organization.hasPermission
  >[0]["permissions"],
): Promise<boolean> {
  const result = await authClient.organization.hasPermission({
    permissions,
  });
  return result.data?.success ?? false;
}

/**
 * Synchronous permission check based on role.
 * Does not include dynamic roles from the server.
 *
 * @example
 * const canApprove = checkRolePermission("admin", { calibration: ["approve"] });
 */
export function checkRolePermission(
  role: Parameters<
    typeof authClient.organization.checkRolePermission
  >[0]["role"],
  permissions: NonNullable<
    Parameters<
      typeof authClient.organization.checkRolePermission
    >[0]["permissions"]
  >,
): boolean {
  return authClient.organization.checkRolePermission({
    role,
    permissions,
  });
}
