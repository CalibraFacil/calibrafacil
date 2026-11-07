import { ReactNode } from 'react'
import {
  checkRolePermission,
  useActiveOrganization,
} from '@calibra-facil/auth/client'
import type { PermissionCheck, RoleName } from '@calibra-facil/auth/access'

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Hook to get the current user's role in the active organization.
 *
 * @returns The current user's role, defaults to "member" if not found
 *
 * @example
 * const role = useRole();
 * if (role === "admin") {
 *   // Show admin features
 * }
 */
function useRole(): RoleName {
  const { data: activeOrg } = useActiveOrganization()

  // Get the current user's member record from the active organization
  const currentMember = activeOrg?.members?.[0]
  return parseRoleName(currentMember?.role)
}

function parseRoleName(role: string | null | undefined): RoleName {
  switch (role) {
    case 'owner':
    case 'admin':
    case 'technician':
    case 'operator':
    case 'client_user':
      return role
    default:
      return 'member'
  }
}

/**
 * Hook to check if the current user has specific permissions.
 *
 * @param permissions - The permissions to check
 * @returns True if the user has all the specified permissions
 *
 * @example
 * const canCreate = useHasPermission({ calibration: ["create"] });
 * const canApproveAndReject = useHasPermission({ calibration: ["approve", "reject"] });
 */
export function useHasPermission(permissions: PermissionCheck): boolean {
  const role = useRole()
  return checkRolePermission(role, permissions)
}

interface RoleGateProps {
  /**
   * The roles allowed to view the content
   */
  roles: Array<RoleName>
  /**
   * Content to render when the user has one of the allowed roles
   */
  children: ReactNode
  /**
   * Optional content to render when the user's role is not allowed
   */
  fallback?: ReactNode
}

/**
 * Conditionally renders children based on current user's role.
 *
 * @example
 * <RoleGate roles={["admin", "owner"]}>
 *   <AdminPanel />
 * </RoleGate>
 *
 * @example
 * <RoleGate roles={["owner"]} fallback={<p>Only owners can access this.</p>}>
 *   <BillingSettings />
 * </RoleGate>
 */
export function RoleGate({ roles, children, fallback = null }: RoleGateProps) {
  const currentRole = useRole()

  if (!roles.includes(currentRole)) {
    return <>{fallback}</>
  }

  return <>{children}</>
}

// =============================================================================
// UTILITY COMPONENTS
// =============================================================================

interface ShowForRoleProps {
  /**
   * Single role or array of roles that can see the content
   */
  role: RoleName | Array<RoleName>
  /**
   * Content to render for the specified role(s)
   */
  children: ReactNode
}

/**
 * Shorthand component for showing content to specific roles.
 *
 * @example
 * <ShowForRole role="owner">
 *   <DeleteOrganizationButton />
 * </ShowForRole>
 *
 * @example
 * <ShowForRole role={["admin", "owner"]}>
 *   <ManageTeamButton />
 * </ShowForRole>
 */
export function ShowForRole({ role, children }: ShowForRoleProps) {
  const roles = Array.isArray(role) ? role : [role]
  return <RoleGate roles={roles}>{children}</RoleGate>
}

interface HideFromRoleProps {
  /**
   * Single role or array of roles that should NOT see the content
   */
  role: RoleName | Array<RoleName>
  /**
   * Content to hide from the specified role(s)
   */
  children: ReactNode
}

/**
 * Shorthand component for hiding content from specific roles.
 *
 * @example
 * <HideFromRole role="client_user">
 *   <InternalNotesSection />
 * </HideFromRole>
 */
export function HideFromRole({ role, children }: HideFromRoleProps) {
  const currentRole = useRole()
  const rolesToHide = Array.isArray(role) ? role : [role]

  if (rolesToHide.includes(currentRole)) {
    return null
  }

  return <>{children}</>
}
