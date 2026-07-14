import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import { notification } from "@calibra-facil/db/schema";
import {
  MarkNotificationsReadSchema,
  PORTAL_NOTIFICATION_TYPES,
  PortalListNotificationsQuerySchema,
} from "@calibra-facil/schemas";
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
} from "../middleware/permission";
import { resolveLabOrganizationIdByPortalHostname } from "../lib/portal-domains";
import { resolvePortalNotificationOrgIds } from "../lib/portal-customer-scope";

async function getPortalLabScope(c: {
  req: { header: (name: string) => string | undefined };
}) {
  const origin = c.req.header("origin") ?? c.req.header("referer") ?? null;
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return resolveLabOrganizationIdByPortalHostname(url.hostname);
  } catch {
    return null;
  }
}

/**
 * Portal notification center (#741): the read surface for the IN_APP rows the
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
 * Conditions shared by every handler: only the caller's own rows, only inside
 * their portal CLIENT orgs (never a dual-role user's lab org), and only the
 * customer-facing types the portal is allowed to surface.
 */
function portalNotificationConditions(userId: string, orgIds: string[]) {
  return [
    eq(notification.recipientUserId, userId),
    inArray(notification.organizationId, orgIds),
    inArray(notification.type, [...PORTAL_NOTIFICATION_TYPES]),
  ];
}

export const portalNotificationsRouter = new Hono<{
  Variables: AuthVariables;
}>()
  // =========================================================================
  // GET / - Chronological feed, cursor-paginated (id desc), 90-day window.
  // =========================================================================
  .get(
    "/",
    ...requirePortalProtected,
    zValidator("query", PortalListNotificationsQuerySchema),
    async (c) => {
      const session = c.get("session");
      const { cursor, limit, status } = c.req.valid("query");
      const portalLabScope = await getPortalLabScope(c);

      try {
        const orgIds = await resolvePortalNotificationOrgIds({
          userId: session.user.id,
          labScope: portalLabScope,
        });
        if (orgIds.length === 0) {
          return c.json({ data: [], nextCursor: null });
        }

        const now = new Date();
        const conditions = [
          ...portalNotificationConditions(session.user.id, orgIds),
          gt(notification.createdAt, windowStart()),
          or(isNull(notification.expiresAt), gt(notification.expiresAt, now)),
          status
            ? eq(notification.status, status)
            : ne(notification.status, "ARCHIVED"),
        ];
        if (cursor !== undefined) {
          conditions.push(lt(notification.id, cursor));
        }

        const rows = await db
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

        return c.json({
          data,
          nextCursor: hasMore && lastRow ? lastRow.id : null,
        });
      } catch (error) {
        console.error("Error listing portal notifications:", error);
        return c.json({ error: "Erro ao listar notificações" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /unread-count - Bell badge, same window as the list.
  // =========================================================================
  .get("/unread-count", ...requirePortalProtected, async (c) => {
    const session = c.get("session");
    const portalLabScope = await getPortalLabScope(c);

    try {
      const orgIds = await resolvePortalNotificationOrgIds({
        userId: session.user.id,
        labScope: portalLabScope,
      });
      if (orgIds.length === 0) {
        return c.json({ count: 0 });
      }

      const now = new Date();
      const [result] = await db
        .select({ count: count() })
        .from(notification)
        .where(
          and(
            ...portalNotificationConditions(session.user.id, orgIds),
            eq(notification.status, "UNREAD"),
            gt(notification.createdAt, windowStart()),
            or(isNull(notification.expiresAt), gt(notification.expiresAt, now)),
          ),
        );

      return c.json({ count: result?.count ?? 0 });
    } catch (error) {
      console.error("Error counting portal notifications:", error);
      return c.json({ error: "Erro ao contar notificações" }, 500);
    }
  })

  // =========================================================================
  // POST /mark-read - Mark specific notifications as read (ownership-checked).
  // =========================================================================
  .post(
    "/mark-read",
    ...requirePortalProtected,
    zValidator("json", MarkNotificationsReadSchema),
    async (c) => {
      const session = c.get("session");
      const { notificationIds } = c.req.valid("json");
      const portalLabScope = await getPortalLabScope(c);

      try {
        const orgIds = await resolvePortalNotificationOrgIds({
          userId: session.user.id,
          labScope: portalLabScope,
        });
        if (orgIds.length === 0) {
          return c.json({ updatedIds: [] });
        }

        const updated = await db
          .update(notification)
          .set({ status: "READ", readAt: new Date() })
          .where(
            and(
              inArray(notification.id, notificationIds),
              ...portalNotificationConditions(session.user.id, orgIds),
              eq(notification.status, "UNREAD"),
            ),
          )
          .returning();

        return c.json({ updatedIds: updated.map((row) => row.id) });
      } catch (error) {
        console.error("Error marking portal notifications read:", error);
        return c.json({ error: "Erro ao marcar notificações" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /mark-all-read - No window: clears the backlog too, so the badge
  // stays at zero afterwards.
  // =========================================================================
  .post("/mark-all-read", ...requirePortalProtected, async (c) => {
    const session = c.get("session");
    const portalLabScope = await getPortalLabScope(c);

    try {
      const orgIds = await resolvePortalNotificationOrgIds({
        userId: session.user.id,
        labScope: portalLabScope,
      });
      if (orgIds.length === 0) {
        return c.json({ count: 0 });
      }

      const updated = await db
        .update(notification)
        .set({ status: "READ", readAt: new Date() })
        .where(
          and(
            ...portalNotificationConditions(session.user.id, orgIds),
            eq(notification.status, "UNREAD"),
          ),
        )
        .returning();

      return c.json({ count: updated.length });
    } catch (error) {
      console.error("Error marking all portal notifications read:", error);
      return c.json({ error: "Erro ao marcar notificações" }, 500);
    }
  });
