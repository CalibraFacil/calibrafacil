import { db, systemDb } from "@calibra-facil/db";
import {
  member,
  organization,
  platformEventLog,
} from "@calibra-facil/db/schema";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";

/**
 * Persistence of the public self-serve sign-up (routes/public-signup.ts).
 *
 * Almost all of it is the GLOBAL `platform_event_log` (the reservation of a
 * domain's daily slot IS an audit row, written before any organization exists),
 * which has no organization column and no row-level-security policy, so it runs
 * on the plain `db`. The one tenant table, `member`, is read on the system path:
 * see `hasLabMembership`.
 */

/** Self-serve organizations allowed per e-mail domain, per rolling day. */
const DOMAIN_SIGNUP_CAP = 3;
const DOMAIN_SIGNUP_WINDOW_MS = 24 * 60 * 60 * 1000;

const SIGNUP_EVENT_ACTION = "public.signup.provisioned";

/**
 * True when this user already belongs to a laboratory team.
 *
 * Scoped to LAB organizations on purpose: `member` also holds the memberships
 * of the system-owned CLIENT organizations behind the customer portal. Someone
 * whose supplier gave them a portal login has no laboratory of their own, and
 * counting that as an existing account would refuse them their own sign-up.
 * `organization.type` is nullable on rows that predate the column, and those
 * are all laboratories.
 *
 * System path (P2-18j): an unauthenticated visitor has no organization, and the
 * question is "does this person belong to ANY laboratory", so it reads the
 * person's own memberships by `user_id` across laboratories (one row, only its
 * existence is used).
 */
export async function hasLabMembership(userId: string) {
  const memberships = await systemDb
    .select({ id: member.id })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(
      and(
        eq(member.userId, userId),
        or(eq(organization.type, "LAB"), isNull(organization.type)),
        // A soft-deleted laboratory (records retention) is not an account.
        isNull(organization.deletedAt),
      ),
    )
    .limit(1);

  return memberships.length > 0;
}

/**
 * Take one of the domain's daily slots, or return null when they are gone.
 *
 * Counting and then provisioning would be a check followed much later by a
 * write, and a burst of parallel requests for the same domain all read a count
 * below the cap before any of them writes — which is exactly how someone would
 * defeat it. The advisory lock serializes every signup for one domain, and the
 * slot is claimed as a row before provisioning starts, so a concurrent request
 * counts it.
 *
 * The row is the audit entry itself, completed once the organization exists and
 * deleted if provisioning fails: an abandoned attempt should not spend a slot.
 */
export async function reserveSignupSlot(domain: string, emailKey: string) {
  return db.transaction(async (tx) => {
    // Two locks, both transaction-scoped so they live on this transaction's own
    // connection and cannot be stranded by pooling. The domain lock caps abuse;
    // the e-mail lock makes the "already registered" check and the reservation
    // that follows it one atomic step, so two concurrent posts for the same new
    // address cannot both pass and leave one person owning two laboratories.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`public-signup:${domain}`}))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`public-signup-email:${emailKey}`}))`,
    );

    const since = new Date(Date.now() - DOMAIN_SIGNUP_WINDOW_MS);

    // A reservation already in flight for this exact address is a duplicate
    // submit, not a second laboratory.
    const [inFlight] = await tx
      .select({ id: platformEventLog.id })
      .from(platformEventLog)
      .where(
        and(
          eq(platformEventLog.action, SIGNUP_EVENT_ACTION),
          gte(platformEventLog.createdAt, since),
          sql`${platformEventLog.details} ->> 'emailKey' = ${emailKey}`,
        ),
      )
      .limit(1);

    if (inFlight) return "duplicate" as const;

    const rows = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(platformEventLog)
      .where(
        and(
          eq(platformEventLog.action, SIGNUP_EVENT_ACTION),
          gte(platformEventLog.createdAt, since),
          sql`${platformEventLog.details} ->> 'emailDomain' = ${domain}`,
        ),
      );

    if ((rows[0]?.total ?? 0) >= DOMAIN_SIGNUP_CAP)
      return "domain_cap" as const;

    const [reserved] = await tx
      .insert(platformEventLog)
      .values({
        action: SIGNUP_EVENT_ACTION,
        entityType: "organization",
        details: { emailDomain: domain, emailKey, status: "RESERVED" },
      })
      .returning();

    return reserved?.id ?? null;
  });
}

export async function releaseSignupSlot(reservationId: number) {
  try {
    await db
      .delete(platformEventLog)
      .where(eq(platformEventLog.id, reservationId));
  } catch (error) {
    console.error("Failed to release a public signup reservation", error);
  }
}

/**
 * Turn the reserved slot into the audit record of what was provisioned.
 *
 * `actorUserId` stays null: nobody was authenticated here. Anyone can submit
 * somebody else's address, so naming the new owner as the actor would put a
 * claim in the trail that the person acted, before they have proved they can
 * even read that mailbox. They are the target, not the author — the same shape
 * the unauthenticated invitation and setup events use.
 */
export async function completeSignupReservation(params: {
  reservationId: number;
  ownerUserId: string;
  organizationId: string;
  emailDomain: string;
  mx: string;
}) {
  await db
    .update(platformEventLog)
    .set({
      actorUserId: null,
      targetUserId: params.ownerUserId,
      entityId: params.organizationId,
      details: {
        emailDomain: params.emailDomain,
        mxCheck: params.mx,
      },
    })
    .where(eq(platformEventLog.id, params.reservationId));
}
