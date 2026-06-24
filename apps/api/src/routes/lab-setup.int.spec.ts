import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  invitation,
  member,
  organization,
  session as authSession,
  user,
} from "@calibra-facil/db/schema";
import { createLabAccountSetupToken } from "@calibra-facil/auth/lab-access";
import { labSetupRouter } from "./lab-setup";
import { loginAs, logout, sessionFor } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";

// Real-DB integration test for the lab ONBOARDING / account-claim surface.
//
// IMPORTANT — this router is NOT an RBAC-gated, session-org-scoped CRUD router.
// `labSetupRouter` mounts NO middleware: no requireLabAuth, no requireOrganization,
// no requirePermission/requireRole/requireOrgType. The authorization primitive is
// the SETUP-TOKEN SECRET (`<id>.<secret>`, sha256-hashed, timing-safe compared) and
// the token -> org/user/email binding enforced by `validateLabAccountSetupToken`
// (packages/auth/src/lab-access.ts), which runs against the REAL test Postgres via
// getDb(). The harness mocks ONLY createLabAuth().api.getSession; the /complete
// route reads that mocked session and then runs a REAL DB transaction.
//
// Consequences for coverage:
//  - The "tenant boundary" is the token's bound organizationId/userId/email, not a
//    session activeOrganizationId. REQ-LS-001/002 are bound to that token boundary.
//  - /request-magic-link and /request-otp call createLabAuth().api.signInMagicLink /
//    .sendVerificationOTP, which the harness's createLabAuth() does NOT provide
//    (only getSession). Their HAPPY paths are NOT exercisable here (would throw on
//    an undefined method) — structurally N/A, like customer-groups' create path.
//    Their REJECTION paths (invalid token) return before touching createLabAuth and
//    ARE exercisable.

const JSON_HEADERS = { "content-type": "application/json" };

// Seed a user whose email matches the harness session shape (`${userId}@lab.test`,
// as produced by sessionFor) + a LAB organization + (optionally) a member row, then
// mint a REAL setup token via the production helper (proper sha256 secret hash). The
// raw `<id>.<secret>` token is what `validateLabAccountSetupToken` re-validates.
async function seedClaimable(params: {
  orgId: string;
  userId: string;
  withMembership?: boolean;
}) {
  const { orgId, userId } = params;
  const email = `${userId}@lab.test`;
  const now = new Date("2026-01-01T00:00:00.000Z");

  await db.insert(user).values({ id: userId, name: `User ${userId}`, email });
  await db.insert(organization).values({
    id: orgId,
    name: `Lab ${orgId}`,
    slug: orgId,
    createdAt: now,
    type: "LAB",
    status: "ACTIVE",
  });

  if (params.withMembership) {
    await db.insert(member).values({
      id: `member-${orgId}-${userId}`,
      organizationId: orgId,
      userId,
      role: "owner",
      createdAt: now,
    });
  }

  const minted = await createLabAccountSetupToken({
    userId,
    organizationId: orgId,
    email,
    purpose: params.withMembership ? "owner_claim" : "member_invite_claim",
    source: "test",
  });

  return { orgId, userId, email, token: minted.token, tokenId: minted.id };
}

// A live better-auth session row for the harness-mocked session id (`sess-<userId>`),
// so the /complete handler's `update(session).set({ activeOrganizationId })` has a
// row to write (proving persistence on the happy path).
async function seedAuthSessionRow(userId: string) {
  const sessionId = `sess-${userId}`;
  await db.insert(authSession).values({
    id: sessionId,
    userId,
    token: `tok-${userId}`,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    activeOrganizationId: null,
  });
  return sessionId;
}

describe("labSetupRouter — real DB + token-bound authorization", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-LS-003: unauthenticated -> 401.
  // /complete validates the token (real DB) then requires a better-auth session.
  // With getSession mocked to null the handler returns 401 "Sessão obrigatória".
  it("REQ-LS-003: POST /:token/complete with no session -> 401", async () => {
    const a = await seedClaimable({
      orgId: "org-a",
      userId: "user-a",
      withMembership: true,
    });
    logout();

    const res = await labSetupRouter.request(`/${a.token}/complete`, {
      method: "POST",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Sessão obrigatória" });
  });

  // REQ-LS-001 [HIGH RISK]: a setup READ returns only the data bound to THAT token's
  // organization. There is no cross-org-readable list surface here; the read is
  // scoped by `.where(eq(labAccountSetupToken.id, parsed.id))` in
  // validateLabAccountSetupToken, joined to its own organization row. Two orgs are
  // seeded, each with its own token whose ONLY difference is the token id; requesting
  // org-A's token must surface org-A's identity and never org-B's.
  it("REQ-LS-001: GET /:token returns only the token's own org identity (tenant isolation)", async () => {
    const a = await seedClaimable({
      orgId: "org-a",
      userId: "user-a",
      withMembership: true,
    });
    await seedClaimable({
      orgId: "org-b",
      userId: "user-b",
      withMembership: true,
    });

    const res = await labSetupRouter.request(`/${a.token}`, {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.organizationName).toBe("Lab org-a");
    expect(body.organizationSlug).toBe("org-a");
    expect(body.email).toBe("user-a@lab.test");
    // The other tenant's identity must never leak through this token.
    expect(body.organizationName).not.toBe("Lab org-b");
    expect(body.organizationSlug).not.toBe("org-b");
    expect(body.email).not.toBe("user-b@lab.test");
  });

  // REQ-LS-002: a setup MUTATION is denied across the token boundary. There is no
  // role/permission gate on this router; the discriminator is the identity binding
  // in /complete:
  //   session.user.id !== validation.token.userId
  //   || normalizeLabAccessEmail(session.user.email) !== validation.token.email
  // A user authenticated as org-B's user CANNOT complete (consume) org-A's token.
  // The leak row (org-A's token + membership) is seeded so identity binding is the
  // SOLE discriminator: had org-B's session been accepted, the token would consume.
  it("REQ-LS-002: POST /:token/complete by a non-matching session -> 403, token NOT consumed", async () => {
    const a = await seedClaimable({
      orgId: "org-a",
      userId: "user-a",
      withMembership: true,
    });
    const b = await seedClaimable({
      orgId: "org-b",
      userId: "user-b",
      withMembership: true,
    });

    // Authenticated as org-B's user, attacking org-A's token.
    loginAs({ userId: b.userId, organizationId: b.orgId });

    const res = await labSetupRouter.request(`/${a.token}/complete`, {
      method: "POST",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Sessão não corresponde ao convite" });

    // The cross-tenant write was actually denied: org-A's token is unconsumed and
    // no member row was created for the attacker in org-A.
    const stillReady = await labSetupRouter.request(`/${a.token}`, {
      headers: JSON_HEADERS,
    });
    const stillReadyBody = await stillReady.json();
    expect(stillReadyBody.status).toBe("ready");

    const crossMembership = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(eq(member.organizationId, a.orgId), eq(member.userId, b.userId)),
      );
    expect(crossMembership).toHaveLength(0);
  });

  // happy-path: a matching session completes the claim. The token is for a
  // member_invite_claim with NO membership yet + a pending invitation, so completion
  // performs the deep write: inserts the member row, accepts the invitation, consumes
  // the token, and sets the session's active organization. Everything re-queried.
  it("happy-path: POST /:token/complete by the matching session creates membership + consumes token + sets active org", async () => {
    const orgId = "org-a";
    const userId = "user-a";
    const email = `${userId}@lab.test`;
    const now = new Date("2026-01-01T00:00:00.000Z");

    await db.insert(user).values({ id: userId, name: `User ${userId}`, email });
    // The inviter must exist (FK invitation.inviter_id -> user.id).
    await db
      .insert(user)
      .values({ id: "inviter-1", name: "Inviter", email: "inviter@lab.test" });
    await db.insert(organization).values({
      id: orgId,
      name: `Lab ${orgId}`,
      slug: orgId,
      createdAt: now,
      type: "LAB",
      status: "ACTIVE",
    });

    const invitationId = randomBytes(12).toString("hex");
    await db.insert(invitation).values({
      id: invitationId,
      organizationId: orgId,
      email,
      role: "technician",
      status: "pending",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      createdAt: now,
      inviterId: "inviter-1",
    });

    const minted = await createLabAccountSetupToken({
      userId,
      organizationId: orgId,
      email,
      purpose: "member_invite_claim",
      invitationId,
      source: "test",
    });

    const sessionId = await seedAuthSessionRow(userId);
    loginAs({ userId, organizationId: orgId });

    const res = await labSetupRouter.request(`/${minted.token}/complete`, {
      method: "POST",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claimed).toBe(true);
    expect(body.organizationId).toBe(orgId);

    // Member row created with the invitation's role.
    const createdMember = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
    expect(createdMember).toHaveLength(1);
    expect(createdMember[0]?.role).toBe("technician");

    // Invitation accepted.
    const inv = await db
      .select({ status: invitation.status })
      .from(invitation)
      .where(eq(invitation.id, invitationId));
    expect(inv[0]?.status).toBe("accepted");

    // Token consumed -> re-validating it now reports "consumed".
    const reread = await labSetupRouter.request(`/${minted.token}`, {
      headers: JSON_HEADERS,
    });
    expect(reread.status).toBe(410);
    const rereadBody = await reread.json();
    expect(rereadBody.status).toBe("consumed");

    // Active organization persisted on the live session row.
    const sess = await db
      .select({ activeOrganizationId: authSession.activeOrganizationId })
      .from(authSession)
      .where(eq(authSession.id, sessionId));
    expect(sess[0]?.activeOrganizationId).toBe(orgId);
  });

  // Sanity: the harness session helper shape is what /complete compares against.
  it("uses the harness session identity for matching (documents the boundary)", () => {
    const s = sessionFor({ userId: "user-a", organizationId: "org-a" });
    expect(s.user.email).toBe("user-a@lab.test");
    expect(s.session.id).toBe("sess-user-a");
  });
});
