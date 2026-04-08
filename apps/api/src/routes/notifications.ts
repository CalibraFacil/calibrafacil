import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  notification,
  notificationPreference,
  type NotificationPreferenceMap,
} from "@calibra-facil/db/schema";
import {
  ListNotificationsQuerySchema,
  MarkNotificationsReadSchema,
  UpdateNotificationPreferencesSchema,
} from "@calibra-facil/schemas";
import {
  withLabPermission,
  requireLabProtected,
  type AuthVariables,
} from "../middleware/permission";
import { eq, and, desc, count, inArray, sql } from "drizzle-orm";

/**
 * Default notification preferences for new users
 * All operational notifications enabled by default for ISO 17025 compliance
 */
const DEFAULT_PREFERENCES: NotificationPreferenceMap = {
  JOB_SUBMITTED_FOR_REVIEW: { inApp: true, email: true },
  JOB_APPROVED: { inApp: true, email: true },
  JOB_REJECTED: { inApp: true, email: true },
  JOB_ASSIGNED: { inApp: true, email: false },
  CERTIFICATE_READY: { inApp: true, email: true },
  ASSET_DUE_FOR_RECALIBRATION: { inApp: true, email: true },
  STANDARD_EXPIRING: { inApp: true, email: true },
  JOB_OVERDUE: { inApp: true, email: true },
  PAYMENT_RECEIVED: { inApp: true, email: true },
  PAYMENT_FAILED: { inApp: true, email: true },
  CUSTOMER_SUCCESS_WORKFLOW_BLOCKED: { inApp: true, email: true },
  CUSTOMER_SUCCESS_GO_LIVE_AT_RISK: { inApp: true, email: true },
  CUSTOMER_SUCCESS_NEXT_ACTION_OVERDUE: { inApp: true, email: true },
  CUSTOMER_SUCCESS_SLA_DUE_SOON: { inApp: true, email: true },
  CUSTOMER_SUCCESS_SLA_BREACHED: { inApp: true, email: true },
  CUSTOMER_SUCCESS_ESCALATION_REQUIRED: { inApp: true, email: true },
};

/**
 * Notifications Router - In-App & Email Notification Management
 *
 * Provides endpoints for:
 * - Listing notifications with pagination and filters
 * - Getting unread count for bell badge
 * - Marking notifications as read
 * - Managing notification preferences
 *
 * ISO 17025 Compliance Note:
 * - Never hard-delete notifications (use ARCHIVED status)
 * - All notification events are auditable
 */
export const notificationsRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List notifications with pagination and filters
  // =========================================================================
  .get(
    "/",
    ...requireLabProtected,
    zValidator("query", ListNotificationsQuerySchema),
    async (c) => {
      const session = c.get("session");
      const member = c.get("member");
      const { page, limit, status, type, priority } = c.req.valid("query");
      const offset = (page - 1) * limit;

      // Build conditions - scope to user and organization
      const conditions = [
        eq(notification.recipientUserId, session.user.id),
        eq(notification.organizationId, member.organizationId),
      ];

      if (status) {
        conditions.push(eq(notification.status, status));
      }

      if (type) {
        conditions.push(eq(notification.type, type));
      }

      if (priority) {
        conditions.push(eq(notification.priority, priority));
      }

      const whereCondition = and(...conditions);

      // Get total count
      const [countResult] = await db
        .select({ total: count() })
        .from(notification)
        .where(whereCondition);

      // Get paginated data
      const notifications = await db
        .select()
        .from(notification)
        .where(whereCondition)
        .orderBy(desc(notification.createdAt))
        .limit(limit)
        .offset(offset);

      return c.json({
        data: notifications,
        pagination: {
          page,
          limit,
          total: countResult?.total ?? 0,
          totalPages: Math.ceil((countResult?.total ?? 0) / limit),
        },
      });
    },
  )

  // =========================================================================
  // GET /unread-count - Get unread notification count for bell badge
  // =========================================================================
  .get("/unread-count", ...requireLabProtected, async (c) => {
    const session = c.get("session");
    const member = c.get("member");

    const [result] = await db
      .select({ count: count() })
      .from(notification)
      .where(
        and(
          eq(notification.recipientUserId, session.user.id),
          eq(notification.organizationId, member.organizationId),
          eq(notification.status, "UNREAD"),
        ),
      );

    return c.json({ count: result?.count ?? 0 });
  })

  // =========================================================================
  // POST /mark-read - Mark specific notifications as read
  // =========================================================================
  .post(
    "/mark-read",
    ...requireLabProtected,
    zValidator("json", MarkNotificationsReadSchema),
    async (c) => {
      const session = c.get("session");
      const member = c.get("member");
      const { notificationIds } = c.req.valid("json");

      const updated = await db
        .update(notification)
        .set({
          status: "READ",
          readAt: new Date(),
        })
        .where(
          and(
            inArray(notification.id, notificationIds),
            eq(notification.recipientUserId, session.user.id),
            eq(notification.organizationId, member.organizationId),
            eq(notification.status, "UNREAD"),
          ),
        )
        .returning();

      return c.json({
        message: `${updated.length} notificacao(oes) marcada(s) como lida(s)`,
        updatedIds: updated.map((n) => n.id),
      });
    },
  )

  // =========================================================================
  // POST /mark-all-read - Mark all notifications as read
  // =========================================================================
  .post("/mark-all-read", ...requireLabProtected, async (c) => {
    const session = c.get("session");
    const member = c.get("member");

    const updated = await db
      .update(notification)
      .set({
        status: "READ",
        readAt: new Date(),
      })
      .where(
        and(
          eq(notification.recipientUserId, session.user.id),
          eq(notification.organizationId, member.organizationId),
          eq(notification.status, "UNREAD"),
        ),
      )
      .returning();

    return c.json({
      message: `${updated.length} notificacao(oes) marcada(s) como lida(s)`,
      count: updated.length,
    });
  })

  // =========================================================================
  // DELETE /:id - Archive notification (soft delete for ISO 17025)
  // =========================================================================
  .delete("/:id", ...requireLabProtected, async (c) => {
    const session = c.get("session");
    const member = c.get("member");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      return c.json({ error: "ID invalido" }, 400);
    }

    const [updated] = await db
      .update(notification)
      .set({ status: "ARCHIVED" })
      .where(
        and(
          eq(notification.id, id),
          eq(notification.recipientUserId, session.user.id),
          eq(notification.organizationId, member.organizationId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json({ error: "Notificacao nao encontrada" }, 404);
    }

    return c.json({ message: "Notificacao arquivada", data: updated });
  })

  // =========================================================================
  // GET /preferences - Get user notification preferences
  // =========================================================================
  .get("/preferences", ...requireLabProtected, async (c) => {
    const session = c.get("session");

    const [prefs] = await db
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, session.user.id))
      .limit(1);

    // Return default preferences if user hasn't set any
    if (!prefs) {
      return c.json({
        preferences: DEFAULT_PREFERENCES,
        emailEnabled: true,
        notifySelfActions: false,
        digestFrequency: "NONE",
      });
    }

    return c.json({
      preferences: prefs.preferences,
      emailEnabled: prefs.emailEnabled,
      notifySelfActions: prefs.notifySelfActions,
      digestFrequency: prefs.digestFrequency,
    });
  })

  // =========================================================================
  // PUT /preferences - Update user notification preferences
  // =========================================================================
  .put(
    "/preferences",
    ...requireLabProtected,
    zValidator("json", UpdateNotificationPreferencesSchema),
    async (c) => {
      const session = c.get("session");
      const input = c.req.valid("json");

      // Check if preferences exist
      const [existing] = await db
        .select()
        .from(notificationPreference)
        .where(eq(notificationPreference.userId, session.user.id))
        .limit(1);

      if (existing) {
        // Update existing preferences
        const updateData: Record<string, unknown> = {};

        if (input.preferences !== undefined) {
          // Merge with existing preferences
          updateData.preferences = {
            ...existing.preferences,
            ...input.preferences,
          };
        }

        if (input.emailEnabled !== undefined) {
          updateData.emailEnabled = input.emailEnabled;
        }

        if (input.notifySelfActions !== undefined) {
          updateData.notifySelfActions = input.notifySelfActions;
        }

        if (input.digestFrequency !== undefined) {
          updateData.digestFrequency = input.digestFrequency;
        }

        const [updated] = await db
          .update(notificationPreference)
          .set(updateData)
          .where(eq(notificationPreference.userId, session.user.id))
          .returning();

        if (!updated) {
          return c.json({ error: "Erro ao atualizar preferencias" }, 500);
        }

        return c.json({
          message: "Preferencias atualizadas",
          preferences: updated.preferences,
          emailEnabled: updated.emailEnabled,
          notifySelfActions: updated.notifySelfActions,
          digestFrequency: updated.digestFrequency,
        });
      } else {
        // Create new preferences record
        const [created] = await db
          .insert(notificationPreference)
          .values({
            userId: session.user.id,
            preferences: input.preferences ?? DEFAULT_PREFERENCES,
            emailEnabled: input.emailEnabled ?? true,
            notifySelfActions: input.notifySelfActions ?? false,
            digestFrequency: input.digestFrequency ?? "NONE",
          })
          .returning();

        if (!created) {
          return c.json({ error: "Erro ao criar preferencias" }, 500);
        }

        return c.json({
          message: "Preferencias criadas",
          preferences: created.preferences,
          emailEnabled: created.emailEnabled,
          notifySelfActions: created.notifySelfActions,
          digestFrequency: created.digestFrequency,
        });
      }
    },
  );
