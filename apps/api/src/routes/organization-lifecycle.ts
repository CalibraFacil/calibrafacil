import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { orgDb } from "../lib/org-db";
import { organization } from "@calibra-facil/db/schema";
import {
  SoftDeleteOrganizationSchema,
  confirmationMatchesOrganizationName,
} from "@calibra-facil/schemas";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
} from "../middleware/permission";
import {
  conflict,
  domainErrorResponse,
  invalid,
  notFound,
} from "../lib/domain-errors";
import { softDeleteLabOrganization } from "../lib/records-retention";

/**
 * Organization lifecycle (records retention, decision Q16).
 *
 * A laboratory is never deleted for real while it holds regulated records:
 * the owner soft-deletes it. Everything it holds is kept for the retention
 * period, the laboratory is suspended (nobody signs in, its API keys are
 * revoked) and only the records purge job may remove it, once the retention
 * period of its newest record has passed (docs/architecture/records-retention.md).
 */
export const organizationLifecycleRouter = new Hono<{
  Variables: AuthVariables;
}>().post(
  "/soft-delete",
  ...requireLabProtected,
  requireOrgType("LAB"),
  // Owner only: the same person who can close the laboratory down.
  requireRole(["owner"]),
  zValidator("json", SoftDeleteOrganizationSchema),
  async (c) => {
    const member = c.get("member");
    const session = c.get("session");
    const input = c.req.valid("json");

    const [lab] = await orgDb(member.organizationId)
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, member.organizationId))
      .limit(1);
    if (!lab) {
      return domainErrorResponse(
        c,
        notFound("not_found", "Organização não encontrada"),
      );
    }

    if (!confirmationMatchesOrganizationName(input.confirmName, lab.name)) {
      return domainErrorResponse(
        c,
        invalid(
          "organization_confirmation_mismatch",
          "O nome digitado não confere com o nome da organização",
        ),
      );
    }

    const outcome = await softDeleteLabOrganization({
      organizationId: member.organizationId,
      deletedBy: session.user.id,
      actorMemberId: member.id,
      reason: input.reason,
    });

    switch (outcome.status) {
      case "soft_deleted":
        return c.json({
          success: true,
          deletedAt: outcome.deletedAt.toISOString(),
        });
      case "already_deleted":
        return domainErrorResponse(
          c,
          conflict(
            "organization_already_deleted",
            "Esta organização já foi excluída",
          ),
        );
      case "not_found":
      case "not_lab":
        return domainErrorResponse(
          c,
          notFound("not_found", "Organização não encontrada"),
        );
    }
  },
);
