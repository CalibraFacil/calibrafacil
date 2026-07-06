import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import {
  invitation,
  member,
  organization,
  session,
  subscription,
  user,
} from "@calibra-facil/db/schema";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PlanId } from "@calibra-facil/shared";
import { truncateAll } from "../../test/integration/db";

// DOM-07 — enforce the plan's user limit on the invite / add-member path.
//
// Real-DB + REAL Better Auth integration. The org plugin exposes
// `beforeCreateInvitation` / `beforeAddMember` hooks; DOM-07 wires the plan
// user-limit check there. These tests import the REAL `createLabAuth`
// (bypassing the global session mock in test/integration/setup.ts via
// `vi.importActual`) and drive the actual `POST /organization/invite-member`
// endpoint server-side, so the hook + real permission/session path run against
// the ephemeral Postgres.
//
// Covered:
//   REQ-DOM-USR-001  org at plan user limit invites -> 402 LIMIT_EXCEEDED   [HIGH RISK]
//   REQ-DOM-USR-002  org below its user limit invites -> success (no regression)
//   REQ-DOM-USR-003  pending (non-expired) invitations count toward the limit
//                    (provisioned-seat semantic) — the seat that tips 4+1 over 5.
//   Regression guard: CLIENT (portal) organizations are exempt from the LAB
//                    plan user limit — enforcing FREE=1 on them would break
//                    portal member provisioning.
//
// RED (before the fix): the invite endpoint has no tier check, so an at-limit /
// provisioned-over-limit invite SUCCEEDS instead of returning 402.

type AuthModule = typeof import("@calibra-facil/auth");
type LabAuth = ReturnType<AuthModule["createLabAuth"]>;

const NOW = new Date("2026-01-01T00:00:00.000Z");
const FUTURE = new Date("2099-01-01T00:00:00.000Z");
const PAST = new Date("2020-01-01T00:00:00.000Z");

// A direct `auth.api.*` call has no incoming request, so the dev dynamic
// baseURL (allowedHosts) needs a Host header to resolve. "localhost:5173" is an
// allowed host in the dev auth config.
const HOST = "localhost:5173";

let labAuth: LabAuth;
let assertOrganizationUserLimit: AuthModule["assertOrganizationUserLimit"];

beforeAll(async () => {
  // No real email provider during the endpoint drive: sendInvitationEmail runs
  // in the background and its throw is swallowed, but an unset/empty key avoids
  // any network attempt.
  process.env.RESEND_API_KEY = "";

  const real = await vi.importActual<AuthModule>("@calibra-facil/auth");
  labAuth = real.createLabAuth();
  assertOrganizationUserLimit = real.assertOrganizationUserLimit;
});

beforeEach(async () => {
  await truncateAll();
});

// ---------------------------------------------------------------------------
// Seed helpers (inline — not modifying shared seed.ts)
// ---------------------------------------------------------------------------

async function seedLabOrg(params: {
  orgId: string;
  planId?: PlanId | null;
}): Promise<void> {
  await db.insert(organization).values({
    id: params.orgId,
    name: `Lab ${params.orgId}`,
    slug: params.orgId,
    createdAt: NOW,
    type: "LAB",
    status: "ACTIVE",
  });

  if (params.planId) {
    await db.insert(subscription).values({
      organizationId: params.orgId,
      planId: params.planId,
      status: "ACTIVE",
    });
  }
}

async function seedClientOrg(orgId: string): Promise<void> {
  await db.insert(organization).values({
    id: orgId,
    name: `Client ${orgId}`,
    slug: orgId,
    createdAt: NOW,
    type: "CLIENT",
    status: "ACTIVE",
  });
}

/** Seed `count` plain members (each with its own user) for an org. */
async function seedMembers(orgId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const userId = `mbr-${orgId}-${i}`;
    await db.insert(user).values({
      id: userId,
      name: `Member ${i}`,
      email: `${userId}@lab.test`,
    });
    await db.insert(member).values({
      id: `m-${orgId}-${i}`,
      organizationId: orgId,
      userId,
      role: "member",
      createdAt: NOW,
    });
  }
}

/** Seed one invitation row with the given status/expiry. */
async function seedInvitation(params: {
  orgId: string;
  email: string;
  inviterId: string;
  status?: string;
  expiresAt?: Date;
}): Promise<void> {
  await db.insert(invitation).values({
    id: `inv-${params.orgId}-${params.email}`,
    organizationId: params.orgId,
    email: params.email,
    role: "member",
    status: params.status ?? "pending",
    expiresAt: params.expiresAt ?? FUTURE,
    inviterId: params.inviterId,
    createdAt: NOW,
  });
}

/**
 * Seed a real owner (verified email + member row) and mint a REAL session for
 * driving Better Auth endpoints. The lab surface is passwordless (#694), so
 * there is no credential account and no sign-in call — the session row + a
 * correctly signed session cookie is exactly what magic-link sign-in yields.
 */
async function createOwnerAndSignIn(orgId: string): Promise<{
  ownerId: string;
  cookie: string;
}> {
  const ownerId = `owner-${orgId}`;
  const email = `${ownerId}@lab.test`;

  await db.insert(user).values({
    id: ownerId,
    name: "Owner",
    email,
    emailVerified: true,
  });
  await db.insert(member).values({
    id: `m-${orgId}-owner`,
    organizationId: orgId,
    userId: ownerId,
    role: "owner",
    createdAt: NOW,
  });

  // #694 (SEC-09): the lab surface is passwordless — signInEmail returns 400
  // BY DESIGN, so mint a REAL session instead: a `session` row plus the cookie
  // signed exactly as Better Auth verifies it (token + HMAC via the public
  // better-auth/crypto makeSignature). This is what production magic-link
  // sign-in produces; the invite endpoint's hook chain runs unchanged.
  const token = `it-session-${orgId}`;
  await db.insert(session).values({
    id: `sess-${orgId}`,
    token,
    userId: ownerId,
    activeOrganizationId: orgId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // Same HMAC better-auth's makeSignature produces (HMAC-SHA256, standard
  // base64); the value is URL-encoded exactly like setSignedCookie writes it.
  const ctx = await labAuth.$context;
  const cookieName = ctx.authCookies.sessionToken.name;
  const signature = createHmac("sha256", ctx.secret)
    .update(token)
    .digest("base64");
  const cookie = `${cookieName}=${encodeURIComponent(`${token}.${signature}`)}`;

  return { ownerId, cookie };
}

function inviteMember(params: {
  cookie: string;
  orgId: string;
  email: string;
}) {
  return labAuth.api.createInvitation({
    body: { email: params.email, role: "member", organizationId: params.orgId },
    headers: new Headers({ cookie: params.cookie, host: HOST }),
  });
}

/** Seed a standalone (non-member) user to be the target of addMember. */
async function seedUser(userId: string): Promise<void> {
  await db.insert(user).values({
    id: userId,
    name: `User ${userId}`,
    email: `${userId}@lab.test`,
  });
}

/**
 * Directly add a member via the trusted server-side `addMember` endpoint
 * (session optional when a userId is provided — no invite email). Exercises the
 * `beforeAddMember` hook.
 */
function addMember(params: { orgId: string; userId: string }) {
  return labAuth.api.addMember({
    body: {
      userId: params.userId,
      role: "member",
      organizationId: params.orgId,
    },
    headers: new Headers({ host: HOST }),
  });
}

async function memberCountFor(orgId: string): Promise<number> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.organizationId, orgId));
  return rows.length;
}

async function pendingInvitesFor(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ email: invitation.email, status: invitation.status })
    .from(invitation)
    .where(eq(invitation.organizationId, orgId));
  return rows.filter((r) => r.status === "pending").map((r) => r.email);
}

// ---------------------------------------------------------------------------
// End-to-end: real invite endpoint through the org-plugin hook
// ---------------------------------------------------------------------------

describe("invite-member endpoint enforces the plan user limit", () => {
  it("REQ-DOM-USR-001 rejects an at-limit STANDARD org invite with 402 LIMIT_EXCEEDED", async () => {
    const orgId = "org-std-atlimit";
    await seedLabOrg({ orgId, planId: "STANDARD" }); // users limit = 5
    const { cookie } = await createOwnerAndSignIn(orgId); // owner = 1 member
    await seedMembers(orgId, 4); // + 4 = 5 members (at limit)

    await expect(
      inviteMember({ cookie, orgId, email: "sixth@lab.test" }),
    ).rejects.toMatchObject({
      statusCode: 402,
      body: { code: "LIMIT_EXCEEDED" },
    });

    // Nothing was provisioned.
    expect(await pendingInvitesFor(orgId)).toHaveLength(0);
  });

  it("REQ-DOM-USR-001 rejects an at-limit FREE org invite with 402 LIMIT_EXCEEDED", async () => {
    const orgId = "org-free-atlimit";
    await seedLabOrg({ orgId, planId: null }); // no subscription -> FREE, limit = 1
    const { cookie } = await createOwnerAndSignIn(orgId); // owner = 1 member (at limit)

    await expect(
      inviteMember({ cookie, orgId, email: "second@lab.test" }),
    ).rejects.toMatchObject({
      statusCode: 402,
      body: { code: "LIMIT_EXCEEDED" },
    });
  });

  it("REQ-DOM-USR-002 allows an invite when the org is below its user limit", async () => {
    const orgId = "org-std-below";
    await seedLabOrg({ orgId, planId: "STANDARD" }); // limit = 5
    const { cookie } = await createOwnerAndSignIn(orgId); // owner = 1
    await seedMembers(orgId, 1); // + 1 = 2 members (below 5)

    const created = await inviteMember({
      cookie,
      orgId,
      email: "newhire@lab.test",
    });
    expect(created.email).toBe("newhire@lab.test");
    expect(await pendingInvitesFor(orgId)).toContain("newhire@lab.test");
  });

  it("REQ-DOM-USR-003 counts pending invitations toward the limit (provisioned seats)", async () => {
    // Control org: 4 members + 0 pending on STANDARD(5) -> invite ALLOWED.
    const controlOrg = "org-std-control";
    await seedLabOrg({ orgId: controlOrg, planId: "STANDARD" });
    const control = await createOwnerAndSignIn(controlOrg); // owner = 1
    await seedMembers(controlOrg, 3); // + 3 = 4 members, 0 pending

    const allowed = await inviteMember({
      cookie: control.cookie,
      orgId: controlOrg,
      email: "fifth@lab.test",
    });
    expect(allowed.email).toBe("fifth@lab.test");

    // Provisioned org: 4 members + 1 pending = 5 provisioned on STANDARD(5).
    // The pending seat is the ONLY difference from the control -> invite BLOCKED,
    // proving pending invitations count toward the limit.
    const provOrg = "org-std-provisioned";
    await seedLabOrg({ orgId: provOrg, planId: "STANDARD" });
    const prov = await createOwnerAndSignIn(provOrg); // owner = 1
    await seedMembers(provOrg, 3); // + 3 = 4 members
    await seedInvitation({
      orgId: provOrg,
      email: "pending-seat@lab.test",
      inviterId: prov.ownerId,
    }); // + 1 pending = 5 provisioned

    await expect(
      inviteMember({
        cookie: prov.cookie,
        orgId: provOrg,
        email: "over-limit@lab.test",
      }),
    ).rejects.toMatchObject({
      statusCode: 402,
      body: { code: "LIMIT_EXCEEDED" },
    });
  });

  it("REQ-DOM-USR-001 rejects a direct add-member on an at-limit org with 402 LIMIT_EXCEEDED", async () => {
    const orgId = "org-std-addmember-atlimit";
    await seedLabOrg({ orgId, planId: "STANDARD" }); // limit = 5
    await seedMembers(orgId, 5); // at limit
    await seedUser("addtarget-blocked");

    await expect(
      addMember({ orgId, userId: "addtarget-blocked" }),
    ).rejects.toMatchObject({
      statusCode: 402,
      body: { code: "LIMIT_EXCEEDED" },
    });
    expect(await memberCountFor(orgId)).toBe(5);
  });

  it("REQ-DOM-USR-002 allows a direct add-member when the org is below its limit", async () => {
    const orgId = "org-std-addmember-below";
    await seedLabOrg({ orgId, planId: "STANDARD" }); // limit = 5
    await seedMembers(orgId, 2); // below limit
    await seedUser("addtarget-ok");

    await addMember({ orgId, userId: "addtarget-ok" });
    expect(await memberCountFor(orgId)).toBe(3);
  });

  it("REQ-DOM-USR-003 does NOT count expired/non-pending invitations", async () => {
    const orgId = "org-std-expired";
    await seedLabOrg({ orgId, planId: "STANDARD" }); // limit = 5
    const { cookie, ownerId } = await createOwnerAndSignIn(orgId); // owner = 1
    await seedMembers(orgId, 3); // + 3 = 4 members total

    // An EXPIRED pending invite and an ACCEPTED invite must NOT consume seats.
    await seedInvitation({
      orgId,
      email: "expired@lab.test",
      inviterId: ownerId,
      status: "pending",
      expiresAt: PAST,
    });
    await seedInvitation({
      orgId,
      email: "accepted@lab.test",
      inviterId: ownerId,
      status: "accepted",
    });

    // 4 members + 0 COUNTED seats -> invite allowed (projected 5 <= 5).
    const created = await inviteMember({
      cookie,
      orgId,
      email: "real-fifth@lab.test",
    });
    expect(created.email).toBe("real-fifth@lab.test");
  });
});

// ---------------------------------------------------------------------------
// Direct-function coverage: exemption + provisioned-seat semantics
// ---------------------------------------------------------------------------

describe("assertOrganizationUserLimit (enforcement unit, real DB)", () => {
  it("throws 402 LIMIT_EXCEEDED for a LAB org at its plan limit", async () => {
    const orgId = "fn-lab-atlimit";
    await seedLabOrg({ orgId, planId: "STANDARD" });
    await seedMembers(orgId, 5); // at limit 5

    await expect(assertOrganizationUserLimit(orgId)).rejects.toMatchObject({
      statusCode: 402,
      body: { code: "LIMIT_EXCEEDED" },
    });
  });

  it("resolves for a LAB org below its plan limit", async () => {
    const orgId = "fn-lab-below";
    await seedLabOrg({ orgId, planId: "STANDARD" });
    await seedMembers(orgId, 2);

    await expect(assertOrganizationUserLimit(orgId)).resolves.toBeUndefined();
  });

  it("regression guard: CLIENT (portal) orgs are exempt from the LAB user limit", async () => {
    // A FREE-equivalent CLIENT org already has members; enforcing users=1 here
    // would break portal member provisioning. It must be exempt.
    const orgId = "fn-client-exempt";
    await seedClientOrg(orgId);
    await seedMembers(orgId, 5); // well over any FREE limit

    await expect(assertOrganizationUserLimit(orgId)).resolves.toBeUndefined();
  });
});
