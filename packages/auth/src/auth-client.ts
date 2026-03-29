/// <reference path="./vite-env.d.ts" />
import { adminClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { ssoClient } from "@better-auth/sso/client";
import { ac, platformAc, platformRoles, roles } from "./access";

function getApiBaseURL(): string {
  // Primary source of truth (Cloudflare Pages, Vite)
  if (typeof window !== "undefined" && import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // Fallback for local development
  return "https://localhost:3000";
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
  },
  plugins: [
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
  },
  plugins: [organizationPluginConfig],
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
  },
  plugins: [
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
  changePassword,
  requestPasswordReset,
  resetPassword,
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
export const usePortalListOrganizations = portalAuthClient.useListOrganizations;
export const usePortalActiveOrganization =
  portalAuthClient.useActiveOrganization;
export const portalOrganization = portalAuthClient.organization;
export const labAdmin = labAuthClient.admin;

// Backoffice-specific exports (for apps/web /backoffice)
export const backofficeSignIn = backofficeAuthClient.signIn;
export const backofficeSignOut = backofficeAuthClient.signOut;
export const useBackofficeSession = backofficeAuthClient.useSession;
export const getBackofficeSession = () => backofficeAuthClient.getSession();
export const backofficeAdmin = backofficeAuthClient.admin;

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
  >[0]["permission"],
): Promise<boolean> {
  const result = await authClient.organization.hasPermission({
    permission: permissions,
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
