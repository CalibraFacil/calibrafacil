// oxlint-disable-next-line typescript/triple-slash-reference -- package-local Vite globals are provided by this declaration file.
/// <reference path="./vite-env.d.ts" />
import {
  adminClient,
  emailOTPClient,
  magicLinkClient,
  organizationClient,
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
        import.meta.env.VITE_API_URL ??
        "http://localhost:3000"
      );
    }

    if (import.meta.env.VITE_API_URL) {
      return import.meta.env.VITE_API_URL;
    }

    // Without VITE_API_URL the API is reached on the same origin: the Vite dev
    // server proxies /api to DEV_API_ORIGIN (http://localhost:3000 by default),
    // and deployments put a reverse proxy in front of both.
    return window.location.origin;
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
        // #647: vigência window (nullable). "string" (ISO) to mirror the
        // server plugin — Better Auth rejects `type: "date"` fields on JSON
        // bodies (z.date() vs. the serialized string), see auth.ts.
        accreditationValidFrom: {
          type: "string",
          input: true,
          required: false,
        },
        accreditationValidUntil: {
          type: "string",
          input: true,
          required: false,
        },
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
