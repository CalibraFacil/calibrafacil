import { createRouter } from "../../../server/router";
import { uniqueSlug } from "../../../lib/unique-slug";
import { customerGroupEndpoints } from "@calibra-facil/contracts";
import {
  asset,
  customer,
  customerGroup,
  invitation,
  member,
  user,
} from "@calibra-facil/db/schema";
import {
  PORTAL_MANAGEABLE_MEMBER_ROLES,
  PORTAL_VISIBLE_MEMBER_ROLES,
  isPortalManageableMemberRole,
} from "@calibra-facil/auth/access";
import { LAB_TODAY_SQL } from "@calibra-facil/shared";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";
import {
  cancelPortalInvitationAsService,
  createClientOrganizationAsServiceOwner,
  createPortalInvitationAsService,
  enforceClientPortalMembershipBoundary,
  removePortalMemberAsService,
} from "../../../lib/portal-service-account";
import { requireGroupRouteId, requireLabGroup } from "../customer-group-access";
import {
  DomainError,
  forbidden,
  invalid,
  notFound,
} from "../../../lib/domain-errors";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

// Mirrors the portal's DUE_SOON window (apps/portal calibration-status / portal.ts).
const DUE_SOON_DAYS = 30;

function getStringProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const property = Object.fromEntries(Object.entries(value))[key];
  return typeof property === "string" ? property : undefined;
}

const PREFIX = "/api/customer-groups";

/**
 * Customer groups (redes/grupos) — a lab models a multi-unit client as a group
 * whose branches are individual `customer` rows. The group is itself a CLIENT
 * organization (its own portal tenant); the portal fans a group-org session
 * out to every branch (see lib/portal-customer-scope).
 */
export const customerGroupsRouter = createRouter<{
  Variables: AuthVariables;
}>();

mount(
  customerGroupsRouter,
  PREFIX,
  customerGroupEndpoints.create,
  withLabPermission({ client: ["create"] }),
  async (c, { body: input }) => {
    const memberData = c.get("member");

    const orgResult = await createClientOrganizationAsServiceOwner({
      name: input.name,
      slug: `grupo-${uniqueSlug(input.name, 40)}`,
    });

    if (!orgResult?.id) {
      throw new DomainError({
        code: "customer_group_create_failed",
        status: 500,
        message: "Falha ao criar organizacao do grupo",
      });
    }

    const [newGroup] = await withOrg(
      memberData.organizationId,
      requestActor(c),
      (ctx) =>
        ctx.o
          .insert(customerGroup)
          .values({
            name: input.name,
            authOrganizationId: orgResult.id,
            labOrganizationId: memberData.organizationId,
          })
          .returning(),
    );

    if (!newGroup) {
      throw new DomainError({
        code: "customer_group_create_failed",
        status: 500,
        message: "Falha ao criar grupo",
      });
    }

    let invitationId: string | null = null;
    if (input.email && input.email.trim() !== "") {
      try {
        const inviteResult = await createPortalInvitationAsService({
          email: input.email,
          role: PORTAL_MANAGEABLE_MEMBER_ROLES[0],
          organizationId: orgResult.id,
        });
        invitationId = inviteResult?.id ?? null;
      } catch (inviteError) {
        console.error("Failed to send group invitation:", inviteError);
      }
    }

    return { ...newGroup, invitationId };
  },
);

mount(
  customerGroupsRouter,
  PREFIX,
  customerGroupEndpoints.list,
  withLabPermission({ client: ["read"] }),
  async (c) => {
    const memberData = c.get("member");

    const groups = await orgDb(memberData.organizationId).transaction((o) =>
      o
        .select({
          id: customerGroup.id,
          name: customerGroup.name,
          authOrganizationId: customerGroup.authOrganizationId,
          createdAt: customerGroup.createdAt,
          // Correlated to the scoped group row; the lab's tenant policy
          // also applies to the customer rows it counts.
          branchCount: sql<number>`cast((select count(*) from ${customer} where ${customer.groupId} = ${customerGroup.id}) as int)`,
        })
        .from(customerGroup)
        .where(eq(customerGroup.labOrganizationId, memberData.organizationId))
        .orderBy(desc(customerGroup.createdAt)),
    );

    return { data: groups };
  },
);

mount(
  customerGroupsRouter,
  PREFIX,
  customerGroupEndpoints.get,
  withLabPermission({ client: ["read"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const id = requireGroupRouteId(params.id);

    return await orgDb(memberData.organizationId).transaction(async (o) => {
      const [group] = await o
        .select({
          id: customerGroup.id,
          name: customerGroup.name,
          authOrganizationId: customerGroup.authOrganizationId,
          createdAt: customerGroup.createdAt,
        })
        .from(customerGroup)
        .where(
          and(
            eq(customerGroup.id, id),
            eq(customerGroup.labOrganizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!group) {
        throw notFound("customer_group_not_found", "Grupo nao encontrado");
      }

      const branchRows = await o
        .select({
          id: customer.id,
          name: customer.name,
          taxId: customer.taxId,
        })
        .from(customer)
        .where(eq(customer.groupId, group.id))
        .orderBy(customer.name);

      // Per-branch active-instrument counts (overview KPIs), one grouped query.
      const branchIds = branchRows.map((branch) => branch.id);
      const countsById = new Map<
        number,
        { total: number; overdue: number; dueSoon: number }
      >();
      if (branchIds.length > 0) {
        const labToday = sql.raw(LAB_TODAY_SQL);
        const labSoon = sql`(${labToday} + ${sql.raw(String(DUE_SOON_DAYS))})`;
        const counts = await o
          .select({
            customerId: asset.customerId,
            total: sql<number>`cast(count(*) as int)`,
            overdue: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} < ${labToday}) as int)`,
            dueSoon: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} >= ${labToday} and ${asset.nextCalibrationDate} <= ${labSoon}) as int)`,
          })
          .from(asset)
          .where(
            and(
              inArray(asset.customerId, branchIds),
              eq(asset.status, "ACTIVE"),
              isNull(asset.deletedAt),
            ),
          )
          .groupBy(asset.customerId);
        for (const row of counts) {
          countsById.set(row.customerId, {
            total: row.total,
            overdue: row.overdue,
            dueSoon: row.dueSoon,
          });
        }
      }

      const branches = branchRows.map((branch) => ({
        ...branch,
        ...(countsById.get(branch.id) ?? {
          total: 0,
          overdue: 0,
          dueSoon: 0,
        }),
      }));

      return { ...group, branches };
    });
  },
);

mount(
  customerGroupsRouter,
  PREFIX,
  customerGroupEndpoints.addBranch,
  withLabPermission({ client: ["update"] }),
  async (c, { params, body: { customerId } }) => {
    const memberData = c.get("member");
    const id = requireGroupRouteId(params.id);

    await withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      const [group] = await ctx.o
        .select({ id: customerGroup.id })
        .from(customerGroup)
        .where(
          and(
            eq(customerGroup.id, id),
            eq(customerGroup.labOrganizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!group) {
        throw notFound("customer_group_not_found", "Grupo nao encontrado");
      }

      // The branch must belong to the same lab as the group (cross-tenant guard).
      const [branch] = await ctx.o
        .select({ id: customer.id, groupId: customer.groupId })
        .from(customer)
        .where(
          and(
            eq(customer.id, customerId),
            eq(customer.labOrganizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!branch) {
        throw notFound("customer_not_found", "Cliente nao encontrado");
      }

      await ctx.o
        .update(customer)
        .set({ groupId: group.id, updatedAt: new Date() })
        .where(eq(customer.id, customerId));

      await ctx.audit("customer", customerId, {
        action: "group_assignment",
        changes: { groupId: { old: branch.groupId, new: group.id } },
      });
    });

    return { success: true as const };
  },
);

mount(
  customerGroupsRouter,
  PREFIX,
  customerGroupEndpoints.removeBranch,
  withLabPermission({ client: ["update"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const id = requireGroupRouteId(params.id);
    const customerId = requireGroupRouteId(params.customerId);

    await withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      // Only detach a branch that is actually in this group, in this lab.
      const result = await ctx.o
        .update(customer)
        .set({ groupId: null, updatedAt: new Date() })
        .where(
          and(
            eq(customer.id, customerId),
            eq(customer.groupId, id),
            eq(customer.labOrganizationId, memberData.organizationId),
          ),
        )
        .returning();

      if (result.length === 0) {
        throw notFound(
          "customer_not_in_group",
          "Cliente nao encontrado no grupo",
        );
      }

      await ctx.audit("customer", customerId, {
        action: "group_removal",
        changes: { groupId: { old: id, new: null } },
      });
    });

    return { success: true as const };
  },
);

mount(
  customerGroupsRouter,
  PREFIX,
  customerGroupEndpoints.listMembers,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const group = await requireLabGroup(params.id, memberData.organizationId);

    // `member` rows of the CLIENT organization carry that organization as
    // their tenant column: it is the one the transaction names (the lab
    // already proved the group is its own above).
    const members = await orgDb(group.authOrganizationId).transaction((o) =>
      o
        .select({
          id: member.id,
          userId: member.userId,
          role: member.role,
          createdAt: member.createdAt,
          userName: user.name,
          userEmail: user.email,
          userImage: user.image,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.organizationId, group.authOrganizationId),
            inArray(member.role, PORTAL_VISIBLE_MEMBER_ROLES),
          ),
        ),
    );

    return members;
  },
);

mount(
  customerGroupsRouter,
  PREFIX,
  customerGroupEndpoints.listInvitations,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const group = await requireLabGroup(params.id, memberData.organizationId);

    // The CLIENT organization's own invitation rows (see the members read).
    const invitations = await orgDb(group.authOrganizationId).transaction((o) =>
      o
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
          inviterName: user.name,
          inviterEmail: user.email,
        })
        .from(invitation)
        .innerJoin(user, eq(invitation.inviterId, user.id))
        .where(eq(invitation.organizationId, group.authOrganizationId))
        .orderBy(desc(invitation.createdAt)),
    );

    return invitations;
  },
);

mount(
  customerGroupsRouter,
  PREFIX,
  customerGroupEndpoints.createInvitation,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params, body: { email, role } }) => {
    const memberData = c.get("member");
    const portalRole = role || PORTAL_MANAGEABLE_MEMBER_ROLES[0];
    const group = await requireLabGroup(params.id, memberData.organizationId);

    await enforceClientPortalMembershipBoundary(group.authOrganizationId);

    const inviteResult = await createPortalInvitationAsService({
      email,
      role: portalRole,
      organizationId: group.authOrganizationId,
    });

    if (!inviteResult?.id) {
      throw new DomainError({
        code: "portal_invitation_failed",
        status: 500,
        message: "Falha ao criar convite",
      });
    }

    return { id: inviteResult.id, email, role: portalRole };
  },
);

mount(
  customerGroupsRouter,
  PREFIX,
  customerGroupEndpoints.resendInvitation,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const group = await requireLabGroup(params.id, memberData.organizationId);

    const [foundInvitation] = await orgDb(group.authOrganizationId).transaction(
      (o) =>
        o
          .select()
          .from(invitation)
          .where(
            and(
              eq(invitation.id, params.invId),
              eq(invitation.organizationId, group.authOrganizationId),
            ),
          )
          .limit(1),
    );

    if (!foundInvitation) {
      throw notFound("portal_invitation_not_found", "Convite nao encontrado");
    }
    if (foundInvitation.status !== "pending") {
      throw invalid(
        "portal_invitation_not_pending",
        "Apenas convites pendentes podem ser reenviados",
      );
    }

    await enforceClientPortalMembershipBoundary(group.authOrganizationId);
    await cancelPortalInvitationAsService({
      invitationId: params.invId,
      organizationId: group.authOrganizationId,
    });
    const newInvite = await createPortalInvitationAsService({
      email: foundInvitation.email,
      role: foundInvitation.role || PORTAL_MANAGEABLE_MEMBER_ROLES[0],
      organizationId: group.authOrganizationId,
    });

    return {
      id: getStringProperty(newInvite, "id"),
      email: foundInvitation.email,
    };
  },
);

mount(
  customerGroupsRouter,
  PREFIX,
  customerGroupEndpoints.cancelInvitation,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const group = await requireLabGroup(params.id, memberData.organizationId);

    const [foundInvitation] = await orgDb(group.authOrganizationId).transaction(
      (o) =>
        o
          .select()
          .from(invitation)
          .where(
            and(
              eq(invitation.id, params.invId),
              eq(invitation.organizationId, group.authOrganizationId),
            ),
          )
          .limit(1),
    );

    if (!foundInvitation) {
      throw notFound("portal_invitation_not_found", "Convite nao encontrado");
    }
    if (foundInvitation.status !== "pending") {
      throw invalid(
        "portal_invitation_not_pending",
        "Apenas convites pendentes podem ser cancelados",
      );
    }

    await enforceClientPortalMembershipBoundary(group.authOrganizationId);
    await cancelPortalInvitationAsService({
      invitationId: params.invId,
      organizationId: group.authOrganizationId,
    });

    return { success: true as const };
  },
);

mount(
  customerGroupsRouter,
  PREFIX,
  customerGroupEndpoints.removeMember,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const group = await requireLabGroup(params.id, memberData.organizationId);

    const [foundMember] = await orgDb(group.authOrganizationId).transaction(
      (o) =>
        o
          .select({ id: member.id, role: member.role })
          .from(member)
          .where(
            and(
              eq(member.id, params.memberId),
              eq(member.organizationId, group.authOrganizationId),
            ),
          )
          .limit(1),
    );

    if (!foundMember) {
      throw notFound("portal_member_not_found", "Membro nao encontrado");
    }
    if (!isPortalManageableMemberRole(foundMember.role)) {
      throw forbidden(
        "portal_member_not_removable",
        "Apenas usuarios externos do portal podem ser removidos por esta tela",
      );
    }

    await enforceClientPortalMembershipBoundary(group.authOrganizationId);
    await removePortalMemberAsService({
      memberId: params.memberId,
      organizationId: group.authOrganizationId,
    });

    return { success: true as const };
  },
);
