import { db } from "@calibra-facil/db";
import {
  memberUnitAssignment,
  organizationUnit,
  type MemberUnitRole,
} from "@calibra-facil/db/schema";
import type { RoleName } from "@calibra-facil/auth/access";
import { and, asc, eq, inArray } from "drizzle-orm";

export type UnitScopeMode = "all" | "unit";

export type ResolvedUnit = {
  id: number;
  name: string;
  slug: string;
  role: MemberUnitRole;
};

export type ResolvedUnitScope = {
  activeUnitId: number | null;
  activeUnitName: string | null;
  accessibleUnitIds: number[];
  accessibleUnits: ResolvedUnit[];
  canAccessAllUnits: boolean;
  selectedUnitScope: UnitScopeMode;
  unitRole: MemberUnitRole | null;
};

export type UnitGovernanceMember = Pick<
  ResolvedUnitScope,
  "accessibleUnitIds" | "canAccessAllUnits" | "unitRole"
> & {
  role: RoleName;
};

export type UnitGovernanceAccess = {
  isGlobalManager: boolean;
  canManageOrganizationUnits: boolean;
  canManageAssignments: boolean;
  canManageGlobalRoles: boolean;
  canViewGovernance: boolean;
  canAccessConsolidatedView: boolean;
  managedUnitIds: number[];
};

const GLOBAL_MULTI_UNIT_ROLES = new Set<RoleName>(["owner", "admin"]);

function slugifyUnitName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getDefaultUnitRole(role: RoleName): MemberUnitRole {
  if (role === "owner" || role === "admin") return "unit_admin";
  if (role === "technician") return "technician";
  return "member";
}

export function isUnitScopedManagementRole(role: RoleName, unitRole?: string | null) {
  return GLOBAL_MULTI_UNIT_ROLES.has(role) || unitRole === "unit_admin";
}

export function isGlobalUnitManager(role: RoleName) {
  return GLOBAL_MULTI_UNIT_ROLES.has(role);
}

export function getUnitGovernanceAccess(
  member: UnitGovernanceMember,
): UnitGovernanceAccess {
  const isGlobalManager = isGlobalUnitManager(member.role);
  const canManageAssignments = isGlobalManager || member.unitRole === "unit_admin";

  return {
    isGlobalManager,
    canManageOrganizationUnits: isGlobalManager,
    canManageAssignments,
    canManageGlobalRoles: isGlobalManager,
    canViewGovernance: canManageAssignments,
    canAccessConsolidatedView: isGlobalManager && member.canAccessAllUnits,
    managedUnitIds: member.accessibleUnitIds,
  };
}

export async function ensureDefaultUnitForOrganization(
  organizationId: string,
  userId?: string | null,
) {
  const [existing] = await db
    .select({
      id: organizationUnit.id,
      name: organizationUnit.name,
      slug: organizationUnit.slug,
      status: organizationUnit.status,
      isDefault: organizationUnit.isDefault,
    })
    .from(organizationUnit)
    .where(eq(organizationUnit.organizationId, organizationId))
    .orderBy(asc(organizationUnit.id))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(organizationUnit)
    .values({
      organizationId,
      name: "Matriz",
      slug: slugifyUnitName("Matriz"),
      status: "ACTIVE",
      isDefault: true,
      createdBy: userId ?? null,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create default organization unit");
  }

  return {
    id: created.id,
    name: created.name,
    slug: created.slug,
    status: created.status,
    isDefault: created.isDefault,
  };
}

export async function ensureDefaultUnitAssignment(params: {
  organizationId: string;
  memberId: string;
  memberRole: RoleName;
  userId: string;
}) {
  const defaultUnit = await ensureDefaultUnitForOrganization(
    params.organizationId,
    params.userId,
  );

  await db
    .insert(memberUnitAssignment)
    .values({
      organizationId: params.organizationId,
      memberId: params.memberId,
      unitId: defaultUnit.id,
      role: getDefaultUnitRole(params.memberRole),
      createdBy: params.userId,
    })
    .onConflictDoNothing();
}

export async function resolveMemberUnitScope(params: {
  organizationId: string;
  memberId: string;
  memberRole: RoleName;
  userId: string;
  requestedScope?: string | null;
}): Promise<ResolvedUnitScope> {
  if (GLOBAL_MULTI_UNIT_ROLES.has(params.memberRole)) {
    await ensureDefaultUnitForOrganization(params.organizationId, params.userId);

    const units = await db
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
      .orderBy(asc(organizationUnit.name));

    const accessibleUnits = units.map((unit) => ({
      ...unit,
      role: "unit_admin" as const,
    }));
    const accessibleUnitIds = accessibleUnits.map((unit) => unit.id);
    const requestedScope = params.requestedScope?.trim();
    const wantsAll = requestedScope === "all";
    const requestedUnitId =
      requestedScope && requestedScope !== "all"
        ? Number.parseInt(requestedScope, 10)
        : Number.NaN;
    const activeUnit =
      Number.isInteger(requestedUnitId) && accessibleUnitIds.includes(requestedUnitId)
        ? accessibleUnits.find((unit) => unit.id === requestedUnitId) ?? null
        : accessibleUnits[0] ?? null;

    return {
      activeUnitId: wantsAll ? null : activeUnit?.id ?? null,
      activeUnitName: wantsAll ? null : activeUnit?.name ?? null,
      accessibleUnitIds,
      accessibleUnits,
      canAccessAllUnits: true,
      selectedUnitScope: wantsAll ? "all" : "unit",
      unitRole: wantsAll ? null : "unit_admin",
    };
  }

  let assignments = await db
    .select({
      id: organizationUnit.id,
      name: organizationUnit.name,
      slug: organizationUnit.slug,
      role: memberUnitAssignment.role,
    })
    .from(memberUnitAssignment)
    .innerJoin(organizationUnit, eq(memberUnitAssignment.unitId, organizationUnit.id))
    .where(
      and(
        eq(memberUnitAssignment.organizationId, params.organizationId),
        eq(memberUnitAssignment.memberId, params.memberId),
        eq(organizationUnit.status, "ACTIVE"),
      ),
    )
    .orderBy(asc(organizationUnit.name));

  if (assignments.length === 0) {
    await ensureDefaultUnitAssignment(params);
    assignments = await db
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
          eq(memberUnitAssignment.memberId, params.memberId),
          eq(organizationUnit.status, "ACTIVE"),
        ),
      )
      .orderBy(asc(organizationUnit.name));
  }

  const accessibleUnits = assignments.map((assignment) => ({
    id: assignment.id,
    name: assignment.name,
    slug: assignment.slug,
    role: assignment.role,
  }));
  const accessibleUnitIds = accessibleUnits.map((unit) => unit.id);
  const requestedUnitId = params.requestedScope
    ? Number.parseInt(params.requestedScope, 10)
    : Number.NaN;
  const activeUnit =
    Number.isInteger(requestedUnitId) && accessibleUnitIds.includes(requestedUnitId)
      ? accessibleUnits.find((unit) => unit.id === requestedUnitId) ?? null
      : accessibleUnits[0] ?? null;

  return {
    activeUnitId: activeUnit?.id ?? null,
    activeUnitName: activeUnit?.name ?? null,
    accessibleUnitIds,
    accessibleUnits,
    canAccessAllUnits: false,
    selectedUnitScope: "unit",
    unitRole: activeUnit?.role ?? null,
  };
}

export function buildUnitScopeCondition(
  column: Parameters<typeof eq>[0],
  scope: Pick<
    ResolvedUnitScope,
    "selectedUnitScope" | "activeUnitId" | "accessibleUnitIds"
  >,
) {
  if (scope.selectedUnitScope === "all") {
    return inArray(column as never, scope.accessibleUnitIds);
  }

  return eq(column as never, scope.activeUnitId as never);
}
