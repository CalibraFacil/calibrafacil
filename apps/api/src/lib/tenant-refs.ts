import type { OrgExecutor } from "@calibra-facil/db/for-org";
import {
  commercialAgreement,
  member,
  memberUnitAssignment,
  organizationUnit,
  service,
  serviceOrder,
  calibrationJob,
} from "@calibra-facil/db/schema";
import { CALIBRATION_EXECUTOR_ROLES } from "@calibra-facil/auth/access";
import { and, eq, exists, inArray, or } from "drizzle-orm";
import { GLOBAL_UNIT_ROLES } from "./units";

/**
 * Tenancy guards for request-supplied foreign ids.
 *
 * Tenancy in this codebase is `organizationId` (+ `unitId` on unit-scoped
 * tables), filtered by hand in every query. A body field that names another
 * entity (a technician, a responsible user, a unit, a service...) is NOT
 * covered by the route's own scoped lookup: it must be checked against the
 * caller's organization before it is written or joined, otherwise a user can
 * reference — and, through name joins, read — another tenant's rows.
 *
 * Every helper answers a plain boolean so callers can return ONE generic
 * "not found / no permission" response for both "does not exist" and "exists in
 * another tenant" (no cross-tenant existence oracle).
 *
 * Each helper reads through the caller's org-bound handle (inside the
 * handler's `withOrg` or `orgDb(org).transaction`), so it works under
 * row-level security.
 */

type TenantRefsExecutor = Pick<OrgExecutor, "select">;

function uniqueValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** The caller's org membership row for `userId`, or null (also null cross-tenant). */
async function findOrganizationMember(
  organizationId: string,
  userId: string,
  executor: TenantRefsExecutor,
) {
  const [row] = await executor
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1);
  return row ?? null;
}

export async function userIsOrganizationMember(
  organizationId: string,
  userId: string,
  executor: TenantRefsExecutor,
) {
  return (
    (await findOrganizationMember(organizationId, userId, executor)) !== null
  );
}

/** The unit assignments that make a non-global member assignable in a unit. */
const ASSIGNABLE_UNIT_ROLES = ["technician", "unit_admin"] as const;

/**
 * THE rule of "may this member be assigned work in this unit", as a condition
 * over `member`. The member's organization role must be one that does the work
 * (`calibration.execute`, packages/auth access.ts); an org-level admin/owner
 * reaches every unit, anyone else needs a technician / unit_admin assignment in
 * `unitId` (a null unit is "any unit": the role alone decides). The technician
 * picker, `POST /jobs/:id/assign`, `createCalibrationJob`, the service-order and
 * visit assignments all ask through this.
 */
export function assignableMemberCondition(
  params: { organizationId: string; unitId: number | null },
  executor: TenantRefsExecutor,
) {
  const { organizationId, unitId } = params;
  return and(
    eq(member.organizationId, organizationId),
    inArray(member.role, [...CALIBRATION_EXECUTOR_ROLES]),
    unitId === null
      ? undefined
      : or(
          inArray(member.role, [...GLOBAL_UNIT_ROLES]),
          exists(
            executor
              .select({ id: memberUnitAssignment.id })
              .from(memberUnitAssignment)
              .where(
                and(
                  eq(memberUnitAssignment.memberId, member.id),
                  eq(memberUnitAssignment.organizationId, organizationId),
                  eq(memberUnitAssignment.unitId, unitId),
                  inArray(memberUnitAssignment.role, [
                    ...ASSIGNABLE_UNIT_ROLES,
                  ]),
                ),
              ),
          ),
        ),
  );
}

/** True when `userId` may be assigned work in `unitId` (`assignableMemberCondition`). */
export async function isAssignableTechnician(
  params: { organizationId: string; userId: string; unitId: number | null },
  executor: TenantRefsExecutor,
) {
  const [found] = await executor
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.userId, params.userId),
        assignableMemberCondition(params, executor),
      ),
    )
    .limit(1);
  return found !== undefined;
}

/** True when every unit id belongs to `organizationId` (empty list is true). */
export async function unitsBelongToOrganization(
  organizationId: string,
  unitIds: readonly number[],
  executor: TenantRefsExecutor,
) {
  const ids = uniqueValues(unitIds);
  if (ids.length === 0) return true;
  const rows = await executor
    .select({ id: organizationUnit.id })
    .from(organizationUnit)
    .where(
      and(
        eq(organizationUnit.organizationId, organizationId),
        inArray(organizationUnit.id, ids),
      ),
    );
  return rows.length === ids.length;
}

/** True when every service id belongs to `organizationId` (empty list is true). */
export async function servicesBelongToOrganization(
  organizationId: string,
  serviceIds: readonly number[],
  executor: TenantRefsExecutor,
) {
  const ids = uniqueValues(serviceIds);
  if (ids.length === 0) return true;
  const rows = await executor
    .select({ id: service.id })
    .from(service)
    .where(
      and(eq(service.organizationId, organizationId), inArray(service.id, ids)),
    );
  return rows.length === ids.length;
}

export async function agreementBelongsToOrganization(
  organizationId: string,
  agreementId: number,
  executor: TenantRefsExecutor,
) {
  const [row] = await executor
    .select({ id: commercialAgreement.id })
    .from(commercialAgreement)
    .where(
      and(
        eq(commercialAgreement.id, agreementId),
        eq(commercialAgreement.organizationId, organizationId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function serviceOrderBelongsToOrganization(
  organizationId: string,
  serviceOrderId: number,
  executor: TenantRefsExecutor,
) {
  const [row] = await executor
    .select({ id: serviceOrder.id })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, organizationId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function calibrationJobBelongsToOrganization(
  organizationId: string,
  jobId: number,
  executor: TenantRefsExecutor,
) {
  const [row] = await executor
    .select({ id: calibrationJob.id })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.id, jobId),
        eq(calibrationJob.organizationId, organizationId),
      ),
    )
    .limit(1);
  return Boolean(row);
}
