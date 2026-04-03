import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, like, not, or, sql } from "drizzle-orm";
import { createBackofficeAuth, createLabAuth } from "@calibra-facil/auth";
import { db } from "@calibra-facil/db";
import {
  member,
  organization,
  organizationIntegration,
  organizationSuccessProfile,
  organizationSupportRequest,
  organizationUnit,
  platformEventLog,
  user as userTable,
} from "@calibra-facil/db/schema";
import {
  canAccessBackoffice,
  parsePlatformRoles,
} from "@calibra-facil/auth/access";
import {
  requireBackofficeAccess,
  requireBackofficeAuthSession,
  requirePlatformAdmin,
  type AuthVariables,
} from "../middleware/permission";
import { internalCustomerSuccessRouter } from "./internal-customer-success";
import { getOrganizationPlanAccess } from "../lib/organization-plan";
import {
  buildWorkflowDelays,
  deriveDefaultSlaTier,
  deriveGoLiveStatus,
  deriveHealthStatus,
  deriveNextActionStatus,
  getActiveCustomerSuccessBlockers,
  resolveDueSoonThresholdHours,
  resolveEffectiveSlaHours,
  getSupportRequestAttentionScore,
  getSupportRequestNeedsEscalation,
  getSupportRequestSlaStatus,
} from "../lib/customer-success";

const SetPlatformRoleSchema = z.object({
  role: z.enum(["user", "platform_operator", "platform_admin"]),
});

const BootstrapSchema = z.object({
  token: z.string().min(1),
});

const CreatePlatformUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  role: z.enum(["platform_operator", "platform_admin"]),
});

const ListBackofficeUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  search: z.string().trim().optional(),
  organizationId: z.string().trim().optional(),
  platformRole: z
    .enum(["all", "user", "platform_operator", "platform_admin", "platform_access"])
    .optional(),
  membershipScope: z
    .enum(["all", "lab_members", "no_lab_membership", "backoffice_only"])
    .optional(),
});

const BanUserSchema = z.object({
  banReason: z.string().trim().max(500).optional(),
  banExpiresIn: z.number().int().positive().optional(),
});

const ImpersonationBridgeSchema = z.object({
  token: z.string().trim().min(1),
  targetUserId: z.string().trim().min(1),
});

function extractErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  if ("message" in payload && typeof payload.message === "string") {
    return payload.message;
  }

  if ("error" in payload && typeof payload.error === "string") {
    return payload.error;
  }

  return fallback;
}

function getAppRedirectErrorUrl(c: {
  req: {
    header(name: string): string | undefined;
  };
  env?: unknown;
}) {
  return `${resolveAppUrl(c)}/backoffice/users`;
}

function redirectToAppWithError(
  c: {
    req: {
      header(name: string): string | undefined;
    };
    env?: unknown;
  },
  message: string,
) {
  const url = new URL(getAppRedirectErrorUrl(c));
  url.searchParams.set("impersonationError", message);

  return Response.redirect(url.toString(), 302);
}

function getSetCookieHeaders(headers: Headers) {
  const candidate = headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof candidate.getSetCookie === "function") {
    return candidate.getSetCookie();
  }

  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function extractCookieHeaderFromResponseHeaders(headers: Headers) {
  const cookies = getSetCookieHeaders(headers)
    .map((value) => value.split(";", 1)[0]?.trim() ?? "")
    .filter(Boolean);

  return cookies.join("; ");
}

async function forwardLabAuthResponse(params: {
  c: {
    req: { raw: Request };
  };
  path: string;
  body?: Record<string, unknown>;
}) {
  const auth = createLabAuth();
  const url = new URL(params.c.req.raw.url);
  url.pathname = params.path;
  url.search = "";

  const headers = new Headers(params.c.req.raw.headers);

  if (params.body) {
    headers.set("content-type", "application/json");
  }

  return auth.handler(
    new Request(url.toString(), {
      method: "POST",
      headers,
      body: params.body ? JSON.stringify(params.body) : undefined,
    }),
  );
}

async function logPlatformEvent(params: {
  actorUserId?: string | null;
  targetUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}) {
  await db.insert(platformEventLog).values({
    actorUserId: params.actorUserId ?? null,
    targetUserId: params.targetUserId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    details: params.details ?? null,
  });
}

async function hasAnyPlatformAdmin() {
  const existing = await db.query.user.findFirst({
    where: like(userTable.role, "%platform_admin%"),
  });

  return Boolean(existing);
}

function readBootstrapToken(c: { env?: unknown }) {
  const envToken =
    (c.env as Record<string, unknown> | undefined)?.BACKOFFICE_BOOTSTRAP_TOKEN ??
    process.env.BACKOFFICE_BOOTSTRAP_TOKEN;

  return typeof envToken === "string" ? envToken.trim() : "";
}

function isValidBootstrapToken(input: string, configured: string) {
  const left = Buffer.from(input);
  const right = Buffer.from(configured);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function resolveAppUrl(c: {
  req: {
    header(name: string): string | undefined;
  };
  env?: unknown;
}) {
  const origin = c.req.header("origin")?.trim();
  if (origin) {
    return origin;
  }

  const referer = c.req.header("referer")?.trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // Ignore malformed referer and fall back to configured app URL.
    }
  }

  const configuredAppUrl =
    (c.env as Record<string, unknown> | undefined)?.APP_URL ?? process.env.APP_URL;

  return typeof configuredAppUrl === "string" && configuredAppUrl.trim().length > 0
    ? configuredAppUrl.trim()
    : "https://localhost:5173";
}

export const backofficeRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .use("*", requireBackofficeAuthSession)
  .get("/access", async (c) => {
    const session = c.get("session");
    const roles = parsePlatformRoles(session.user.role);
    const bootstrapAvailable =
      Boolean(readBootstrapToken(c)) && !(await hasAnyPlatformAdmin());

    return c.json({
      allowed: canAccessBackoffice(session.user.role),
      roles,
      bootstrapAvailable,
      isImpersonating: Boolean(session.session.impersonatedBy),
      session: {
        userId: session.user.id,
        email: session.user.email,
      },
    });
  })
  .post("/bootstrap", zValidator("json", BootstrapSchema), async (c) => {
    const session = c.get("session");
    const input = c.req.valid("json");
    const configuredToken = readBootstrapToken(c);

    if (!configuredToken) {
      return c.json({ error: "Bootstrap do backoffice não configurado" }, 503);
    }

    if (await hasAnyPlatformAdmin()) {
      return c.json({ error: "Bootstrap já foi concluído" }, 409);
    }

    if (!isValidBootstrapToken(input.token, configuredToken)) {
      return c.json({ error: "Token de bootstrap inválido" }, 403);
    }

    await db
      .update(userTable)
      .set({
        role: "platform_admin",
        updatedAt: new Date(),
      })
      .where(eq(userTable.id, session.user.id));

    await logPlatformEvent({
      actorUserId: session.user.id,
      targetUserId: session.user.id,
      action: "backoffice.bootstrap.completed",
      entityType: "user",
      entityId: session.user.id,
      details: {
        email: session.user.email,
      },
    });

    return c.json({
      promoted: true,
      role: "platform_admin",
    });
  })
  .post("/impersonation/stop", async (c) => {
    const session = c.get("session");
    const labAuth = createLabAuth();
    const labSession = await labAuth.api.getSession({
      headers: c.req.raw.headers,
    });
    const impersonatedBy = labSession?.session.impersonatedBy ?? null;

    if (!impersonatedBy) {
      return c.json({ error: "Nenhuma impersonação ativa" }, 400);
    }

    const response = await forwardLabAuthResponse({
      c,
      path: "/api/auth/lab/admin/stop-impersonating",
    });

    if (response.ok) {
      await logPlatformEvent({
        actorUserId: session.user.id,
        targetUserId: labSession?.user.id ?? null,
        action: "backoffice.impersonation.stop",
        entityType: "user",
        entityId: labSession?.user.id ?? null,
        details: {
          impersonatedBy,
        },
      });
    }

    return response;
  })
  .use("*", requireBackofficeAccess)
  .get(
    "/impersonation/bridge",
    zValidator("query", ImpersonationBridgeSchema),
    async (c) => {
      const session = c.get("session");
      const input = c.req.valid("query");
      const labAuth = createLabAuth() as any;

      const targetUser = await db.query.user.findFirst({
        where: eq(userTable.id, input.targetUserId),
      });

      if (!targetUser) {
        await logPlatformEvent({
          actorUserId: session.user.id,
          targetUserId: input.targetUserId,
          action: "backoffice.impersonation.failed",
          entityType: "user",
          entityId: input.targetUserId,
          details: {
            reason: "target_not_found",
          },
        });

        return redirectToAppWithError(c, "Usuário alvo não encontrado");
      }

      try {
        const verifyResponse = (await labAuth.api.verifyOneTimeToken({
          body: { token: input.token },
          asResponse: true,
        })) as Response;

        if (!verifyResponse.ok) {
          const payload = await verifyResponse.json().catch(() => null);

          await logPlatformEvent({
            actorUserId: session.user.id,
            targetUserId: input.targetUserId,
            action: "backoffice.impersonation.failed",
            entityType: "user",
            entityId: input.targetUserId,
            details: {
              reason: "invalid_handoff_token",
            },
          });

          return redirectToAppWithError(
            c,
            extractErrorMessage(
              payload,
              "Falha ao validar o handoff de impersonação",
            ),
          );
        }

        const operatorLabCookie = extractCookieHeaderFromResponseHeaders(
          verifyResponse.headers,
        );

        if (!operatorLabCookie) {
          await logPlatformEvent({
            actorUserId: session.user.id,
            targetUserId: input.targetUserId,
            action: "backoffice.impersonation.failed",
            entityType: "user",
            entityId: input.targetUserId,
            details: {
              reason: "missing_lab_cookie_after_verify",
            },
          });

          return redirectToAppWithError(
            c,
            "Falha ao preparar a sessão LAB do operador para impersonação",
          );
        }

        const operatorLabSession = await labAuth.api.getSession({
          headers: new Headers({
            cookie: operatorLabCookie,
          }),
        });

        if (!operatorLabSession) {
          await logPlatformEvent({
            actorUserId: session.user.id,
            targetUserId: input.targetUserId,
            action: "backoffice.impersonation.failed",
            entityType: "user",
            entityId: input.targetUserId,
            details: {
              reason: "lab_session_not_established",
            },
          });

          return redirectToAppWithError(
            c,
            "Falha ao estabelecer a sessão LAB do operador",
          );
        }

        if (operatorLabSession.user.id !== session.user.id) {
          await logPlatformEvent({
            actorUserId: session.user.id,
            targetUserId: input.targetUserId,
            action: "backoffice.impersonation.failed",
            entityType: "user",
            entityId: input.targetUserId,
            details: {
              reason: "operator_identity_mismatch",
              labUserId: operatorLabSession.user.id,
            },
          });

          return redirectToAppWithError(
            c,
            "Falha ao reconciliar a identidade do operador no handoff",
          );
        }

        const impersonateResponse = (await labAuth.api.impersonateUser({
          body: {
            userId: input.targetUserId,
          },
          headers: new Headers({
            cookie: operatorLabCookie,
          }),
          asResponse: true,
        })) as Response;

        if (!impersonateResponse.ok) {
          const payload = await impersonateResponse.json().catch(() => null);

          await logPlatformEvent({
            actorUserId: session.user.id,
            targetUserId: input.targetUserId,
            action: "backoffice.impersonation.failed",
            entityType: "user",
            entityId: input.targetUserId,
            details: {
              reason: "lab_impersonation_rejected",
            },
          });

          return redirectToAppWithError(
            c,
            extractErrorMessage(
              payload,
              "Falha ao iniciar impersonação no dashboard LAB",
            ),
          );
        }

        await logPlatformEvent({
          actorUserId: session.user.id,
          targetUserId: input.targetUserId,
          action: "backoffice.impersonation.start",
          entityType: "user",
          entityId: input.targetUserId,
          details: {
            email: targetUser.email,
            via: "one_time_token_bridge",
          },
        });

        const headers = new Headers(impersonateResponse.headers);
        headers.set("Location", `${resolveAppUrl(c)}/dashboard`);

        return new Response(null, {
          status: 302,
          headers,
        });
      } catch (error) {
        await logPlatformEvent({
          actorUserId: session.user.id,
          targetUserId: input.targetUserId,
          action: "backoffice.impersonation.failed",
          entityType: "user",
          entityId: input.targetUserId,
          details: {
            reason: "unexpected_error",
            message: error instanceof Error ? error.message : null,
          },
        });

        return redirectToAppWithError(
          c,
          extractErrorMessage(
            error instanceof Error ? { message: error.message } : null,
            "Falha ao concluir a ponte de impersonação",
          ),
        );
      }
    },
  )
  .route("/customer-success", internalCustomerSuccessRouter)
  .get("/organizations", async (c) => {
    const rows = await db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        type: organization.type,
        createdAt: organization.createdAt,
        successProfileUpdatedAt: organizationSuccessProfile.updatedAt,
        onboardingStatus: organizationSuccessProfile.onboardingStatus,
        migrationStatus: organizationSuccessProfile.migrationStatus,
        unitsCount: sql<number>`count(distinct ${organizationUnit.id})`,
        integrationsCount: sql<number>`count(distinct ${organizationIntegration.id})`,
        openRequestsCount: sql<number>`count(distinct case when ${organizationSupportRequest.status} in ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER') then ${organizationSupportRequest.id} end)`,
      })
      .from(organization)
      .leftJoin(
        organizationSuccessProfile,
        eq(organizationSuccessProfile.organizationId, organization.id),
      )
      .leftJoin(
        organizationUnit,
        eq(organizationUnit.organizationId, organization.id),
      )
      .leftJoin(
        organizationIntegration,
        eq(organizationIntegration.organizationId, organization.id),
      )
      .leftJoin(
        organizationSupportRequest,
        eq(organizationSupportRequest.organizationId, organization.id),
      )
      .where(eq(organization.type, "LAB"))
      .groupBy(
        organization.id,
        organization.name,
        organization.slug,
        organization.type,
        organization.createdAt,
        organizationSuccessProfile.updatedAt,
        organizationSuccessProfile.onboardingStatus,
        organizationSuccessProfile.migrationStatus,
      )
      .orderBy(asc(organization.name));

    return c.json({ data: rows });
  })
  .get("/organizations/:id", async (c) => {
    const id = c.req.param("id");
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, id), eq(organization.type, "LAB")),
    });

    if (!org) {
      return c.json({ error: "Organização não encontrada" }, 404);
    }

    const [units, integrations, supportSummary, successProfile, planAccess] =
      await Promise.all([
        db.query.organizationUnit.findMany({
          where: eq(organizationUnit.organizationId, id),
          orderBy: [asc(organizationUnit.name)],
        }),
        db.query.organizationIntegration.findMany({
          where: eq(organizationIntegration.organizationId, id),
          orderBy: [desc(organizationIntegration.createdAt)],
        }),
        db
          .select({
            total: sql<number>`count(*)`,
            open: sql<number>`count(case when ${organizationSupportRequest.status} in ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER') then 1 end)`,
          })
          .from(organizationSupportRequest)
          .where(eq(organizationSupportRequest.organizationId, id)),
        db.query.organizationSuccessProfile.findFirst({
          where: eq(organizationSuccessProfile.organizationId, id),
        }),
        getOrganizationPlanAccess(id),
      ]);

    return c.json({
      organization: org,
      units,
      integrations,
      successProfile,
      support: supportSummary[0] ?? { total: 0, open: 0 },
      plan: planAccess,
    });
  })
  .get("/support/queue", async (c) => {
    const rows = await db.query.organizationSupportRequest.findMany({
      with: {
        requestedByUser: true,
        assignedToUser: true,
        organization: true,
      },
      orderBy: [
        desc(organizationSupportRequest.priority),
        desc(organizationSupportRequest.createdAt),
      ],
      limit: 100,
    });

    const organizationIds = Array.from(
      new Set(rows.map((row) => row.organizationId)),
    );

    const [profiles, planAccessEntries] = await Promise.all([
      organizationIds.length === 0
        ? Promise.resolve([])
        : db.query.organizationSuccessProfile.findMany({
            where: inArray(organizationSuccessProfile.organizationId, organizationIds),
          }),
      Promise.all(
        organizationIds.map(async (organizationId) => [
          organizationId,
          await getOrganizationPlanAccess(organizationId),
        ] as const),
      ),
    ]);

    const profilesByOrg = new Map(
      profiles.map((profile) => [profile.organizationId, profile] as const),
    );
    const planAccessByOrg = new Map(planAccessEntries);

    const data = rows.map((row) => {
      const profile = profilesByOrg.get(row.organizationId);
      const planAccess = planAccessByOrg.get(row.organizationId);
      const effectiveSlaTier =
        profile && planAccess
          ? profile.slaTier === "PLAN_DEFAULT"
            ? deriveDefaultSlaTier(planAccess.supportPolicy)
            : profile.slaTier
          : "PLAN_DEFAULT";
      const goLiveStatus =
        profile && planAccess
          ? deriveGoLiveStatus({
              currentStatus: profile.goLiveStatus,
              goLiveActualDate: profile.goLiveActualDate,
              goLiveTargetDate: profile.goLiveTargetDate,
            })
          : "NOT_SCHEDULED";
      const dueSoonThresholdHours =
        profile && planAccess
          ? resolveDueSoonThresholdHours(
              resolveEffectiveSlaHours(
                planAccess.supportPolicy.targetFirstResponseBusinessHours,
                effectiveSlaTier,
              ),
            )
          : 4;
      const healthStatus =
        profile && planAccess
          ? deriveHealthStatus({
              currentStatus: profile.healthStatus,
              onboardingStatus: profile.onboardingStatus,
              migrationStatus: profile.migrationStatus,
              goLiveStatus,
              breachedRequestsCount:
                getSupportRequestSlaStatus({
                  status: row.status,
                  slaTargetAt: row.slaTargetAt,
                  dueSoonThresholdHours,
                }) === "BREACHED"
                  ? 1
                  : 0,
              dueSoonRequestsCount:
                getSupportRequestSlaStatus({
                  status: row.status,
                  slaTargetAt: row.slaTargetAt,
                  dueSoonThresholdHours,
                }) === "DUE_SOON"
                  ? 1
                  : 0,
            })
          : "HEALTHY";
      const slaStatus = getSupportRequestSlaStatus({
        status: row.status,
        slaTargetAt: row.slaTargetAt,
        dueSoonThresholdHours,
      });
      const activeBlockers = getActiveCustomerSuccessBlockers(profile?.blockers);
      const nextActionStatus = profile
        ? deriveNextActionStatus({
            nextAction: profile.nextAction,
            nextActionDueAt: profile.nextActionDueAt,
            nextActionCompletedAt: profile.nextActionCompletedAt,
          })
        : "NONE";
      const prioritySupport =
        (profile?.prioritySupport ?? false) ||
        effectiveSlaTier !== "PLAN_DEFAULT" ||
        (planAccess?.supportPolicy.hasPrioritySupport ?? false);
      const needsEscalation = getSupportRequestNeedsEscalation({
        status: row.status,
        slaStatus,
        priority: row.priority,
        prioritySupport,
        escalatedAt: row.escalatedAt,
      });
      const attentionScore = getSupportRequestAttentionScore({
        status: row.status,
        slaStatus,
        priority: row.priority,
        assignedToUserId: row.assignedToUserId,
        prioritySupport,
        escalatedAt: row.escalatedAt,
      });

      return {
        ...row,
        slaStatus,
        timeToSlaMs: row.slaTargetAt
          ? row.slaTargetAt.getTime() - Date.now()
          : null,
        organizationHealth: healthStatus,
        prioritySupport,
        effectiveSlaTier,
        needsEscalation,
        attentionScore,
        escalationReason: row.escalationReason,
        nextActionStatus,
        organizationBlockers: activeBlockers,
        workflowDelays: buildWorkflowDelays({
          nextActionStatus,
          goLiveStatus,
          activeBlockersCount: activeBlockers.length,
        }),
      };
    }).sort((left, right) => {
      if (right.attentionScore !== left.attentionScore) {
        return right.attentionScore - left.attentionScore;
      }

      const leftSla = left.slaTargetAt
        ? new Date(left.slaTargetAt).getTime()
        : Number.POSITIVE_INFINITY;
      const rightSla = right.slaTargetAt
        ? new Date(right.slaTargetAt).getTime()
        : Number.POSITIVE_INFINITY;

      return leftSla - rightSla;
    });

    return c.json({ data });
  })
  .get("/users", zValidator("query", ListBackofficeUsersQuerySchema), async (c) => {
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
        or(
          ilike(userTable.name, pattern),
          ilike(userTable.email, pattern),
        )!,
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

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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

    return c.json({
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        banned: user.banned,
        createdAt: user.createdAt,
        memberships: membershipsByUser.get(user.id) ?? [],
      })),
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
  })
  .post("/users", requirePlatformAdmin, zValidator("json", CreatePlatformUserSchema), async (c) => {
    const auth = createBackofficeAuth() as any;
    const session = c.get("session");
    const input = c.req.valid("json");
    const temporaryPassword = randomBytes(24).toString("base64url");
    const appUrl = resolveAppUrl(c);

    const createdUser = await auth.api.createUser({
      body: {
        name: input.name,
        email: input.email,
        password: temporaryPassword,
        role: input.role,
      },
      headers: c.req.raw.headers,
    });
    const createdUserRecord =
      createdUser && typeof createdUser === "object" && "user" in createdUser
        ? (createdUser.user as { id: string; email: string; name: string })
        : (createdUser as { id: string; email: string; name: string });

    const resetResponse = await forwardLabAuthResponse({
      c,
      path: "/api/auth/lab/request-password-reset",
      body: {
        email: input.email,
        redirectTo: `${appUrl}/reset-password`,
      },
    });

    const resetPayload = resetResponse.ok ? null : await resetResponse.json().catch(() => null);

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
        : extractErrorMessage(resetPayload, "Falha ao enviar email de definição de senha"),
    });
  })
  .post(
    "/users/:id/impersonate",
    async (c) => {
      const backofficeAuth = createBackofficeAuth() as any;
      const session = c.get("session");
      const targetUserId = c.req.param("id");
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
  .use("/users/:id/request-password-reset", requirePlatformAdmin)
  .use("/users/:id/role", requirePlatformAdmin)
  .use("/users/:id/ban", requirePlatformAdmin)
  .use("/users/:id/unban", requirePlatformAdmin)
  .post("/users/:id/request-password-reset", async (c) => {
    const session = c.get("session");
    const userId = c.req.param("id");
    const user = await db.query.user.findFirst({
      where: eq(userTable.id, userId),
    });

    if (!user) {
      return c.json({ error: "Usuário não encontrado" }, 404);
    }

    const appUrl = resolveAppUrl(c);
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
          { status: response.status as 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503 },
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
    "/users/:id/role",
    zValidator("json", SetPlatformRoleSchema),
    async (c) => {
      const auth = createBackofficeAuth() as any;
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
  .post("/users/:id/ban", zValidator("json", BanUserSchema), async (c) => {
    const auth = createBackofficeAuth() as any;
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
  .post("/users/:id/unban", async (c) => {
    const auth = createBackofficeAuth() as any;
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
  .onError((error, c) => {
    if (error instanceof Response) {
      return error;
    }

    return c.json(
      {
        error: extractErrorMessage(
          error instanceof Error ? { message: error.message } : null,
          "Backoffice request failed",
        ),
      },
      500,
    );
  });
