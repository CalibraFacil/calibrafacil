import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { ac, roles } from "./access";

function getApiBaseURL(): string {
  if (typeof window === "undefined") {
    return "https://localhost:3000";
  }
  const host = window.location.hostname;
  // For network access (e.g., iPhone testing via IP)
  if (host !== "localhost") {
    return `https://${host}:3000`;
  }
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
          input: true, // Allow passing type when creating organizations
        },
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
  plugins: [organizationPluginConfig],
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
