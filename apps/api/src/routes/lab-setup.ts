import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { createLabAuth } from "@calibra-facil/auth";
import {
  buildLabClaimUrl,
  normalizeLabAccessEmail,
  validateLabAccountSetupToken,
} from "@calibra-facil/auth/lab-access";
import { db } from "@calibra-facil/db";
import {
  invitation,
  labAccountSetupToken,
  member,
  organization,
  platformEventLog,
  session as authSession,
} from "@calibra-facil/db/schema";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

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

  return process.env.NODE_ENV === "production"
    ? "https://calibrafacil.com"
    : "http://localhost:5173";
}

function tokenStatusHttpCode(status: string) {
  if (status === "expired" || status === "consumed") {
    return 410;
  }

  if (status === "invalid") {
    return 404;
  }

  return 400;
}

async function logClaimEvent(input: {
  action: string;
  targetUserId?: string | null;
  tokenId?: string | null;
  details?: Record<string, unknown> | null;
}) {
  await db.insert(platformEventLog).values({
    actorUserId: null,
    targetUserId: input.targetUserId ?? null,
    action: input.action,
    entityType: "lab_account_setup_token",
    entityId: input.tokenId ?? null,
    details: input.details ?? null,
  });
}

export const labSetupRouter = new Hono()
  .get("/:token", async (c) => {
    const rawToken = c.req.param("token");
    const validation = await validateLabAccountSetupToken(rawToken);

    if (!validation.ok) {
      return c.json(
        {
          status: validation.status,
          passkeyPreferred: true,
          fallbackMethods: ["magic_link", "email_otp"],
        },
        tokenStatusHttpCode(validation.status),
      );
    }

    return c.json({
      status: "ready",
      email: validation.token.email,
      organizationName: validation.token.organizationName,
      organizationSlug: validation.token.organizationSlug,
      expiresAt: validation.token.expiresAt,
      passkeyPreferred: true,
      fallbackMethods: ["magic_link", "email_otp"],
    });
  })
  .post("/:token/request-magic-link", async (c) => {
    const rawToken = c.req.param("token");
    const validation = await validateLabAccountSetupToken(rawToken);

    if (!validation.ok) {
      await logClaimEvent({
        action: "lab_account.magic_link_request_failed",
        details: { reason: validation.status },
      });
      return c.json(
        { magicLinkRequested: true },
        tokenStatusHttpCode(validation.status),
      );
    }

    const appUrl = resolveTrustedAppUrl(c);
    const claimUrl = buildLabClaimUrl(appUrl, rawToken);
    const auth = createLabAuth();
    const response = await auth.api.signInMagicLink({
      body: {
        email: validation.token.email,
        callbackURL: claimUrl,
        errorCallbackURL: claimUrl,
        metadata: {
          setupToken: rawToken,
        },
      },
      headers: c.req.raw.headers,
      asResponse: true,
    });

    if (!response.ok) {
      return c.json({ error: "Falha ao enviar link mágico" }, 500);
    }

    await logClaimEvent({
      action: "lab_account.magic_link_requested",
      targetUserId: validation.token.userId,
      tokenId: validation.token.id,
      details: {
        organizationId: validation.token.organizationId,
        invitationId: validation.token.invitationId,
      },
    });

    return c.json({ magicLinkRequested: true });
  })
  .post("/:token/request-otp", async (c) => {
    const rawToken = c.req.param("token");
    const validation = await validateLabAccountSetupToken(rawToken);

    if (!validation.ok) {
      await logClaimEvent({
        action: "lab_account.otp_request_failed",
        details: { reason: validation.status },
      });
      return c.json(
        { otpRequested: true },
        tokenStatusHttpCode(validation.status),
      );
    }

    const auth = createLabAuth();
    const response = await auth.api.sendVerificationOTP({
      body: {
        email: validation.token.email,
        type: "sign-in",
      },
      asResponse: true,
    });

    if (!response.ok) {
      return c.json({ error: "Falha ao enviar código" }, 500);
    }

    await logClaimEvent({
      action: "lab_account.otp_requested",
      targetUserId: validation.token.userId,
      tokenId: validation.token.id,
      details: {
        organizationId: validation.token.organizationId,
        invitationId: validation.token.invitationId,
      },
    });

    return c.json({ otpRequested: true });
  })
  .post("/:token/complete", async (c) => {
    const rawToken = c.req.param("token");
    const validation = await validateLabAccountSetupToken(rawToken);

    if (!validation.ok) {
      await logClaimEvent({
        action: "lab_account.claim_failed",
        details: { reason: validation.status },
      });
      return c.json(
        { error: "Link de configuração inválido ou expirado" },
        tokenStatusHttpCode(validation.status),
      );
    }

    const auth = createLabAuth();
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session?.user?.id) {
      return c.json({ error: "Sessão obrigatória" }, 401);
    }

    if (
      session.user.id !== validation.token.userId ||
      normalizeLabAccessEmail(session.user.email) !== validation.token.email
    ) {
      await logClaimEvent({
        action: "lab_account.claim_failed",
        targetUserId: validation.token.userId,
        tokenId: validation.token.id,
        details: {
          reason: "session_user_mismatch",
          sessionUserId: session.user.id,
          organizationId: validation.token.organizationId,
        },
      });
      return c.json({ error: "Sessão não corresponde ao convite" }, 403);
    }

    try {
      await db.transaction(async (tx) => {
        if (!validation.token.hasMembership) {
          if (
            validation.token.purpose !== "member_invite_claim" ||
            !validation.token.invitationId
          ) {
            throw new Error("MEMBERSHIP_MISSING");
          }

          const [pendingInvitation] = await tx
            .select({
              id: invitation.id,
              role: invitation.role,
            })
            .from(invitation)
            .where(
              and(
                eq(invitation.id, validation.token.invitationId),
                eq(invitation.organizationId, validation.token.organizationId),
                eq(
                  sql<string>`lower(${invitation.email})`,
                  validation.token.email,
                ),
                eq(invitation.status, "pending"),
                gt(invitation.expiresAt, new Date()),
              ),
            )
            .limit(1);

          if (!pendingInvitation) {
            throw new Error("INVITATION_INVALID");
          }

          const [existingMembership] = await tx
            .select({ id: member.id })
            .from(member)
            .where(
              and(
                eq(member.organizationId, validation.token.organizationId),
                eq(member.userId, validation.token.userId),
              ),
            )
            .limit(1);

          if (!existingMembership) {
            await tx.insert(member).values({
              id: randomBytes(16).toString("hex"),
              organizationId: validation.token.organizationId,
              userId: validation.token.userId,
              role: pendingInvitation.role ?? "member",
              createdAt: new Date(),
            });
          }

          await tx
            .update(invitation)
            .set({ status: "accepted" })
            .where(eq(invitation.id, pendingInvitation.id));
        }

        const [consumed] = await tx
          .update(labAccountSetupToken)
          .set({ consumedAt: new Date() })
          .where(
            and(
              eq(labAccountSetupToken.id, validation.token.id),
              isNull(labAccountSetupToken.consumedAt),
              gt(labAccountSetupToken.expiresAt, new Date()),
            ),
          )
          .returning();

        if (!consumed) {
          throw new Error("TOKEN_CONSUMED");
        }

        await tx.insert(platformEventLog).values({
          actorUserId: validation.token.userId,
          targetUserId: validation.token.userId,
          action: "lab_account.claim_completed",
          entityType: "lab_account_setup_token",
          entityId: validation.token.id,
          details: {
            organizationId: validation.token.organizationId,
            invitationId: validation.token.invitationId,
            purpose: validation.token.purpose,
          },
        });

        await tx
          .update(authSession)
          .set({ activeOrganizationId: validation.token.organizationId })
          .where(eq(authSession.id, session.session.id));
      });

      const [org] = await db
        .select({
          cnpj: organization.cnpj,
          email: organization.email,
          phone: organization.phone,
        })
        .from(organization)
        .where(eq(organization.id, validation.token.organizationId))
        .limit(1);

      return c.json({
        claimed: true,
        organizationId: validation.token.organizationId,
        needsOnboarding: !org?.cnpj || !org.email || !org.phone,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN";
      const status = message === "TOKEN_CONSUMED" ? 409 : 400;

      await logClaimEvent({
        action: "lab_account.claim_failed",
        targetUserId: validation.token.userId,
        tokenId: validation.token.id,
        details: {
          reason: message,
          organizationId: validation.token.organizationId,
          invitationId: validation.token.invitationId,
        },
      });

      return c.json({ error: "Não foi possível concluir o acesso" }, status);
    }
  });
