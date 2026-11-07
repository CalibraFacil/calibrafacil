import { z } from "zod";
import {
  CreateUnitSchema,
  UpdateAssignmentsSchema,
  UpdateMemberRoleSchema,
  UpdateUnitSchema,
} from "@calibra-facil/schemas";

import { nullableString } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's units (sites) and who works in them: the unit context of
 * the session (`GET /api/units`) and the governance screens under
 * `/api/units/admin`. Response schemas are wire schemas written from what the
 * handlers in `apps/api/src/routes/units.ts` return. The desktop answers the
 * reads from the local session (`transport/desktop-client.ts`); every endpoint
 * is `cloud-only` (units are managed online).
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** What the signed-in member may do with units, derived from role and unit role. */
const governanceViewerSchema = z.object({
  isGlobalManager: z.boolean(),
  canManageOrganizationUnits: z.boolean(),
  canManageAssignments: z.boolean(),
  canManageGlobalRoles: z.boolean(),
  canViewGovernance: z.boolean(),
  canAccessConsolidatedView: z.boolean(),
  managedUnitIds: z.array(z.number()),
});
export type GovernanceViewer = z.infer<typeof governanceViewerSchema>;

const unitAssignmentRoleSchema = z.enum(["member", "technician", "unit_admin"]);
export type UnitAssignmentRole = z.infer<typeof unitAssignmentRoleSchema>;

/** A unit the member can reach, with the member's role in it. */
const accessibleUnitSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  role: z.string(),
});

/** GET /api/units: the unit context of the session. */
const unitsContextSchema = z.object({
  activeUnitId: z.number().nullable(),
  activeUnitName: nullableString,
  selectedUnitScope: z.enum(["all", "unit"]),
  canAccessAllUnits: z.boolean(),
  viewer: governanceViewerSchema,
  scopeSummary: z.object({
    isConsolidated: z.boolean(),
    activeUnitId: z.number().nullable(),
    activeUnitName: nullableString,
    accessibleUnitsCount: z.number(),
    managedUnitsCount: z.number(),
    effectiveRole: z.string(),
    effectiveRoleLabel: z.string(),
    label: z.string(),
    description: z.string(),
  }),
  data: z.array(accessibleUnitSchema),
});
export type UnitsContext = z.infer<typeof unitsContextSchema>;

/** One unit as the governance screens show it (the calibrating-body block included). */
const organizationUnitSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  isDefault: z.boolean(),
  createdAt: z.string(),
  archivedAt: nullableString,
  legalName: nullableString,
  cnpj: nullableString,
  street: nullableString,
  number: nullableString,
  complement: nullableString,
  neighbourhood: nullableString,
  city: nullableString,
  state: nullableString,
  cep: nullableString,
});
export type OrganizationUnit = z.infer<typeof organizationUnitSchema>;

/** GET /api/units/admin/units */
const organizationUnitsResponseSchema = z.object({
  data: z.array(organizationUnitSchema),
  viewer: governanceViewerSchema,
});
export type OrganizationUnitsData = z.infer<
  typeof organizationUnitsResponseSchema
>;

const governanceMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.string(),
  name: z.string(),
  email: z.string(),
  createdAt: z.string(),
  assignments: z.array(
    z.object({
      unitId: z.number(),
      unitName: z.string(),
      role: unitAssignmentRoleSchema,
    }),
  ),
});
export type GovernanceMember = z.infer<typeof governanceMemberSchema>;

/** GET /api/units/admin/members */
const governanceMembersResponseSchema = z.object({
  data: z.array(governanceMemberSchema),
  viewer: governanceViewerSchema,
});
export type OrganizationGovernanceMembersData = z.infer<
  typeof governanceMembersResponseSchema
>;

const governanceActivityEntrySchema = z.object({
  id: z.number(),
  action: z.string(),
  entityType: z.string(),
  entityId: nullableString,
  createdAt: z.string(),
  details: z.record(z.string(), z.unknown()).nullable(),
  unit: z.object({ id: z.number(), name: z.string() }).nullable(),
  actorUser: z
    .object({ id: z.string(), name: z.string(), email: nullableString })
    .nullable(),
});
export type GovernanceActivityEntry = z.infer<
  typeof governanceActivityEntrySchema
>;

/** GET /api/units/admin/activity */
const governanceActivityResponseSchema = z.object({
  data: z.array(governanceActivityEntrySchema),
  viewer: governanceViewerSchema,
});
export type OrganizationGovernanceActivityData = z.infer<
  typeof governanceActivityResponseSchema
>;

const successSchema = z.object({ success: z.literal(true) });

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "Governança de unidades";

export const unitEndpoints = {
  getDashboardUnits: endpoint({
    method: "get",
    path: "/api/units",
    response: unitsContextSchema,
    failure: "Falha ao carregar unidades",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listAdminUnits: endpoint({
    method: "get",
    path: "/api/units/admin/units",
    response: organizationUnitsResponseSchema,
    failure: "Falha ao carregar unidades",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listAdminMembers: endpoint({
    method: "get",
    path: "/api/units/admin/members",
    response: governanceMembersResponseSchema,
    failure: "Falha ao carregar governança por unidade",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listAdminActivity: endpoint({
    method: "get",
    path: "/api/units/admin/activity",
    response: governanceActivityResponseSchema,
    failure: "Falha ao carregar atividade de governança",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  createAdminUnit: endpoint({
    method: "post",
    path: "/api/units/admin/units",
    body: CreateUnitSchema,
    response: organizationUnitSchema,
    status: 201,
    failure: "Erro ao criar unidade",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  updateAdminUnit: endpoint({
    method: "patch",
    path: "/api/units/admin/units/:id",
    body: UpdateUnitSchema,
    response: organizationUnitSchema,
    failure: "Erro ao atualizar unidade",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  updateMemberAssignments: endpoint({
    method: "put",
    path: "/api/units/admin/members/:memberId/assignments",
    body: UpdateAssignmentsSchema,
    response: successSchema,
    failure: "Erro ao atualizar atribuições",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  updateMemberRole: endpoint({
    method: "patch",
    path: "/api/units/admin/members/:memberId/role",
    body: UpdateMemberRoleSchema,
    response: successSchema,
    failure: "Erro ao atualizar papel global",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
