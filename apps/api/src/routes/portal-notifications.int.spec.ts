import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  customer,
  customerGroup,
  member,
  notification,
  notificationPreference,
  organization,
  user,
  type NotificationType,
} from "@calibra-facil/db/schema";
import { portalNotificationsRouter } from "./portal-notifications";
import { portalRouter } from "./portal";
import { loginAsPortal, logoutPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedPortalContext,
  seedPortalCustomer,
} from "../../test/integration/seed";

// Real-DB integration tests for the portal notification center (#741). Only
// the portal better-auth getSession is mocked; requirePortalProtected and
// resolvePortalNotificationOrgIds run for real. The properties under test are
// the tenant boundaries: own rows only, CLIENT orgs only (a dual-role user's
// lab rows must not surface), whitelisted types only, and the preference
// merge-write that must not clobber lab-side keys.

const LOCAL_ORIGIN = { origin: "http://localhost" };
const JSON_HEADERS = { ...LOCAL_ORIGIN, "content-type": "application/json" };

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function seedNotification(params: {
  recipientUserId: string;
  organizationId: string;
  type: NotificationType;
  title?: string;
  status?: "UNREAD" | "READ" | "ARCHIVED";
  createdAt?: Date;
  expiresAt?: Date;
}): Promise<number> {
  const [row] = await db
    .insert(notification)
    .values({
      recipientUserId: params.recipientUserId,
      organizationId: params.organizationId,
      type: params.type,
      title: params.title ?? params.type,
      message: `msg ${params.type}`,
      status: params.status ?? "UNREAD",
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
      ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
    })
    .returning({ id: notification.id });
  if (!row) throw new Error("seedNotification: insert failed");
  return row.id;
}

describe("portalNotificationsRouter — real DB + real portal middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ===========================================================================
  // REQ-PORTALNOTIF-001 [HIGH RISK]: the list is scoped to the caller's own
  // rows inside their CLIENT orgs and to whitelisted types. Leak candidates
  // seeded: another user's row, the same user's LAB-org row (dual-role), a
  // lab-internal type addressed to the CLIENT org, and an out-of-window row.
  // ===========================================================================
  it("REQ-PORTALNOTIF-001: lists only own, in-scope, whitelisted, in-window rows", async () => {
    const ctx = await seedPortalContext({});
    await seedPortalCustomer({
      labOrgId: ctx.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });

    const visibleId = await seedNotification({
      recipientUserId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
      type: "CERTIFICATE_READY",
      title: "Certificado disponível",
    });
    // Other user's row in another CLIENT org.
    await seedNotification({
      recipientUserId: "portal-user-b",
      organizationId: "portal-client-b",
      type: "CERTIFICATE_READY",
      title: "LEAK other-user",
    });
    // Dual-role: same user, LAB org — must never surface in the portal.
    await seedNotification({
      recipientUserId: ctx.portalUserId,
      organizationId: ctx.labOrgId,
      type: "CERTIFICATE_READY",
      title: "LEAK lab-org",
    });
    // Lab-internal type addressed (oddly) to the CLIENT org.
    await seedNotification({
      recipientUserId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
      type: "JOB_APPROVED",
      title: "LEAK lab-type",
    });
    // Outside the 90-day window.
    await seedNotification({
      recipientUserId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
      type: "CERTIFICATE_READY",
      title: "OLD backlog",
      createdAt: daysAgo(120),
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    const listRes = await portalNotificationsRouter.request("/", {
      headers: LOCAL_ORIGIN,
    });
    expect(listRes.status).toBe(200);
    const body = await listRes.json();
    expect(body.data.map((row: { id: number }) => row.id)).toEqual([visibleId]);
    expect(body.nextCursor).toBeNull();

    const countRes = await portalNotificationsRouter.request("/unread-count", {
      headers: LOCAL_ORIGIN,
    });
    expect(countRes.status).toBe(200);
    expect(await countRes.json()).toEqual({ count: 1 });
  });

  // ===========================================================================
  // REQ-PORTALNOTIF-002: a group portal user sees rows addressed to them under
  // any branch unit's CLIENT org (group cockpit org-expansion).
  // ===========================================================================
  it("REQ-PORTALNOTIF-002: group user sees rows across member-unit orgs", async () => {
    const ctx = await seedPortalContext({});
    const now = new Date("2026-01-01T00:00:00.000Z");

    // The group's own CLIENT org + portal user.
    await db.insert(organization).values({
      id: "portal-group-org",
      name: "Group Org",
      slug: "portal-group-org",
      createdAt: now,
      type: "CLIENT",
      status: "ACTIVE",
    });
    await db.insert(user).values({
      id: "group-user",
      name: "Group QM",
      email: "group-user@client.test",
    });
    await db.insert(member).values({
      id: "member-group-org-group-user",
      organizationId: "portal-group-org",
      userId: "group-user",
      role: "client_user",
      createdAt: now,
    });
    const [group] = await db
      .insert(customerGroup)
      .values({
        name: "Group",
        authOrganizationId: "portal-group-org",
        labOrganizationId: ctx.labOrgId,
      })
      .returning({ id: customerGroup.id });
    if (!group) throw new Error("group insert failed");

    // A branch customer with its own CLIENT org, member of the group. The
    // group user is NOT a member of the branch org — visibility must come
    // from the group expansion alone.
    await db.insert(organization).values({
      id: "portal-branch-org",
      name: "Branch Org",
      slug: "portal-branch-org",
      createdAt: now,
      type: "CLIENT",
      status: "ACTIVE",
    });
    await db.insert(customer).values({
      name: "Branch",
      authOrganizationId: "portal-branch-org",
      labOrganizationId: ctx.labOrgId,
      groupId: group.id,
    });

    const branchRowId = await seedNotification({
      recipientUserId: "group-user",
      organizationId: "portal-branch-org",
      type: "CERTIFICATE_READY",
      title: "Certificado da unidade",
    });

    loginAsPortal({ userId: "group-user", organizationId: "portal-group-org" });

    const res = await portalNotificationsRouter.request("/", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((row: { id: number }) => row.id)).toEqual([
      branchRowId,
    ]);
  });

  // ===========================================================================
  // REQ-PORTALNOTIF-003: mark-read only touches rows the caller owns.
  // ===========================================================================
  it("REQ-PORTALNOTIF-003: mark-read rejects ids owned by another user", async () => {
    const ctx = await seedPortalContext({});
    await seedPortalCustomer({
      labOrgId: ctx.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });

    const ownId = await seedNotification({
      recipientUserId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
      type: "VISIT_CONFIRMED",
    });
    const foreignId = await seedNotification({
      recipientUserId: "portal-user-b",
      organizationId: "portal-client-b",
      type: "VISIT_CONFIRMED",
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    const res = await portalNotificationsRouter.request("/mark-read", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ notificationIds: [ownId, foreignId] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedIds).toEqual([ownId]);

    const [foreignRow] = await db
      .select({ status: notification.status })
      .from(notification)
      .where(eq(notification.id, foreignId));
    expect(foreignRow?.status).toBe("UNREAD");
  });

  // ===========================================================================
  // REQ-PORTALNOTIF-004: mark-all-read clears the pre-window backlog too, so
  // the badge (windowed) can never come back non-zero afterwards.
  // ===========================================================================
  it("REQ-PORTALNOTIF-004: mark-all-read clears backlog beyond the window", async () => {
    const ctx = await seedPortalContext({});
    await seedNotification({
      recipientUserId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
      type: "CERTIFICATE_READY",
    });
    const oldId = await seedNotification({
      recipientUserId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
      type: "CERTIFICATE_READY",
      createdAt: daysAgo(200),
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    const res = await portalNotificationsRouter.request("/mark-all-read", {
      method: "POST",
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 2 });

    const [oldRow] = await db
      .select({ status: notification.status })
      .from(notification)
      .where(eq(notification.id, oldId));
    expect(oldRow?.status).toBe("READ");
  });

  // ===========================================================================
  // REQ-PORTALNOTIF-005: no portal session -> 401 on every endpoint.
  // ===========================================================================
  it("REQ-PORTALNOTIF-005: unauthenticated requests get 401", async () => {
    logoutPortal();
    for (const [path, init] of [
      ["/", { headers: LOCAL_ORIGIN }],
      ["/unread-count", { headers: LOCAL_ORIGIN }],
      [
        "/mark-read",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ notificationIds: [1] }),
        },
      ],
      ["/mark-all-read", { method: "POST", headers: LOCAL_ORIGIN }],
    ] as const) {
      const res = await portalNotificationsRouter.request(path, init);
      expect(res.status).toBe(401);
    }
  });
});

describe("portalRouter /notification-preferences — per-type map", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ===========================================================================
  // REQ-PORTALNOTIF-006: GET with no stored row returns defaults for exactly
  // the whitelisted types.
  // ===========================================================================
  it("REQ-PORTALNOTIF-006: GET returns whitelisted defaults when unset", async () => {
    const ctx = await seedPortalContext({});
    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    const res = await portalRouter.request("/notification-preferences", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.digestFrequency).toBe("NONE");
    expect(body.emailEnabled).toBe(true);
    expect(body.preferences.CERTIFICATE_READY).toEqual({
      inApp: true,
      email: true,
    });
    // Lab-internal types are never exposed to the portal.
    expect(body.preferences.JOB_APPROVED).toBeUndefined();
  });

  // ===========================================================================
  // REQ-PORTALNOTIF-007 [HIGH RISK]: PUT rejects non-whitelisted type keys —
  // a portal session cannot toggle lab-internal preferences.
  // ===========================================================================
  it("REQ-PORTALNOTIF-007: PUT rejects non-whitelisted types", async () => {
    const ctx = await seedPortalContext({});
    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    const res = await portalRouter.request("/notification-preferences", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        preferences: { JOB_APPROVED: { inApp: false, email: false } },
      }),
    });
    expect(res.status).toBe(400);
  });

  // ===========================================================================
  // REQ-PORTALNOTIF-008 [HIGH RISK]: PUT merge-writes — lab-side keys and the
  // digest of a dual-role user survive a portal edit.
  // ===========================================================================
  it("REQ-PORTALNOTIF-008: PUT merges without clobbering lab-side keys", async () => {
    const ctx = await seedPortalContext({});
    await db.insert(notificationPreference).values({
      userId: ctx.portalUserId,
      preferences: {
        JOB_APPROVED: { inApp: false, email: false },
        CERTIFICATE_READY: { inApp: true, email: true },
      },
      emailEnabled: true,
      digestFrequency: "DAILY",
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    const res = await portalRouter.request("/notification-preferences", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        preferences: { CERTIFICATE_READY: { inApp: false, email: true } },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferences.CERTIFICATE_READY).toEqual({
      inApp: false,
      email: true,
    });
    // Response never exposes lab keys...
    expect(body.preferences.JOB_APPROVED).toBeUndefined();
    // ...but the stored row keeps them, and the digest opt-in is untouched.
    const [row] = await db
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, ctx.portalUserId));
    expect(row?.preferences.JOB_APPROVED).toEqual({
      inApp: false,
      email: false,
    });
    expect(row?.digestFrequency).toBe("DAILY");
  });
});
