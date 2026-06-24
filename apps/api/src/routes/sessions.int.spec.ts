import { beforeEach, describe, expect, it } from "vitest";
import { sessionsRouter } from "./sessions";
import { db } from "@calibra-facil/db";
import { session as sessionTable } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for the session-revoke boundary.
// Only better-auth's getSession is mocked (see test/integration/setup.ts);
// requireLabAuth runs for real, and the handler's userId scope check runs
// against REAL session rows in Postgres. This proves the security property a
// vi.mock(db) tier cannot: a user can revoke ONLY their own session rows.
//
// Contract (apps/api/src/routes/sessions.ts): the router exposes a SINGLE route,
//   POST /revoke (guard: requireLabAuth)
// and scopes deletion by the authenticated user's id:
//   if (!targetSession || targetSession.userId !== userId) -> 404 "Session not found"
// There is NO list endpoint, so the "list returns only own sessions" half of
// REQ-SESS-001 is N/A — the only observable surface is /revoke, asserted below.

const JSON_HEADERS = { "content-type": "application/json" };

/** Seed a real Better-Auth session row for a seeded user. Returns its id. */
async function seedSession(params: {
  id: string;
  userId: string;
}): Promise<string> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  await db.insert(sessionTable).values({
    id: params.id,
    userId: params.userId,
    token: `token-${params.id}`,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    createdAt: now,
    updatedAt: now,
  });
  return params.id;
}

async function sessionExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(eq(sessionTable.id, id))
    .limit(1);
  return rows.length === 1;
}

describe("sessionsRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-SESS-001: POST /revoke of ANOTHER user's session -> 404 and that session survives (userId scope)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const orgB = await seedOrg({ orgId: "org-b", userId: "user-b" });

    // user-a's own session, plus user-b's session as the SOLE leak discriminator.
    await seedSession({ id: "sess-a", userId: orgA.userId });
    const victimSessionId = await seedSession({
      id: "sess-b",
      userId: orgB.userId,
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await sessionsRouter.request("/revoke", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: victimSessionId }),
    });

    // The boundary: the row exists, but belongs to user-b, so user-a is told it
    // does not exist and — crucially — it is NOT deleted.
    expect(res.status).toBe(404);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "Session not found" });
    expect(await sessionExists(victimSessionId)).toBe(true);
  });

  it("REQ-SESS-001: happy-path revoke of OWN session -> { status: true } and row deleted", async () => {
    const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const ownSessionId = await seedSession({ id: "sess-a", userId: orgA.userId });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await sessionsRouter.request("/revoke", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: ownSessionId }),
    });

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toEqual({ status: true });
    expect(await sessionExists(ownSessionId)).toBe(false);
  });

  it("REQ-SESS-002: POST /revoke unauthenticated -> 401 and no session deleted", async () => {
    const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const ownSessionId = await seedSession({ id: "sess-a", userId: orgA.userId });

    logout();
    const res = await sessionsRouter.request("/revoke", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: ownSessionId }),
    });

    expect(res.status).toBe(401);
    // requireLabAuth blocks before the handler — the row is untouched.
    expect(await sessionExists(ownSessionId)).toBe(true);
  });

  it("missing sessionId -> 400 (input validation, authenticated)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await sessionsRouter.request("/revoke", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "sessionId is required" });
  });
});
