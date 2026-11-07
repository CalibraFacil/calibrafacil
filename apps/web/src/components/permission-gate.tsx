import { useCurrentRole } from '@/hooks/use-current-role'
import { ReactNode } from 'react'
import { checkRolePermission } from '@calibra-facil/auth/client'
import type { PermissionCheck, RoleName } from '@calibra-facil/auth/access'

// =============================================================================
// HOOKS
// =============================================================================

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
  const role = useCurrentRole()
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
  const currentRole = useCurrentRole()

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
  const currentRole = useCurrentRole()
  const rolesToHide = Array.isArray(role) ? role : [role]

  if (rolesToHide.includes(currentRole)) {
    return null
  }

  return <>{children}</>
}
