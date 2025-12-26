import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import { member, organization } from "@calibra-facil/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthVariables } from "../middleware/permission";

/**
 * Portal routes - endpoints specific to the client portal.
 * These routes handle client-facing functionality.
 */
export const portalRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET /organizations - List CLIENT organizations for the portal
  // =========================================================================
  // Returns only organizations where:
  // 1. The organization type is "CLIENT"
  // 2. The user's role is "client_user" (not "owner" or other lab admin roles)
  //
  // This ensures lab admins (who create CLIENT orgs and become "owner")
  // don't see those orgs in the client portal.
  // =========================================================================
  .get("/organizations", requireAuth, async (c) => {
    const session = c.get("session");

    try {
      // Query member table joined with organization
      // Filter by user ID, organization type CLIENT, and role client_user
      const clientOrganizations = await db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          logo: organization.logo,
          type: organization.type,
          createdAt: organization.createdAt,
          memberRole: member.role,
        })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(organization.type, "CLIENT"),
            eq(member.role, "client_user")
          )
        );

      return c.json(clientOrganizations);
    } catch (error) {
      console.error("Error listing portal organizations:", error);
      return c.json({ error: "Erro ao listar organizações" }, 500);
    }
  });
