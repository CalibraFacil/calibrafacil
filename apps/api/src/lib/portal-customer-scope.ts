import { systemDb } from "@calibra-facil/db";
import {
  customer,
  customerGroup,
  member,
  organization,
} from "@calibra-facil/db/schema";
import { PORTAL_ACCESS_ROLES } from "@calibra-facil/auth/access";
import { and, eq, inArray, or, sql } from "drizzle-orm";

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
 *
 * SYSTEM PATH (P2-18a): every statement in this module runs on `systemDb`, the
 * owner connection, on purpose. They start from the signed-in USER or from a
 * CLIENT organization, both outside any laboratory, and their job is to LEARN
 * which laboratory (or set of laboratories) the portal session belongs to; row-level
 * security needs that laboratory named before a tenant read can run, so these
 * lookups cannot be bound to one yet. Each produces ids that every other portal
 * statement is then bound to (`orgDb(scope.labOrganizationId).transaction`,
 * `orgSetDb`); they are the only statements of the portal that are
 * cross-organization on purpose (see tenant-sql-allowlist.ts, portal-cross-org).
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
  const [directCustomer] = await systemDb
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
  const [group] = await systemDb
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
  const branches = await systemDb
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

  const orgs = await systemDb
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
  const directCustomers = await systemDb
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
  const groups = await systemDb
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
    const branchOrgs = await systemDb
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

export type PortalAccessibleCustomers = {
  customerIds: number[];
  /**
   * The laboratories those customers belong to. A customer user can belong to
   * customers of more than one laboratory (on the default portal host nothing
   * narrows it), so a query over `customerIds` runs through
   * `orgSetDb(labOrganizationIds)` and cannot reach any other laboratory.
   */
  labOrganizationIds: string[];
};

export async function resolvePortalAccessibleCustomers(params: {
  userId: string;
  labScope: string | null;
}): Promise<PortalAccessibleCustomers> {
  const { userId, labScope } = params;

  const orgs = await systemDb
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
  if (orgIds.length === 0) return { customerIds: [], labOrganizationIds: [] };

  const labByCustomerId = new Map<number, string>();

  // Direct branch memberships.
  const directCustomers = await systemDb
    .select({ id: customer.id, labOrganizationId: customer.labOrganizationId })
    .from(customer)
    .where(
      and(
        inArray(customer.authOrganizationId, orgIds),
        labScope ? eq(customer.labOrganizationId, labScope) : undefined,
      ),
    );
  for (const row of directCustomers) {
    labByCustomerId.set(row.id, row.labOrganizationId);
  }

  // Group memberships → expand to branch customers.
  const groups = await systemDb
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
    const groupCustomers = await systemDb
      .select({
        id: customer.id,
        labOrganizationId: customer.labOrganizationId,
      })
      .from(customer)
      .where(
        and(
          inArray(customer.groupId, groupIds),
          labScope ? eq(customer.labOrganizationId, labScope) : undefined,
        ),
      );
    for (const row of groupCustomers) {
      labByCustomerId.set(row.id, row.labOrganizationId);
    }
  }

  return {
    customerIds: [...labByCustomerId.keys()],
    labOrganizationIds: [...new Set(labByCustomerId.values())],
  };
}

/**
 * The customer a CLIENT organization is linked to, for the endpoints that act
 * for exactly one branch customer (creating a request). It is the lookup that
 * learns WHICH laboratory the portal session belongs to, so it cannot be bound
 * to a laboratory yet; it is narrowed to the host laboratory when there is one.
 */
export async function resolvePortalLinkedCustomer(params: {
  authOrganizationId: string;
  labScope: string | null;
}) {
  const [linkedCustomer] = await systemDb
    .select({
      id: customer.id,
      name: customer.name,
      labOrganizationId: customer.labOrganizationId,
      address: customer.address,
    })
    .from(customer)
    .where(
      and(
        eq(customer.authOrganizationId, params.authOrganizationId),
        params.labScope
          ? eq(customer.labOrganizationId, params.labScope)
          : undefined,
      ),
    )
    .limit(1);

  return linkedCustomer ?? null;
}

/**
 * The CLIENT organizations a portal user belongs to (the organization
 * switcher), each tagged as a branch ("unit") or a customer group. A person's
 * memberships are cross-organization by design: the signed-in user, not a
 * laboratory, is the boundary. Narrowed to the host laboratory when there is one.
 */
export async function listPortalClientOrganizations(params: {
  userId: string;
  labScope: string | null;
}) {
  return systemDb
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      type: organization.type,
      createdAt: organization.createdAt,
      memberRole: member.role,
      // A group org has no `customer` row: left-join both so it is not dropped.
      kind: sql<
        "unit" | "group"
      >`case when ${customerGroup.id} is not null then 'group' else 'unit' end`,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .leftJoin(customer, eq(customer.authOrganizationId, organization.id))
    .leftJoin(
      customerGroup,
      eq(customerGroup.authOrganizationId, organization.id),
    )
    .where(
      and(
        eq(member.userId, params.userId),
        eq(organization.type, "CLIENT"),
        inArray(member.role, PORTAL_ACCESS_ROLES),
        params.labScope
          ? or(
              eq(customer.labOrganizationId, params.labScope),
              eq(customerGroup.labOrganizationId, params.labScope),
            )
          : undefined,
      ),
    );
}
