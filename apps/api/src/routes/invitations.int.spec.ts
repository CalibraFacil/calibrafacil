import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { invitationsRouter } from "./invitations";
import { db } from "@calibra-facil/db";
import {
  invitation,
  labAccountSetupToken,
  member,
  organization,
  platformEventLog,
  user,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB integration test for the PUBLIC invitations router
// (apps/api/src/routes/invitations.ts). Unlike the authed routers, this one is
// mounted at /api/invitations with NO middleware — both routes are reachable
// without a session. The harness mocks ONLY better-auth's getSession (see
// test/integration/setup.ts); every DB read/write here runs for real against a
// seeded Postgres.
//
// SURFACE MAP (read from the route file, both PUBLIC):
//   GET  /:id                    -> pure-DB read; surfaces an invitation ONLY
//                                   when status=pending AND expiresAt>now() AND
//                                   it joins to a real org. Returns role+org.
//   POST /:id/request-setup-link -> same pending+not-expired gate PLUS
//                                   organization.type="LAB"; then mints a
//                                   lab_account_setup_token BOUND to the invite's
//                                   organizationId + invitationId + email and
//                                   writes a platformEventLog row.
//
// KEY SECURITY PROPERTY this router owns: the setup token it mints carries the
// invite's OWN org + invitationId + email — it cannot be steered to a different
// org or identity than the invitation row says. The downstream member-row INSERT
// itself lives in lab-setup.ts (/:token/complete), NOT this file; see the N/A
// note on REQ-INV-001 below for that boundary.

const JSON_HEADERS = { "content-type": "application/json" };

/** Seed an invitation row. Defaults to a pending, far-future invite. */
async function seedInvitation(params: {
  id?: string;
  organizationId: string;
  inviterId: string;
  email: string;
  role?: string;
  status?: string;
  expiresAt?: Date;
}): Promise<string> {
  const id = params.id ?? `inv-${randomBytes(6).toString("hex")}`;
  await db.insert(invitation).values({
    id,
    organizationId: params.organizationId,
    email: params.email,
    role: params.role ?? "technician",
    status: params.status ?? "pending",
    expiresAt: params.expiresAt ?? new Date("2099-01-01T00:00:00.000Z"),
    inviterId: params.inviterId,
  });
  return id;
}

/** Seed a non-LAB (CLIENT) organization to contest the LAB-only gate. */
async function seedClientOrg(orgId: string): Promise<void> {
  await db.insert(organization).values({
    id: orgId,
    name: `Client ${orgId}`,
    slug: orgId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "CLIENT",
    status: "ACTIVE",
  });
}

/** Seed a plain user (e.g. the not-yet-member invitee) without a membership. */
async function seedUser(params: { id: string; email: string }): Promise<void> {
  await db.insert(user).values({
    id: params.id,
    name: `User ${params.id}`,
    email: params.email,
  });
}

describe("invitationsRouter — real DB (public router)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // happy-path / REQ-INV-001 binding surface: GET /:id
  // =========================================================================
  it("GET /:id returns the invite's OWN org + role (binding round-trip)", async () => {
    const labA = await seedOrg({ orgId: "lab-a", role: "admin" });
    // A second org exists so "returns the right org" is a real discriminator,
    // not the only org in the DB.
    await seedOrg({ orgId: "lab-b", role: "admin" });
    const invId = await seedInvitation({
      organizationId: labA.orgId,
      inviterId: labA.userId,
      email: "invitee@lab.test",
      role: "technician",
    });

    const res = await invitationsRouter.request(`/${invId}`, {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // The accept page must see the invite's CORRECT org + role, not another's.
    expect(body.organizationId).toBe(labA.orgId);
    expect(body.organizationName).toBe("Lab lab-a");
    expect(body.role).toBe("technician");
    expect(body.email).toBe("invitee@lab.test");
    expect(body.status).toBe("pending");
  });

  // =========================================================================
  // REQ-INV-001 [HIGH RISK]: a VALID setup-link request BINDS the minted token
  // to the invite's CORRECT org + invitationId + email. The org binding on this
  // token is exactly what lab-setup/complete later reads to create the member
  // row in the right org — so this is the binding contract this file owns.
  // =========================================================================
  it("REQ-INV-001 setup-link binds the token to the invite's org + invitationId + email", async () => {
    const labA = await seedOrg({ orgId: "lab-a", role: "admin" });
    await seedOrg({ orgId: "lab-b", role: "admin" });
    // Seed the invitee user with the SAME email so ensureInvitationUser takes
    // the existing-user branch (the create-user branch needs better-auth, which
    // the getSession-only mock can't reach — see the harness-unreachable note).
    const inviteEmail = "invitee@lab.test";
    await seedUser({ id: "u-invitee", email: inviteEmail });
    const invId = await seedInvitation({
      organizationId: labA.orgId,
      inviterId: labA.userId,
      email: inviteEmail,
      role: "technician",
    });

    const res = await invitationsRouter.request(`/${invId}/request-setup-link`, {
      method: "POST",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.setupLinkRequested).toBe(true);

    // Re-query the minted token: it must point at lab-a (the invite's org) and
    // carry THIS invitation id + the invited email — never lab-b, never another.
    const tokens = await db
      .select({
        organizationId: labAccountSetupToken.organizationId,
        invitationId: labAccountSetupToken.invitationId,
        email: labAccountSetupToken.email,
        userId: labAccountSetupToken.userId,
        purpose: labAccountSetupToken.purpose,
      })
      .from(labAccountSetupToken);

    expect(tokens).toHaveLength(1);
    const token = tokens[0];
    expect(token?.organizationId).toBe(labA.orgId);
    expect(token?.invitationId).toBe(invId);
    expect(token?.email).toBe(inviteEmail);
    expect(token?.userId).toBe("u-invitee");
    expect(token?.purpose).toBe("member_invite_claim");

    // No membership is created by THIS router (that is lab-setup/complete's job);
    // proving it here pins the file boundary so a future drive-by can't smuggle a
    // member insert into this public, sessionless endpoint.
    const members = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, labA.orgId),
          eq(member.userId, "u-invitee"),
        ),
      );
    expect(members).toHaveLength(0);
  });

  // =========================================================================
  // REQ-INV-002 [HIGH RISK]: invalid / unknown / non-pending / expired invite
  // is rejected with 404 and writes NOTHING (no token, no event log).
  // =========================================================================
  it("REQ-INV-002 GET /:id of an unknown invitation -> 404", async () => {
    await seedOrg({ orgId: "lab-a", role: "admin" });
    const res = await invitationsRouter.request("/does-not-exist", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(404);
  });

  it("REQ-INV-002 GET /:id of a non-pending (already-accepted) invite -> 404", async () => {
    const labA = await seedOrg({ orgId: "lab-a", role: "admin" });
    const invId = await seedInvitation({
      organizationId: labA.orgId,
      inviterId: labA.userId,
      email: "invitee@lab.test",
      status: "accepted", // already consumed
    });

    const res = await invitationsRouter.request(`/${invId}`, {
      headers: JSON_HEADERS,
    });
    // The pending-gate (status="pending") is the sole reason this differs from
    // the happy-path GET above; an already-redeemed invite must not re-surface.
    expect(res.status).toBe(404);
  });

  it("REQ-INV-002 GET /:id of an expired invite -> 404", async () => {
    const labA = await seedOrg({ orgId: "lab-a", role: "admin" });
    const invId = await seedInvitation({
      organizationId: labA.orgId,
      inviterId: labA.userId,
      email: "invitee@lab.test",
      expiresAt: new Date("2000-01-01T00:00:00.000Z"), // long expired
    });

    const res = await invitationsRouter.request(`/${invId}`, {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(404);
  });

  it("REQ-INV-002 setup-link for an expired invite -> 404 and mints NO token / logs NO event", async () => {
    const labA = await seedOrg({ orgId: "lab-a", role: "admin" });
    const inviteEmail = "invitee@lab.test";
    await seedUser({ id: "u-invitee", email: inviteEmail });
    const invId = await seedInvitation({
      organizationId: labA.orgId,
      inviterId: labA.userId,
      email: inviteEmail,
      expiresAt: new Date("2000-01-01T00:00:00.000Z"), // expired
    });

    const res = await invitationsRouter.request(`/${invId}/request-setup-link`, {
      method: "POST",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(404);

    // The token-check gate must short-circuit BEFORE any side effect: no setup
    // token minted, no platformEventLog row written for this invitation.
    const tokens = await db.select().from(labAccountSetupToken);
    expect(tokens).toHaveLength(0);

    const events = await db
      .select()
      .from(platformEventLog)
      .where(eq(platformEventLog.entityId, invId));
    expect(events).toHaveLength(0);
  });

  // =========================================================================
  // REQ-INV-003: the guard THIS file actually enforces on the side-effecting
  // route — organization.type must be "LAB". A perfectly valid, pending invite
  // attached to a non-LAB (CLIENT) org must NOT mint a lab setup token. (There
  // is no session-identity match in this router; that lives in lab-setup/complete.
  // See the N/A note for that variant.)
  // =========================================================================
  it("REQ-INV-003 setup-link for a pending invite on a NON-LAB org -> 404, no token", async () => {
    // Inviter user + a CLIENT org carrying an otherwise-valid pending invite.
    await seedUser({ id: "client-inviter", email: "inviter@client.test" });
    await seedClientOrg("client-org");
    const inviteEmail = "invitee@client.test";
    await seedUser({ id: "u-client-invitee", email: inviteEmail });
    const invId = await seedInvitation({
      organizationId: "client-org",
      inviterId: "client-inviter",
      email: inviteEmail,
      status: "pending",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    const res = await invitationsRouter.request(`/${invId}/request-setup-link`, {
      method: "POST",
      headers: JSON_HEADERS,
    });

    // organization.type="LAB" is the SOLE discriminator vs REQ-INV-001's happy
    // path: same pending, same not-expired, same matching user — only the org
    // type differs. A CLIENT-org invite must never yield a LAB setup token.
    expect(res.status).toBe(404);
    const tokens = await db.select().from(labAccountSetupToken);
    expect(tokens).toHaveLength(0);
  });

  // =========================================================================
  // REQ-INV-004: N/A — there is no authed route in this router to return 401.
  // Both routes are mounted publicly (route-mounts.ts: .route("/api/invitations",
  // invitationsRouter) with NO requireLabAuth before it) so an unauthenticated
  // request is the DESIGNED case, not a rejection. Asserting 401 here would
  // contradict the real contract. The 401-on-unauthenticated property is proven
  // for the AUTHED routers (e.g. services.int.spec.ts "GET / unauthenticated -> 401").
  // =========================================================================
});
