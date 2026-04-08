import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  organizationSupportRequest,
  organizationSupportRequestEvent,
  user,
} from "@calibra-facil/db/schema";
import { getOrganizationPlanAccess } from "../lib/organization-plan";
import {
  calculateSlaTargetAt,
  ensureSuccessProfile,
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

async function listSupportRequests(organizationId: string, publicOnly: boolean) {
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
      publicOnly ? eq(organizationSupportRequestEvent.publicVisible, true) : undefined,
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
    events: eventsByRequest.get(request.id) ?? [],
  }));
}

export const customerSuccessRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", ...requireLabProtected, requireOrgType("LAB"))
  .get("/profile", async (c) => {
    const member = c.get("member");
    const planAccess = await getOrganizationPlanAccess(member.organizationId);
    const profile = await ensureSuccessProfile(member.organizationId);

    return c.json({
      profile,
      supportPolicy: planAccess.supportPolicy,
      plan: {
        id: planAccess.planId,
        name: planAccess.planName,
        status: planAccess.status,
      },
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
            planAccess.supportPolicy.targetFirstResponseBusinessHours,
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
