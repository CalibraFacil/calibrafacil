import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  integrationEventLog,
  integrationSyncRun,
  organizationIntegration,
  integrationConnection,
} from "@calibra-facil/db/schema";
import { normalizeIntegrationBaseUrl } from "@calibra-facil/shared";
import { getOrganizationPlanAccess } from "../lib/organization-plan";
import {
  buildGenericConnectionConfig,
  createSyncRun,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  failIntegrationSyncRun,
  getIntegrationRecord,
  listOrganizationIntegrations,
  runIntegrationSync,
  validateGenericConnection,
  writeIntegrationEvent,
  writeOrganizationIntegrationEvent,
  type IntegrationsEnv,
} from "../lib/integrations";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
} from "../middleware/permission";
import { requireFeature } from "../middleware/tier-guard";

const BaseUrlSchema = z.string().trim().url().transform((value, ctx) => {
  try {
    return normalizeIntegrationBaseUrl(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Base URL inválida",
    });
    return z.NEVER;
  }
});

const IntegrationBodySchema = z.object({
  name: z.string().trim().min(3).max(80),
  baseUrl: BaseUrlSchema,
  authToken: z.string().trim().min(8),
  healthPath: z.string().trim().optional(),
  customerPath: z.string().trim().optional(),
  serviceOrderPath: z.string().trim().optional(),
  billingDocumentPath: z.string().trim().optional(),
});

const UpdateIntegrationBodySchema = z.object({
  name: z.string().trim().min(3).max(80).optional(),
  baseUrl: BaseUrlSchema.optional(),
  authToken: z.string().trim().min(8).optional(),
  healthPath: z.string().trim().optional(),
  customerPath: z.string().trim().optional(),
  serviceOrderPath: z.string().trim().optional(),
  billingDocumentPath: z.string().trim().optional(),
});

const SyncRequestSchema = z.object({
  target: z.enum(["customer", "service_order", "billing_document"]),
  limit: z.coerce.number().min(1).max(250).default(50),
});

const ToggleSchema = z.object({
  enabled: z.boolean(),
});

type QueueMessage = {
  type: "INTEGRATION_SYNC";
  integrationId: string;
  organizationId: string;
  runId: string;
  target: "customer" | "service_order" | "billing_document";
  limit: number;
};

type IntegrationsBindings = IntegrationsEnv & {
  PDF_QUEUE?: {
    send: (body: QueueMessage) => Promise<void>;
  };
};

async function buildListPayload(organizationId: string) {
  const billing = await getOrganizationPlanAccess(organizationId);
  const integrations = await listOrganizationIntegrations(organizationId);

  const data = await Promise.all(
    integrations.map(async (integration) => {
      const recentRuns = await db.query.integrationSyncRun.findMany({
        where: eq(integrationSyncRun.integrationId, integration.id),
        orderBy: [desc(integrationSyncRun.createdAt)],
        limit: 5,
      });

      const recentEvents = await db.query.integrationEventLog.findMany({
        where: eq(integrationEventLog.integrationId, integration.id),
        orderBy: [desc(integrationEventLog.createdAt)],
        limit: 5,
      });

      return {
        id: integration.id,
        type: integration.type,
        provider: integration.provider,
        name: integration.name,
        status: integration.status,
        lastValidatedAt: integration.lastValidatedAt,
        lastValidationError: integration.lastValidationError,
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt,
        connection: {
          id: integration.connection?.id ?? null,
          credentialType: integration.connection?.credentialType ?? "bearer",
          config: integration.connection?.config ?? null,
        },
        recentRuns,
        recentEvents,
      };
    }),
  );

  return {
    billing: {
      planId: billing.planId,
      planName: billing.planName,
      status: billing.status,
      hasCustomIntegrations: billing.entitlements.includes("custom_integrations"),
    },
    data,
  };
}

export const integrationsRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: IntegrationsBindings;
}>()
  .get(
    "/",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      return c.json(await buildListPayload(member.organizationId));
    },
  )
  .post(
    "/",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    requireFeature("custom_integrations"),
    zValidator("json", IntegrationBodySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");
      const config = buildGenericConnectionConfig(input);
      const encrypted = encryptIntegrationSecret(input.authToken, c.env);
      const integrationId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();

      await db.transaction(async (tx) => {
        await tx.insert(organizationIntegration).values({
          id: integrationId,
          organizationId: member.organizationId,
          type: "financial_erp",
          provider: "generic_http",
          name: input.name,
          status: "ACTIVE",
          createdBy: session.user.id,
          updatedBy: session.user.id,
        });

        await tx.insert(integrationConnection).values({
          id: connectionId,
          integrationId,
          organizationId: member.organizationId,
          credentialType: "bearer",
          config,
          encryptedSecret: encrypted.encryptedSecret,
          secretIv: encrypted.secretIv,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        });
      });

      await writeIntegrationEvent({
        integrationId,
        organizationId: member.organizationId,
        level: "info",
        event: "integration.created",
        message: "Integração criada",
        details: {
          provider: "generic_http",
          type: "financial_erp",
          name: input.name,
        },
      });

      await writeOrganizationIntegrationEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "integration.created",
        entityId: integrationId,
        details: {
          provider: "generic_http",
          type: "financial_erp",
          name: input.name,
        },
      });

      return c.json(await buildListPayload(member.organizationId), 201);
    },
  )
  .put(
    "/:id",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    requireFeature("custom_integrations"),
    zValidator("json", UpdateIntegrationBodySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      const mergedConfig = buildGenericConnectionConfig({
        baseUrl: input.baseUrl ?? record.connection.config.baseUrl,
        healthPath: input.healthPath ?? record.connection.config.healthPath,
        customerPath:
          input.customerPath ?? record.connection.config.customerPath,
        serviceOrderPath:
          input.serviceOrderPath ?? record.connection.config.serviceOrderPath,
        billingDocumentPath:
          input.billingDocumentPath ??
          record.connection.config.billingDocumentPath,
      });

      await db.transaction(async (tx) => {
        await tx
          .update(organizationIntegration)
          .set({
            name: input.name ?? record.integration.name,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(organizationIntegration.id, id));

        const connectionUpdate: Partial<
          typeof integrationConnection.$inferInsert
        > = {
          config: mergedConfig,
          updatedBy: session.user.id,
          updatedAt: new Date(),
        };

        if (input.authToken) {
          const encrypted = encryptIntegrationSecret(input.authToken, c.env);
          connectionUpdate.encryptedSecret = encrypted.encryptedSecret;
          connectionUpdate.secretIv = encrypted.secretIv;
        }

        await tx
          .update(integrationConnection)
          .set(connectionUpdate)
          .where(eq(integrationConnection.integrationId, id));
      });

      await writeIntegrationEvent({
        integrationId: id,
        organizationId: member.organizationId,
        level: "info",
        event: "integration.updated",
        message: "Integração atualizada",
      });

      await writeOrganizationIntegrationEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "integration.updated",
        entityId: id,
      });

      return c.json(await buildListPayload(member.organizationId));
    },
  )
  .post(
    "/:id/validate",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    requireFeature("custom_integrations"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      try {
        const secret = decryptIntegrationSecret(
          record.connection.encryptedSecret,
          record.connection.secretIv,
          c.env,
        );

        await validateGenericConnection(record.connection.config, secret);

        await db
          .update(organizationIntegration)
          .set({
            lastValidatedAt: new Date(),
            lastValidationError: null,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(organizationIntegration.id, id));

        await writeIntegrationEvent({
          integrationId: id,
          organizationId: member.organizationId,
          level: "info",
          event: "integration.validation_succeeded",
          message: "Conexão validada com sucesso",
        });

        await writeOrganizationIntegrationEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "integration.validated",
          entityId: id,
        });

        return c.json({ success: true });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Falha ao validar conexão";

        await db
          .update(organizationIntegration)
          .set({
            lastValidationError: message,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(organizationIntegration.id, id));

        await writeIntegrationEvent({
          integrationId: id,
          organizationId: member.organizationId,
          level: "error",
          event: "integration.validation_failed",
          message,
        });

        return c.json({ error: message }, 400);
      }
    },
  )
  .post(
    "/:id/sync",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    requireFeature("custom_integrations"),
    zValidator("json", SyncRequestSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      if (record.integration.status !== "ACTIVE") {
        return c.json({ error: "Integração desativada" }, 409);
      }

      const runId = await createSyncRun({
        integrationId: id,
        organizationId: member.organizationId,
        trigger: "manual",
        target: input.target,
        initiatedBy: session.user.id,
      });

      await writeIntegrationEvent({
        integrationId: id,
        organizationId: member.organizationId,
        runId,
        level: "info",
        event: "sync.requested",
        message: "Sincronização solicitada",
        details: {
          target: input.target,
          limit: input.limit,
        },
      });

      if (c.env.PDF_QUEUE) {
        try {
          await c.env.PDF_QUEUE.send({
            type: "INTEGRATION_SYNC",
            integrationId: id,
            organizationId: member.organizationId,
            runId,
            target: input.target,
            limit: input.limit,
          });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Falha ao enfileirar sincronização";

          await failIntegrationSyncRun({
            integrationId: id,
            organizationId: member.organizationId,
            runId,
            target: input.target,
            message,
            details: {
              phase: "queue_send",
            },
          });

          return c.json({ error: message }, 500);
        }

        return c.json({
          success: true,
          queued: true,
          runId,
          status: "PENDING",
        });
      }

      let result;
      try {
        result = await runIntegrationSync({
          integrationId: id,
          organizationId: member.organizationId,
          runId,
          target: input.target,
          limit: input.limit,
          env: c.env,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao processar sincronização";
        return c.json({ error: message }, 500);
      }

      return c.json({
        success: true,
        queued: false,
        runId,
        status: result.status,
      });
    },
  )
  .post(
    "/:id/toggle",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    requireFeature("custom_integrations"),
    zValidator("json", ToggleSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      await db
        .update(organizationIntegration)
        .set({
          status: input.enabled ? "ACTIVE" : "DISABLED",
          disabledAt: input.enabled ? null : new Date(),
          updatedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(organizationIntegration.id, id));

      await writeIntegrationEvent({
        integrationId: id,
        organizationId: member.organizationId,
        level: "info",
        event: input.enabled ? "integration.enabled" : "integration.disabled",
        message: input.enabled ? "Integração ativada" : "Integração desativada",
      });

      return c.json(await buildListPayload(member.organizationId));
    },
  )
  .get(
    "/:id/runs",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const id = c.req.param("id");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      const runs = await db.query.integrationSyncRun.findMany({
        where: and(
          eq(integrationSyncRun.integrationId, id),
          eq(integrationSyncRun.organizationId, member.organizationId),
        ),
        orderBy: [desc(integrationSyncRun.createdAt)],
        limit: 20,
      });

      return c.json({ data: runs });
    },
  )
  .get(
    "/:id/events",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const id = c.req.param("id");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      const events = await db.query.integrationEventLog.findMany({
        where: and(
          eq(integrationEventLog.integrationId, id),
          eq(integrationEventLog.organizationId, member.organizationId),
        ),
        orderBy: [desc(integrationEventLog.createdAt)],
        limit: 30,
      });

      return c.json({ data: events });
    },
  );
