import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  customer,
  customerGroup,
  customerAuditLog,
} from "@calibra-facil/db/schema";
import {
  AssignCustomerGroupBranchSchema,
  CreateCustomerGroupSchema,
} from "@calibra-facil/schemas";
import { PORTAL_MANAGEABLE_MEMBER_ROLES } from "@calibra-facil/auth/access";
import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { requireFeature } from "../middleware/tier-guard";
import {
  createClientOrganizationAsServiceOwner,
  createPortalInvitationAsService,
} from "../lib/portal-service-account";

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

        const branches = await db
          .select({
            id: customer.id,
            name: customer.name,
            taxId: customer.taxId,
          })
          .from(customer)
          .where(eq(customer.groupId, group.id))
          .orderBy(customer.name);

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
  );
