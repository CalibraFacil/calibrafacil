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
 *   REQ-18J-PROV-2  A failed provisioning is cleaned up as calibra_app: a laboratory
 *                   that holds nothing is hard-deleted (advisory lock, purge-only
 *                   setting, cascade), one that holds evidence is soft-deleted.
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
  organizationEventLog,
  personnelCompetence,
  platformEventLog,
  service,
  session as authSession,
  syncChangeLog,
  syncChangeLogPurge,
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
import {
  FUTURE,
  NOW,
  seedLab,
  seedMember,
  seedUser,
  sessionRowFor,
  signInWithMagicLink,
} from "../../test/integration/identity-fixtures";
import { cleanupExpiredAuthRecords } from "./auth-maintenance";
import { purgeSyncChangeLog } from "./sync-change-log-purge";
import { invitationsRouter } from "../routes/invitations";
import { labSetupRouter } from "../routes/lab-setup";
import {
  cleanupFailedLabProvisioning,
  createLabOrganizationWithUniqueSlug,
  ensureLabProvisioningUser,
  provisionLabAccount,
} from "../services/lab-provisioning";
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

  it("REQ-18J-PROV-1 [HIGH RISK]: provisioning creates the laboratory and its first member (the owner); a second one with the same name takes the next slug", async () => {
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

  it("REQ-18J-PROV-2 [HIGH RISK]: a failed provisioning is cleaned up as calibra_app: an empty laboratory is hard-deleted, one that holds evidence is soft-deleted", async () => {
    const { empty, withEvidence } = await asApplicationRole(async () => {
      const owner = await ensureLabProvisioningUser({
        name: "Dona",
        email: "dona@prov.test",
      });
      const auth = createLabAuth();
      const create = (name: string) =>
        createLabOrganizationWithUniqueSlug({
          auth,
          lab: { name },
          ownerUserId: owner.user.id,
          ownerEmail: owner.user.email,
        });
      return {
        empty: await create("Lab Vazio"),
        withEvidence: await create("Lab Com Registro"),
      };
    });
    // The second laboratory already holds an audit entry: evidence.
    await db.insert(organizationEventLog).values({
      organizationId: withEvidence.id,
      action: "test.evidence",
      entityType: "organization",
      entityId: withEvidence.id,
    });

    await asApplicationRole(async () => {
      await cleanupFailedLabProvisioning({ organizationId: empty.id });
      await cleanupFailedLabProvisioning({ organizationId: withEvidence.id });
    });

    // Hard delete: the organization and its (owner) membership are gone.
    expect(
      await db.select().from(organization).where(eq(organization.id, empty.id)),
    ).toEqual([]);
    expect(
      await db.select().from(member).where(eq(member.organizationId, empty.id)),
    ).toEqual([]);
    // Soft delete: kept, suspended, stamped.
    const [kept] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, withEvidence.id));
    expect(kept?.deletedAt).not.toBeNull();
    expect(kept?.status).toBe("SUSPENDED");
    expect(
      (
        await db
          .select()
          .from(member)
          .where(eq(member.organizationId, withEvidence.id))
      ).length,
    ).toBe(1);
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
    const addService = async (lab: typeof labA, name: string) => {
      const [row] = await db
        .insert(service)
        .values({ unitId: lab.unitId, organizationId: lab.orgId, name })
        .returning({ id: service.id });
      return Number(row?.id);
    };
    // BOTH laboratories hold old entries (A one service, B two) and recent ones, so
    // a purge that ignored the laboratory could not pass: each laboratory's horizon
    // must be ITS OWN newest purged entry, and each keeps exactly its recent entries.
    const oldA = [await addService(labA, "old-a")];
    const oldB = [
      await addService(labB, "old-b1"),
      await addService(labB, "old-b2"),
    ];
    await addService(labA, "new-a");
    await addService(labB, "new-b");
    for (const [lab, ids] of [
      ["lab-a", oldA],
      ["lab-b", oldB],
    ] as const) {
      await db.execute(
        sql`update sync_change_log set changed_at = now() - interval '100 days' where organization_id = ${lab} and entity_type = 'service' and entity_id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    }
    const before = await db.select().from(syncChangeLog);
    const old = (lab: string) =>
      before.filter(
        (row) =>
          row.organizationId === lab &&
          row.entityType === "service" &&
          (lab === "lab-a" ? oldA : oldB).includes(row.entityId),
      );
    const recent = (lab: string) =>
      before.filter(
        (row) => row.organizationId === lab && !old(lab).includes(row),
      );
    const newest = (rows: typeof before) =>
      rows.toSorted((x, y) => Number(y.seq) - Number(x.seq))[0];
    expect(old("lab-a").length).toBeGreaterThan(0);
    expect(old("lab-b").length).toBeGreaterThan(old("lab-a").length);

    const result = await asApplicationRole(() =>
      purgeSyncChangeLog({ retentionDays: 90 }),
    );

    expect(result.organizations).toBe(2);
    expect(result.purged).toBe(old("lab-a").length + old("lab-b").length);
    const after = await db.select().from(syncChangeLog);
    for (const lab of ["lab-a", "lab-b"]) {
      expect(
        after.filter((row) => row.organizationId === lab).map((row) => row.seq),
        lab,
      ).toEqual(recent(lab).map((row) => row.seq));
    }
    const horizons = await db.select().from(syncChangeLogPurge);
    const horizonOf = (lab: string) =>
      horizons.find((row) => row.organizationId === lab);
    expect(Number(horizonOf("lab-a")?.purgedThroughSeq)).toBe(
      Number(newest(old("lab-a"))?.seq),
    );
    expect(Number(horizonOf("lab-b")?.purgedThroughSeq)).toBe(
      Number(newest(old("lab-b"))?.seq),
    );
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
