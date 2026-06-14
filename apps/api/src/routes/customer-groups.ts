import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  asset,
  customer,
  customerGroup,
  customerAuditLog,
  invitation,
  member,
  user,
} from "@calibra-facil/db/schema";
import {
  AssignCustomerGroupBranchSchema,
  CreateCustomerGroupSchema,
  CreatePortalInvitationSchema,
} from "@calibra-facil/schemas";
import {
  PORTAL_MANAGEABLE_MEMBER_ROLES,
  PORTAL_VISIBLE_MEMBER_ROLES,
  isPortalManageableMemberRole,
} from "@calibra-facil/auth/access";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { requireFeature } from "../middleware/tier-guard";
import {
  cancelPortalInvitationAsService,
  createClientOrganizationAsServiceOwner,
  createPortalInvitationAsService,
  enforceClientPortalMembershipBoundary,
  PortalServiceAccountError,
  removePortalMemberAsService,
} from "../lib/portal-service-account";

// Mirrors the portal's DUE_SOON window (apps/portal calibration-status / portal.ts).
const DUE_SOON_DAYS = 30;

function portalErrorStatus(
  error: PortalServiceAccountError,
): 400 | 401 | 403 | 404 | 409 | 500 {
  switch (error.status) {
    case 400:
    case 401:
    case 403:
    case 404:
    case 409:
      return error.status;
    default:
      return 500;
  }
}

function getStringProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const property = Object.fromEntries(Object.entries(value))[key];
  return typeof property === "string" ? property : undefined;
}

/** Lab-scoped group lookup: the cross-tenant gate for the member endpoints. */
async function resolveLabGroupOrg(id: number, labOrganizationId: string) {
  const [group] = await db
    .select({
      id: customerGroup.id,
      authOrganizationId: customerGroup.authOrganizationId,
    })
    .from(customerGroup)
    .where(
      and(
        eq(customerGroup.id, id),
        eq(customerGroup.labOrganizationId, labOrganizationId),
      ),
    )
    .limit(1);
  return group ?? null;
}

function generateUniqueSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 40);
  const suffix = Math.random().toString(36).substring(2, 8);
  return `grupo-${base}-${suffix}`;
}

function clientIp(c: {
  req: { header: (name: string) => string | undefined };
}) {
  return c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null;
}

/**
 * Customer groups (redes/grupos) — a lab models a multi-unit client as a group
 * whose branches are individual `customer` rows. The group is itself a CLIENT
 * organization (its own portal tenant); the portal fans a group-org session
 * out to every branch (see lib/portal-customer-scope). Gated by the
 * `customer_group` entitlement (Professional+).
 */
export const customerGroupsRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // POST / - Create a group (provisions its CLIENT org; optional manager invite)
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ client: ["create"] }),
    requireFeature("customer_group"),
    zValidator("json", CreateCustomerGroupSchema),
    async (c) => {
      const input = c.req.valid("json");
      const memberData = c.get("member");

      try {
        const orgResult = await createClientOrganizationAsServiceOwner({
          name: input.name,
          slug: generateUniqueSlug(input.name),
        });

        if (!orgResult?.id) {
          return c.json({ error: "Falha ao criar organizacao do grupo" }, 500);
        }

        const [newGroup] = await db
          .insert(customerGroup)
          .values({
            name: input.name,
            authOrganizationId: orgResult.id,
            labOrganizationId: memberData.organizationId,
          })
          .returning();

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

        return c.json({ ...newGroup, invitationId }, 201);
      } catch (error) {
        console.error("Error creating customer group:", error);
        return c.json({ error: "Erro ao criar grupo" }, 500);
      }
    },
  )

  // =========================================================================
  // GET / - List the lab's groups, with branch counts
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ client: ["read"] }),
    requireFeature("customer_group"),
    async (c) => {
      const memberData = c.get("member");

      try {
        const groups = await db
          .select({
            id: customerGroup.id,
            name: customerGroup.name,
            authOrganizationId: customerGroup.authOrganizationId,
            createdAt: customerGroup.createdAt,
            branchCount: sql<number>`cast((select count(*) from ${customer} where ${customer.groupId} = ${customerGroup.id}) as int)`,
          })
          .from(customerGroup)
          .where(eq(customerGroup.labOrganizationId, memberData.organizationId))
          .orderBy(desc(customerGroup.createdAt));

        return c.json({ data: groups });
      } catch (error) {
        console.error("Error listing customer groups:", error);
        return c.json({ error: "Erro ao listar grupos" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /:id - Group detail with its branch customers
  // =========================================================================
  .get(
    "/:id",
    ...withLabPermission({ client: ["read"] }),
    requireFeature("customer_group"),
    async (c) => {
      const memberData = c.get("member");
      const id = Number.parseInt(c.req.param("id"), 10);
      if (Number.isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const [group] = await db
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
          return c.json({ error: "Grupo nao encontrado" }, 404);
        }

        const branchRows = await db
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
          const nowUtc = sql`(now() at time zone 'utc')`;
          const soonUtc = sql`((now() at time zone 'utc') + interval '${sql.raw(String(DUE_SOON_DAYS))} days')`;
          const counts = await db
            .select({
              customerId: asset.customerId,
              total: sql<number>`cast(count(*) as int)`,
              overdue: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} < ${nowUtc}) as int)`,
              dueSoon: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} >= ${nowUtc} and ${asset.nextCalibrationDate} <= ${soonUtc}) as int)`,
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

        return c.json({ ...group, branches });
      } catch (error) {
        console.error("Error fetching customer group:", error);
        return c.json({ error: "Erro ao buscar grupo" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/branches - Assign a branch customer to the group
  // =========================================================================
  .post(
    "/:id/branches",
    ...withLabPermission({ client: ["update"] }),
    requireFeature("customer_group"),
    zValidator("json", AssignCustomerGroupBranchSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const { customerId } = c.req.valid("json");
      if (Number.isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const [group] = await db
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
          return c.json({ error: "Grupo nao encontrado" }, 404);
        }

        // The branch must belong to the same lab as the group (cross-tenant guard).
        const [branch] = await db
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
          return c.json({ error: "Cliente nao encontrado" }, 404);
        }

        await db
          .update(customer)
          .set({ groupId: group.id, updatedAt: new Date() })
          .where(eq(customer.id, customerId));

        await db.insert(customerAuditLog).values({
          customerId,
          action: "group_assignment",
          changes: { groupId: { old: branch.groupId, new: group.id } },
          performedBy: session.user.id,
          ipAddress: clientIp(c),
        });

        return c.json({ success: true });
      } catch (error) {
        console.error("Error assigning branch to group:", error);
        return c.json({ error: "Erro ao vincular cliente ao grupo" }, 500);
      }
    },
  )

  // =========================================================================
  // DELETE /:id/branches/:customerId - Detach a branch from the group
  // =========================================================================
  .delete(
    "/:id/branches/:customerId",
    ...withLabPermission({ client: ["update"] }),
    requireFeature("customer_group"),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const customerId = Number.parseInt(c.req.param("customerId"), 10);
      if (Number.isNaN(id) || Number.isNaN(customerId)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        // Only detach a branch that is actually in this group, in this lab.
        const result = await db
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
          return c.json({ error: "Cliente nao encontrado no grupo" }, 404);
        }

        await db.insert(customerAuditLog).values({
          customerId,
          action: "group_removal",
          changes: { groupId: { old: id, new: null } },
          performedBy: session.user.id,
          ipAddress: clientIp(c),
        });

        return c.json({ success: true });
      } catch (error) {
        console.error("Error detaching branch from group:", error);
        return c.json({ error: "Erro ao desvincular cliente do grupo" }, 500);
      }
    },
  )

  // =========================================================================
  // Manager (Gestor) tab — the group's portal access. Mirrors the customer
  // member endpoints, keyed on the group's CLIENT org (authOrganizationId),
  // resolved via a lab-scoped lookup (the cross-tenant gate). Group member
  // actions are not written to customer_audit_log (no customerId) — known gap.
  // =========================================================================
  .get(
    "/:id/members",
    ...withLabPermission({ client: ["manage_portal"] }),
    requireFeature("customer_group"),
    async (c) => {
      const memberData = c.get("member");
      const id = Number.parseInt(c.req.param("id"), 10);
      if (Number.isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const group = await resolveLabGroupOrg(id, memberData.organizationId);
        if (!group) {
          return c.json({ error: "Grupo nao encontrado" }, 404);
        }

        const members = await db
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
          );

        return c.json(members);
      } catch (error) {
        console.error("Error listing group members:", error);
        return c.json({ error: "Erro ao listar gestores do grupo" }, 500);
      }
    },
  )

  .get(
    "/:id/invitations",
    ...withLabPermission({ client: ["manage_portal"] }),
    requireFeature("customer_group"),
    async (c) => {
      const memberData = c.get("member");
      const id = Number.parseInt(c.req.param("id"), 10);
      if (Number.isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const group = await resolveLabGroupOrg(id, memberData.organizationId);
        if (!group) {
          return c.json({ error: "Grupo nao encontrado" }, 404);
        }

        const invitations = await db
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
          .orderBy(desc(invitation.createdAt));

        return c.json(invitations);
      } catch (error) {
        console.error("Error listing group invitations:", error);
        return c.json({ error: "Erro ao listar convites" }, 500);
      }
    },
  )

  .post(
    "/:id/invitations",
    ...withLabPermission({ client: ["manage_portal"] }),
    requireFeature("customer_group"),
    zValidator("json", CreatePortalInvitationSchema),
    async (c) => {
      const { email, role } = c.req.valid("json");
      const memberData = c.get("member");
      const portalRole = role || PORTAL_MANAGEABLE_MEMBER_ROLES[0];
      const id = Number.parseInt(c.req.param("id"), 10);
      if (Number.isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const group = await resolveLabGroupOrg(id, memberData.organizationId);
        if (!group) {
          return c.json({ error: "Grupo nao encontrado" }, 404);
        }

        await enforceClientPortalMembershipBoundary(group.authOrganizationId);

        const inviteResult = await createPortalInvitationAsService({
          email,
          role: portalRole,
          organizationId: group.authOrganizationId,
        });

        if (!inviteResult?.id) {
          return c.json({ error: "Falha ao criar convite" }, 500);
        }

        return c.json({ id: inviteResult.id, email, role: portalRole }, 201);
      } catch (error) {
        console.error("Error creating group invitation:", error);
        if (error instanceof PortalServiceAccountError) {
          return c.json(
            { error: error.message, code: error.code },
            portalErrorStatus(error),
          );
        }
        return c.json({ error: "Erro ao criar convite" }, 500);
      }
    },
  )

  .post(
    "/:id/invitations/:invId/resend",
    ...withLabPermission({ client: ["manage_portal"] }),
    requireFeature("customer_group"),
    async (c) => {
      const invId = c.req.param("invId");
      const memberData = c.get("member");
      const id = Number.parseInt(c.req.param("id"), 10);
      if (Number.isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const group = await resolveLabGroupOrg(id, memberData.organizationId);
        if (!group) {
          return c.json({ error: "Grupo nao encontrado" }, 404);
        }

        const [foundInvitation] = await db
          .select()
          .from(invitation)
          .where(
            and(
              eq(invitation.id, invId),
              eq(invitation.organizationId, group.authOrganizationId),
            ),
          )
          .limit(1);

        if (!foundInvitation) {
          return c.json({ error: "Convite nao encontrado" }, 404);
        }
        if (foundInvitation.status !== "pending") {
          return c.json(
            { error: "Apenas convites pendentes podem ser reenviados" },
            400,
          );
        }

        await enforceClientPortalMembershipBoundary(group.authOrganizationId);
        await cancelPortalInvitationAsService({
          invitationId: invId,
          organizationId: group.authOrganizationId,
        });
        const newInvite = await createPortalInvitationAsService({
          email: foundInvitation.email,
          role: foundInvitation.role || PORTAL_MANAGEABLE_MEMBER_ROLES[0],
          organizationId: group.authOrganizationId,
        });

        return c.json({
          id: getStringProperty(newInvite, "id"),
          email: foundInvitation.email,
        });
      } catch (error) {
        console.error("Error resending group invitation:", error);
        if (error instanceof PortalServiceAccountError) {
          return c.json(
            { error: error.message, code: error.code },
            portalErrorStatus(error),
          );
        }
        return c.json({ error: "Erro ao reenviar convite" }, 500);
      }
    },
  )

  .delete(
    "/:id/invitations/:invId",
    ...withLabPermission({ client: ["manage_portal"] }),
    requireFeature("customer_group"),
    async (c) => {
      const invId = c.req.param("invId");
      const memberData = c.get("member");
      const id = Number.parseInt(c.req.param("id"), 10);
      if (Number.isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const group = await resolveLabGroupOrg(id, memberData.organizationId);
        if (!group) {
          return c.json({ error: "Grupo nao encontrado" }, 404);
        }

        const [foundInvitation] = await db
          .select()
          .from(invitation)
          .where(
            and(
              eq(invitation.id, invId),
              eq(invitation.organizationId, group.authOrganizationId),
            ),
          )
          .limit(1);

        if (!foundInvitation) {
          return c.json({ error: "Convite nao encontrado" }, 404);
        }
        if (foundInvitation.status !== "pending") {
          return c.json(
            { error: "Apenas convites pendentes podem ser cancelados" },
            400,
          );
        }

        await enforceClientPortalMembershipBoundary(group.authOrganizationId);
        await cancelPortalInvitationAsService({
          invitationId: invId,
          organizationId: group.authOrganizationId,
        });

        return c.json({ success: true });
      } catch (error) {
        console.error("Error canceling group invitation:", error);
        if (error instanceof PortalServiceAccountError) {
          return c.json(
            { error: error.message, code: error.code },
            portalErrorStatus(error),
          );
        }
        return c.json({ error: "Erro ao cancelar convite" }, 500);
      }
    },
  )

  .delete(
    "/:id/members/:memberId",
    ...withLabPermission({ client: ["manage_portal"] }),
    requireFeature("customer_group"),
    async (c) => {
      const memberId = c.req.param("memberId");
      const memberData = c.get("member");
      const id = Number.parseInt(c.req.param("id"), 10);
      if (Number.isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const group = await resolveLabGroupOrg(id, memberData.organizationId);
        if (!group) {
          return c.json({ error: "Grupo nao encontrado" }, 404);
        }

        const [foundMember] = await db
          .select({ id: member.id, role: member.role })
          .from(member)
          .where(
            and(
              eq(member.id, memberId),
              eq(member.organizationId, group.authOrganizationId),
            ),
          )
          .limit(1);

        if (!foundMember) {
          return c.json({ error: "Membro nao encontrado" }, 404);
        }
        if (!isPortalManageableMemberRole(foundMember.role)) {
          return c.json(
            {
              error:
                "Apenas usuarios externos do portal podem ser removidos por esta tela",
            },
            403,
          );
        }

        await enforceClientPortalMembershipBoundary(group.authOrganizationId);
        await removePortalMemberAsService({
          memberId,
          organizationId: group.authOrganizationId,
        });

        return c.json({ success: true });
      } catch (error) {
        console.error("Error removing group member:", error);
        if (error instanceof PortalServiceAccountError) {
          return c.json(
            { error: error.message, code: error.code },
            portalErrorStatus(error),
          );
        }
        return c.json({ error: "Erro ao remover membro" }, 500);
      }
    },
  );
