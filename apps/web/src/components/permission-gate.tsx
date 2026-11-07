import { useCurrentRole, useIsLabManager } from '@/hooks/use-current-role'
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

interface ManagerGateProps {
  children: ReactNode
}

/**
 * Shows content to whoever manages the whole laboratory: the roles the access
 * table lets update settings (see `isLabManagerRole`).
 *
 * @example
 * <ShowForManager>
 *   <ManageTeamButton />
 * </ShowForManager>
 */
export function ShowForManager({ children }: ManagerGateProps) {
  return useIsLabManager() ? <>{children}</> : null
}

/** The counterpart of `ShowForManager`: content for everyone else. */
export function HideFromManager({ children }: ManagerGateProps) {
  return useIsLabManager() ? null : <>{children}</>
}
