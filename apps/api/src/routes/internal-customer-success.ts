import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  organization,
  organizationSuccessProfile,
  organizationSupportRequest,
  organizationSupportRequestEvent,
  user,
} from "@calibra-facil/db/schema";
import { getOrganizationPlanAccess } from "../lib/organization-plan";
import {
  ensureSuccessProfile,
  writeOrganizationCustomerSuccessEvent,
  writeSupportRequestEvent,
} from "../lib/customer-success";
import {
  requireBackofficeAccess,
  requireLabAuth,
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

async function listRequestsForOrganization(organizationId: string) {
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

export const internalCustomerSuccessRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .use("*", requireLabAuth, requireBackofficeAccess)
  .get("/access", (c) => c.json({ allowed: true }))
  .get("/organizations", async (c) => {
    const rows = await db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        type: organization.type,
        successProfileId: organizationSuccessProfile.id,
        onboardingStatus: organizationSuccessProfile.onboardingStatus,
        migrationStatus: organizationSuccessProfile.migrationStatus,
        accountOwnerName: organizationSuccessProfile.accountOwnerName,
        accountOwnerEmail: organizationSuccessProfile.accountOwnerEmail,
        supportContactEmail: organizationSuccessProfile.supportContactEmail,
        goLiveTargetDate: organizationSuccessProfile.goLiveTargetDate,
        goLiveActualDate: organizationSuccessProfile.goLiveActualDate,
        updatedAt: organizationSuccessProfile.updatedAt,
      })
      .from(organization)
      .leftJoin(
        organizationSuccessProfile,
        eq(organizationSuccessProfile.organizationId, organization.id),
      )
      .where(eq(organization.type, "LAB"))
      .orderBy(asc(organization.name));

    return c.json({ data: rows });
  })
  .get("/organizations/:id/profile", async (c) => {
    const id = c.req.param("id");
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, id), eq(organization.type, "LAB")),
    });

    if (!org) {
      return c.json({ error: "Organização não encontrada" }, 404);
    }

    const profile = await ensureSuccessProfile(org.id);
    const planAccess = await getOrganizationPlanAccess(org.id);

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
          onboardingStatus: input.onboardingStatus ?? existing.onboardingStatus,
          migrationStatus: input.migrationStatus ?? existing.migrationStatus,
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
          onboardingStatus: input.onboardingStatus,
          migrationStatus: input.migrationStatus,
          accountOwnerEmail:
            input.accountOwnerEmail !== undefined
              ? normalizeNullableText(input.accountOwnerEmail)
              : undefined,
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

    return c.json({
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
      data: await listRequestsForOrganization(org.id),
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
