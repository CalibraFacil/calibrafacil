import { type SyncCommandOperation } from "@calibra-facil/contracts";
import type { PermissionCheck } from "@calibra-facil/auth/access";
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
 * The table is exhaustive by type (`satisfies Record<SyncCommandOperation, ...>`):
 * adding an operation to the push protocol fails to compile here until someone
 * says who may send it. `operation-permissions.spec.ts` also reads the online
 * route sources and fails when a route's guard and this table disagree.
 */
export type SyncOperationPermission = {
  /** The permission the member needs, as `withLabPermission(...)` states it. */
  readonly permission: PermissionCheck;
  /** The online route (or guard) the permission was taken from. */
  readonly onlineRoute: string;
};

/**
 * The attachment endpoints (`/api/sync/attachments/*`) and the
 * `create_local_attachment` event share one permission: an attachment is field
 * evidence captured by whoever may start work on the lab's records.
 */
export const SYNC_ATTACHMENT_PERMISSION: PermissionCheck = {
  calibration: ["create"],
};

export const SYNC_OPERATION_PERMISSIONS = {
  create_local_job_draft: {
    permission: { calibration: ["create"] },
    onlineRoute: "POST /api/jobs",
  },
  create_local_asset: {
    permission: { equipment: ["create"] },
    onlineRoute: "POST /api/assets",
  },
  update_local_asset: {
    permission: { equipment: ["update"] },
    onlineRoute: "PUT /api/assets/:id",
  },
  create_local_customer: {
    permission: { client: ["create"] },
    onlineRoute: "POST /api/customers",
  },
  update_local_customer: {
    permission: { client: ["update"] },
    onlineRoute: "PUT /api/customers/:id",
  },
  update_local_customer_compliance: {
    permission: { client: ["update"] },
    onlineRoute: "PUT /api/customers/:id/compliance",
  },
  save_local_execution: {
    permission: { calibration: ["execute"] },
    onlineRoute: "POST /api/jobs/:id/execute",
  },
  submit_local_execution: {
    permission: { calibration: ["submit"] },
    onlineRoute: "POST /api/jobs/:id/submit",
  },
  create_local_service_order_intake: {
    permission: { service_order: ["create"] },
    onlineRoute: "POST /api/service-orders",
  },
  create_local_non_conformance: {
    permission: { non_conformance: ["create"] },
    onlineRoute: "POST /api/non-conformances",
  },
  create_local_service_order_quote_draft: {
    permission: { service_order: ["quote_create"] },
    onlineRoute: "POST /api/service-orders/:id/quotes",
  },
  save_local_service_order_execution_notes: {
    permission: { service_order: ["execute"] },
    onlineRoute: "PATCH /api/service-orders/:id/execution",
  },
  create_local_service_order_delivery_document_draft: {
    permission: { service_order: ["deliver"] },
    onlineRoute: "POST /api/service-orders/:id/delivery-document",
  },
  create_local_attachment: {
    permission: SYNC_ATTACHMENT_PERMISSION,
    onlineRoute: "POST /api/sync/attachments/init-upload",
  },
  // An audit-only marker of an older build: it writes one audit row, so it needs
  // what the push needed before this table existed.
  create_local_certificate_draft: {
    permission: { calibration: ["create"] },
    onlineRoute: "POST /api/sync/push (audit marker)",
  },
  // Certificates are issued online only, after the approval; an offline
  // "publish PDF" is the approve decision, so it asks for the approve right
  // (and is refused for good whoever sends it).
  generate_local_certificate_pdf: {
    permission: { calibration: ["approve"] },
    onlineRoute: "POST /api/jobs/:id/approve",
  },
} satisfies Record<SyncCommandOperation, SyncOperationPermission>;

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
  const { permission } = SYNC_OPERATION_PERMISSIONS[operation];
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
