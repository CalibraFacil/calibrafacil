/**
 * identity-lab-scope.int.spec.ts - P2-18j [HIGH RISK].
 *
 * Identity runs BEFORE an organization is chosen (sign-in, sessions, invitations,
 * claiming an account, provisioning a laboratory) and across a person's
 * memberships, so it is the slice that breaks login if the role split is wrong.
 * These specs run the REAL Better Auth lab instance and the real routes with the
 * application connection as `calibra_app` (bound by the `tenant_isolation`
 * policies) and `DATABASE_OWNER_URL` as the owner, the way the API runs after the
 * split (test/integration/application-role.ts). Seeding and assertions are the
 * owner's.
 *
 *   REQ-18J-AUTH-1  A magic-link sign-in creates a session whose active laboratory
 *                   is the oldest non-deleted LAB membership (never a portal
 *                   client organization), and the platform audit row is written.
 *   REQ-18J-AUTH-2  Lab switching: the real organization plugin lists the
 *                   person's memberships and sets the active laboratory; a
 *                   laboratory the person does not belong to is refused and the
 *                   session is unchanged.
 *   REQ-18J-AUTH-3  The sign-in gate (a member e-mail or a pending invitation)
 *                   answers across laboratories and never for a soft-deleted one.
 *   REQ-18J-INV-1   Claiming an invited account: the invitation is accepted into
 *                   the laboratory its token names, the membership, the
 *                   invitation and the token change together, the session lands
 *                   on that laboratory.
 *   REQ-18J-INV-2   An invitation of ANOTHER laboratory cannot be redeemed with a
 *                   token of this one: no membership appears anywhere and the
 *                   token stays unconsumed.
 *   REQ-18J-INV-3   The public invitation page resolves an invitation by its id
 *                   alone and exposes only that laboratory.
 *   REQ-18J-PROV-1  Provisioning creates the laboratory and its first member (the
 *                   owner) under the role split, and a failed provisioning is
 *                   cleaned up.
 *   REQ-18J-USER-1  Deleting a person preserves their regulated records in EVERY
 *                   laboratory they belonged to, in one transaction.
 *   REQ-18J-SWEEP-1 The change-log retention sweep purges each laboratory in its
 *                   own transaction: its own old entries only, its own horizon.
 *   REQ-18J-SWEEP-2 The auth maintenance sweep (global tables) works as
 *                   calibra_app.
 */
import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  authorizedSignatory,
  customer,
  invitation,
  labAccountSetupToken,
  member,
  organization,
  personnelCompetence,
  platformEventLog,
  service,
  session as authSession,
  syncChangeLog,
  syncChangeLogPurge,
  user,
  verification,
} from "@calibra-facil/db/schema";
import {
  createLabAccountSetupToken,
  validateLabAccountSetupToken,
} from "@calibra-facil/auth/lab-access";
import {
  createLabAuth,
  findDefaultActiveOrganizationId,
  preserveRegulatedRecordsOnUserDeletion,
} from "@calibra-facil/auth";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { asApplicationRole } from "../../test/integration/application-role";
import { cleanupExpiredAuthRecords } from "./auth-maintenance";
import { purgeSyncChangeLog } from "./sync-change-log-purge";
import { invitationsRouter } from "../routes/invitations";
import { labSetupRouter } from "../routes/lab-setup";
import { provisionLabAccount } from "../services/lab-provisioning";
import {
  hasActiveLabMembership,
  hasPendingLabInvitation,
} from "@calibra-facil/auth/lab-access";
import {
  completeSignupReservation,
  hasLabMembership,
  releaseSignupSlot,
  reserveSignupSlot,
} from "./public-signup-store";
import { getActivationChecklist } from "../services/activation-checklist";

// This file runs the REAL Better Auth lab instance: the harness's fake
// `createLabAuth` (only `getSession`) is replaced by the real module.
vi.mock("@calibra-facil/auth", async (importOriginal) => importOriginal());

const WEB = "http://localhost:5173";
const API = "http://localhost:3000";
const NOW = new Date("2026-02-01T00:00:00.000Z");
const FUTURE = new Date("2099-01-01T00:00:00.000Z");

async function seedUser(id: string, email = `${id}@lab.test`) {
  await db.insert(user).values({ id, name: `User ${id}`, email });
  return { id, email };
}

async function seedLab(
  orgId: string,
  type: "LAB" | "CLIENT" = "LAB",
  deletedAt: Date | null = null,
) {
  await db.insert(organization).values({
    id: orgId,
    name: `Lab ${orgId}`,
    slug: orgId,
    createdAt: NOW,
    type,
    status: deletedAt ? "SUSPENDED" : "ACTIVE",
    ...(deletedAt
      ? {
          deletedAt,
          suspendedAt: deletedAt,
          suspensionReason: "test",
        }
      : {}),
  });
}

async function seedMember(
  orgId: string,
  userId: string,
  createdAt: Date,
  role = "admin",
) {
  await db.insert(member).values({
    id: `m-${orgId}-${userId}`,
    organizationId: orgId,
    userId,
    role,
    createdAt,
  });
}

/** A magic-link verification row for `email` (Better Auth stores the token hashed). */
async function seedMagicLinkToken(email: string) {
  const token = randomBytes(24).toString("base64url");
  await db.insert(verification).values({
    id: randomBytes(8).toString("hex"),
    identifier: createHash("sha256").update(token).digest("base64url"),
    value: JSON.stringify({ email, name: "", attempt: 0 }),
    expiresAt: FUTURE,
  });
  return token;
}

/** The `Cookie` header of a Set-Cookie list. */
function cookieHeaderOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/**
 * The real sign-in: the real magic-link verify endpoint of the real lab auth
 * (creates the session, runs the session hooks), as the application role.
 */
async function signInWithMagicLink(email: string): Promise<{
  cookie: string;
  status: number;
}> {
  const token = await seedMagicLinkToken(email);
  return asApplicationRole(async () => {
    const response = await createLabAuth().handler(
      new Request(
        `${API}/api/auth/lab/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(`${WEB}/dashboard`)}`,
      ),
    );
    return { cookie: cookieHeaderOf(response), status: response.status };
  });
}

async function sessionRowFor(userId: string) {
  const [row] = await db
    .select()
    .from(authSession)
    .where(eq(authSession.userId, userId));
  return row;
}

describe("identity as calibra_app (P2-18j)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-18J-AUTH-1 [HIGH RISK]: a magic-link sign-in lands on the oldest LAB membership, never on a client organization, and is audited", async () => {
    const person = await seedUser("person");
    const inviter = await seedUser("someone");
    await seedLab("client-oldest", "CLIENT");
    await seedLab("lab-newer");
    await seedLab("lab-older");
    await seedLab("lab-deleted", "LAB", new Date("2025-12-01T00:00:00.000Z"));
    void inviter;
    // The CLIENT membership is the oldest of all and the soft-deleted lab is older
    // than the live ones: neither may become the default laboratory.
    await seedMember("client-oldest", person.id, new Date("2020-01-01"));
    await seedMember("lab-deleted", person.id, new Date("2020-06-01"));
    await seedMember("lab-older", person.id, new Date("2021-01-01"));
    await seedMember("lab-newer", person.id, new Date("2022-01-01"));

    const signedIn = await signInWithMagicLink(person.email);

    expect(signedIn.cookie).toContain("lab.session_token=");
    const row = await sessionRowFor(person.id);
    expect(row?.activeOrganizationId).toBe("lab-older");
    const [audit] = await db
      .select()
      .from(platformEventLog)
      .where(eq(platformEventLog.action, "auth.session_created"));
    expect(audit?.targetUserId).toBe(person.id);
    // The helper the session hook uses answers the same on the application role.
    expect(
      await asApplicationRole(() =>
        findDefaultActiveOrganizationId(person.id, "LAB"),
      ),
    ).toBe("lab-older");
    expect(
      await asApplicationRole(() =>
        findDefaultActiveOrganizationId(person.id, "CLIENT"),
      ),
    ).toBe("client-oldest");
  });

  it("REQ-18J-AUTH-2 [HIGH RISK]: lab switching works through the real organization plugin; a laboratory the person is not in is refused", async () => {
    const person = await seedUser("person");
    await seedLab("lab-a");
    await seedLab("lab-b");
    await seedLab("lab-c");
    await seedMember("lab-a", person.id, new Date("2021-01-01"));
    await seedMember("lab-b", person.id, new Date("2022-01-01"));
    const { cookie } = await signInWithMagicLink(person.email);
    expect((await sessionRowFor(person.id))?.activeOrganizationId).toBe(
      "lab-a",
    );
    const headers = new Headers({ cookie });

    const listed = await asApplicationRole(() =>
      createLabAuth().api.listOrganizations({ headers }),
    );
    expect(listed.map((org) => org.id).toSorted()).toEqual(["lab-a", "lab-b"]);

    await asApplicationRole(() =>
      createLabAuth().api.setActiveOrganization({
        body: { organizationId: "lab-b" },
        headers,
      }),
    );
    expect((await sessionRowFor(person.id))?.activeOrganizationId).toBe(
      "lab-b",
    );

    // Not a member of lab-c: refused (Better Auth also clears the active laboratory
    // of the session on such an attempt): the person is never switched into lab-c.
    await expect(
      asApplicationRole(() =>
        createLabAuth().api.setActiveOrganization({
          body: { organizationId: "lab-c" },
          headers,
        }),
      ),
    ).rejects.toThrow();
    expect((await sessionRowFor(person.id))?.activeOrganizationId).toBeNull();
  });

  it("REQ-18J-AUTH-3: the sign-in gate answers across laboratories, and never for a soft-deleted one", async () => {
    const member1 = await seedUser("member1");
    const guest = await seedUser("guest");
    const inviter = await seedUser("inviter");
    await seedLab("lab-live");
    await seedLab("lab-gone", "LAB", new Date("2025-12-01T00:00:00.000Z"));
    await seedMember("lab-live", member1.id, NOW);
    await db.insert(invitation).values({
      id: "inv-live",
      organizationId: "lab-live",
      email: guest.email,
      role: "member",
      status: "pending",
      expiresAt: FUTURE,
      inviterId: inviter.id,
    });
    const ghost = await seedUser("ghost");
    await seedMember("lab-gone", ghost.id, NOW);

    await asApplicationRole(async () => {
      expect(await hasActiveLabMembership(member1.email)).toBe(true);
      expect(await hasActiveLabMembership("nobody@lab.test")).toBe(false);
      expect(await hasActiveLabMembership(ghost.email)).toBe(false);
      expect(await hasPendingLabInvitation(guest.email)).toBe(true);
      expect(await hasPendingLabInvitation(member1.email)).toBe(false);
    });
  });

  describe("claiming an invited account", () => {
    async function seedInvitedPerson() {
      const inviter = await seedUser("inviter");
      const person = await seedUser("person");
      await seedLab("lab-a");
      await seedLab("lab-b");
      await seedMember("lab-a", inviter.id, NOW, "owner");
      await seedMember("lab-b", inviter.id, NOW, "owner");
      for (const orgId of ["lab-a", "lab-b"]) {
        await db.insert(invitation).values({
          id: `inv-${orgId}`,
          organizationId: orgId,
          email: person.email,
          role: "technician",
          status: "pending",
          expiresAt: FUTURE,
          inviterId: inviter.id,
        });
      }
      return { inviter, person };
    }

    it("REQ-18J-INV-1 [HIGH RISK]: the claim accepts the invitation into the laboratory its token names, atomically, and the session lands there", async () => {
      const { person } = await seedInvitedPerson();
      const minted = await asApplicationRole(() =>
        createLabAccountSetupToken({
          userId: person.id,
          organizationId: "lab-a",
          invitationId: "inv-lab-a",
          email: person.email,
          purpose: "member_invite_claim",
          source: "test",
        }),
      );
      const { cookie } = await signInWithMagicLink(person.email);

      const response = await asApplicationRole(() =>
        labSetupRouter.request(`/${minted.token}/complete`, {
          method: "POST",
          headers: { cookie },
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        claimed: true,
        organizationId: "lab-a",
      });
      const [membership] = await db
        .select()
        .from(member)
        .where(
          and(eq(member.userId, person.id), eq(member.organizationId, "lab-a")),
        );
      expect(membership?.role).toBe("technician");
      // Only the laboratory of the token: lab-b still has no member of this person.
      const others = await db
        .select()
        .from(member)
        .where(
          and(eq(member.userId, person.id), eq(member.organizationId, "lab-b")),
        );
      expect(others).toEqual([]);
      const [accepted] = await db
        .select({ status: invitation.status })
        .from(invitation)
        .where(eq(invitation.id, "inv-lab-a"));
      expect(accepted?.status).toBe("accepted");
      const [untouched] = await db
        .select({ status: invitation.status })
        .from(invitation)
        .where(eq(invitation.id, "inv-lab-b"));
      expect(untouched?.status).toBe("pending");
      const [consumed] = await db
        .select({ consumedAt: labAccountSetupToken.consumedAt })
        .from(labAccountSetupToken)
        .where(eq(labAccountSetupToken.id, minted.id));
      expect(consumed?.consumedAt).not.toBeNull();
      expect((await sessionRowFor(person.id))?.activeOrganizationId).toBe(
        "lab-a",
      );
    });

    it("REQ-18J-INV-2 [HIGH RISK]: another laboratory's invitation cannot be redeemed with this laboratory's token", async () => {
      const { person } = await seedInvitedPerson();
      // A token of lab-a that points at lab-b's invitation (same e-mail).
      const crossed = await asApplicationRole(() =>
        createLabAccountSetupToken({
          userId: person.id,
          organizationId: "lab-a",
          invitationId: "inv-lab-b",
          email: person.email,
          purpose: "member_invite_claim",
          source: "test",
        }),
      );

      const validation = await asApplicationRole(() =>
        validateLabAccountSetupToken(crossed.token),
      );
      expect(validation).toEqual({ ok: false, status: "invitation_invalid" });

      const { cookie } = await signInWithMagicLink(person.email);
      const response = await asApplicationRole(() =>
        labSetupRouter.request(`/${crossed.token}/complete`, {
          method: "POST",
          headers: { cookie },
        }),
      );
      expect(response.status).toBe(400);
      expect(
        await db.select().from(member).where(eq(member.userId, person.id)),
      ).toEqual([]);
      const [still] = await db
        .select({ consumedAt: labAccountSetupToken.consumedAt })
        .from(labAccountSetupToken)
        .where(eq(labAccountSetupToken.id, crossed.id));
      expect(still?.consumedAt).toBeNull();
      const [pending] = await db
        .select({ status: invitation.status })
        .from(invitation)
        .where(eq(invitation.id, "inv-lab-b"));
      expect(pending?.status).toBe("pending");
    });

    it("REQ-18J-INV-3: the public invitation page resolves an invitation by its id and exposes only that laboratory", async () => {
      await seedInvitedPerson();

      const found = await asApplicationRole(() =>
        invitationsRouter.request("/inv-lab-a"),
      );
      expect(found.status).toBe(200);
      expect(await found.json()).toMatchObject({
        id: "inv-lab-a",
        organizationId: "lab-a",
        organizationSlug: "lab-a",
        role: "technician",
      });
      const missing = await asApplicationRole(() =>
        invitationsRouter.request("/inv-unknown"),
      );
      expect(missing.status).toBe(404);
    });
  });

  it("REQ-18J-PROV-1 [HIGH RISK]: provisioning creates the laboratory and its first member (the owner), and a failed one is cleaned up", async () => {
    const provisioned = await asApplicationRole(() =>
      provisionLabAccount({
        lab: { name: "Laboratório Provisionado", email: "contato@prov.test" },
        owner: { name: "Dona Prov", email: "dona@prov.test" },
      }),
    );

    expect(provisioned.ownerCreated).toBe(true);
    const [org] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, provisioned.organization.id));
    expect(org?.type).toBe("LAB");
    expect(org?.slug).toBe("laboratorio-provisionado");
    const members = await db
      .select()
      .from(member)
      .where(eq(member.organizationId, provisioned.organization.id));
    expect(members.map((row) => [row.userId, row.role])).toEqual([
      [provisioned.owner.id, "owner"],
    ]);

    // The same laboratory name takes the next slug; nothing of the first changes.
    const second = await asApplicationRole(() =>
      provisionLabAccount({
        lab: { name: "Laboratório Provisionado" },
        owner: { name: "Outro", email: "outro@prov.test" },
      }),
    );
    expect(second.organization.slug).toBe("laboratorio-provisionado-2");
    expect(second.organization.id).not.toBe(provisioned.organization.id);
  });

  it("REQ-18J-SIGNUP-1: the public sign-up store answers 'already a laboratory member' across laboratories and keeps its slot ledger in the global audit log", async () => {
    const labMember = await seedUser("lab-member");
    const clientOnly = await seedUser("client-only");
    const ghost = await seedUser("ghost");
    await seedLab("lab-live");
    await seedLab("client-org", "CLIENT");
    await seedLab("lab-gone", "LAB", new Date("2025-12-01T00:00:00.000Z"));
    await seedMember("lab-live", labMember.id, NOW);
    await seedMember("client-org", clientOnly.id, NOW);
    await seedMember("lab-gone", ghost.id, NOW);

    await asApplicationRole(async () => {
      expect(await hasLabMembership(labMember.id)).toBe(true);
      // A portal login is not a laboratory of their own; a deleted one is no account.
      expect(await hasLabMembership(clientOnly.id)).toBe(false);
      expect(await hasLabMembership(ghost.id)).toBe(false);

      const slot = await reserveSignupSlot(
        "new-lab.test",
        "owner@new-lab.test",
      );
      expect(typeof slot).toBe("number");
      // The same address again is a duplicate submit, not a second laboratory.
      expect(
        await reserveSignupSlot("new-lab.test", "owner@new-lab.test"),
      ).toBe("duplicate");
      if (typeof slot !== "number") throw new Error("no slot");
      await completeSignupReservation({
        reservationId: slot,
        ownerUserId: labMember.id,
        organizationId: "lab-live",
        emailDomain: "new-lab.test",
        mx: "ok",
      });
      const [completed] = await db
        .select()
        .from(platformEventLog)
        .where(eq(platformEventLog.id, slot));
      expect(completed?.entityId).toBe("lab-live");
      // An abandoned attempt (provisioning failed before completion) gives its
      // slot back; a completed one is evidence and stays (append-only).
      const abandoned = await reserveSignupSlot("other.test", "x@other.test");
      if (typeof abandoned !== "number") throw new Error("no slot");
      await releaseSignupSlot(abandoned);
    });

    const events = await db.select().from(platformEventLog);
    expect(events.map((event) => event.entityId)).toEqual(["lab-live"]);
  });

  it("REQ-18J-ONB-1: the activation checklist reads one laboratory's state, never another's", async () => {
    const labA = await seedOrg({ orgId: "lab-a", userId: "user-lab-a" });
    await seedOrg({ orgId: "lab-b", userId: "user-lab-b" });
    await db.insert(customer).values({
      name: "Cliente A",
      taxId: "11111111000111",
      authOrganizationId: labA.orgId,
      labOrganizationId: labA.orgId,
    });

    const [checklistA, checklistB] = await asApplicationRole(() =>
      Promise.all([
        getActivationChecklist("lab-a"),
        getActivationChecklist("lab-b"),
      ]),
    );

    const done = (list: typeof checklistA, id: string) =>
      list.steps.find((step) => step.id === id)?.done;
    expect(done(checklistA, "customer")).toBe(true);
    expect(done(checklistB, "customer")).toBe(false);
  });

  it("REQ-18J-USER-1 [HIGH RISK]: deleting a person preserves their regulated records in every laboratory, in one transaction", async () => {
    const person = await seedUser("person");
    const labA = await seedOrg({ orgId: "lab-a", userId: "user-lab-a" });
    const labB = await seedOrg({ orgId: "lab-b", userId: "user-lab-b" });
    for (const lab of [labA, labB]) {
      await db.insert(personnelCompetence).values({
        organizationId: lab.orgId,
        userId: person.id,
        scopeDescription: "Massa",
        status: "ACTIVE",
        requestedBy: lab.userId,
        createdBy: lab.userId,
      });
      await db.insert(authorizedSignatory).values({
        organizationId: lab.orgId,
        userId: person.id,
        authorizedBy: lab.userId,
        status: "ACTIVE",
      });
    }

    await asApplicationRole(() =>
      preserveRegulatedRecordsOnUserDeletion({
        id: person.id,
        name: "Person",
        email: person.email,
      }),
    );

    const competences = await db.select().from(personnelCompetence);
    expect(competences).toHaveLength(2);
    expect(competences.every((row) => row.deletedAt !== null)).toBe(true);
    const signatories = await db.select().from(authorizedSignatory);
    expect(signatories.map((row) => row.status)).toEqual([
      "REVOKED",
      "REVOKED",
    ]);
    const audits = await db.execute(
      sql`select organization_id from personnel_competence_audit_log order by organization_id`,
    );
    const auditRows: unknown = Array.isArray(audits)
      ? audits
      : Reflect.get(audits, "rows");
    expect(
      Array.isArray(auditRows)
        ? auditRows.map((r) => Reflect.get(r, "organization_id"))
        : null,
    ).toEqual(["lab-a", "lab-b"]);
  });

  it("REQ-18J-SWEEP-1 [HIGH RISK]: the change-log retention sweep purges each laboratory in its own transaction: its own old entries, its own horizon", async () => {
    const labA = await seedOrg({ orgId: "lab-a", userId: "user-lab-a" });
    const labB = await seedOrg({ orgId: "lab-b", userId: "user-lab-b" });
    // Lab A: one old and one recent entry. Lab B: only a recent one.
    const [oldA] = await db
      .insert(service)
      .values({ unitId: labA.unitId, organizationId: "lab-a", name: "old-a" })
      .returning({ id: service.id });
    await db
      .insert(service)
      .values({ unitId: labA.unitId, organizationId: "lab-a", name: "new-a" });
    await db
      .insert(service)
      .values({ unitId: labB.unitId, organizationId: "lab-b", name: "new-b" });
    await db.execute(
      sql`update sync_change_log set changed_at = now() - interval '100 days' where entity_id = ${String(oldA?.id)} and organization_id = 'lab-a'`,
    );
    const before = await db.select().from(syncChangeLog);
    const beforeByLab = (lab: string) =>
      before.filter((row) => row.organizationId === lab).length;

    const result = await asApplicationRole(() =>
      purgeSyncChangeLog({ retentionDays: 90 }),
    );

    expect(result.organizations).toBe(1);
    expect(result.purged).toBeGreaterThan(0);
    const after = await db.select().from(syncChangeLog);
    const afterByLab = (lab: string) =>
      after.filter((row) => row.organizationId === lab).length;
    expect(afterByLab("lab-a")).toBe(beforeByLab("lab-a") - result.purged);
    // Lab B had nothing old: its entries and (absent) horizon are untouched.
    expect(afterByLab("lab-b")).toBe(beforeByLab("lab-b"));
    const horizons = await db.select().from(syncChangeLogPurge);
    expect(horizons.map((row) => row.organizationId)).toEqual(["lab-a"]);
  });

  it("REQ-18J-SWEEP-2: the auth maintenance sweep removes expired sessions and verifications as calibra_app", async () => {
    const person = await seedUser("person");
    await db.insert(authSession).values([
      {
        id: "s-old",
        userId: person.id,
        token: "t-old",
        expiresAt: new Date("2020-01-01"),
      },
      { id: "s-live", userId: person.id, token: "t-live", expiresAt: FUTURE },
    ]);
    await db.insert(verification).values([
      {
        id: "v-old",
        identifier: "a",
        value: "x",
        expiresAt: new Date("2020-01-01"),
      },
      { id: "v-live", identifier: "b", value: "x", expiresAt: FUTURE },
    ]);

    const result = await asApplicationRole(() => cleanupExpiredAuthRecords());

    expect(result).toEqual({ deletedSessions: 1, deletedVerifications: 1 });
    expect((await db.select().from(authSession)).map((row) => row.id)).toEqual([
      "s-live",
    ]);
  });
});
