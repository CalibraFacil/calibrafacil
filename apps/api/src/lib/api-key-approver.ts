import { db } from "@calibra-facil/db";
import {
  member as memberTable,
  memberUnitAssignment,
  organization as organizationTable,
  organizationUnit,
} from "@calibra-facil/db/schema";
import type { RoleName } from "@calibra-facil/auth/access";
import { and, asc, eq } from "drizzle-orm";
import type { MemberData } from "../middleware/permission";
import { isGlobalUnitManager, type ResolvedUnit } from "./units";

function roleNameFromUnknown(value: unknown): RoleName {
  if (
    value === "owner" ||
    value === "admin" ||
    value === "technician" ||
    value === "operator" ||
    value === "member" ||
    value === "client_user"
  ) {
    return value;
  }
  return "member";
}

/**
 * The accountable person behind an API-key approval: the key's creator, with
 * their CURRENT membership, role and unit scope in the key's organization —
 * the same shape `requireOrganization` builds for a session, so the approval
 * policy evaluates a key exactly like the person's own session. Returns null
 * when the creator is no longer a member of an active LAB organization (a key
 * outlives a departed employee; nobody is then accountable for an approval).
 *
 * `unitId` is the job's unit: a unit-scoped creator can approve only inside
 * the units they are assigned to, which `resolveMemberUnitScope` encodes.
 */
export async function resolveApiKeyApprover(params: {
  organizationId: string;
  userId: string;
  unitId: number;
}): Promise<MemberData | null> {
  const [row] = await db
    .select({
      memberId: memberTable.id,
      memberRole: memberTable.role,
      orgType: organizationTable.type,
      orgStatus: organizationTable.status,
    })
    .from(memberTable)
    .innerJoin(
      organizationTable,
      eq(memberTable.organizationId, organizationTable.id),
    )
    .where(
      and(
        eq(memberTable.userId, params.userId),
        eq(memberTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);

  if (!row || row.orgType !== "LAB" || row.orgStatus === "SUSPENDED") {
    return null;
  }

  const role = roleNameFromUnknown(row.memberRole);
  // READ-ONLY unit resolution. `resolveMemberUnitScope` self-heals (creates the
  // default unit / assignment) which is right for a person's own session but
  // must never happen as a side effect of an approval attempt made by a key.
  // A scoped creator with no assignment simply has no accessible unit, so the
  // job is out of scope and the approval is refused.
  const accessibleUnits: ResolvedUnit[] = isGlobalUnitManager(role)
    ? (
        await db
          .select({
            id: organizationUnit.id,
            name: organizationUnit.name,
            slug: organizationUnit.slug,
          })
          .from(organizationUnit)
          .where(
            and(
              eq(organizationUnit.organizationId, params.organizationId),
              eq(organizationUnit.status, "ACTIVE"),
            ),
          )
          .orderBy(asc(organizationUnit.name))
      ).map((unit) => ({ ...unit, role: "unit_admin" as const }))
    : await db
        .select({
          id: organizationUnit.id,
          name: organizationUnit.name,
          slug: organizationUnit.slug,
          role: memberUnitAssignment.role,
        })
        .from(memberUnitAssignment)
        .innerJoin(
          organizationUnit,
          eq(memberUnitAssignment.unitId, organizationUnit.id),
        )
        .where(
          and(
            eq(memberUnitAssignment.organizationId, params.organizationId),
            eq(memberUnitAssignment.memberId, row.memberId),
            eq(organizationUnit.organizationId, params.organizationId),
            eq(organizationUnit.status, "ACTIVE"),
          ),
        )
        .orderBy(asc(organizationUnit.name));
  const activeUnit =
    accessibleUnits.find((unit) => unit.id === params.unitId) ?? null;
  const unitScope = {
    activeUnitId: activeUnit?.id ?? null,
    activeUnitName: activeUnit?.name ?? null,
    accessibleUnitIds: accessibleUnits.map((unit) => unit.id),
    accessibleUnits,
    selectedUnitScope: "unit" as const,
    canAccessAllUnits: isGlobalUnitManager(role),
    unitRole: activeUnit?.role ?? null,
  };

  return {
    id: row.memberId,
    role,
    organizationId: params.organizationId,
    organizationType: "LAB",
    userId: params.userId,
    activeUnitId: unitScope.activeUnitId,
    activeUnitName: unitScope.activeUnitName,
    accessibleUnitIds: unitScope.accessibleUnitIds,
    accessibleUnits: unitScope.accessibleUnits,
    selectedUnitScope: unitScope.selectedUnitScope,
    canAccessAllUnits: unitScope.canAccessAllUnits,
    unitRole: unitScope.unitRole,
  };
}
