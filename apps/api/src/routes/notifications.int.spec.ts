import { beforeEach, describe, expect, it } from "vitest";
import { notificationsRouter } from "./notifications";
import { db } from "@calibra-facil/db";
import {
  notification,
  notificationPreference,
  type NotificationType,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for the notifications router. Only the
// better-auth lab session is mocked (see test/integration/setup.ts); the real
// guard chain runs against a seeded Postgres:
//
//   ...requireLabProtected === [requireLabAuth, requireOrganization]
//
// Every notifications route uses requireLabProtected ONLY — there is no
// requirePermission / requireRole / requireOrgType (any authenticated member of
// the active org passes the guard). So RBAC here is NOT role-gated; the security
// property under test is the handler's WHERE-clause tenant + user scoping:
//
//   notification rows are filtered by BOTH
//     eq(notification.recipientUserId, session.user.id)   // per-USER
//     eq(notification.organizationId,  member.organizationId)  // per-ORG
//
// Because the scope is a TWO-column predicate, an isolation test for ONE column
// must seed the "leak" row so the column under test is the SOLE discriminator
// (the other two scoping columns must MATCH the reader). Otherwise a distinct
// id / org / user would let a sibling predicate hide the leak and the test would
// pass vacuously. See the per-test comments for how each leak row is constructed.

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Seed a notification row. Caller controls recipientUserId + organizationId so a
 * test can place a "leak" row that differs from the reader on exactly ONE scoping
 * column. Returns the created serial id.
 */
async function seedNotification(params: {
  recipientUserId: string;
  organizationId: string;
  title: string;
  type?: NotificationType;
  status?: "UNREAD" | "READ" | "ARCHIVED";
}): Promise<number> {
  const [row] = await db
    .insert(notification)
    .values({
      recipientUserId: params.recipientUserId,
      organizationId: params.organizationId,
      type: params.type ?? "JOB_APPROVED",
      title: params.title,
      message: `${params.title} body`,
      status: params.status ?? "UNREAD",
    })
    .returning({ id: notification.id });
  if (!row) throw new Error("seedNotification: insert failed");
  return row.id;
}

/**
 * Seed a SECOND user inside an already-seeded org (seedOrg only makes one). Used
 * to construct the same-org-different-user leak row for REQ-NOTIF-001/002 so the
 * `recipientUserId` predicate is the sole discriminator.
 */
async function seedSecondUser(params: {
  userId: string;
  organizationId: string;
}): Promise<void> {
  const { user, member } = await import("@calibra-facil/db/schema");
  await db.insert(user).values({
    id: params.userId,
    name: `User ${params.userId}`,
    email: `${params.userId}@lab.test`,
  });
  await db.insert(member).values({
    id: `member-${params.organizationId}-${params.userId}`,
    organizationId: params.organizationId,
    userId: params.userId,
    role: "member",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

/** Make the reader user ALSO a member of a second org so an other-org leak row's
 * only distinguishing scoping column vs. the reader's active-org scope is
 * organizationId. */
async function addMembership(params: {
  userId: string;
  organizationId: string;
}): Promise<void> {
  const { member } = await import("@calibra-facil/db/schema");
  await db.insert(member).values({
    id: `member-${params.organizationId}-${params.userId}`,
    organizationId: params.organizationId,
    userId: params.userId,
    role: "admin",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

describe("notificationsRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ===========================================================================
  // REQ-NOTIF-003: unauthenticated -> 401
  // ===========================================================================
  it("REQ-NOTIF-003: GET / unauthenticated -> 401 (requireLabAuth)", async () => {
    logout();
    const res = await notificationsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });

  it("REQ-NOTIF-003: POST /mark-read unauthenticated -> 401", async () => {
    logout();
    const res = await notificationsRouter.request("/mark-read", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ notificationIds: [1] }),
    });
    expect(res.status).toBe(401);
  });

  // ===========================================================================
  // REQ-NOTIF-001 [HIGH RISK]: list isolation — a principal sees only their own
  // notifications. Two leak rows, each isolating ONE scoping column:
  //   (a) same-ORG, different USER  -> recipientUserId is the sole discriminator
  //   (b) different ORG, same USER  -> organizationId  is the sole discriminator
  // ===========================================================================
  it("REQ-NOTIF-001: GET / returns only the principal's own notifications (user + org scope)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    // second user inside orgA (same org as the reader, different recipient)
    await seedSecondUser({ userId: "user-other", organizationId: orgA.orgId });
    // reader is ALSO a member of orgB so the org-leak row's only distinguishing
    // column vs. the reader's active-org scope is organizationId
    await addMembership({ userId: orgA.userId, organizationId: orgB.orgId });

    // the reader's OWN notification (must appear)
    await seedNotification({
      recipientUserId: orgA.userId,
      organizationId: orgA.orgId,
      title: "Mine",
    });
    // leak (a): SAME org, DIFFERENT recipient user
    await seedNotification({
      recipientUserId: "user-other",
      organizationId: orgA.orgId,
      title: "OtherUserSameOrg",
    });
    // leak (b): SAME recipient user, DIFFERENT org
    await seedNotification({
      recipientUserId: orgA.userId,
      organizationId: orgB.orgId,
      title: "MyUserOtherOrg",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await notificationsRouter.request("/", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const titles = body.data.map((n: { title: string }) => n.title);
    expect(titles).toContain("Mine");
    expect(titles).not.toContain("OtherUserSameOrg"); // user-scope leak guard
    expect(titles).not.toContain("MyUserOtherOrg"); // org-scope leak guard
    expect(body.pagination.total).toBe(1);
  });

  it("REQ-NOTIF-001: GET /unread-count counts only the principal's own unread (user + org scope)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    await seedSecondUser({ userId: "user-other", organizationId: orgA.orgId });
    await addMembership({ userId: orgA.userId, organizationId: orgB.orgId });

    await seedNotification({
      recipientUserId: orgA.userId,
      organizationId: orgA.orgId,
      title: "Mine",
      status: "UNREAD",
    });
    // same-org other-user leak (sole discriminator = recipientUserId)
    await seedNotification({
      recipientUserId: "user-other",
      organizationId: orgA.orgId,
      title: "OtherUserSameOrg",
      status: "UNREAD",
    });
    // same-user other-org leak (sole discriminator = organizationId)
    await seedNotification({
      recipientUserId: orgA.userId,
      organizationId: orgB.orgId,
      title: "MyUserOtherOrg",
      status: "UNREAD",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await notificationsRouter.request("/unread-count", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
  });

  // ===========================================================================
  // REQ-NOTIF-002 [HIGH RISK]: writes targeting a notification outside the
  // principal's scope are no-ops (zero rows updated). Bound to the real
  // mark-read / mark-all-read / DELETE handlers' WHERE clauses.
  // ===========================================================================
  it("REQ-NOTIF-002: POST /mark-read cannot mark another user's notification in the same org (no-op)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedSecondUser({ userId: "user-other", organizationId: orgA.orgId });

    // Leak row: SAME org as the attacker, DIFFERENT recipient user. The only
    // scoping column distinguishing it from the attacker's scope is
    // recipientUserId — if that predicate regressed, this row would be marked.
    const foreignId = await seedNotification({
      recipientUserId: "user-other",
      organizationId: orgA.orgId,
      title: "OtherUserSameOrg",
      status: "UNREAD",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await notificationsRouter.request("/mark-read", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ notificationIds: [foreignId] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedIds).toEqual([]); // nothing the attacker owned -> no-op

    // The foreign row is untouched: still UNREAD, never read.
    const [after] = await db
      .select()
      .from(notification)
      .where(eq(notification.id, foreignId));
    expect(after?.status).toBe("UNREAD");
    expect(after?.readAt).toBeNull();
  });

  it("REQ-NOTIF-002: POST /mark-read cannot mark a same-user notification in another org (no-op)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    // Reader is a member of orgB too, so org is the sole discriminator.
    await addMembership({ userId: orgA.userId, organizationId: orgB.orgId });

    // Leak row: SAME recipient user, DIFFERENT org. Sole discriminator vs. the
    // attacker's active-org scope is organizationId.
    const foreignOrgId = await seedNotification({
      recipientUserId: orgA.userId,
      organizationId: orgB.orgId,
      title: "MyUserOtherOrg",
      status: "UNREAD",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await notificationsRouter.request("/mark-read", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ notificationIds: [foreignOrgId] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedIds).toEqual([]);

    const [after] = await db
      .select()
      .from(notification)
      .where(eq(notification.id, foreignOrgId));
    expect(after?.status).toBe("UNREAD");
    expect(after?.readAt).toBeNull();
  });

  it("REQ-NOTIF-002: DELETE /:id of another user's notification (same org) -> 404, row untouched", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedSecondUser({ userId: "user-other", organizationId: orgA.orgId });

    // Same-org, different-user leak row: recipientUserId is the sole discriminator.
    const foreignId = await seedNotification({
      recipientUserId: "user-other",
      organizationId: orgA.orgId,
      title: "OtherUserSameOrg",
      status: "UNREAD",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await notificationsRouter.request(`/${foreignId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(404);

    const [after] = await db
      .select()
      .from(notification)
      .where(eq(notification.id, foreignId));
    expect(after?.status).toBe("UNREAD"); // not ARCHIVED — soft-delete blocked
  });

  it("REQ-NOTIF-002: POST /mark-all-read marks only the principal's own unread (foreign rows untouched)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    await seedSecondUser({ userId: "user-other", organizationId: orgA.orgId });
    await addMembership({ userId: orgA.userId, organizationId: orgB.orgId });

    const mineId = await seedNotification({
      recipientUserId: orgA.userId,
      organizationId: orgA.orgId,
      title: "Mine",
      status: "UNREAD",
    });
    // same-org other-user leak
    const otherUserId = await seedNotification({
      recipientUserId: "user-other",
      organizationId: orgA.orgId,
      title: "OtherUserSameOrg",
      status: "UNREAD",
    });
    // same-user other-org leak
    const otherOrgId = await seedNotification({
      recipientUserId: orgA.userId,
      organizationId: orgB.orgId,
      title: "MyUserOtherOrg",
      status: "UNREAD",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await notificationsRouter.request("/mark-all-read", {
      method: "POST",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);

    const [mine] = await db
      .select()
      .from(notification)
      .where(eq(notification.id, mineId));
    expect(mine?.status).toBe("READ");

    const [otherUser] = await db
      .select()
      .from(notification)
      .where(eq(notification.id, otherUserId));
    expect(otherUser?.status).toBe("UNREAD"); // user-scope leak guard

    const [otherOrg] = await db
      .select()
      .from(notification)
      .where(eq(notification.id, otherOrgId));
    expect(otherOrg?.status).toBe("UNREAD"); // org-scope leak guard
  });

  // ===========================================================================
  // Happy path: own list + mark-read round-trip persists.
  // ===========================================================================
  it("happy-path: principal lists, marks own notification read, and it persists", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    const id = await seedNotification({
      recipientUserId: org.userId,
      organizationId: org.orgId,
      title: "Mine",
      status: "UNREAD",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });

    // List shows it as UNREAD.
    const listRes = await notificationsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].status).toBe("UNREAD");

    // Mark it read.
    const markRes = await notificationsRouter.request("/mark-read", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ notificationIds: [id] }),
    });
    expect(markRes.status).toBe(200);
    const markBody = await markRes.json();
    expect(markBody.updatedIds).toEqual([id]);

    // Persisted: status READ, readAt set.
    const [after] = await db
      .select()
      .from(notification)
      .where(eq(notification.id, id));
    expect(after?.status).toBe("READ");
    expect(after?.readAt).not.toBeNull();

    // Unread count is now 0.
    const countRes = await notificationsRouter.request("/unread-count", {
      headers: JSON_HEADERS,
    });
    const countBody = await countRes.json();
    expect(countBody.count).toBe(0);
  });

  it("happy-path: PUT /preferences then GET /preferences round-trips per-user", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    // No prefs yet -> GET returns defaults.
    const defaultsRes = await notificationsRouter.request("/preferences", {
      headers: JSON_HEADERS,
    });
    expect(defaultsRes.status).toBe(200);
    const defaults = await defaultsRes.json();
    expect(defaults.emailEnabled).toBe(true);
    expect(defaults.digestFrequency).toBe("NONE");

    // PUT creates a row.
    const putRes = await notificationsRouter.request("/preferences", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ emailEnabled: false, digestFrequency: "WEEKLY" }),
    });
    expect(putRes.status).toBe(200);

    // Persisted for this user.
    const [row] = await db
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, org.userId));
    expect(row?.emailEnabled).toBe(false);
    expect(row?.digestFrequency).toBe("WEEKLY");

    // GET reflects it.
    const getRes = await notificationsRouter.request("/preferences", {
      headers: JSON_HEADERS,
    });
    const getBody = await getRes.json();
    expect(getBody.emailEnabled).toBe(false);
    expect(getBody.digestFrequency).toBe("WEEKLY");
  });
});
