/**
 * identity-org-plugin-deny.int.spec.ts - P2-18j, Q40 [HIGH RISK].
 *
 * Better Auth runs on the owner connection (the identity adapter is
 * `getSystemDb()`), so row-level security is NOT a backstop for its organization
 * plugin: the only guard is the plugin's own membership and role check. This spec
 * pins that guard, endpoint by endpoint, with the REAL lab auth instance and a
 * REAL session, as `calibra_app` with the owner adapter
 * (test/integration/application-role.ts): an OWNER of laboratory A calls every
 * organization-plugin endpoint against laboratory B and each one is refused, with
 * laboratory B's organization, members and invitations unchanged.
 *
 *   REQ-Q40-1  list-members, get-full-organization, list-invitations: refused for
 *              B, answered for A (positive control: the refusal is not a broken
 *              endpoint).
 *   REQ-Q40-2  create-invitation, get-invitation, accept-invitation,
 *              cancel-invitation against B's invitations: refused, B's invitations
 *              keep their status and nothing new appears.
 *   REQ-Q40-3  update-member-role and remove-member against B's members, by
 *              `organizationId: B` and through the path that finds a member by its
 *              id alone (Better Auth's `findMemberById` has no organization
 *              filter): refused, B's roles and memberships unchanged. Lab A has a
 *              SECOND owner, so what refuses the removal of B's owner is the
 *              organization check, not the "only owner" check.
 *   REQ-Q40-4  update-organization against B: refused, B's profile unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { invitation, member, organization } from "@calibra-facil/db/schema";
import { createLabAuth } from "@calibra-facil/auth";
import { truncateAll } from "../../test/integration/db";
import { asApplicationRole } from "../../test/integration/application-role";
import {
  FUTURE,
  seedLab,
  seedMember,
  seedUser,
  sessionRowFor,
  signInWithMagicLink,
} from "../../test/integration/identity-fixtures";

// The REAL Better Auth lab instance (the harness's fake only has `getSession`).
vi.mock("@calibra-facil/auth", async (importOriginal) => importOriginal());

type Api = ReturnType<typeof createLabAuth>["api"];

/** What laboratory B looks like: its profile, members and invitations. */
async function snapshotOfB() {
  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, "lab-b"));
  const members = await db
    .select()
    .from(member)
    .where(eq(member.organizationId, "lab-b"))
    .orderBy(member.id);
  const invitations = await db
    .select()
    .from(invitation)
    .where(eq(invitation.organizationId, "lab-b"))
    .orderBy(invitation.id);
  return { org, members, invitations };
}

/** The call is refused by Better Auth with a client error, not a crash. */
async function refused(
  call: (api: Api) => Promise<unknown>,
  /** The reason Better Auth gives, when the test pins which check refused. */
  reason?: RegExp,
) {
  const failure = await asApplicationRole(() => call(createLabAuth().api)).then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure, "the call was accepted").not.toBeNull();
  const status =
    failure && typeof failure === "object"
      ? Reflect.get(failure, "statusCode")
      : undefined;
  expect(status, String(failure)).toBeGreaterThanOrEqual(400);
  expect(status, String(failure)).toBeLessThan(500);
  if (reason)
    expect(String(Reflect.get(failure ?? {}, "message"))).toMatch(reason);
}

describe("Better Auth organization plugin: a lab-A owner against lab B (Q40)", () => {
  let headers: Headers;

  beforeEach(async () => {
    await truncateAll();
    const a1 = await seedUser("a1");
    const a2 = await seedUser("a2");
    const b1 = await seedUser("b1");
    const b2 = await seedUser("b2");
    await seedLab("lab-a");
    await seedLab("lab-b");
    // Lab A has TWO owners (so the "only owner" rule never decides a removal).
    await seedMember("lab-a", a1.id, new Date("2021-01-01"), "owner");
    await seedMember("lab-a", a2.id, new Date("2021-02-01"), "owner");
    await seedMember("lab-b", b1.id, new Date("2021-01-01"), "owner");
    await seedMember("lab-b", b2.id, new Date("2021-02-01"), "member");
    for (const [id, email] of [
      ["inv-b-1", "invitee1@b.test"],
      ["inv-b-2", a1.email],
    ] as const) {
      await db.insert(invitation).values({
        id,
        organizationId: "lab-b",
        email,
        role: "member",
        status: "pending",
        expiresAt: FUTURE,
        inviterId: b1.id,
      });
    }
    const signedIn = await signInWithMagicLink(a1.email);
    headers = new Headers({ cookie: signedIn.cookie });
    expect((await sessionRowFor(a1.id))?.activeOrganizationId).toBe("lab-a");
  });

  it("REQ-Q40-1: list-members, get-full-organization and list-invitations answer for lab A and are refused for lab B", async () => {
    const before = await snapshotOfB();

    // Positive control: the same calls work on the owner's own laboratory.
    const own = await asApplicationRole(async () => {
      const api = createLabAuth().api;
      return {
        members: await api.listMembers({
          query: { organizationId: "lab-a" },
          headers,
        }),
        full: await api.getFullOrganization({
          query: { organizationId: "lab-a" },
          headers,
        }),
      };
    });
    expect(own.members.members.map((row) => row.organizationId)).toEqual([
      "lab-a",
      "lab-a",
    ]);
    expect(own.full?.id).toBe("lab-a");

    await refused((api) =>
      api.listMembers({ query: { organizationId: "lab-b" }, headers }),
    );
    await refused((api) =>
      api.getFullOrganization({ query: { organizationId: "lab-b" }, headers }),
    );
    await refused((api) =>
      api.listInvitations({ query: { organizationId: "lab-b" }, headers }),
    );
    expect(await snapshotOfB()).toEqual(before);
  });

  it("REQ-Q40-2: create, get, accept and cancel invitation against lab B are refused; B's invitations are untouched and none appears", async () => {
    const before = await snapshotOfB();

    await refused((api) =>
      api.createInvitation({
        body: {
          email: "intruder@a.test",
          role: "admin",
          organizationId: "lab-b",
        },
        headers,
      }),
    );
    // An invitation of lab B that is NOT addressed to the caller...
    await refused((api) =>
      api.getInvitation({ query: { id: "inv-b-1" }, headers }),
    );
    await refused((api) =>
      api.acceptInvitation({ body: { invitationId: "inv-b-1" }, headers }),
    );
    await refused((api) =>
      api.cancelInvitation({ body: { invitationId: "inv-b-1" }, headers }),
    );
    // ... and one addressed to the caller's own e-mail may be read and accepted
    // by that person, but never CANCELLED by a non-member of lab B.
    await refused((api) =>
      api.cancelInvitation({ body: { invitationId: "inv-b-2" }, headers }),
    );

    expect(await snapshotOfB()).toEqual(before);
    // Nothing was granted to the caller in lab B.
    expect(
      (await snapshotOfB()).members.map((row) => row.userId).toSorted(),
    ).toEqual(["b1", "b2"]);
  });

  it("REQ-Q40-3: update-member-role and remove-member against lab B's members are refused, also through the member id alone", async () => {
    const before = await snapshotOfB();
    const bOwnerMemberId = "m-lab-b-b1";
    const bMemberId = "m-lab-b-b2";

    // By organizationId: B.
    await refused((api) =>
      api.updateMemberRole({
        body: { memberId: bMemberId, role: "admin", organizationId: "lab-b" },
        headers,
      }),
    );
    await refused((api) =>
      api.removeMember({
        body: { memberIdOrEmail: bMemberId, organizationId: "lab-b" },
        headers,
      }),
    );
    // Through `findMemberById` (no organization filter): the caller's ACTIVE
    // laboratory is A, B's member id is supplied with A as the organization, or
    // with none at all. B's OWNER is the target of the removal: lab A has a second
    // owner, so the only-owner rule passes and the organization check is what
    // refuses.
    // "Member not found" is the plugin's organization check on the member it
    // found by id (`toBeRemovedMember.organizationId !== organizationId`), after
    // the only-owner and permission checks passed.
    const orgCheck = /Member not found/;
    await refused(
      (api) =>
        api.removeMember({
          body: { memberIdOrEmail: bOwnerMemberId, organizationId: "lab-a" },
          headers,
        }),
      orgCheck,
    );
    await refused(
      (api) =>
        api.removeMember({
          body: { memberIdOrEmail: bOwnerMemberId },
          headers,
        }),
      orgCheck,
    );
    await refused(
      (api) =>
        api.removeMember({
          body: { memberIdOrEmail: bMemberId, organizationId: "lab-a" },
          headers,
        }),
      orgCheck,
    );
    const updateOrgCheck = /not allowed to update this member/;
    await refused(
      (api) =>
        api.updateMemberRole({
          body: {
            memberId: bOwnerMemberId,
            role: "member",
            organizationId: "lab-a",
          },
          headers,
        }),
      updateOrgCheck,
    );
    await refused(
      (api) =>
        api.updateMemberRole({
          body: { memberId: bMemberId, role: "admin" },
          headers,
        }),
      updateOrgCheck,
    );
    // By e-mail of a lab-B member, with lab A as the organization.
    await refused((api) =>
      api.removeMember({
        body: { memberIdOrEmail: "b2@lab.test", organizationId: "lab-a" },
        headers,
      }),
    );

    expect(await snapshotOfB()).toEqual(before);
    // Lab A's own members are intact as well.
    expect(
      (await db.select().from(member).where(eq(member.organizationId, "lab-a")))
        .length,
    ).toBe(2);
  });

  it("REQ-Q40-4: update-organization against lab B is refused and B's profile is unchanged", async () => {
    const before = await snapshotOfB();

    await refused((api) =>
      api.updateOrganization({
        body: { data: { name: "Hijacked" }, organizationId: "lab-b" },
        headers,
      }),
    );

    expect(await snapshotOfB()).toEqual(before);
    // Positive control: the same call on the owner's own laboratory works.
    await asApplicationRole(() =>
      createLabAuth().api.updateOrganization({
        body: { data: { name: "Lab A renamed" }, organizationId: "lab-a" },
        headers,
      }),
    );
    const [renamed] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, "lab-a"));
    expect(renamed?.name).toBe("Lab A renamed");
  });
});
