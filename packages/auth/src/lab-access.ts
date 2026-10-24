import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb, getSystemDb } from "@calibra-facil/db";
import { forOrg } from "@calibra-facil/db/for-org";
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

  // The laboratory is known (the token is minted FOR it), so the row is written
  // in a transaction that names it: `lab_account_setup_token` is a tenant table.
  await forOrg(getDb(), input.organizationId).transaction((tx) =>
    tx.insert(labAccountSetupToken).values({
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
    }),
  );

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

  // System path (P2-18j): the token id from the link is a bearer credential and
  // its row is what NAMES the laboratory (this lookup runs before any
  // organization is known, on the owner connection). Only the one row of that
  // id is read; the membership and invitation checks below run in the
  // laboratory it names.
  const [record] = await getSystemDb()
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

  // The laboratory is now named by the token: the membership and the pending
  // invitation are read in a transaction that names it.
  const laboratory = forOrg(getDb(), record.organizationId);
  const [membership] = await laboratory.transaction((tx) =>
    tx
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, record.organizationId),
          eq(member.userId, record.userId),
        ),
      )
      .limit(1),
  );

  if (!membership && record.purpose === "owner_claim") {
    return { ok: false, status: "membership_missing" };
  }

  if (!membership && record.purpose === "member_invite_claim") {
    if (!record.invitationId) {
      return { ok: false, status: "invitation_invalid" };
    }
    const invitationId = record.invitationId;

    const [pendingInvitation] = await laboratory.transaction((tx) =>
      tx
        .select({ id: invitation.id })
        .from(invitation)
        .where(
          and(
            eq(invitation.id, invitationId),
            eq(invitation.organizationId, record.organizationId),
            eq(sql<string>`lower(${invitation.email})`, record.email),
            eq(invitation.status, "pending"),
            gt(invitation.expiresAt, new Date()),
          ),
        )
        .limit(1),
    );

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
  // System path (P2-18j): the sign-in gate asks "does this e-mail belong to ANY
  // laboratory?" before a session, so before an organization, exists. It reads
  // the person's own memberships by e-mail across laboratories on purpose, and
  // returns only whether one exists.
  const [record] = await getSystemDb()
    .select({ memberId: member.id })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(
      and(
        eq(sql<string>`lower(${user.email})`, normalizedEmail),
        eq(organization.type, "LAB"),
        isNull(organization.deletedAt),
      ),
    )
    .limit(1);

  return Boolean(record);
}

export async function hasPendingLabInvitation(email: string) {
  const normalizedEmail = normalizeLabAccessEmail(email);
  // System path (P2-18j): same gate as above, for an e-mail that holds a pending
  // invitation to a laboratory but is not a member yet (no organization is
  // active before the first sign-in).
  const [record] = await getSystemDb()
    .select({ invitationId: invitation.id })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(
      and(
        eq(sql<string>`lower(${invitation.email})`, normalizedEmail),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
        eq(organization.type, "LAB"),
        isNull(organization.deletedAt),
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
  // System path (P2-18j): single-use consumption by the token's own id, after its
  // secret was verified by the caller; the id is what names the laboratory.
  const [updated] = await getSystemDb()
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
