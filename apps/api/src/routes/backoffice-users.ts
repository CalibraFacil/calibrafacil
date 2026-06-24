import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  lt,
  max,
  not,
  or,
  sql,
} from "drizzle-orm";
import { createBackofficeAuth } from "@calibra-facil/auth";
import { db } from "@calibra-facil/db";
import {
  member,
  organization,
  platformEventLog,
  session as authSession,
  user as userTable,
} from "@calibra-facil/db/schema";
import {
  requirePlatformAdmin,
  type AuthVariables,
} from "../middleware/permission";
import { logPlatformEvent } from "./backoffice-platform-log";
import {
  extractErrorMessage,
  forwardLabAuthResponse,
  platformUserFromUnknown,
  resolveTrustedAppUrl,
  responseStatus,
} from "./backoffice-shared";

const SetPlatformRoleSchema = z.object({
  role: z.enum(["user", "platform_operator", "platform_admin"]),
});

const CreatePlatformUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  role: z.enum(["platform_operator", "platform_admin"]),
});

const ListBackofficeUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  search: z.string().trim().optional(),
  organizationId: z.string().trim().optional(),
  platformRole: z
    .enum([
      "all",
      "user",
      "platform_operator",
      "platform_admin",
      "platform_access",
    ])
    .optional(),
  membershipScope: z
    .enum(["all", "lab_members", "no_lab_membership", "backoffice_only"])
    .optional(),
});

const BanUserSchema = z.object({
  banReason: z.string().trim().max(500).optional(),
  banExpiresIn: z.number().int().positive().optional(),
});

const ImpersonateUserSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

// Single-user activity timeline (a scoped slice of the platformEventLog firehose
// that /audit-log exposes; viewable at the backoffice-access level since it only
// surfaces events about/by one user).
const UserActivityQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const RevokeUserSessionSchema = z.object({
  sessionId: z.string().trim().min(1),
});

// Backoffice users sub-router. Mounted on the backoffice parent via
// `.route("/users", backofficeUsersRouter)` INSIDE the access-gated zone (after
// `requireBackofficeAuthSession` + `requireBackofficeAccess`), so every route
// here inherits auth + the backoffice-access gate exactly as before extraction.
//
// Guard split preserved VERBATIM:
//   - GET /  (collection)            access-gated only
//   - POST / (create platform user)  inline requirePlatformAdmin
//   - POST /:id/impersonate          access-gated only (operators may impersonate)
//   - the mutating POSTs (request-password-reset / role / ban / unban /
//     sessions/revoke) are gated by PATH-SCOPED `.use("/:id/…", requirePlatformAdmin)`
//     registered just before their handlers — rebased from the parent's
//     `.use("/users/:id/…", …)` to keep the same effective paths.
//   - GET /:id, GET /:id/sessions, GET /:id/activity   access-gated only
//
// The sub-router deliberately defines NO `onError` so errors propagate to the
// parent's `onError`, preserving the `{ error: message }` response shape.
export const backofficeUsersRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .get(
    "/",
    zValidator("query", ListBackofficeUsersQuerySchema),
    async (c) => {
      const input = c.req.valid("query");
      const limit = input.limit ?? 100;
      const offset = input.offset ?? 0;
      const platformRole = input.platformRole ?? "all";
      const membershipScope = input.membershipScope ?? "all";

      const labMembershipSubquery = db
        .select({ userId: member.userId })
        .from(member)
        .innerJoin(
          organization,
          and(
            eq(member.organizationId, organization.id),
            eq(organization.type, "LAB"),
          ),
        );

      const conditions = [];

      if (input.search) {
        const pattern = `%${input.search}%`;
        conditions.push(
          or(ilike(userTable.name, pattern), ilike(userTable.email, pattern))!,
        );
      }

      if (input.organizationId) {
        conditions.push(
          inArray(
            userTable.id,
            db
              .select({ userId: member.userId })
              .from(member)
              .where(eq(member.organizationId, input.organizationId)),
          ),
        );
      }

      if (platformRole === "user") {
        conditions.push(eq(userTable.role, "user"));
      } else if (platformRole === "platform_operator") {
        conditions.push(eq(userTable.role, "platform_operator"));
      } else if (platformRole === "platform_admin") {
        conditions.push(eq(userTable.role, "platform_admin"));
      } else if (platformRole === "platform_access") {
        conditions.push(
          or(
            eq(userTable.role, "platform_operator"),
            eq(userTable.role, "platform_admin"),
          )!,
        );
      }

      if (membershipScope === "lab_members") {
        conditions.push(inArray(userTable.id, labMembershipSubquery));
      } else if (membershipScope === "no_lab_membership") {
        conditions.push(not(inArray(userTable.id, labMembershipSubquery)));
      } else if (membershipScope === "backoffice_only") {
        conditions.push(
          and(
            or(
              eq(userTable.role, "platform_operator"),
              eq(userTable.role, "platform_admin"),
            ),
            not(inArray(userTable.id, labMembershipSubquery)),
          )!,
        );
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [users, totalRows] = await Promise.all([
        db.query.user.findMany({
          where: whereClause,
          orderBy: [asc(userTable.name), asc(userTable.email)],
          limit,
          offset,
        }),
        db
          .select({
            total: sql<number>`count(*)`,
          })
          .from(userTable)
          .where(whereClause),
      ]);

      const userIds = users.map((user) => user.id);

      const memberships = userIds.length
        ? await db
            .select({
              userId: member.userId,
              organizationId: organization.id,
              organizationName: organization.name,
              organizationSlug: organization.slug,
              memberRole: member.role,
            })
            .from(member)
            .innerJoin(
              organization,
              and(
                eq(member.organizationId, organization.id),
                eq(organization.type, "LAB"),
              ),
            )
            .where(inArray(member.userId, userIds))
            .orderBy(asc(organization.name))
        : [];

      const membershipsByUser = new Map<
        string,
        Array<{
          organizationId: string;
          organizationName: string;
          organizationSlug: string;
          memberRole: string;
        }>
      >();

      for (const row of memberships) {
        const current = membershipsByUser.get(row.userId) ?? [];
        current.push({
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          organizationSlug: row.organizationSlug,
          memberRole: row.memberRole,
        });
        membershipsByUser.set(row.userId, current);
      }

      // Per-user session signals for observability, batched over the page's users
      // (one grouped scan using session_userId_idx). lastLoginAt ≈ most recent
      // session start; lastSeenAt ≈ most recent session refresh; isOnline = has a
      // non-expired session right now.
      const sessionAgg = userIds.length
        ? await db
            .select({
              userId: authSession.userId,
              lastLoginAt: max(authSession.createdAt),
              lastSeenAt: max(authSession.updatedAt),
              // Use SQL now() — a raw-sql ${jsDate} param isn't type-aware and
              // serializes to a non-ISO string Postgres rejects.
              activeSessionCount: sql<number>`count(*) filter (where ${authSession.expiresAt} > now())`,
            })
            .from(authSession)
            .where(inArray(authSession.userId, userIds))
            .groupBy(authSession.userId)
        : [];
      const sessionAggByUser = new Map(
        sessionAgg.map((row) => [row.userId, row]),
      );

      return c.json({
        users: users.map((user) => {
          const agg = sessionAggByUser.get(user.id);
          const activeSessionCount = Number(agg?.activeSessionCount ?? 0);
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            banned: user.banned,
            createdAt: user.createdAt,
            lastLoginAt: agg?.lastLoginAt ?? null,
            lastSeenAt: agg?.lastSeenAt ?? null,
            activeSessionCount,
            isOnline: activeSessionCount > 0,
            memberships: membershipsByUser.get(user.id) ?? [],
          };
        }),
        total: totalRows[0]?.total ?? 0,
        filters: {
          limit,
          offset,
          search: input.search ?? "",
          organizationId: input.organizationId ?? "",
          platformRole,
          membershipScope,
        },
      });
    },
  )
  .post(
    "/",
    requirePlatformAdmin,
    zValidator("json", CreatePlatformUserSchema),
    async (c) => {
      const auth = createBackofficeAuth();
      const session = c.get("session");
      const input = c.req.valid("json");
      const temporaryPassword = randomBytes(24).toString("base64url");
      // Password setup/reset pages live in the lab app, not the request origin
      // (the backoffice has no /reset-password route).
      const appUrl = resolveTrustedAppUrl(c);

      const createdUser = await auth.api.createUser({
        body: {
          name: input.name,
          email: input.email,
          password: temporaryPassword,
          role: input.role,
        },
        headers: c.req.raw.headers,
      });
      const createdUserRecord = platformUserFromUnknown(createdUser);

      const resetResponse = await forwardLabAuthResponse({
        c,
        path: "/api/auth/lab/request-password-reset",
        body: {
          email: input.email,
          redirectTo: `${appUrl}/reset-password`,
        },
      });

      const resetPayload = resetResponse.ok
        ? null
        : await resetResponse.json().catch(() => null);

      await logPlatformEvent({
        actorUserId: session.user.id,
        targetUserId: createdUserRecord.id,
        action: "backoffice.user.created",
        entityType: "user",
        entityId: createdUserRecord.id,
        details: {
          email: input.email,
          role: input.role,
          passwordSetupRequested: resetResponse.ok,
        },
      });

      return c.json({
        user: createdUserRecord,
        passwordSetupRequested: resetResponse.ok,
        passwordSetupMessage: resetResponse.ok
          ? "Email de definição de senha solicitado"
          : extractErrorMessage(
              resetPayload,
              "Falha ao enviar email de definição de senha",
            ),
      });
    },
  )
  .post(
    "/:id/impersonate",
    zValidator("json", ImpersonateUserSchema),
    async (c) => {
      const backofficeAuth = createBackofficeAuth();
      const session = c.get("session");
      const targetUserId = c.req.param("id");
      // Access policy (deliberate): impersonation is available to
      // platform_operator as well as platform_admin — customer-success
      // operators use it for support — unlike the admin-only user-management
      // routes below (role/ban/password-reset/session-revoke). The lab-side
      // admin plugin still refuses to impersonate platform admins without the
      // dedicated permission, and every attempt is audited.
      // Governance: impersonation requires a recorded justification (LGPD / trust).
      // The reason is written to the immutable platformEventLog and is visible in
      // the backoffice Audit Log.
      const { reason } = c.req.valid("json");
      const targetUser = await db.query.user.findFirst({
        where: eq(userTable.id, targetUserId),
      });

      if (!targetUser) {
        return c.json({ error: "Usuário alvo não encontrado" }, 404);
      }

      const handoff = await backofficeAuth.api.generateOneTimeToken({
        headers: c.req.raw.headers,
      });

      await logPlatformEvent({
        actorUserId: session.user.id,
        targetUserId,
        action: "backoffice.impersonation.handoff.started",
        entityType: "user",
        entityId: targetUserId,
        details: {
          email: targetUser.email,
          reason,
        },
      });

      const bridgeSearch = new URLSearchParams({
        token: handoff.token,
        targetUserId,
      });

      return c.json({
        redirectPath: `/api/backoffice/impersonation/bridge?${bridgeSearch.toString()}`,
      });
    },
  )
  .use("/:id/request-password-reset", requirePlatformAdmin)
  .use("/:id/role", requirePlatformAdmin)
  .use("/:id/ban", requirePlatformAdmin)
  .use("/:id/unban", requirePlatformAdmin)
  .use("/:id/sessions/revoke", requirePlatformAdmin)
  .post("/:id/request-password-reset", async (c) => {
    const session = c.get("session");
    const userId = c.req.param("id");
    const user = await db.query.user.findFirst({
      where: eq(userTable.id, userId),
    });

    if (!user) {
      return c.json({ error: "Usuário não encontrado" }, 404);
    }

    // Password reset pages live in the lab app, not the request origin
    // (the backoffice has no /reset-password route).
    const appUrl = resolveTrustedAppUrl(c);
    const response = await forwardLabAuthResponse({
      c,
      path: "/api/auth/lab/request-password-reset",
      body: {
        email: user.email,
        redirectTo: `${appUrl}/reset-password`,
      },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return c.json(
        {
          error: extractErrorMessage(
            payload,
            "Falha ao solicitar definição de senha",
          ),
        },
        {
          status: responseStatus(response.status),
        },
      );
    }

    await logPlatformEvent({
      actorUserId: session.user.id,
      targetUserId: userId,
      action: "backoffice.user.password_setup.requested",
      entityType: "user",
      entityId: userId,
      details: {
        email: user.email,
      },
    });

    return c.json({ ok: true });
  })
  .post(
    "/:id/role",
    zValidator("json", SetPlatformRoleSchema),
    async (c) => {
      const auth = createBackofficeAuth();
      const session = c.get("session");
      const userId = c.req.param("id");
      const input = c.req.valid("json");

      const result = await auth.api.setRole({
        body: {
          userId,
          role: input.role,
        },
        headers: c.req.raw.headers,
      });

      await db.delete(authSession).where(eq(authSession.userId, userId));

      await logPlatformEvent({
        actorUserId: session.user.id,
        targetUserId: userId,
        action: "backoffice.user.role.updated",
        entityType: "user",
        entityId: userId,
        details: {
          role: input.role,
        },
      });

      return c.json(result);
    },
  )
  .post("/:id/ban", zValidator("json", BanUserSchema), async (c) => {
    const auth = createBackofficeAuth();
    const session = c.get("session");
    const userId = c.req.param("id");
    const input = c.req.valid("json");

    const result = await auth.api.banUser({
      body: {
        userId,
        banReason: input.banReason,
        banExpiresIn: input.banExpiresIn,
      },
      headers: c.req.raw.headers,
    });

    await logPlatformEvent({
      actorUserId: session.user.id,
      targetUserId: userId,
      action: "backoffice.user.banned",
      entityType: "user",
      entityId: userId,
      details: {
        banReason: input.banReason ?? null,
        banExpiresIn: input.banExpiresIn ?? null,
      },
    });

    return c.json(result);
  })
  .post("/:id/unban", async (c) => {
    const auth = createBackofficeAuth();
    const session = c.get("session");
    const userId = c.req.param("id");

    const result = await auth.api.unbanUser({
      body: { userId },
      headers: c.req.raw.headers,
    });

    await logPlatformEvent({
      actorUserId: session.user.id,
      targetUserId: userId,
      action: "backoffice.user.unbanned",
      entityType: "user",
      entityId: userId,
    });

    return c.json(result);
  })
  // ── User observability ────────────────────────────────────────────────────
  // Single-user detail (profile + lab memberships + session signals), the
  // per-user sessions list, the scoped activity timeline, and the platform-wide
  // presence summary for the Comando dashboard. All read at backoffice-access
  // level; only the session revoke (a force-logout) is platform-admin gated.
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const target = await db.query.user.findFirst({
      where: eq(userTable.id, id),
    });

    if (!target) {
      return c.json({ error: "Usuário não encontrado" }, 404);
    }

    const memberships = await db
      .select({
        organizationId: organization.id,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        memberRole: member.role,
      })
      .from(member)
      .innerJoin(
        organization,
        and(
          eq(member.organizationId, organization.id),
          eq(organization.type, "LAB"),
        ),
      )
      .where(eq(member.userId, id))
      .orderBy(asc(organization.name));

    const [agg] = await db
      .select({
        lastLoginAt: max(authSession.createdAt),
        lastSeenAt: max(authSession.updatedAt),
        activeSessionCount: sql<number>`count(*) filter (where ${authSession.expiresAt} > now())`,
      })
      .from(authSession)
      .where(eq(authSession.userId, id));

    const activeSessionCount = Number(agg?.activeSessionCount ?? 0);

    return c.json({
      user: {
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        banned: target.banned,
        createdAt: target.createdAt,
        lastLoginAt: agg?.lastLoginAt ?? null,
        lastSeenAt: agg?.lastSeenAt ?? null,
        activeSessionCount,
        isOnline: activeSessionCount > 0,
        memberships,
      },
    });
  })
  .get("/:id/sessions", async (c) => {
    const id = c.req.param("id");
    const now = new Date();
    const rows = await db
      .select({
        id: authSession.id,
        ipAddress: authSession.ipAddress,
        userAgent: authSession.userAgent,
        createdAt: authSession.createdAt,
        updatedAt: authSession.updatedAt,
        expiresAt: authSession.expiresAt,
        activeOrganizationId: authSession.activeOrganizationId,
        impersonatedBy: authSession.impersonatedBy,
      })
      .from(authSession)
      .where(eq(authSession.userId, id))
      .orderBy(desc(authSession.updatedAt));

    return c.json({
      sessions: rows.map((s) => ({
        id: s.id,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        loginAt: s.createdAt,
        lastActivityAt: s.updatedAt,
        expiresAt: s.expiresAt,
        isCurrentlyActive: s.expiresAt > now,
        isImpersonated: Boolean(s.impersonatedBy),
        // Approximate: Better Auth refreshes session.updatedAt on use, but with no
        // explicit logout the true online time is unknowable without a heartbeat.
        approxDurationMs: s.updatedAt.getTime() - s.createdAt.getTime(),
        activeOrganizationId: s.activeOrganizationId,
      })),
    });
  })
  .get(
    "/:id/activity",
    zValidator("query", UserActivityQuerySchema),
    async (c) => {
      const id = c.req.param("id");
      const input = c.req.valid("query");
      const limit = input.limit ?? 50;

      const conditions = [
        or(
          eq(platformEventLog.actorUserId, id),
          eq(platformEventLog.targetUserId, id),
        )!,
      ];
      if (input.cursor) conditions.push(lt(platformEventLog.id, input.cursor));

      const rows = await db
        .select({
          id: platformEventLog.id,
          action: platformEventLog.action,
          entityType: platformEventLog.entityType,
          entityId: platformEventLog.entityId,
          details: platformEventLog.details,
          createdAt: platformEventLog.createdAt,
          actorUserId: platformEventLog.actorUserId,
          targetUserId: platformEventLog.targetUserId,
        })
        .from(platformEventLog)
        .where(and(...conditions))
        .orderBy(desc(platformEventLog.id))
        .limit(limit + 1);

      const userIds = Array.from(
        new Set(
          rows.flatMap((row) =>
            [row.actorUserId, row.targetUserId].filter(
              (value): value is string => Boolean(value),
            ),
          ),
        ),
      );
      const users =
        userIds.length > 0
          ? await db
              .select({
                id: userTable.id,
                name: userTable.name,
                email: userTable.email,
              })
              .from(userTable)
              .where(inArray(userTable.id, userIds))
          : [];
      const usersById = new Map(users.map((entry) => [entry.id, entry]));

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const data = page.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        details: row.details,
        createdAt: row.createdAt,
        actorUser: row.actorUserId
          ? (usersById.get(row.actorUserId) ?? null)
          : null,
        targetUser: row.targetUserId
          ? (usersById.get(row.targetUserId) ?? null)
          : null,
      }));

      const last = page.at(-1);
      const nextCursor = hasMore && last ? last.id : null;

      return c.json({ data, nextCursor });
    },
  )
  .post(
    "/:id/sessions/revoke",
    zValidator("json", RevokeUserSessionSchema),
    async (c) => {
      const session = c.get("session");
      const id = c.req.param("id");
      const { sessionId } = c.req.valid("json");

      const [target] = await db
        .select({
          id: authSession.id,
          userId: authSession.userId,
          ipAddress: authSession.ipAddress,
          userAgent: authSession.userAgent,
          impersonatedBy: authSession.impersonatedBy,
        })
        .from(authSession)
        .where(eq(authSession.id, sessionId))
        .limit(1);

      if (!target || target.userId !== id) {
        return c.json({ error: "Sessão não encontrada" }, 404);
      }

      await db.delete(authSession).where(eq(authSession.id, target.id));

      await logPlatformEvent({
        actorUserId: session.user.id,
        targetUserId: id,
        action: "backoffice.user.session.revoked",
        entityType: "session",
        entityId: sessionId,
        details: {
          ipAddress: target.ipAddress,
          userAgent: target.userAgent,
          impersonated: Boolean(target.impersonatedBy),
        },
      });

      return c.json({ ok: true });
    },
  );
