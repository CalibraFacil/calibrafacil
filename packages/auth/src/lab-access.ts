import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "@calibra-facil/db";
import {
  invitation,
  labAccountSetupToken,
  member,
  organization,
  platformEventLog,
  user,
  type LabAccountSetupTokenPurpose,
} from "@calibra-facil/db/schema";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

export const LAB_SETUP_TOKEN_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

export type CreateLabAccountSetupTokenInput = {
  userId: string;
  organizationId: string;
  email: string;
  purpose: LabAccountSetupTokenPurpose;
  invitationId?: string | null;
  createdByUserId?: string | null;
  source: string;
  expiresInSeconds?: number;
};

export type LabSetupTokenStatus =
  | "ready"
  | "invalid"
  | "expired"
  | "consumed"
  | "user_invalid"
  | "email_mismatch"
  | "organization_invalid"
  | "membership_missing"
  | "invitation_invalid";

export type ValidLabSetupToken = {
  id: string;
  userId: string;
  organizationId: string;
  invitationId: string | null;
  email: string;
  purpose: LabAccountSetupTokenPurpose;
  expiresAt: Date;
  organizationName: string;
  organizationSlug: string;
  hasMembership: boolean;
};

export type LabSetupTokenValidation =
  | {
      ok: true;
      status: "ready";
      token: ValidLabSetupToken;
    }
  | {
      ok: false;
      status: Exclude<LabSetupTokenStatus, "ready">;
    };

export function normalizeLabAccessEmail(email: string) {
  return email.trim().toLowerCase();
}

export function buildLabClaimUrl(appUrl: string, token: string) {
  const url = new URL("/claim-account", appUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function hashSetupTokenSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function parseSetupToken(token: string) {
  const [id, secret, ...extra] = token.split(".");
  if (!id || !secret || extra.length > 0) {
    return null;
  }

  return { id, secret };
}

function secretsMatch(expectedHash: string, secret: string) {
  const actualHash = hashSetupTokenSecret(secret);
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

export async function createLabAccountSetupToken(
  input: CreateLabAccountSetupTokenInput,
) {
  const id = randomBytes(18).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() +
      (input.expiresInSeconds ?? LAB_SETUP_TOKEN_EXPIRES_IN_SECONDS) * 1000,
  );
  const email = normalizeLabAccessEmail(input.email);

  await getDb()
    .insert(labAccountSetupToken)
    .values({
      id,
      secretHash: hashSetupTokenSecret(secret),
      userId: input.userId,
      organizationId: input.organizationId,
      invitationId: input.invitationId ?? null,
      email,
      purpose: input.purpose,
      expiresAt,
      createdByUserId: input.createdByUserId ?? null,
      source: input.source,
    });

  return {
    id,
    token: `${id}.${secret}`,
    expiresAt,
  };
}

export async function validateLabAccountSetupToken(
  rawToken: string,
): Promise<LabSetupTokenValidation> {
  const parsed = parseSetupToken(rawToken.trim());
  if (!parsed) {
    return { ok: false, status: "invalid" };
  }

  const [record] = await getDb()
    .select({
      id: labAccountSetupToken.id,
      secretHash: labAccountSetupToken.secretHash,
      userId: labAccountSetupToken.userId,
      organizationId: labAccountSetupToken.organizationId,
      invitationId: labAccountSetupToken.invitationId,
      email: labAccountSetupToken.email,
      purpose: labAccountSetupToken.purpose,
      expiresAt: labAccountSetupToken.expiresAt,
      consumedAt: labAccountSetupToken.consumedAt,
      userEmail: user.email,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      organizationType: organization.type,
    })
    .from(labAccountSetupToken)
    .innerJoin(user, eq(labAccountSetupToken.userId, user.id))
    .innerJoin(
      organization,
      eq(labAccountSetupToken.organizationId, organization.id),
    )
    .where(eq(labAccountSetupToken.id, parsed.id))
    .limit(1);

  if (!record || !secretsMatch(record.secretHash, parsed.secret)) {
    return { ok: false, status: "invalid" };
  }

  if (record.consumedAt) {
    return { ok: false, status: "consumed" };
  }

  if (record.expiresAt <= new Date()) {
    await getDb()
      .insert(platformEventLog)
      .values({
        actorUserId: null,
        targetUserId: record.userId,
        action: "lab_account_claim.failed",
        entityType: "lab_account_setup_token",
        entityId: record.id,
        details: {
          reason: "expired",
          organizationId: record.organizationId,
          invitationId: record.invitationId,
        },
      });
    return { ok: false, status: "expired" };
  }

  if (normalizeLabAccessEmail(record.userEmail) !== record.email) {
    return { ok: false, status: "email_mismatch" };
  }

  if (record.organizationType !== "LAB") {
    return { ok: false, status: "organization_invalid" };
  }

  const [membership] = await getDb()
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, record.organizationId),
        eq(member.userId, record.userId),
      ),
    )
    .limit(1);

  if (!membership && record.purpose === "owner_claim") {
    return { ok: false, status: "membership_missing" };
  }

  if (!membership && record.purpose === "member_invite_claim") {
    if (!record.invitationId) {
      return { ok: false, status: "invitation_invalid" };
    }

    const [pendingInvitation] = await getDb()
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(invitation.id, record.invitationId),
          eq(invitation.organizationId, record.organizationId),
          eq(sql<string>`lower(${invitation.email})`, record.email),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!pendingInvitation) {
      return { ok: false, status: "invitation_invalid" };
    }
  }

  return {
    ok: true,
    status: "ready",
    token: {
      id: record.id,
      userId: record.userId,
      organizationId: record.organizationId,
      invitationId: record.invitationId,
      email: record.email,
      purpose: record.purpose,
      expiresAt: record.expiresAt,
      organizationName: record.organizationName,
      organizationSlug: record.organizationSlug,
      hasMembership: Boolean(membership),
    },
  };
}

export async function hasActiveLabMembership(email: string) {
  const normalizedEmail = normalizeLabAccessEmail(email);
  const [record] = await getDb()
    .select({ memberId: member.id })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(
      and(
        eq(sql<string>`lower(${user.email})`, normalizedEmail),
        eq(organization.type, "LAB"),
      ),
    )
    .limit(1);

  return Boolean(record);
}

export async function hasPendingLabInvitation(email: string) {
  const normalizedEmail = normalizeLabAccessEmail(email);
  const [record] = await getDb()
    .select({ invitationId: invitation.id })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(
      and(
        eq(sql<string>`lower(${invitation.email})`, normalizedEmail),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
        eq(organization.type, "LAB"),
      ),
    )
    .limit(1);

  return Boolean(record);
}

export async function hasValidLabSetupTokenForEmail(
  token: string | undefined,
  email: string,
) {
  if (!token) {
    return false;
  }

  const validation = await validateLabAccountSetupToken(token);

  return (
    validation.ok && validation.token.email === normalizeLabAccessEmail(email)
  );
}

export async function consumeLabAccountSetupToken(id: string) {
  const [updated] = await getDb()
    .update(labAccountSetupToken)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(labAccountSetupToken.id, id),
        isNull(labAccountSetupToken.consumedAt),
        gt(labAccountSetupToken.expiresAt, new Date()),
      ),
    )
    .returning();

  return Boolean(updated);
}
