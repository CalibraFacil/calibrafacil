import {
  organizationClient,
  multiSessionClient,
} from "better-auth/client/plugins";
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

export const authClient = createBetterAuthClient({
  baseURL: getApiBaseURL(),
  fetchOptions: {
    credentials: "include",
  },
  plugins: [
    organizationClient({
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
    }),
    // Multi-session support for dashboard + portal simultaneous logins
    multiSessionClient(),
  ],
});

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
  // Multi-session methods
  multiSession,
} = authClient;

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
