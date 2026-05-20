import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  organizationSuccessProfile,
  organizationSupportRequest,
  organizationSupportRequestEvent,
  user,
} from "@calibra-facil/db/schema";
import { getOrganizationPlanAccess } from "../lib/organization-plan";
import {
  buildCustomerSuccessWorkflow,
  calculateSlaTargetAt,
  deriveDefaultSlaTier,
  deriveGoLiveStatus,
  deriveHealthStatus,
  deriveNextActionStatus,
  emitCustomerSuccessAutomationSignals,
  ensureSuccessProfile,
  getCustomerSuccessAutomationSnapshot,
  getActiveCustomerSuccessBlockers,
  getSupportRequestSlaStatus,
  resolveDueSoonThresholdHours,
  resolveEffectiveSlaHours,
  writeOrganizationCustomerSuccessEvent,
  writeSupportRequestEvent,
} from "../lib/customer-success";
import {
  requireLabProtected,
  requireOrgType,
  type AuthVariables,
} from "../middleware/permission";

const CreateSupportRequestSchema = z.object({
  category: z.enum([
    "GENERAL",
    "TRAINING",
    "MIGRATION",
    "INTEGRATION",
    "BILLING",
    "INCIDENT",
  ]),
  subject: z.string().trim().min(5).max(160),
  description: z.string().trim().min(10).max(4000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
});

async function listSupportRequests(
  organizationId: string,
  publicOnly: boolean,
) {
  const [profile, planAccess] = await Promise.all([
    ensureSuccessProfile(organizationId),
    getOrganizationPlanAccess(organizationId),
  ]);
  const effectiveSlaTier =
    profile.slaTier === "PLAN_DEFAULT"
      ? deriveDefaultSlaTier(planAccess.supportPolicy)
      : profile.slaTier;
  const dueSoonThresholdHours = resolveDueSoonThresholdHours(
    resolveEffectiveSlaHours(
      planAccess.supportPolicy.targetFirstResponseBusinessHours,
      effectiveSlaTier,
    ),
  );
  const requests = await db.query.organizationSupportRequest.findMany({
    where: eq(organizationSupportRequest.organizationId, organizationId),
    with: {
      requestedByUser: true,
      assignedToUser: true,
    },
    orderBy: [desc(organizationSupportRequest.createdAt)],
  });

  if (requests.length === 0) {
    return [];
  }

  const events = await db.query.organizationSupportRequestEvent.findMany({
    where: and(
      eq(organizationSupportRequestEvent.organizationId, organizationId),
      inArray(
        organizationSupportRequestEvent.supportRequestId,
        requests.map((request) => request.id),
      ),
      publicOnly
        ? eq(organizationSupportRequestEvent.publicVisible, true)
        : undefined,
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

  return requests.map((request) => ({
    ...request,
    slaStatus: getSupportRequestSlaStatus({
      status: request.status,
      slaTargetAt: request.slaTargetAt,
      dueSoonThresholdHours,
    }),
    timeToSlaMs: request.slaTargetAt
      ? request.slaTargetAt.getTime() - Date.now()
      : null,
    prioritySupport:
      profile.prioritySupport ||
      effectiveSlaTier !== "PLAN_DEFAULT" ||
      planAccess.supportPolicy.hasPrioritySupport,
    events: eventsByRequest.get(request.id) ?? [],
  }));
}

export const customerSuccessRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", ...requireLabProtected, requireOrgType("LAB"))
  .get("/profile", async (c) => {
    const member = c.get("member");
    const [planAccess, profile, requests] = await Promise.all([
      getOrganizationPlanAccess(member.organizationId),
      ensureSuccessProfile(member.organizationId),
      listSupportRequests(member.organizationId, true),
    ]);
    const goLiveStatus = deriveGoLiveStatus({
      currentStatus: profile.goLiveStatus,
      goLiveActualDate: profile.goLiveActualDate,
      goLiveTargetDate: profile.goLiveTargetDate,
    });
    const nextActionStatus = deriveNextActionStatus({
      nextAction: profile.nextAction,
      nextActionDueAt: profile.nextActionDueAt,
      nextActionCompletedAt: profile.nextActionCompletedAt,
    });
    const openRequests = requests.filter(
      (request) =>
        request.status === "OPEN" ||
        request.status === "IN_PROGRESS" ||
        request.status === "WAITING_ON_CUSTOMER",
    );
    const effectiveSlaTier =
      profile.slaTier === "PLAN_DEFAULT"
        ? deriveDefaultSlaTier(planAccess.supportPolicy)
        : profile.slaTier;
    const prioritySupport =
      profile.prioritySupport ||
      effectiveSlaTier !== "PLAN_DEFAULT" ||
      planAccess.supportPolicy.hasPrioritySupport;
    const healthStatus = deriveHealthStatus({
      currentStatus: profile.healthStatus,
      onboardingStatus: profile.onboardingStatus,
      migrationStatus: profile.migrationStatus,
      goLiveStatus,
      breachedRequestsCount: openRequests.filter(
        (request) => request.slaStatus === "BREACHED",
      ).length,
      dueSoonRequestsCount: openRequests.filter(
        (request) => request.slaStatus === "DUE_SOON",
      ).length,
    });
    const workflow = buildCustomerSuccessWorkflow({
      supportPolicy: planAccess.supportPolicy,
      effectiveSlaTier,
      prioritySupport,
      onboardingStatus: profile.onboardingStatus,
      migrationStatus: profile.migrationStatus,
      goLiveStatus,
      nextActionStatus,
      nextAction: profile.nextAction,
      internalOwnerUserId: profile.internalOwnerUserId,
      blockers: profile.blockers,
      openRequestsCount: openRequests.length,
      dueSoonRequestsCount: openRequests.filter(
        (request) => request.slaStatus === "DUE_SOON",
      ).length,
      breachedRequestsCount: openRequests.filter(
        (request) => request.slaStatus === "BREACHED",
      ).length,
      escalatedRequestsCount: openRequests.filter(
        (request) => request.escalatedAt !== null,
      ).length,
    });

    return c.json({
      profile: {
        ...profile,
        goLiveStatus,
      },
      publicSummary: {
        healthStatus,
        onboardingStatus: profile.onboardingStatus,
        migrationStatus: profile.migrationStatus,
        goLiveStatus,
        nextActionStatus,
        hasActiveBlockers:
          getActiveCustomerSuccessBlockers(profile.blockers).length > 0,
      },
      supportPolicy: planAccess.supportPolicy,
      plan: {
        id: planAccess.planId,
        name: planAccess.planName,
        status: planAccess.status,
      },
      workflow,
      workflowWarnings: workflow.warnings,
      workflowViolations: workflow.violations,
      policy: workflow.policy,
    });
  })
  .get("/support-policy", async (c) => {
    const member = c.get("member");
    const planAccess = await getOrganizationPlanAccess(member.organizationId);

    return c.json({
      planId: planAccess.planId,
      planName: planAccess.planName,
      status: planAccess.status,
      supportPolicy: planAccess.supportPolicy,
    });
  })
  .get("/requests", async (c) => {
    const member = c.get("member");
    return c.json({
      data: await listSupportRequests(member.organizationId, true),
    });
  })
  .post(
    "/requests",
    zValidator("json", CreateSupportRequestSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");
      const planAccess = await getOrganizationPlanAccess(member.organizationId);
      const profile = await ensureSuccessProfile(member.organizationId);
      const previousAutomation = await getCustomerSuccessAutomationSnapshot(
        member.organizationId,
      );
      const effectiveSlaTier =
        profile.slaTier === "PLAN_DEFAULT"
          ? deriveDefaultSlaTier(planAccess.supportPolicy)
          : profile.slaTier;

      const [created] = await db
        .insert(organizationSupportRequest)
        .values({
          organizationId: member.organizationId,
          requestedByUserId: session.user.id,
          category: input.category,
          priority: input.priority,
          status: "OPEN",
          subject: input.subject,
          description: input.description,
          slaTargetAt: calculateSlaTargetAt(
            resolveEffectiveSlaHours(
              planAccess.supportPolicy.targetFirstResponseBusinessHours,
              effectiveSlaTier,
            ),
          ),
        })
        .returning();

      if (!created) {
        return c.json({ error: "Falha ao abrir solicitação" }, 500);
      }

      await writeSupportRequestEvent({
        supportRequestId: created.id,
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        kind: "created",
        message: "Solicitação aberta pelo laboratório",
        publicVisible: true,
        details: {
          category: input.category,
          priority: input.priority,
          subject: input.subject,
        },
      });

      await writeOrganizationCustomerSuccessEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "support_request.created",
        entityType: "organization_support_request",
        entityId: String(created.id),
        details: {
          category: input.category,
          priority: input.priority,
          subject: input.subject,
        },
      });

      const nextAutomation = await getCustomerSuccessAutomationSnapshot(
        member.organizationId,
      );
      await emitCustomerSuccessAutomationSignals({
        organizationId: member.organizationId,
        previous: previousAutomation,
        next: nextAutomation,
        actorUserId: session.user.id,
      });

      await db
        .update(organizationSuccessProfile)
        .set({
          lastTouchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          eq(organizationSuccessProfile.organizationId, member.organizationId),
        );

      const [requester] = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
        })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1);

      return c.json(
        {
          ...created,
          requestedByUser: requester ?? null,
          assignedToUser: null,
          slaStatus: "ON_TRACK",
          timeToSlaMs: created.slaTargetAt
            ? created.slaTargetAt.getTime() - Date.now()
            : null,
          prioritySupport:
            profile.prioritySupport ||
            effectiveSlaTier !== "PLAN_DEFAULT" ||
            planAccess.supportPolicy.hasPrioritySupport,
          events: [
            {
              kind: "created",
              message: "Solicitação aberta pelo laboratório",
              publicVisible: true,
              actorUser: requester ?? null,
              createdAt: new Date(),
            },
          ],
        },
        201,
      );
    },
  );
