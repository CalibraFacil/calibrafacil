import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  publicApiWebhookDelivery,
  publicApiWebhookSubscription,
} from "@calibra-facil/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { buildPublicApiError, createWebhookSecret } from "../../lib/public-api";
import {
  emitPublicApiWebhookEvent,
  mapWebhookDelivery,
  replayPublicApiWebhookDelivery,
} from "../../lib/public-api-webhooks";
import { requireApiScope } from "../../middleware/api-key-auth";
import { type PublicApiV2Env } from "./env";
import { WebhookSubscriptionSchema } from "./schemas";
import { withIdempotentMutation } from "./idempotency";
import { orgDb } from "../../lib/org-db";

function mapWebhookSubscription(
  record: typeof publicApiWebhookSubscription.$inferSelect,
) {
  return {
    id: record.id,
    name: record.name,
    targetUrl: record.targetUrl,
    events: record.events,
    status: record.status,
    secretPrefix: record.secretPrefix,
    lastSuccessAt: record.lastSuccessAt,
    lastFailureAt: record.lastFailureAt,
    consecutiveFailures: record.consecutiveFailures,
    disabledAt: record.disabledAt,
    disabledReason: record.disabledReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export const webhookRoutes = new Hono<PublicApiV2Env>()
  .get("/webhooks", requireApiScope("webhooks:manage"), async (c) => {
    const apiKey = c.get("apiKey");
    const subscriptions = await orgDb(apiKey.organizationId).transaction((o) =>
      o
        .select()
        .from(publicApiWebhookSubscription)
        .where(
          eq(
            publicApiWebhookSubscription.organizationId,
            apiKey.organizationId,
          ),
        )
        .orderBy(desc(publicApiWebhookSubscription.createdAt)),
    );
    return c.json({ data: subscriptions.map(mapWebhookSubscription) });
  })
  .post(
    "/webhooks",
    requireApiScope("webhooks:manage"),
    zValidator("json", WebhookSubscriptionSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");

      return withIdempotentMutation(c, input, async ({ o }) => {
        const secret = createWebhookSecret(c.env);
        const [created] = await o
          .insert(publicApiWebhookSubscription)
          .values({
            id: crypto.randomUUID(),
            organizationId: apiKey.organizationId,
            name: input.name,
            targetUrl: input.targetUrl,
            events: input.events,
            status: input.status ?? "ACTIVE",
            secretPrefix: secret.prefix,
            encryptedSecret: secret.encryptedSecret,
            secretIv: secret.secretIv,
            createdBy: apiKey.createdBy,
          })
          .returning();

        return {
          status: 201,
          body: {
            data: mapWebhookSubscription(created!),
            secret: secret.raw,
          },
        };
      });
    },
  )
  .patch(
    "/webhooks/:id",
    requireApiScope("webhooks:manage"),
    zValidator("json", WebhookSubscriptionSchema.partial()),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const [existing] = await orgDb(apiKey.organizationId).transaction((o) =>
        o
          .select()
          .from(publicApiWebhookSubscription)
          .where(
            and(
              eq(publicApiWebhookSubscription.id, c.req.param("id")),
              eq(
                publicApiWebhookSubscription.organizationId,
                apiKey.organizationId,
              ),
            ),
          )
          .limit(1),
      );

      if (!existing) {
        return c.json(
          buildPublicApiError({
            code: "webhook_not_found",
            message: "Webhook não encontrado",
          }),
          404,
        );
      }

      const [updated] = await orgDb(apiKey.organizationId).transaction((o) =>
        o
          .update(publicApiWebhookSubscription)
          .set({
            name: input.name ?? existing.name,
            targetUrl: input.targetUrl ?? existing.targetUrl,
            events: input.events ?? existing.events,
            status: input.status ?? existing.status,
            // Switching it on again clears why it was switched off and the
            // failure streak that did it.
            ...(input.status === "ACTIVE" && existing.status !== "ACTIVE"
              ? {
                  disabledAt: null,
                  disabledReason: null,
                  consecutiveFailures: 0,
                }
              : {}),
            updatedBy: apiKey.createdBy,
          })
          .where(eq(publicApiWebhookSubscription.id, existing.id))
          .returning(),
      );

      return c.json({ data: mapWebhookSubscription(updated!) });
    },
  )
  .delete("/webhooks/:id", requireApiScope("webhooks:manage"), async (c) => {
    const apiKey = c.get("apiKey");
    return withIdempotentMutation(
      c,
      { id: c.req.param("id") },
      async ({ o }) => {
        const [existing] = await o
          .select()
          .from(publicApiWebhookSubscription)
          .where(
            and(
              eq(publicApiWebhookSubscription.id, c.req.param("id")),
              eq(
                publicApiWebhookSubscription.organizationId,
                apiKey.organizationId,
              ),
            ),
          )
          .limit(1);

        if (!existing) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "webhook_not_found",
              message: "Webhook não encontrado",
            }),
          };
        }

        await o
          .delete(publicApiWebhookSubscription)
          .where(eq(publicApiWebhookSubscription.id, existing.id));
        return {
          status: 200,
          body: { data: { id: existing.id, deleted: true } },
        };
      },
    );
  })
  .post("/webhooks/:id/test", requireApiScope("webhooks:manage"), async (c) => {
    const apiKey = c.get("apiKey");
    const [existing] = await orgDb(apiKey.organizationId).transaction((o) =>
      o
        .select()
        .from(publicApiWebhookSubscription)
        .where(
          and(
            eq(publicApiWebhookSubscription.id, c.req.param("id")),
            eq(
              publicApiWebhookSubscription.organizationId,
              apiKey.organizationId,
            ),
          ),
        )
        .limit(1),
    );

    if (!existing) {
      return c.json(
        buildPublicApiError({
          code: "webhook_not_found",
          message: "Webhook não encontrado",
        }),
        404,
      );
    }

    await emitPublicApiWebhookEvent({
      organizationId: apiKey.organizationId,
      eventType: existing.events[0] ?? "customer.created",
      payload: {
        test: true,
        subscriptionId: existing.id,
      },
    });

    return c.json({ data: { id: existing.id, tested: true } });
  })
  .get(
    "/webhooks/:id/deliveries",
    requireApiScope("webhooks:manage"),
    async (c) => {
      const apiKey = c.get("apiKey");
      const deliveries = await orgDb(apiKey.organizationId).transaction((o) =>
        o
          .select()
          .from(publicApiWebhookDelivery)
          .where(
            and(
              eq(publicApiWebhookDelivery.subscriptionId, c.req.param("id")),
              eq(
                publicApiWebhookDelivery.organizationId,
                apiKey.organizationId,
              ),
            ),
          )
          .orderBy(desc(publicApiWebhookDelivery.createdAt))
          .limit(50),
      );
      return c.json({ data: deliveries.map(mapWebhookDelivery) });
    },
  )
  .post(
    "/webhooks/:id/deliveries/:deliveryId/replay",
    requireApiScope("webhooks:manage"),
    async (c) => {
      const apiKey = c.get("apiKey");
      const replay = await replayPublicApiWebhookDelivery({
        organizationId: apiKey.organizationId,
        subscriptionId: c.req.param("id"),
        deliveryId: c.req.param("deliveryId"),
      });

      if (!replay) {
        return c.json(
          buildPublicApiError({
            code: "webhook_delivery_not_found",
            message: "Entrega não encontrada",
          }),
          404,
        );
      }

      return c.json({ data: mapWebhookDelivery(replay) });
    },
  );
