import { db, systemDb } from "@calibra-facil/db";
import {
  invitation,
  member,
  organization,
  platformEventLog,
  session as sessionTable,
  user,
  verification,
} from "@calibra-facil/db/schema";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

/**
 * Identity statements of the routes that run BEFORE an organization is chosen
 * (public invitation pages, the magic-link preview, sessions, profile, public
 * sign-up). Routes may not touch `db` / `systemDb` (calibra/no-raw-db-in-routes),
 * so they call these.
 *
 * Two kinds of statement live here, and the split is the point (P2-18j):
 *
 *  - GLOBAL tables (`user`, `session`, `verification`, `organization`,
 *    `platform_event_log`): no organization column and no row-level-security
 *    policy (tenancy.ts), so any connection role may use them. They stay on the
 *    plain `db`.
 *  - TENANT tables read BEFORE the laboratory is known (`invitation`, `member`):
 *    the invitation id is a bearer secret whose own row names the organization;
 *    a user's memberships are read by `user_id` across laboratories. They run on
 *    the system path (`systemDb`, the owner connection), as one narrow SELECT
 *    each, and everything a route does after it names the laboratory.
 */

const inviter = alias(user, "inviter");

/** `user` by e-mail, case-insensitive. */
export async function findUserByEmail(email: string) {
  const [existing] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(sql<string>`lower(${user.email})`, email.trim().toLowerCase()))
    .limit(1);
  return existing ?? null;
}

/** `user` by the exact stored e-mail (the magic-link token carries it verbatim). */
export async function findUserByExactEmail(email: string) {
  const [account] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return account ?? null;
}

export async function findUserImage(userId: string) {
  const [current] = await db
    .select({ image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return current?.image ?? null;
}

/** The unexpired verification row for a hashed magic-link token, if any. */
export async function findLiveVerificationValue(hashedIdentifier: string) {
  const [record] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(
      and(
        eq(verification.identifier, hashedIdentifier),
        gt(verification.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return record?.value ?? null;
}

/**
 * Revokes one of the signed-in user's OWN sessions. False when the session does
 * not exist or belongs to someone else (the caller answers 404 for both).
 */
export async function revokeOwnSession(userId: string, sessionId: string) {
  const [target] = await db
    .select({ id: sessionTable.id, userId: sessionTable.userId })
    .from(sessionTable)
    .where(eq(sessionTable.id, sessionId))
    .limit(1);
  if (!target || target.userId !== userId) return false;
  await db.delete(sessionTable).where(eq(sessionTable.id, target.id));
  return true;
}

/** A LAB organization by its slug (a public SSO entry point learns the laboratory from it). */
export async function findLabOrganizationBySlug(slug: string) {
  const [org] = await db
    .select({ id: organization.id, slug: organization.slug })
    .from(organization)
    .where(and(eq(organization.slug, slug), eq(organization.type, "LAB")))
    .limit(1);
  return org ?? null;
}

/** Platform-level evidence (sign-ups, invitations, claims): global, never purged with an organization. */
export async function recordPlatformEvent(
  values: typeof platformEventLog.$inferInsert,
) {
  await db.insert(platformEventLog).values(values);
}

/**
 * Public invitation page (`GET /api/invitations/:id`): a pending, unexpired
 * invitation with its organization and the inviter's e-mail.
 *
 * System path: the invitation id from the e-mailed link is the bearer secret and
 * its own row names the organization, so this is the lookup that LEARNS the
 * laboratory. One row, projected to what the accept page needs.
 */
export async function findPublicInvitation(id: string) {
  const [row] = await systemDb
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
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .leftJoin(inviter, eq(invitation.inviterId, inviter.id))
    .where(
      and(
        eq(invitation.id, id),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The pending invitation behind a "send me an access link" request, only for a
 * LAB organization. System path for the same reason as `findPublicInvitation`.
 */
export async function findLabInvitationForSetupLink(id: string) {
  const [row] = await systemDb
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
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(
      and(
        eq(invitation.id, id),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
        eq(organization.type, "LAB"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The user's primary organization of one surface (oldest membership, not
 * soft-deleted): the magic-link preview names it before any session exists.
 *
 * System path: the person's OWN memberships by `user_id`, across laboratories,
 * returning only the organization's public name and logo.
 */
export async function findUserPrimaryOrganization(
  userId: string,
  organizationType: "LAB" | "CLIENT",
) {
  const [org] = await systemDb
    .select({ name: organization.name, logo: organization.logo })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(
      and(
        eq(member.userId, userId),
        eq(organization.type, organizationType),
        isNull(organization.deletedAt),
      ),
    )
    .orderBy(asc(member.createdAt))
    .limit(1);
  return org ?? null;
}
