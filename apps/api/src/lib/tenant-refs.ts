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
import { and, eq, inArray } from "drizzle-orm";
import { orgDb } from "./org-db";

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
 * Each helper reads through the caller's org-bound handle when it passes one
 * (inside the handler's `orgDb(org).transaction`); without one it reads in a
 * short transaction of its own that names the organization, so it works under
 * row-level security either way.
 */

type TenantRefsExecutor = Pick<OrgExecutor, "select">;

function withReader<R>(
  organizationId: string,
  executor: TenantRefsExecutor | undefined,
  run: (reader: TenantRefsExecutor) => Promise<R>,
): Promise<R> {
  return executor ? run(executor) : orgDb(organizationId).transaction(run);
}

function uniqueValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** The caller's org membership row for `userId`, or null (also null cross-tenant). */
export function findOrganizationMember(
  organizationId: string,
  userId: string,
  executor?: TenantRefsExecutor,
) {
  return withReader(organizationId, executor, async (reader) => {
    const [row] = await reader
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(
        and(
          eq(member.userId, userId),
          eq(member.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

/** True when `userId` is a member of `organizationId`. */
export async function userIsOrganizationMember(
  organizationId: string,
  userId: string,
  executor?: TenantRefsExecutor,
) {
  return (
    (await findOrganizationMember(organizationId, userId, executor)) !== null
  );
}

/**
 * True when `userId` may be assigned work in `unitId`: a member of the
 * organization who is an org-level admin/owner, or holds a technician /
 * unit_admin assignment in that unit. Mirrors the rule in `POST /jobs/:id/assign`
 * and `createCalibrationJob`.
 */
export function isAssignableTechnician(
  params: { organizationId: string; userId: string; unitId: number | null },
  executor?: TenantRefsExecutor,
) {
  return withReader(params.organizationId, executor, async (reader) => {
    const found = await findOrganizationMember(
      params.organizationId,
      params.userId,
      reader,
    );
    if (!found) return false;
    if (found.role === "admin" || found.role === "owner") return true;
    if (params.unitId === null) return true;

    const [assignment] = await reader
      .select({ id: memberUnitAssignment.id })
      .from(memberUnitAssignment)
      .where(
        and(
          eq(memberUnitAssignment.memberId, found.id),
          eq(memberUnitAssignment.organizationId, params.organizationId),
          eq(memberUnitAssignment.unitId, params.unitId),
          inArray(memberUnitAssignment.role, ["technician", "unit_admin"]),
        ),
      )
      .limit(1);
    return Boolean(assignment);
  });
}

/** True when every unit id belongs to `organizationId` (empty list is true). */
export async function unitsBelongToOrganization(
  organizationId: string,
  unitIds: readonly number[],
  executor?: TenantRefsExecutor,
) {
  const ids = uniqueValues(unitIds);
  if (ids.length === 0) return true;
  return withReader(organizationId, executor, async (reader) => {
    const rows = await reader
      .select({ id: organizationUnit.id })
      .from(organizationUnit)
      .where(
        and(
          eq(organizationUnit.organizationId, organizationId),
          inArray(organizationUnit.id, ids),
        ),
      );
    return rows.length === ids.length;
  });
}

/** True when every service id belongs to `organizationId` (empty list is true). */
export async function servicesBelongToOrganization(
  organizationId: string,
  serviceIds: readonly number[],
  executor?: TenantRefsExecutor,
) {
  const ids = uniqueValues(serviceIds);
  if (ids.length === 0) return true;
  return withReader(organizationId, executor, async (reader) => {
    const rows = await reader
      .select({ id: service.id })
      .from(service)
      .where(
        and(
          eq(service.organizationId, organizationId),
          inArray(service.id, ids),
        ),
      );
    return rows.length === ids.length;
  });
}

/** True when the commercial agreement belongs to `organizationId`. */
export function agreementBelongsToOrganization(
  organizationId: string,
  agreementId: number,
  executor?: TenantRefsExecutor,
) {
  return withReader(organizationId, executor, async (reader) => {
    const [row] = await reader
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
  });
}

/** True when the service order belongs to `organizationId`. */
export function serviceOrderBelongsToOrganization(
  organizationId: string,
  serviceOrderId: number,
  executor?: TenantRefsExecutor,
) {
  return withReader(organizationId, executor, async (reader) => {
    const [row] = await reader
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
  });
}

/** True when the calibration job belongs to `organizationId`. */
export function calibrationJobBelongsToOrganization(
  organizationId: string,
  jobId: number,
  executor?: TenantRefsExecutor,
) {
  return withReader(organizationId, executor, async (reader) => {
    const [row] = await reader
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
  });
}
