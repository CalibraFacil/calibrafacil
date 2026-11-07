import {
  SYNC_COMMAND_OPERATIONS,
  SYNC_OPERATIONS,
  type SyncCommandOperation,
} from "@calibra-facil/contracts";
import { ac, type PermissionCheck } from "@calibra-facil/auth/access";
import {
  type MemberData,
  getEffectivePermissionRole,
  hasPermissionLocally,
} from "../../middleware/permission";

/**
 * Who may push which desktop operation (roadmap P0-2).
 *
 * `POST /api/sync/push` used to gate the whole request on `calibration:create`
 * and then apply every event, so a technician or operator could do offline what
 * the online routes deny them (a quote, a delivery document, a non-conformance,
 * a service order). Each operation now carries the permission of the online
 * route that does the same thing, evaluated per event against the pushing
 * member with the helper the online guard uses (`requirePermission`:
 * `getEffectivePermissionRole` + `hasPermissionLocally`).
 *
 * The permission lives in the push-operation table of the contract
 * (`SYNC_OPERATIONS`, packages/contracts/src/sync-protocol.ts), which is exhaustive
 * by type: adding an operation to the push protocol fails to compile there until
 * someone says who may send it. The contract states resources and actions as plain
 * strings (it cannot import the access-control statements), so
 * {@link syncOperationPermission} checks the names against them.
 * `operation-permissions.spec.ts` also reads the online route sources and fails when
 * a route's guard and the table disagree.
 */
function isPermissionCheck(value: unknown): value is PermissionCheck {
  if (typeof value !== "object" || value === null) return false;
  const known = new Map<string, readonly string[]>(
    Object.entries(ac.statements),
  );
  return Object.entries(value).every(([resource, actions]) => {
    const allowed = known.get(resource);
    return (
      allowed !== undefined &&
      Array.isArray(actions) &&
      actions.every((action) => allowed.includes(action))
    );
  });
}

/** The permission an operation needs, as the access-control statements spell it. */
export function syncOperationPermission(
  operation: SyncCommandOperation,
): PermissionCheck {
  const { permission } = SYNC_OPERATIONS[operation];
  if (!isPermissionCheck(permission)) {
    throw new Error(
      `The push-operation table gives ${operation} a permission that is not an access-control statement.`,
    );
  }
  return permission;
}

// Fail at load, not on the first push of that operation, when the table names a
// resource or action the access control does not have.
for (const operation of SYNC_COMMAND_OPERATIONS) {
  syncOperationPermission(operation);
}

/**
 * The attachment endpoints (`/api/sync/attachments/*`) and the
 * `create_local_attachment` event share one permission: an attachment is field
 * evidence captured by whoever may start work on the lab's records.
 */
export const SYNC_ATTACHMENT_PERMISSION: PermissionCheck =
  syncOperationPermission("create_local_attachment");

/**
 * The member as the event's own unit sees them. `memberData.unitRole` is the role
 * in the ACTIVE unit (the `x-active-unit-id` header, or the first accessible unit:
 * the desktop sends no header), but the apply writes into the event's unit, so a
 * member who is a technician in one unit and a plain member in another must not
 * borrow the first role for the second. The unit is the one the apply uses:
 * `event.unitId`, then a numeric `payload.unitId` (job drafts and service-order
 * intakes read it), then the active unit. A unit the member has no assignment in
 * gives no unit role (so no unit elevation).
 */
export function memberForEventUnit(
  member: Pick<MemberData, "role" | "activeUnitId" | "accessibleUnits">,
  event: { unitId: number | null; payload?: unknown },
): Pick<MemberData, "role" | "unitRole"> {
  const payloadUnit =
    event.payload && typeof event.payload === "object"
      ? Reflect.get(event.payload, "unitId")
      : undefined;
  const unitId =
    event.unitId ??
    (typeof payloadUnit === "number" ? payloadUnit : null) ??
    member.activeUnitId;
  const unitRole =
    unitId === null
      ? null
      : (member.accessibleUnits.find((unit) => unit.id === unitId)?.role ??
        null);
  return { role: member.role, unitRole };
}

export type SyncPermissionDecision =
  | { allowed: true }
  | { allowed: false; code: string; reason: string };

/**
 * Whether the pushing member may send `operation`. The same evaluation as the
 * online `requirePermission` middleware: the member's effective role (a unit
 * role elevates only on unit-scoped resources) against the permission.
 */
export function authorizeSyncOperation(
  member: Pick<MemberData, "role" | "unitRole">,
  operation: SyncCommandOperation,
): SyncPermissionDecision {
  const permission = syncOperationPermission(operation);
  const role = getEffectivePermissionRole(member, permission);
  if (hasPermissionLocally(role, permission)) return { allowed: true };

  return {
    allowed: false,
    code: "SYNC_PERMISSION_DENIED",
    reason: `Role ${role} may not send ${operation} (requires ${describePermission(permission)}).`,
  };
}

function describePermission(permission: PermissionCheck): string {
  return Object.entries(permission)
    .map(([resource, actions]) => `${resource}:${(actions ?? []).join(",")}`)
    .join(" ");
}
