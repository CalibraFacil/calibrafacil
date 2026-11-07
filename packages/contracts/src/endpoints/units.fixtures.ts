import type {
  GovernanceViewer,
  OrganizationGovernanceActivityData,
  OrganizationGovernanceMembersData,
  OrganizationUnit,
  OrganizationUnitsData,
  UnitsContext,
} from "./units";

/**
 * Contract-valid example payloads for the units endpoints, for tests in any
 * package. Every value mirrors what the handlers return today; `units.test.ts`
 * parses every builder against its response schema.
 */

export function buildGovernanceViewer(
  overrides: Partial<GovernanceViewer> = {},
): GovernanceViewer {
  return {
    isGlobalManager: true,
    canManageOrganizationUnits: true,
    canManageAssignments: true,
    canManageGlobalRoles: true,
    canViewGovernance: true,
    canAccessConsolidatedView: true,
    managedUnitIds: [10],
    ...overrides,
  };
}

export function buildOrganizationUnit(
  overrides: Partial<OrganizationUnit> = {},
): OrganizationUnit {
  return {
    id: 10,
    name: "Matriz",
    slug: "matriz",
    status: "ACTIVE",
    isDefault: true,
    createdAt: "2026-01-10T12:00:00.000Z",
    archivedAt: null,
    legalName: null,
    cnpj: null,
    street: null,
    number: null,
    complement: null,
    neighbourhood: null,
    city: null,
    state: null,
    cep: null,
    ...overrides,
  };
}

export function buildOrganizationUnitsData(
  data: OrganizationUnit[] = [buildOrganizationUnit()],
): OrganizationUnitsData {
  return { data, viewer: buildGovernanceViewer() };
}

export function buildOrganizationGovernanceMembersData(): OrganizationGovernanceMembersData {
  return {
    data: [
      {
        id: "member-1",
        userId: "user-1",
        role: "admin",
        name: "Ana",
        email: "ana@example.test",
        createdAt: "2026-01-10T12:00:00.000Z",
        assignments: [{ unitId: 10, unitName: "Matriz", role: "unit_admin" }],
      },
    ],
    viewer: buildGovernanceViewer(),
  };
}

export function buildOrganizationGovernanceActivityData(): OrganizationGovernanceActivityData {
  return {
    data: [
      {
        id: 1,
        action: "unit.created",
        entityType: "organization_unit",
        entityId: "10",
        createdAt: "2026-01-10T12:00:00.000Z",
        details: { name: "Matriz" },
        unit: { id: 10, name: "Matriz" },
        actorUser: { id: "user-1", name: "Ana", email: "ana@example.test" },
      },
    ],
    viewer: buildGovernanceViewer(),
  };
}

export function buildUnitsContext(
  overrides: Partial<UnitsContext> = {},
): UnitsContext {
  return {
    activeUnitId: 10,
    activeUnitName: "Matriz",
    selectedUnitScope: "unit",
    canAccessAllUnits: true,
    viewer: buildGovernanceViewer(),
    scopeSummary: {
      isConsolidated: false,
      activeUnitId: 10,
      activeUnitName: "Matriz",
      accessibleUnitsCount: 1,
      managedUnitsCount: 1,
      effectiveRole: "global_manager",
      effectiveRoleLabel: "Administrador global",
      label: "Matriz",
      description: "Operando com foco operacional em Matriz.",
    },
    data: [{ id: 10, name: "Matriz", slug: "matriz", role: "unit_admin" }],
    ...overrides,
  };
}
