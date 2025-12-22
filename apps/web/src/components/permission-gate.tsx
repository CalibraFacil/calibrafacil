import * as React from 'react'
import {
  checkRolePermission,
  useActiveOrganization,
} from '@calibra-facil/auth/client'
import { canPerformCalibrationAction } from '@calibra-facil/auth/access'
import type {
  CalibrationAction,
  CalibrationState,
  PermissionCheck,
  RoleName,
} from '@calibra-facil/auth/access'

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
export function useRole(): RoleName {
  const { data: activeOrg } = useActiveOrganization()

  // Get the current user's member record from the active organization
  const currentMember = activeOrg?.members?.[0]
  return currentMember?.role as RoleName
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

/**
 * Hook to check if the current user can perform a calibration action.
 * Takes into account both the role and the calibration's current state.
 *
 * @param action - The action to check (edit, delete, submit, approve, reject)
 * @param state - The current state of the calibration
 * @returns True if the user can perform the action
 *
 * @example
 * const canApprove = useCanPerformCalibrationAction("approve", calibration.state);
 * const canEdit = useCanPerformCalibrationAction("edit", "draft");
 */
export function useCanPerformCalibrationAction(
  action: CalibrationAction,
  state: CalibrationState,
): boolean {
  const role = useRole()
  return canPerformCalibrationAction(role, state, action)
}

/**
 * Hook to get all allowed calibration actions for the current user.
 *
 * @param state - The current state of the calibration
 * @returns Array of actions the user can perform
 *
 * @example
 * const allowedActions = useAllowedCalibrationActions("draft");
 * // For technician: ["edit", "delete", "submit"]
 * // For admin: ["edit", "delete", "submit"]
 */
export function useAllowedCalibrationActions(
  state: CalibrationState,
): Array<CalibrationAction> {
  const role = useRole()
  const actions: Array<CalibrationAction> = [
    'edit',
    'delete',
    'submit',
    'approve',
    'reject',
  ]
  return actions.filter((action) =>
    canPerformCalibrationAction(role, state, action),
  )
}

// =============================================================================
// COMPONENTS
// =============================================================================

interface PermissionGateProps {
  /**
   * The permissions required to render the children
   */
  permissions: PermissionCheck
  /**
   * Content to render when the user has the required permissions
   */
  children: React.ReactNode
  /**
   * Optional content to render when the user lacks permissions
   */
  fallback?: React.ReactNode
}

/**
 * Conditionally renders children based on current user's permissions.
 *
 * @example
 * <PermissionGate permissions={{ calibration: ["approve"] }}>
 *   <ApproveButton />
 * </PermissionGate>
 *
 * @example
 * <PermissionGate
 *   permissions={{ calibration: ["create"] }}
 *   fallback={<p>You don't have permission to create calibrations.</p>}
 * >
 *   <CreateCalibrationForm />
 * </PermissionGate>
 */
export function PermissionGate({
  permissions,
  children,
  fallback = null,
}: PermissionGateProps) {
  const hasPermission = useHasPermission(permissions)

  if (!hasPermission) {
    return <>{fallback}</>
  }

  return <>{children}</>
}

interface RoleGateProps {
  /**
   * The roles allowed to view the content
   */
  roles: Array<RoleName>
  /**
   * Content to render when the user has one of the allowed roles
   */
  children: React.ReactNode
  /**
   * Optional content to render when the user's role is not allowed
   */
  fallback?: React.ReactNode
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

interface CalibrationActionGateProps {
  /**
   * The workflow action to check
   */
  action: CalibrationAction
  /**
   * The current state of the calibration
   */
  state: CalibrationState
  /**
   * Content to render when the user can perform the action
   */
  children: React.ReactNode
  /**
   * Optional content to render when the user cannot perform the action
   */
  fallback?: React.ReactNode
}

/**
 * Conditionally renders children based on calibration workflow permissions.
 * Enforces ISO 17025 separation of duties.
 *
 * @example
 * <CalibrationActionGate action="approve" state={calibration.state}>
 *   <ApproveButton onClick={handleApprove} />
 * </CalibrationActionGate>
 *
 * @example
 * <CalibrationActionGate action="edit" state="approved">
 *   <EditButton /> {// Will not render - approved calibrations are immutable}
 * </CalibrationActionGate>
 */
export function CalibrationActionGate({
  action,
  state,
  children,
  fallback = null,
}: CalibrationActionGateProps) {
  const canPerform = useCanPerformCalibrationAction(action, state)

  if (!canPerform) {
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
  children: React.ReactNode
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
  children: React.ReactNode
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

interface CanProps {
  /**
   * Resource to check permission for
   */
  resource: keyof PermissionCheck
  /**
   * Action to check permission for
   */
  action: string
  /**
   * Content to render when the user has permission
   */
  children: React.ReactNode
  /**
   * Optional content to render when permission is denied
   */
  fallback?: React.ReactNode
}

/**
 * Shorthand component for checking a single permission.
 *
 * @example
 * <Can resource="calibration" action="create">
 *   <NewCalibrationButton />
 * </Can>
 *
 * @example
 * <Can
 *   resource="billing"
 *   action="update"
 *   fallback={<p>Contact the owner to update billing.</p>}
 * >
 *   <UpdatePaymentMethodForm />
 * </Can>
 */
export function Can({ resource, action, children, fallback = null }: CanProps) {
  const permissions = { [resource]: [action] } as PermissionCheck
  return (
    <PermissionGate permissions={permissions} fallback={fallback}>
      {children}
    </PermissionGate>
  )
}
