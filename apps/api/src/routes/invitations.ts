import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { createLabAuth, sendLabAccountSetupEmail } from "@calibra-facil/auth";
import {
  buildLabClaimUrl,
  createLabAccountSetupToken,
} from "@calibra-facil/auth/lab-access";
import { db } from "@calibra-facil/db";
import {
  invitation,
  organization,
  platformEventLog,
  user,
} from "@calibra-facil/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { userCreateErrorWasDuplicate } from "../lib/auth-user-errors";
import { withDbWakeRetry } from "../lib/db-retry";
import { appBaseUrl } from "@calibra-facil/shared/public-urls";

// Aliased user table for joining the inviter onto an invitation row.
const inviter = alias(user, "inviter");

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function getEnvValue(c: { env?: unknown }, key: string) {
  return recordFromUnknown(c.env)[key];
}

function resolveTrustedAppUrl(c: { env?: unknown }) {
  const configuredAppUrl =
    getEnvValue(c, "APP_URL") ?? process.env.APP_URL ?? process.env.WEB_URL;

  if (typeof configuredAppUrl === "string") {
    const trimmed = configuredAppUrl.trim().replace(/\/+$/, "");
    if (trimmed) return trimmed;
  }

  return appBaseUrl();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function displayNameFromEmail(email: string) {
  return (
    email
      .split("@")[0]
      ?.replace(/[._-]+/g, " ")
      .trim() || email
  );
}

async function findInvitationUser(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const existing = await db.query.user.findFirst({
    where: eq(sql<string>`lower(${user.email})`, normalizedEmail),
  });

  if (!existing) return null;

  return {
    id: existing.id,
    name: existing.name,
    email: existing.email,
  };
}

function invitationUserFromAuthResponse(value: unknown) {
  const candidate = recordFromUnknown(value);
  const nestedUser = recordFromUnknown(candidate.user);
  const createdUser =
    Object.keys(nestedUser).length > 0 ? nestedUser : candidate;

  if (
    typeof createdUser.id !== "string" ||
    typeof createdUser.email !== "string" ||
    typeof createdUser.name !== "string"
  ) {
    throw new Error("Lab auth returned an invalid user payload");
  }

  return {
    id: createdUser.id,
    name: createdUser.name,
    email: createdUser.email,
  };
}

async function ensureInvitationUser(email: string) {
  const existing = await findInvitationUser(email);

  if (existing) {
    return {
      created: false,
      user: existing,
    };
  }

  const auth = createLabAuth();

  try {
    const created = await auth.api.createUser({
      body: {
        name: displayNameFromEmail(email),
        email,
        password: randomBytes(24).toString("base64url"),
        role: "user",
      },
    });

    return {
      created: true,
      user: invitationUserFromAuthResponse(created),
    };
  } catch (error) {
    if (!userCreateErrorWasDuplicate(error)) {
      throw error;
    }

    const reloaded = await findInvitationUser(email);
    if (!reloaded) {
      throw error;
    }

    return {
      created: false,
      user: reloaded,
    };
  }
}

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
      // Fetch invitation with organization + inviter details. This endpoint is
      // public so a not-yet-signed-up invitee can render the accept page; keep
      // the projection limited to what that page needs. Wrap the first DB touch
      // in withDbWakeRetry so a Neon cold start is a brief delay, not a 500.
      const result = await withDbWakeRetry(() =>
        db
          .select({
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
            organizationId: invitation.organizationId,
            organizationName: organization.name,
            organizationSlug: organization.slug,
            inviterEmail: inviter.email,
          })
          .from(invitation)
          .innerJoin(
            organization,
            eq(invitation.organizationId, organization.id),
          )
          .leftJoin(inviter, eq(invitation.inviterId, inviter.id))
          .where(
            and(
              eq(invitation.id, id),
              eq(invitation.status, "pending"),
              gt(invitation.expiresAt, new Date()),
            ),
          )
          .limit(1),
      );

      const inv = result[0];
      if (!inv) {
        return c.json({ error: "Convite não encontrado" }, 404);
      }

      return c.json({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status: inv.status,
        expiresAt: inv.expiresAt,
        organizationId: inv.organizationId,
        organizationName: inv.organizationName,
        organizationSlug: inv.organizationSlug,
        inviterEmail: inv.inviterEmail ?? "",
      });
    } catch (error) {
      console.error("Error fetching invitation:", error);
      return c.json({ error: "Erro ao buscar convite" }, 500);
    }
  })
  .post("/:id/request-setup-link", async (c) => {
    const id = c.req.param("id");

    if (!id) {
      return c.json({ error: "ID de convite não fornecido" }, 400);
    }

    try {
      // First DB touch — retry through a Neon cold start so the invitee's
      // "Enviar link" click doesn't 500 on a freshly-woken compute.
      const result = await withDbWakeRetry(() =>
        db
          .select({
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
            organizationId: invitation.organizationId,
            organizationName: organization.name,
            organizationType: organization.type,
          })
          .from(invitation)
          .innerJoin(
            organization,
            eq(invitation.organizationId, organization.id),
          )
          .where(
            and(
              eq(invitation.id, id),
              eq(invitation.status, "pending"),
              gt(invitation.expiresAt, new Date()),
              eq(organization.type, "LAB"),
            ),
          )
          .limit(1),
      );

      const inv = result[0];
      if (!inv) {
        return c.json({ error: "Convite não encontrado" }, 404);
      }

      const invitedEmail = normalizeEmail(inv.email);
      const invitedUser = await ensureInvitationUser(invitedEmail);
      const appUrl = resolveTrustedAppUrl(c);
      const setupToken = await createLabAccountSetupToken({
        userId: invitedUser.user.id,
        organizationId: inv.organizationId,
        invitationId: inv.id,
        email: invitedEmail,
        purpose: "member_invite_claim",
        createdByUserId: null,
        source: "lab.invitation.setup_link_request",
      });

      await sendLabAccountSetupEmail({
        email: invitedEmail,
        recipientName: invitedUser.user.name,
        organizationName: inv.organizationName,
        claimUrl: buildLabClaimUrl(appUrl, setupToken.token),
      });

      await db.insert(platformEventLog).values({
        actorUserId: null,
        targetUserId: invitedUser.user.id,
        action: "invitation.setup_link_requested",
        entityType: "invitation",
        entityId: inv.id,
        details: {
          organizationId: inv.organizationId,
          organizationName: inv.organizationName,
          userCreated: invitedUser.created,
          email: invitedEmail,
          role: inv.role,
        },
      });

      return c.json({
        setupLinkRequested: true,
        userCreated: invitedUser.created,
      });
    } catch (error) {
      console.error("Error requesting invitation setup link:", error);
      return c.json({ error: "Erro ao enviar link de acesso" }, 500);
    }
  });
