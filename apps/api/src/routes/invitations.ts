import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import { invitation, organization, user } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";

/**
 * Public invitations router
 * These endpoints do NOT require authentication - they are used by the
 * accept-invite flow where users are not yet signed up.
 */
export const invitationsRouter = new Hono()
  // =========================================================================
  // GET /:id - Get invitation details (public)
  // =========================================================================
  .get("/:id", async (c) => {
    const id = c.req.param("id");

    if (!id) {
      return c.json({ error: "ID de convite não fornecido" }, 400);
    }

    try {
      // Fetch invitation with organization details
      const result = await db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          organizationId: invitation.organizationId,
          organizationName: organization.name,
          organizationSlug: organization.slug,
          inviterId: invitation.inviterId,
        })
        .from(invitation)
        .innerJoin(organization, eq(invitation.organizationId, organization.id))
        .where(eq(invitation.id, id))
        .limit(1);

      const inv = result[0];
      if (!inv) {
        return c.json({ error: "Convite não encontrado" }, 404);
      }

      // Get inviter email if available
      let inviterEmail = "";
      if (inv.inviterId) {
        const inviterResult = await db
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, inv.inviterId))
          .limit(1);

        const inviter = inviterResult[0];
        if (inviter) {
          inviterEmail = inviter.email;
        }
      }

      return c.json({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status: inv.status,
        expiresAt: inv.expiresAt,
        organizationName: inv.organizationName,
        organizationSlug: inv.organizationSlug,
        inviterEmail,
      });
    } catch (error) {
      console.error("Error fetching invitation:", error);
      return c.json({ error: "Erro ao buscar convite" }, 500);
    }
  });
