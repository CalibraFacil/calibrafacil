import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  organization,
  organizationEventLog,
  organizationSuccessProfile,
  organizationSupportRequest,
  organizationSupportRequestEvent,
  user as userTable,
} from "@calibra-facil/db/schema";
import {
  deriveDefaultSlaTier,
  deriveGoLiveStatus,
  deriveHealthStatus,
  ensureSuccessProfile,
  getOrganizationWorkstreams,
  getSupportRequestSlaStatus,
  writeOrganizationCustomerSuccessEvent,
  writeSupportRequestEvent,
} from "../lib/customer-success";
import { getOrganizationPlanAccess } from "../lib/organization-plan";
import {
  requireBackofficeAccess,
  requireBackofficeAuthSession,
  type AuthVariables,
} from "../middleware/permission";

const UpdateSuccessProfileSchema = z.object({
  accountOwnerUserId: z.string().trim().min(1).nullable().optional(),
  accountOwnerName: z.string().trim().max(255).nullable().optional(),
  accountOwnerEmail: z
    .string()
    .trim()
    .email()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  supportContactEmail: z
    .string()
    .trim()
    .email()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  internalOwnerUserId: z.string().trim().min(1).nullable().optional(),
  prioritySupport: z.boolean().optional(),
  slaTier: z.enum(["PLAN_DEFAULT", "PRIORITY", "DEDICATED"]).optional(),
  onboardingStatus: z
    .enum([
      "NOT_STARTED",
      "DISCOVERY",
      "CONFIGURATION",
      "TRAINING",
      "LIVE",
      "BLOCKED",
    ])
    .optional(),
  migrationStatus: z
    .enum([
      "NOT_REQUIRED",
      "PLANNING",
      "IN_PROGRESS",
      "VALIDATION",
      "COMPLETED",
      "BLOCKED",
    ])
    .optional(),
  goLiveStatus: z
    .enum(["NOT_SCHEDULED", "SCHEDULED", "AT_RISK", "LIVE"])
    .optional(),
  healthStatus: z.enum(["HEALTHY", "ATTENTION", "CRITICAL"]).optional(),
  nextAction: z.string().trim().max(1000).nullable().optional(),
  nextActionDueAt: z.string().datetime().nullable().optional(),
  goLiveTargetDate: z.string().datetime().nullable().optional(),
  goLiveActualDate: z.string().datetime().nullable().optional(),
  publicStatusNote: z.string().trim().max(4000).nullable().optional(),
  internalNotes: z.string().trim().max(4000).nullable().optional(),
});

const AssignSupportRequestSchema = z.object({
  assignedToUserId: z.string().trim().min(1).nullable(),
});

const RespondSupportRequestSchema = z.object({
  message: z.string().trim().min(3).max(4000),
  publicVisible: z.boolean().default(true),
});

const UpdateSupportRequestStatusSchema = z.object({
  status: z.enum([
    "OPEN",
    "IN_PROGRESS",
    "WAITING_ON_CUSTOMER",
    "RESOLVED",
    "CLOSED",
  ]),
});

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isOpenSupportStatus(status: string) {
  return (
    status === "OPEN" ||
    status === "IN_PROGRESS" ||
    status === "WAITING_ON_CUSTOMER"
  );
}

async function touchSuccessProfile(organizationId: string) {
  await ensureSuccessProfile(organizationId);
  await db
    .update(organizationSuccessProfile)
    .set({
      lastTouchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(organizationSuccessProfile.organizationId, organizationId));
}

async function listInternalOperators() {
  return db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      role: userTable.role,
    })
    .from(userTable)
    .where(inArray(userTable.role, ["platform_operator", "platform_admin"]))
    .orderBy(asc(userTable.name));
}

async function getTimelineForOrganization(organizationId: string) {
  const events = await db
    .select({
      id: organizationEventLog.id,
      action: organizationEventLog.action,
      entityType: organizationEventLog.entityType,
      entityId: organizationEventLog.entityId,
      details: organizationEventLog.details,
      createdAt: organizationEventLog.createdAt,
      actorUserId: organizationEventLog.actorUserId,
      actorName: userTable.name,
      actorEmail: userTable.email,
    })
    .from(organizationEventLog)
    .leftJoin(userTable, eq(organizationEventLog.actorUserId, userTable.id))
    .where(eq(organizationEventLog.organizationId, organizationId))
    .orderBy(desc(organizationEventLog.createdAt))
    .limit(24);

  return events.map((event) => ({
    id: event.id,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    details: event.details,
    createdAt: event.createdAt,
    actorUser: event.actorUserId
      ? {
          id: event.actorUserId,
          name: event.actorName ?? "Usuário removido",
          email: event.actorEmail ?? null,
        }
      : null,
  }));
}

function buildOperationalSummary(params: {
  profile: Awaited<ReturnType<typeof ensureSuccessProfile>>;
  supportPolicy: Awaited<ReturnType<typeof getOrganizationPlanAccess>>["supportPolicy"];
  openRequestsCount: number;
  urgentRequestsCount: number;
  dueSoonRequestsCount: number;
  breachedRequestsCount: number;
  totalRequestsCount: number;
}) {
  const effectiveSlaTier =
    params.profile.slaTier === "PLAN_DEFAULT"
      ? deriveDefaultSlaTier(params.supportPolicy)
      : params.profile.slaTier;
  const goLiveStatus = deriveGoLiveStatus({
    currentStatus: params.profile.goLiveStatus,
    goLiveActualDate: params.profile.goLiveActualDate,
    goLiveTargetDate: params.profile.goLiveTargetDate,
  });
  const healthStatus = deriveHealthStatus({
    currentStatus: params.profile.healthStatus,
    onboardingStatus: params.profile.onboardingStatus,
    migrationStatus: params.profile.migrationStatus,
    goLiveStatus,
    breachedRequestsCount: params.breachedRequestsCount,
    dueSoonRequestsCount: params.dueSoonRequestsCount,
  });
  const workstreams = getOrganizationWorkstreams({
    onboardingStatus: params.profile.onboardingStatus,
    migrationStatus: params.profile.migrationStatus,
    openRequestsCount: params.openRequestsCount,
  });
  const nextActionOverdue =
    params.profile.nextActionDueAt !== null &&
    params.profile.nextActionDueAt.getTime() < Date.now();

  return {
    supportMode: params.supportPolicy.supportMode,
    effectiveSlaTier,
    prioritySupport:
      params.profile.prioritySupport ||
      effectiveSlaTier !== "PLAN_DEFAULT" ||
      params.supportPolicy.hasPrioritySupport,
    healthStatus,
    goLiveStatus,
    workstreams,
    openRequestsCount: params.openRequestsCount,
    urgentRequestsCount: params.urgentRequestsCount,
    dueSoonRequestsCount: params.dueSoonRequestsCount,
    breachedRequestsCount: params.breachedRequestsCount,
    totalRequestsCount: params.totalRequestsCount,
    needsAttention:
      healthStatus !== "HEALTHY" ||
      params.breachedRequestsCount > 0 ||
      nextActionOverdue,
    nextActionOverdue,
  };
}

async function listRequestsForOrganization(organizationId: string) {
  const [profile, planAccess] = await Promise.all([
    ensureSuccessProfile(organizationId),
    getOrganizationPlanAccess(organizationId),
  ]);

  const requests = await db.query.organizationSupportRequest.findMany({
    where: eq(organizationSupportRequest.organizationId, organizationId),
    with: {
      requestedByUser: true,
      assignedToUser: true,
    },
    orderBy: [desc(organizationSupportRequest.createdAt)],
  });

  if (requests.length === 0) {
    return {
      requests: [],
      operationalSummary: buildOperationalSummary({
        profile,
        supportPolicy: planAccess.supportPolicy,
        openRequestsCount: 0,
        urgentRequestsCount: 0,
        dueSoonRequestsCount: 0,
        breachedRequestsCount: 0,
        totalRequestsCount: 0,
      }),
    };
  }

  const events = await db.query.organizationSupportRequestEvent.findMany({
    where: and(
      eq(organizationSupportRequestEvent.organizationId, organizationId),
      inArray(
        organizationSupportRequestEvent.supportRequestId,
        requests.map((request) => request.id),
      ),
    ),
    with: {
      actorUser: true,
    },
    orderBy: [asc(organizationSupportRequestEvent.createdAt)],
  });

  const eventsByRequest = new Map<number, typeof events>();
  for (const event of events) {
    const bucket = eventsByRequest.get(event.supportRequestId) ?? [];
    bucket.push(event);
    eventsByRequest.set(event.supportRequestId, bucket);
  }

  const enrichedRequests = requests.map((request) => {
    const slaStatus = getSupportRequestSlaStatus({
      status: request.status,
      slaTargetAt: request.slaTargetAt,
    });
    const timeToSlaMs = request.slaTargetAt
      ? request.slaTargetAt.getTime() - Date.now()
      : null;

    return {
      ...request,
      slaStatus,
      timeToSlaMs,
      prioritySupport:
        profile.prioritySupport ||
        deriveDefaultSlaTier(planAccess.supportPolicy) !== "PLAN_DEFAULT" ||
        planAccess.supportPolicy.hasPrioritySupport,
      events: eventsByRequest.get(request.id) ?? [],
    };
  });

  const openRequests = enrichedRequests.filter((request) =>
    isOpenSupportStatus(request.status),
  );

  return {
    requests: enrichedRequests,
    operationalSummary: buildOperationalSummary({
      profile,
      supportPolicy: planAccess.supportPolicy,
      openRequestsCount: openRequests.length,
      urgentRequestsCount: openRequests.filter(
        (request) => request.priority === "URGENT" || request.priority === "HIGH",
      ).length,
      dueSoonRequestsCount: openRequests.filter(
        (request) => request.slaStatus === "DUE_SOON",
      ).length,
      breachedRequestsCount: openRequests.filter(
        (request) => request.slaStatus === "BREACHED",
      ).length,
      totalRequestsCount: enrichedRequests.length,
    }),
  };
}

export const internalCustomerSuccessRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .use("*", requireBackofficeAuthSession, requireBackofficeAccess)
  .get("/access", (c) => c.json({ allowed: true }))
  .get("/organizations", async (c) => {
    const now = new Date();
    const rows = await db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        type: organization.type,
        successProfileId: organizationSuccessProfile.id,
        accountOwnerName: organizationSuccessProfile.accountOwnerName,
        accountOwnerEmail: organizationSuccessProfile.accountOwnerEmail,
        supportContactEmail: organizationSuccessProfile.supportContactEmail,
        internalOwnerUserId: organizationSuccessProfile.internalOwnerUserId,
        prioritySupport: organizationSuccessProfile.prioritySupport,
        slaTier: organizationSuccessProfile.slaTier,
        onboardingStatus: organizationSuccessProfile.onboardingStatus,
        migrationStatus: organizationSuccessProfile.migrationStatus,
        goLiveStatus: organizationSuccessProfile.goLiveStatus,
        goLiveTargetDate: organizationSuccessProfile.goLiveTargetDate,
        goLiveActualDate: organizationSuccessProfile.goLiveActualDate,
        healthStatus: organizationSuccessProfile.healthStatus,
        nextAction: organizationSuccessProfile.nextAction,
        nextActionDueAt: organizationSuccessProfile.nextActionDueAt,
        lastTouchedAt: organizationSuccessProfile.lastTouchedAt,
        updatedAt: organizationSuccessProfile.updatedAt,
        openRequestsCount: sql<number>`count(case when ${organizationSupportRequest.status} in ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER') then 1 end)`,
        totalRequestsCount: sql<number>`count(${organizationSupportRequest.id})`,
        urgentRequestsCount: sql<number>`count(case when ${organizationSupportRequest.status} in ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER') and ${organizationSupportRequest.priority} in ('HIGH', 'URGENT') then 1 end)`,
        dueSoonRequestsCount: sql<number>`count(case when ${organizationSupportRequest.status} in ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER') and ${organizationSupportRequest.slaTargetAt} > ${now} and ${organizationSupportRequest.slaTargetAt} <= ${new Date(now.getTime() + 4 * 60 * 60 * 1000)} then 1 end)`,
        breachedRequestsCount: sql<number>`count(case when ${organizationSupportRequest.status} in ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER') and ${organizationSupportRequest.slaTargetAt} <= ${now} then 1 end)`,
      })
      .from(organization)
      .leftJoin(
        organizationSuccessProfile,
        eq(organizationSuccessProfile.organizationId, organization.id),
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
        organizationSuccessProfile.id,
        organizationSuccessProfile.accountOwnerName,
        organizationSuccessProfile.accountOwnerEmail,
        organizationSuccessProfile.supportContactEmail,
        organizationSuccessProfile.internalOwnerUserId,
        organizationSuccessProfile.prioritySupport,
        organizationSuccessProfile.slaTier,
        organizationSuccessProfile.onboardingStatus,
        organizationSuccessProfile.migrationStatus,
        organizationSuccessProfile.goLiveStatus,
        organizationSuccessProfile.goLiveTargetDate,
        organizationSuccessProfile.goLiveActualDate,
        organizationSuccessProfile.healthStatus,
        organizationSuccessProfile.nextAction,
        organizationSuccessProfile.nextActionDueAt,
        organizationSuccessProfile.lastTouchedAt,
        organizationSuccessProfile.updatedAt,
      )
      .orderBy(asc(organization.name));

    const planAccessByOrg = new Map(
      await Promise.all(
        rows.map(async (row) => [row.id, await getOrganizationPlanAccess(row.id)] as const),
      ),
    );

    const profilesByOrg = new Map(
      await Promise.all(
        rows.map(async (row) => {
          if (row.successProfileId) {
            return [
              row.id,
              {
                id: row.successProfileId,
                organizationId: row.id,
                accountOwnerUserId: null,
                accountOwnerName: row.accountOwnerName,
                accountOwnerEmail: row.accountOwnerEmail,
                supportContactEmail: row.supportContactEmail,
                internalOwnerUserId: row.internalOwnerUserId,
                prioritySupport: row.prioritySupport ?? false,
                slaTier: row.slaTier ?? "PLAN_DEFAULT",
                onboardingStatus: row.onboardingStatus ?? "NOT_STARTED",
                migrationStatus: row.migrationStatus ?? "NOT_REQUIRED",
                goLiveStatus: row.goLiveStatus ?? "NOT_SCHEDULED",
                healthStatus: row.healthStatus ?? "HEALTHY",
                nextAction: row.nextAction,
                nextActionDueAt: row.nextActionDueAt,
                goLiveTargetDate: row.goLiveTargetDate,
                goLiveActualDate: row.goLiveActualDate,
                publicStatusNote: null,
                internalNotes: null,
                lastTouchedAt: row.lastTouchedAt,
                createdAt: row.updatedAt ?? new Date(),
                updatedAt: row.updatedAt ?? new Date(),
              },
            ] as const;
          }

          return [row.id, await ensureSuccessProfile(row.id)] as const;
        }),
      ),
    );

    const operatorIds = Array.from(
      new Set(
        rows
          .map((row) => row.internalOwnerUserId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const operatorsById = new Map(
      operatorIds.length === 0
        ? []
        : (
            await db
              .select({
                id: userTable.id,
                name: userTable.name,
                email: userTable.email,
                role: userTable.role,
              })
              .from(userTable)
              .where(inArray(userTable.id, operatorIds))
          ).map((row) => [row.id, row] as const),
    );

    return c.json({
      data: rows.map((row) => {
        const profile = profilesByOrg.get(row.id)!;
        const planAccess = planAccessByOrg.get(row.id)!;
        const operationalSummary = buildOperationalSummary({
          profile,
          supportPolicy: planAccess.supportPolicy,
          openRequestsCount: Number(row.openRequestsCount ?? 0),
          urgentRequestsCount: Number(row.urgentRequestsCount ?? 0),
          dueSoonRequestsCount: Number(row.dueSoonRequestsCount ?? 0),
          breachedRequestsCount: Number(row.breachedRequestsCount ?? 0),
          totalRequestsCount: Number(row.totalRequestsCount ?? 0),
        });

        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          type: row.type,
          accountOwnerName: profile.accountOwnerName,
          accountOwnerEmail: profile.accountOwnerEmail,
          supportContactEmail: profile.supportContactEmail,
          internalOwnerUser: profile.internalOwnerUserId
            ? operatorsById.get(profile.internalOwnerUserId) ?? null
            : null,
          profile: {
            onboardingStatus: profile.onboardingStatus,
            migrationStatus: profile.migrationStatus,
            goLiveStatus: operationalSummary.goLiveStatus,
            healthStatus: operationalSummary.healthStatus,
            nextAction: profile.nextAction,
            nextActionDueAt: profile.nextActionDueAt,
            lastTouchedAt: profile.lastTouchedAt,
            goLiveTargetDate: profile.goLiveTargetDate,
            goLiveActualDate: profile.goLiveActualDate,
            prioritySupport: operationalSummary.prioritySupport,
            slaTier: operationalSummary.effectiveSlaTier,
          },
          supportPolicy: planAccess.supportPolicy,
          plan: {
            id: planAccess.planId,
            name: planAccess.planName,
            status: planAccess.status,
          },
          operationalSummary,
        };
      }),
    });
  })
  .get("/organizations/:id/profile", async (c) => {
    const id = c.req.param("id");
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, id), eq(organization.type, "LAB")),
    });

    if (!org) {
      return c.json({ error: "Organização não encontrada" }, 404);
    }

    const [profile, planAccess, requestsData, timeline, operators] = await Promise.all([
      ensureSuccessProfile(org.id),
      getOrganizationPlanAccess(org.id),
      listRequestsForOrganization(org.id),
      getTimelineForOrganization(org.id),
      listInternalOperators(),
    ]);

    const internalOwnerUser = profile.internalOwnerUserId
      ? operators.find((operator) => operator.id === profile.internalOwnerUserId) ?? null
      : null;

    return c.json({
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
      profile,
      supportPolicy: planAccess.supportPolicy,
      plan: {
        id: planAccess.planId,
        name: planAccess.planName,
        status: planAccess.status,
      },
      internalOwnerUser,
      operators,
      operationalSummary: requestsData.operationalSummary,
      timeline,
    });
  })
  .put(
    "/organizations/:id/profile",
    zValidator("json", UpdateSuccessProfileSchema),
    async (c) => {
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");
      const org = await db.query.organization.findFirst({
        where: and(eq(organization.id, id), eq(organization.type, "LAB")),
      });

      if (!org) {
        return c.json({ error: "Organização não encontrada" }, 404);
      }

      const existing = await ensureSuccessProfile(org.id);
      const [updated] = await db
        .update(organizationSuccessProfile)
        .set({
          accountOwnerUserId: input.accountOwnerUserId ?? existing.accountOwnerUserId,
          accountOwnerName:
            input.accountOwnerName !== undefined
              ? normalizeNullableText(input.accountOwnerName)
              : existing.accountOwnerName,
          accountOwnerEmail:
            input.accountOwnerEmail !== undefined
              ? normalizeNullableText(input.accountOwnerEmail)
              : existing.accountOwnerEmail,
          supportContactEmail:
            input.supportContactEmail !== undefined
              ? normalizeNullableText(input.supportContactEmail)
              : existing.supportContactEmail,
          internalOwnerUserId:
            input.internalOwnerUserId !== undefined
              ? input.internalOwnerUserId
              : existing.internalOwnerUserId,
          prioritySupport: input.prioritySupport ?? existing.prioritySupport,
          slaTier: input.slaTier ?? existing.slaTier,
          onboardingStatus: input.onboardingStatus ?? existing.onboardingStatus,
          migrationStatus: input.migrationStatus ?? existing.migrationStatus,
          goLiveStatus: input.goLiveStatus ?? existing.goLiveStatus,
          healthStatus: input.healthStatus ?? existing.healthStatus,
          nextAction:
            input.nextAction !== undefined
              ? normalizeNullableText(input.nextAction)
              : existing.nextAction,
          nextActionDueAt:
            input.nextActionDueAt !== undefined
              ? input.nextActionDueAt
                ? new Date(input.nextActionDueAt)
                : null
              : existing.nextActionDueAt,
          goLiveTargetDate:
            input.goLiveTargetDate !== undefined
              ? input.goLiveTargetDate
                ? new Date(input.goLiveTargetDate)
                : null
              : existing.goLiveTargetDate,
          goLiveActualDate:
            input.goLiveActualDate !== undefined
              ? input.goLiveActualDate
                ? new Date(input.goLiveActualDate)
                : null
              : existing.goLiveActualDate,
          publicStatusNote:
            input.publicStatusNote !== undefined
              ? normalizeNullableText(input.publicStatusNote)
              : existing.publicStatusNote,
          internalNotes:
            input.internalNotes !== undefined
              ? normalizeNullableText(input.internalNotes)
              : existing.internalNotes,
          lastTouchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(organizationSuccessProfile.organizationId, org.id))
        .returning();

      await writeOrganizationCustomerSuccessEvent({
        organizationId: org.id,
        actorUserId: session.user.id,
        action: "customer_success.profile.updated",
        entityType: "organization_success_profile",
        entityId: String(updated?.id ?? existing.id),
        details: {
          internalOwnerUserId:
            input.internalOwnerUserId !== undefined ? input.internalOwnerUserId : undefined,
          prioritySupport: input.prioritySupport,
          slaTier: input.slaTier,
          onboardingStatus: input.onboardingStatus,
          migrationStatus: input.migrationStatus,
          goLiveStatus: input.goLiveStatus,
          healthStatus: input.healthStatus,
          nextAction:
            input.nextAction !== undefined ? normalizeNullableText(input.nextAction) : undefined,
        },
      });

      return c.json(updated ?? existing);
    },
  )
  .get("/organizations/:id/requests", async (c) => {
    const id = c.req.param("id");
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, id), eq(organization.type, "LAB")),
    });

    if (!org) {
      return c.json({ error: "Organização não encontrada" }, 404);
    }

    const requestsData = await listRequestsForOrganization(org.id);

    return c.json({
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
      operationalSummary: requestsData.operationalSummary,
      data: requestsData.requests,
    });
  })
  .post(
    "/requests/:id/assign",
    zValidator("json", AssignSupportRequestSchema),
    async (c) => {
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!Number.isInteger(id)) {
        return c.json({ error: "Solicitação inválida" }, 400);
      }

      const existing = await db.query.organizationSupportRequest.findFirst({
        where: eq(organizationSupportRequest.id, id),
      });

      if (!existing) {
        return c.json({ error: "Solicitação não encontrada" }, 404);
      }

      const [updated] = await db
        .update(organizationSupportRequest)
        .set({
          assignedToUserId: input.assignedToUserId,
          firstResponseAt: existing.firstResponseAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(organizationSupportRequest.id, id))
        .returning();

      await touchSuccessProfile(existing.organizationId);

      await writeSupportRequestEvent({
        supportRequestId: id,
        organizationId: existing.organizationId,
        actorUserId: session.user.id,
        kind: "assigned",
        message: input.assignedToUserId
          ? "Solicitação atribuída a um operador interno"
          : "Solicitação desatribuída",
        details: {
          assignedToUserId: input.assignedToUserId,
        },
      });

      await writeOrganizationCustomerSuccessEvent({
        organizationId: existing.organizationId,
        actorUserId: session.user.id,
        action: "support_request.assigned",
        entityType: "organization_support_request",
        entityId: String(id),
        details: {
          assignedToUserId: input.assignedToUserId,
        },
      });

      return c.json(updated);
    },
  )
  .post(
    "/requests/:id/respond",
    zValidator("json", RespondSupportRequestSchema),
    async (c) => {
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!Number.isInteger(id)) {
        return c.json({ error: "Solicitação inválida" }, 400);
      }

      const existing = await db.query.organizationSupportRequest.findFirst({
        where: eq(organizationSupportRequest.id, id),
      });

      if (!existing) {
        return c.json({ error: "Solicitação não encontrada" }, 404);
      }

      const nextStatus =
        existing.status === "OPEN" ? "IN_PROGRESS" : existing.status;

      const [updated] = await db
        .update(organizationSupportRequest)
        .set({
          status: nextStatus,
          publicResponse: input.publicVisible ? input.message : existing.publicResponse,
          firstResponseAt: existing.firstResponseAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(organizationSupportRequest.id, id))
        .returning();

      await touchSuccessProfile(existing.organizationId);

      await writeSupportRequestEvent({
        supportRequestId: id,
        organizationId: existing.organizationId,
        actorUserId: session.user.id,
        kind: "public_reply",
        message: input.message,
        publicVisible: input.publicVisible,
      });

      await writeOrganizationCustomerSuccessEvent({
        organizationId: existing.organizationId,
        actorUserId: session.user.id,
        action: "support_request.responded",
        entityType: "organization_support_request",
        entityId: String(id),
        details: {
          publicVisible: input.publicVisible,
        },
      });

      return c.json(updated);
    },
  )
  .post(
    "/requests/:id/status",
    zValidator("json", UpdateSupportRequestStatusSchema),
    async (c) => {
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!Number.isInteger(id)) {
        return c.json({ error: "Solicitação inválida" }, 400);
      }

      const existing = await db.query.organizationSupportRequest.findFirst({
        where: eq(organizationSupportRequest.id, id),
      });

      if (!existing) {
        return c.json({ error: "Solicitação não encontrada" }, 404);
      }

      const [updated] = await db
        .update(organizationSupportRequest)
        .set({
          status: input.status,
          firstResponseAt: existing.firstResponseAt ?? new Date(),
          resolvedAt:
            input.status === "RESOLVED" || input.status === "CLOSED"
              ? new Date()
              : null,
          updatedAt: new Date(),
        })
        .where(eq(organizationSupportRequest.id, id))
        .returning();

      await touchSuccessProfile(existing.organizationId);

      await writeSupportRequestEvent({
        supportRequestId: id,
        organizationId: existing.organizationId,
        actorUserId: session.user.id,
        kind:
          input.status === "RESOLVED" || input.status === "CLOSED"
            ? "resolved"
            : "status_changed",
        message: `Status atualizado para ${input.status}`,
        details: {
          previousStatus: existing.status,
          nextStatus: input.status,
        },
      });

      await writeOrganizationCustomerSuccessEvent({
        organizationId: existing.organizationId,
        actorUserId: session.user.id,
        action: "support_request.status_updated",
        entityType: "organization_support_request",
        entityId: String(id),
        details: {
          previousStatus: existing.status,
          nextStatus: input.status,
        },
      });

      return c.json(updated);
    },
  );
