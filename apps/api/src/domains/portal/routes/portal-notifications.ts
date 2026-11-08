import { createRouter } from "../../../server/router";
import { requirePortalLabScope } from "../portal-lab-scope";
import { portalNotificationEndpoints } from "@calibra-facil/contracts";
import { notification } from "@calibra-facil/db/schema";
import { PORTAL_NOTIFICATION_TYPES } from "@calibra-facil/schemas";
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
} from "drizzle-orm";
import {
  requirePortalProtected,
  type AuthVariables,
} from "../../../middleware/permission";
import { resolveLabOrganizationIdByPortalHostname } from "../../org";
import { resolvePortalNotificationOrgIds } from "../portal-customer-scope";
import { orgSetDb } from "../../../lib/org-db";
import { mount } from "../../../lib/endpoint-mount";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

/**
 * Portal notification center: the read surface for the IN_APP rows the
 * dispatchers already address to portal users (certificate ready/amended,
 * calibration-request statuses, visit lifecycle, audit packs, OOT findings).
 * Not to be confused with the §7.10 acknowledgment feed at
 * /api/portal/oot-notifications — that one is a compliance record.
 *
 * Rows older than the window are left out of both the list and the badge so
 * long-standing accounts don't open to months of backlog; mark-all-read still
 * clears everything, keeping the count coherent afterwards.
 */
const NOTIFICATION_WINDOW_DAYS = 90;

function windowStart(): Date {
  return new Date(Date.now() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Conditions shared by every handler: only the caller's own rows and only the
 * customer-facing types the portal is allowed to surface. The rows are inside
 * the caller's portal CLIENT orgs (never a dual-role user's lab org) because
 * every handler reads them through `orgSetDb(orgIds)`.
 */
function portalNotificationConditions(userId: string) {
  return [
    eq(notification.recipientUserId, userId),
    inArray(notification.type, [...PORTAL_NOTIFICATION_TYPES]),
  ];
}

const PREFIX = "/api/portal/notifications";

export const portalNotificationsRouter = createRouter<{
  Variables: AuthVariables;
}>();

// =========================================================================
// GET / - Chronological feed, cursor-paginated (id desc), 90-day window.
// =========================================================================
mount(
  portalNotificationsRouter,
  PREFIX,
  portalNotificationEndpoints.list,
  [...requirePortalProtected],
  async (c, { query }) => {
    const session = c.get("session");
    const { cursor, limit, status } = query;
    const portalLabScope = await requirePortalLabScope(c);

    const orgIds = await resolvePortalNotificationOrgIds({
      userId: session.user.id,
      labScope: portalLabScope,
    });
    if (orgIds.length === 0) {
      return { data: [], nextCursor: null };
    }

    const now = new Date();
    const conditions = [
      ...portalNotificationConditions(session.user.id),
      gt(notification.createdAt, windowStart()),
      or(isNull(notification.expiresAt), gt(notification.expiresAt, now)),
      status
        ? eq(notification.status, status)
        : ne(notification.status, "ARCHIVED"),
    ];
    if (cursor !== undefined) {
      conditions.push(lt(notification.id, cursor));
    }

    const rows = await orgSetDb(orgIds)
      .select({
        id: notification.id,
        type: notification.type,
        priority: notification.priority,
        status: notification.status,
        title: notification.title,
        message: notification.message,
        actionUrl: notification.actionUrl,
        createdAt: notification.createdAt,
        readAt: notification.readAt,
      })
      .from(notification)
      .where(and(...conditions))
      .orderBy(desc(notification.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = data.at(-1);

    return {
      data,
      nextCursor: hasMore && lastRow ? lastRow.id : null,
    };
  },
);

// =========================================================================
// GET /unread-count - Bell badge, same window as the list.
// =========================================================================
mount(
  portalNotificationsRouter,
  PREFIX,
  portalNotificationEndpoints.unreadCount,
  [...requirePortalProtected],
  async (c) => {
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);

    const orgIds = await resolvePortalNotificationOrgIds({
      userId: session.user.id,
      labScope: portalLabScope,
    });
    if (orgIds.length === 0) {
      return {
        count: 0,
      };
    }

    const now = new Date();
    const [result] = await orgSetDb(orgIds)
      .select({ count: count() })
      .from(notification)
      .where(
        and(
          ...portalNotificationConditions(session.user.id),
          eq(notification.status, "UNREAD"),
          gt(notification.createdAt, windowStart()),
          or(isNull(notification.expiresAt), gt(notification.expiresAt, now)),
        ),
      );

    return {
      count: result?.count ?? 0,
    };
  },
);

// =========================================================================
// POST /mark-read - Mark specific notifications as read (ownership-checked).
// =========================================================================
mount(
  portalNotificationsRouter,
  PREFIX,
  portalNotificationEndpoints.markRead,
  [...requirePortalProtected],
  async (c, { body }) => {
    const session = c.get("session");
    const { notificationIds } = body;
    const portalLabScope = await requirePortalLabScope(c);

    const orgIds = await resolvePortalNotificationOrgIds({
      userId: session.user.id,
      labScope: portalLabScope,
    });
    if (orgIds.length === 0) {
      return {
        updatedIds: [],
      };
    }

    // The set handle only reads: find which organization each of the
    // caller's unread rows belongs to, then write through a handle bound to
    // exactly that organization.
    const candidates = await orgSetDb(orgIds)
      .select({
        id: notification.id,
        organizationId: notification.organizationId,
      })
      .from(notification)
      .where(
        and(
          inArray(notification.id, notificationIds),
          ...portalNotificationConditions(session.user.id),
          eq(notification.status, "UNREAD"),
        ),
      );

    const idsByOrganization = new Map<string, number[]>();
    for (const row of candidates) {
      const ids = idsByOrganization.get(row.organizationId) ?? [];
      ids.push(row.id);
      idsByOrganization.set(row.organizationId, ids);
    }

    const updatedPerOrganization = await Promise.all(
      [...idsByOrganization].map(([organizationId, ids]) =>
        withOrg(organizationId, requestActor(c), (ctx) =>
          ctx.o
            .update(notification)
            .set({ status: "READ", readAt: new Date() })
            .where(
              and(
                inArray(notification.id, ids),
                ...portalNotificationConditions(session.user.id),
                eq(notification.status, "UNREAD"),
              ),
            )
            .returning({ id: notification.id }),
        ),
      ),
    );

    return {
      updatedIds: updatedPerOrganization.flat().map((row) => row.id),
    };
  },
);

// =========================================================================
// POST /mark-all-read - No window: clears the backlog too, so the badge
// stays at zero afterwards.
// =========================================================================
mount(
  portalNotificationsRouter,
  PREFIX,
  portalNotificationEndpoints.markAllRead,
  [...requirePortalProtected],
  async (c) => {
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);

    const orgIds = await resolvePortalNotificationOrgIds({
      userId: session.user.id,
      labScope: portalLabScope,
    });
    if (orgIds.length === 0) {
      return {
        count: 0,
      };
    }

    // One write per organization, each through a handle bound to it (the
    // set handle is read-only).
    const updatedPerOrganization = await Promise.all(
      orgIds.map((organizationId) =>
        withOrg(organizationId, requestActor(c), (ctx) =>
          ctx.o
            .update(notification)
            .set({ status: "READ", readAt: new Date() })
            .where(
              and(
                ...portalNotificationConditions(session.user.id),
                eq(notification.status, "UNREAD"),
              ),
            )
            .returning({ id: notification.id }),
        ),
      ),
    );
    const updated = updatedPerOrganization.flat();

    return {
      count: updated.length,
    };
  },
);
