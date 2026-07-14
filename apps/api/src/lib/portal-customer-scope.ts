import { db } from "@calibra-facil/db";
import {
  customer,
  customerGroup,
  member,
  organization,
} from "@calibra-facil/db/schema";
import { PORTAL_ACCESS_ROLES } from "@calibra-facil/auth/access";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Portal customer scope resolution.
 *
 * The portal's active organization (member.organizationId) maps to EITHER a
 * single branch customer (customer.authOrganizationId) OR a customer group
 * (customer_group.authOrganizationId). A group fans out to all its branch
 * customers, so a unified quality manager invited once to the group org sees
 * every branch consolidated. This resolver is the single chokepoint every
 * portal read/write site uses instead of inlining the customer lookup — in
 * "single" mode it returns exactly one customer id, so existing single-tenant
 * behavior is byte-for-byte unchanged.
 */

export type PortalScopeCustomer = {
  id: number;
  name: string;
  labOrganizationId: string;
};

export type PortalCustomerScope =
  | {
      mode: "single";
      groupId: null;
      /** Exactly one customer id. */
      customerIds: number[];
      customerById: Map<number, PortalScopeCustomer>;
      labOrganizationId: string;
    }
  | {
      mode: "group";
      groupId: number;
      /** Zero or more branch customer ids (a group may have no branches yet). */
      customerIds: number[];
      customerById: Map<number, PortalScopeCustomer>;
      labOrganizationId: string;
    };

/**
 * Resolve the set of customers the active portal org may access.
 * Returns `null` when the org maps to nothing, or to a customer/group whose
 * lab does not match the host lab (cross-tenant guard).
 */
export async function resolvePortalCustomerScope(params: {
  activeOrgId: string;
  labScope: string | null;
}): Promise<PortalCustomerScope | null> {
  const { activeOrgId, labScope } = params;

  // 1) Active org is a branch customer's CLIENT org.
  const [directCustomer] = await db
    .select({
      id: customer.id,
      name: customer.name,
      labOrganizationId: customer.labOrganizationId,
    })
    .from(customer)
    .where(eq(customer.authOrganizationId, activeOrgId))
    .limit(1);

  if (directCustomer) {
    if (labScope && directCustomer.labOrganizationId !== labScope) return null;
    return {
      mode: "single",
      groupId: null,
      customerIds: [directCustomer.id],
      customerById: new Map([[directCustomer.id, directCustomer]]),
      labOrganizationId: directCustomer.labOrganizationId,
    };
  }

  // 2) Active org is a customer group's CLIENT org → fan out to branches.
  const [group] = await db
    .select({
      id: customerGroup.id,
      labOrganizationId: customerGroup.labOrganizationId,
    })
    .from(customerGroup)
    .where(eq(customerGroup.authOrganizationId, activeOrgId))
    .limit(1);

  if (!group) return null;
  if (labScope && group.labOrganizationId !== labScope) return null;

  // The lab-match predicate on branches is the cross-tenant guard: even a
  // mis-assigned branch cannot leak across labs.
  const branches = await db
    .select({
      id: customer.id,
      name: customer.name,
      labOrganizationId: customer.labOrganizationId,
    })
    .from(customer)
    .where(
      and(
        eq(customer.groupId, group.id),
        eq(customer.labOrganizationId, group.labOrganizationId),
      ),
    );

  return {
    mode: "group",
    groupId: group.id,
    customerIds: branches.map((branch) => branch.id),
    customerById: new Map(branches.map((branch) => [branch.id, branch])),
    labOrganizationId: group.labOrganizationId,
  };
}

/**
 * Narrow a resolved scope to a single unit (= branch customer id), e.g. the
 * portal's per-unit filter. Returns all scope customers when no unit is given;
 * an empty array when the requested unit is not in scope (caller short-circuits
 * to an empty payload rather than passing `[]` to `inArray`).
 */
export function applyUnitFilter(
  scope: PortalCustomerScope,
  unitId: number | undefined,
): number[] {
  if (unitId === undefined) return scope.customerIds;
  return scope.customerIds.includes(unitId) ? [unitId] : [];
}

/**
 * Every branch customer a portal user can access, across ALL their CLIENT-org
 * memberships (active-org-agnostic) — both direct branch orgs and group orgs
 * (a group membership expands to its branches). Used by the certificate
 * endpoints, which historically fan out over all of a user's customers
 * regardless of the active switcher selection; this preserves that behavior
 * while adding group support. All results are constrained to the host lab.
 */
/**
 * The CLIENT organization ids whose in-app notification rows a portal user
 * may read. Notification rows are always addressed to a recipient user, but
 * their `organizationId` is the CLIENT org the event belongs to — a branch
 * customer's org for most dispatchers. A user therefore sees rows from:
 * every CLIENT org they belong to with a portal role (validated against the
 * host lab through its customer/customer-group mapping — the cross-tenant
 * guard), plus, for group memberships, the branch customers' own CLIENT orgs
 * (group cockpit: rows addressed to a unit org must reach the group's
 * quality manager). Lab orgs never qualify, so a dual-role user's lab-side
 * notifications stay out of the portal.
 */
export async function resolvePortalNotificationOrgIds(params: {
  userId: string;
  labScope: string | null;
}): Promise<string[]> {
  const { userId, labScope } = params;

  const orgs = await db
    .select({ orgId: member.organizationId })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(
      and(
        eq(member.userId, userId),
        eq(organization.type, "CLIENT"),
        inArray(member.role, PORTAL_ACCESS_ROLES),
      ),
    );

  const memberOrgIds = orgs.map((row) => row.orgId);
  if (memberOrgIds.length === 0) return [];

  const orgIds = new Set<string>();

  // Direct branch memberships.
  const directCustomers = await db
    .select({ authOrganizationId: customer.authOrganizationId })
    .from(customer)
    .where(
      and(
        inArray(customer.authOrganizationId, memberOrgIds),
        labScope ? eq(customer.labOrganizationId, labScope) : undefined,
      ),
    );
  for (const row of directCustomers) {
    if (row.authOrganizationId) orgIds.add(row.authOrganizationId);
  }

  // Group memberships → the group org itself plus all branch customer orgs.
  const groups = await db
    .select({
      id: customerGroup.id,
      authOrganizationId: customerGroup.authOrganizationId,
    })
    .from(customerGroup)
    .where(
      and(
        inArray(customerGroup.authOrganizationId, memberOrgIds),
        labScope ? eq(customerGroup.labOrganizationId, labScope) : undefined,
      ),
    );
  for (const row of groups) {
    if (row.authOrganizationId) orgIds.add(row.authOrganizationId);
  }
  const groupIds = groups.map((row) => row.id);
  if (groupIds.length > 0) {
    const branchOrgs = await db
      .select({ authOrganizationId: customer.authOrganizationId })
      .from(customer)
      .where(
        and(
          inArray(customer.groupId, groupIds),
          labScope ? eq(customer.labOrganizationId, labScope) : undefined,
        ),
      );
    for (const row of branchOrgs) {
      if (row.authOrganizationId) orgIds.add(row.authOrganizationId);
    }
  }

  return [...orgIds];
}

export async function resolvePortalAccessibleCustomerIds(params: {
  userId: string;
  labScope: string | null;
}): Promise<number[]> {
  const { userId, labScope } = params;

  const orgs = await db
    .select({ orgId: member.organizationId })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(
      and(
        eq(member.userId, userId),
        eq(organization.type, "CLIENT"),
        inArray(member.role, PORTAL_ACCESS_ROLES),
      ),
    );

  const orgIds = orgs.map((row) => row.orgId);
  if (orgIds.length === 0) return [];

  const ids = new Set<number>();

  // Direct branch memberships.
  const directCustomers = await db
    .select({ id: customer.id })
    .from(customer)
    .where(
      and(
        inArray(customer.authOrganizationId, orgIds),
        labScope ? eq(customer.labOrganizationId, labScope) : undefined,
      ),
    );
  for (const row of directCustomers) ids.add(row.id);

  // Group memberships → expand to branch customers.
  const groups = await db
    .select({ id: customerGroup.id })
    .from(customerGroup)
    .where(
      and(
        inArray(customerGroup.authOrganizationId, orgIds),
        labScope ? eq(customerGroup.labOrganizationId, labScope) : undefined,
      ),
    );
  const groupIds = groups.map((row) => row.id);
  if (groupIds.length > 0) {
    const groupCustomers = await db
      .select({ id: customer.id })
      .from(customer)
      .where(
        and(
          inArray(customer.groupId, groupIds),
          labScope ? eq(customer.labOrganizationId, labScope) : undefined,
        ),
      );
    for (const row of groupCustomers) ids.add(row.id);
  }

  return [...ids];
}
