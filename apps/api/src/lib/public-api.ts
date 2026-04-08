import {
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { db } from "@calibra-facil/db";
import {
  organizationApiKey,
  organizationUnit,
  publicApiIdempotencyKey,
  publicApiResourceRef,
  publicApiWebhookDelivery,
  publicApiWebhookSubscription,
} from "@calibra-facil/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  PUBLIC_API_WEBHOOK_EVENTS,
  type PublicApiResourceType,
  type PublicApiWebhookEvent,
} from "@calibra-facil/shared";
import {
  decryptPassword,
  encryptPassword,
} from "@calibra-facil/signing";

const DEFAULT_IDEMPOTENCY_TTL_DAYS = 7;

export interface PublicApiEnv {
  PUBLIC_API_MASTER_KEY?: string;
  INTEGRATIONS_MASTER_KEY?: string;
}

export function getPublicApiRequestIp(headers: Headers) {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    null
  );
}

export function buildPublicApiError(params: {
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
}) {
  return {
    error: {
      code: params.code,
      message: params.message,
      details: params.details ?? null,
    },
  };
}

export function buildListMeta(params: {
  page: number;
  limit: number;
  total: number;
  filters?: Record<string, unknown>;
}) {
  return {
    page: params.page,
    limit: params.limit,
    total: params.total,
    hasNextPage: params.page * params.limit < params.total,
    filters: params.filters ?? {},
  };
}

export function normalizeExternalId(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function getIdempotencyKey(headers: Headers) {
  return headers.get("idempotency-key")?.trim() ?? null;
}

export function hashIdempotencyPayload(input: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(input ?? null))
    .digest("hex");
}

function getWebhookMasterKey(env: PublicApiEnv) {
  const key = env.PUBLIC_API_MASTER_KEY ?? env.INTEGRATIONS_MASTER_KEY;
  if (!key) {
    throw new Error("PUBLIC_API_MASTER_KEY não configurada");
  }

  return key;
}

export function createWebhookSecret(env: PublicApiEnv) {
  const raw = `whsec_${randomBytes(24).toString("base64url")}`;
  const encrypted = encryptPassword(raw, getWebhookMasterKey(env));

  return {
    raw,
    prefix: raw.slice(0, 12),
    encryptedSecret: encrypted.encryptedPassword,
    secretIv: encrypted.iv,
  };
}

export function decryptWebhookSecret(
  encryptedSecret: string,
  secretIv: string,
  env: PublicApiEnv,
) {
  return decryptPassword(encryptedSecret, secretIv, getWebhookMasterKey(env));
}

export function signWebhookPayload(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function getResourceExternalId(params: {
  organizationId: string;
  resourceType: PublicApiResourceType;
  resourceId: string | number;
}) {
  const ref = await db.query.publicApiResourceRef.findFirst({
    where: and(
      eq(publicApiResourceRef.organizationId, params.organizationId),
      eq(publicApiResourceRef.resourceType, params.resourceType),
      eq(publicApiResourceRef.resourceId, String(params.resourceId)),
    ),
  });

  return ref?.externalId ?? null;
}

export async function getResourceExternalIdMap(params: {
  organizationId: string;
  resourceType: PublicApiResourceType;
  resourceIds: Array<string | number>;
}) {
  const ids = Array.from(
    new Set(
      params.resourceIds
        .map((value) => String(value))
        .filter((value) => value.length > 0),
    ),
  );

  if (ids.length === 0) {
    return new Map<string, string>();
  }

  const refs = await db
    .select({
      resourceId: publicApiResourceRef.resourceId,
      externalId: publicApiResourceRef.externalId,
    })
    .from(publicApiResourceRef)
    .where(
      and(
        eq(publicApiResourceRef.organizationId, params.organizationId),
        eq(publicApiResourceRef.resourceType, params.resourceType),
        inArray(publicApiResourceRef.resourceId, ids),
      ),
    );

  return new Map(refs.map((ref) => [ref.resourceId, ref.externalId]));
}

export async function upsertResourceExternalId(params: {
  organizationId: string;
  apiKeyId?: string | null;
  resourceType: PublicApiResourceType;
  resourceId: string | number;
  externalId: string;
}) {
  await db
    .insert(publicApiResourceRef)
    .values({
      id: crypto.randomUUID(),
      organizationId: params.organizationId,
      resourceType: params.resourceType,
      resourceId: String(params.resourceId),
      externalId: params.externalId,
      createdByApiKeyId: params.apiKeyId ?? null,
    })
    .onConflictDoUpdate({
      target: [
        publicApiResourceRef.organizationId,
        publicApiResourceRef.resourceType,
        publicApiResourceRef.resourceId,
      ],
      set: {
        externalId: params.externalId,
        updatedAt: new Date(),
      },
    });
}

export async function findIdempotencyRecord(params: {
  organizationId: string;
  apiKeyId: string;
  requestMethod: string;
  requestPath: string;
  idempotencyKey: string;
}) {
  return db.query.publicApiIdempotencyKey.findFirst({
    where: and(
      eq(publicApiIdempotencyKey.organizationId, params.organizationId),
      eq(publicApiIdempotencyKey.apiKeyId, params.apiKeyId),
      eq(publicApiIdempotencyKey.requestMethod, params.requestMethod),
      eq(publicApiIdempotencyKey.requestPath, params.requestPath),
      eq(publicApiIdempotencyKey.idempotencyKey, params.idempotencyKey),
    ),
  });
}

export async function storeIdempotencyRecord(params: {
  organizationId: string;
  apiKeyId: string;
  requestMethod: string;
  requestPath: string;
  idempotencyKey: string;
  requestHash: string;
  responseStatus: number;
  responseBody: Record<string, unknown>;
  resourceType?: PublicApiResourceType;
  resourceId?: string | number | null;
}) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + DEFAULT_IDEMPOTENCY_TTL_DAYS);

  await db.insert(publicApiIdempotencyKey).values({
    id: crypto.randomUUID(),
    organizationId: params.organizationId,
    apiKeyId: params.apiKeyId,
    requestMethod: params.requestMethod,
    requestPath: params.requestPath,
    idempotencyKey: params.idempotencyKey,
    requestHash: params.requestHash,
    responseStatus: params.responseStatus,
    responseBody: params.responseBody,
    resourceType: params.resourceType ?? null,
    resourceId: params.resourceId ? String(params.resourceId) : null,
    expiresAt,
  });
}

export async function listAccessibleUnits(organizationId: string) {
  return db
    .select({
      id: organizationUnit.id,
      name: organizationUnit.name,
      slug: organizationUnit.slug,
      isDefault: organizationUnit.isDefault,
    })
    .from(organizationUnit)
    .where(
      and(
        eq(organizationUnit.organizationId, organizationId),
        eq(organizationUnit.status, "ACTIVE"),
      ),
    )
    .orderBy(organizationUnit.name);
}

export async function resolvePublicApiUnitScope(params: {
  organizationId: string;
  requestedUnitId?: number | null;
}) {
  const units = await listAccessibleUnits(params.organizationId);

  if (params.requestedUnitId == null) {
    return {
      availableUnits: units,
      selectedUnitId: null,
      selectedUnits: units,
    };
  }

  const selectedUnit = units.find((unit) => unit.id === params.requestedUnitId);
  if (!selectedUnit) {
    throw new Error("Unidade fora do escopo permitido");
  }

  return {
    availableUnits: units,
    selectedUnitId: selectedUnit.id,
    selectedUnits: [selectedUnit],
  };
}

export async function emitPublicApiWebhookEvent(params: {
  organizationId: string;
  eventType: PublicApiWebhookEvent;
  payload: Record<string, unknown>;
  env: PublicApiEnv;
}) {
  if (!PUBLIC_API_WEBHOOK_EVENTS.includes(params.eventType)) {
    return;
  }

  const subscriptions = await db
    .select()
    .from(publicApiWebhookSubscription)
    .where(
      and(
        eq(publicApiWebhookSubscription.organizationId, params.organizationId),
        eq(publicApiWebhookSubscription.status, "ACTIVE"),
        sql`${publicApiWebhookSubscription.events} ? ${params.eventType}`,
      ),
    );

  if (subscriptions.length === 0) {
    return;
  }

  const eventId = crypto.randomUUID();
  const occurredAt = new Date().toISOString();

  await Promise.all(
    subscriptions.map(async (subscription) => {
      const requestBody = {
        id: eventId,
        type: params.eventType,
        occurredAt,
        data: params.payload,
      };
      const serializedBody = JSON.stringify(requestBody);
      const secret = decryptWebhookSecret(
        subscription.encryptedSecret,
        subscription.secretIv,
        params.env,
      );

      const [delivery] = await db
        .insert(publicApiWebhookDelivery)
        .values({
          id: crypto.randomUUID(),
          subscriptionId: subscription.id,
          organizationId: subscription.organizationId,
          eventId,
          eventType: params.eventType,
          requestUrl: subscription.targetUrl,
          requestBody,
        })
        .returning();

      try {
        const response = await fetch(subscription.targetUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-calibra-event-id": eventId,
            "x-calibra-event-type": params.eventType,
            "x-calibra-signature": signWebhookPayload(secret, serializedBody),
          },
          body: serializedBody,
        });

        const responseBody = await response.text().catch(() => null);
        const isSuccess = response.ok;

        await db
          .update(publicApiWebhookDelivery)
          .set({
            attemptCount: 1,
            responseStatus: response.status,
            responseBody,
            status: isSuccess ? "SUCCESS" : "FAILED",
            deliveredAt: isSuccess ? new Date() : null,
            failedAt: isSuccess ? null : new Date(),
            lastError: isSuccess ? null : `HTTP ${response.status}`,
            updatedAt: new Date(),
          })
          .where(eq(publicApiWebhookDelivery.id, delivery!.id));

        await db
          .update(publicApiWebhookSubscription)
          .set({
            consecutiveFailures: isSuccess
              ? 0
              : subscription.consecutiveFailures + 1,
            lastSuccessAt: isSuccess ? new Date() : subscription.lastSuccessAt,
            lastFailureAt: isSuccess ? subscription.lastFailureAt : new Date(),
            updatedAt: new Date(),
          })
          .where(eq(publicApiWebhookSubscription.id, subscription.id));
      } catch (error) {
        await db
          .update(publicApiWebhookDelivery)
          .set({
            attemptCount: 1,
            status: "FAILED",
            failedAt: new Date(),
            lastError:
              error instanceof Error ? error.message : "Falha de entrega",
            updatedAt: new Date(),
          })
          .where(eq(publicApiWebhookDelivery.id, delivery!.id));

        await db
          .update(publicApiWebhookSubscription)
          .set({
            consecutiveFailures: subscription.consecutiveFailures + 1,
            lastFailureAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(publicApiWebhookSubscription.id, subscription.id));
      }
    }),
  );
}

export async function replayPublicApiWebhookDelivery(params: {
  organizationId: string;
  subscriptionId: string;
  deliveryId: string;
  env: PublicApiEnv;
}) {
  const [subscription, delivery] = await Promise.all([
    db.query.publicApiWebhookSubscription.findFirst({
      where: and(
        eq(publicApiWebhookSubscription.id, params.subscriptionId),
        eq(publicApiWebhookSubscription.organizationId, params.organizationId),
      ),
    }),
    db.query.publicApiWebhookDelivery.findFirst({
      where: and(
        eq(publicApiWebhookDelivery.id, params.deliveryId),
        eq(publicApiWebhookDelivery.organizationId, params.organizationId),
      ),
      orderBy: [desc(publicApiWebhookDelivery.createdAt)],
    }),
  ]);

  if (!subscription || !delivery) {
    return null;
  }

  const secret = decryptWebhookSecret(
    subscription.encryptedSecret,
    subscription.secretIv,
    params.env,
  );
  const payload = JSON.stringify(delivery.requestBody);
  const replay = await db
    .insert(publicApiWebhookDelivery)
    .values({
      id: crypto.randomUUID(),
      subscriptionId: subscription.id,
      organizationId: params.organizationId,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      requestUrl: subscription.targetUrl,
      requestBody: delivery.requestBody,
      replayOfDeliveryId: delivery.id,
    })
    .returning();

  try {
    const response = await fetch(subscription.targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-calibra-event-id": delivery.eventId,
        "x-calibra-event-type": delivery.eventType,
        "x-calibra-signature": signWebhookPayload(secret, payload),
      },
      body: payload,
    });

    const responseBody = await response.text().catch(() => null);
    const isSuccess = response.ok;

    await db
      .update(publicApiWebhookDelivery)
      .set({
        attemptCount: 1,
        responseStatus: response.status,
        responseBody,
        status: isSuccess ? "SUCCESS" : "FAILED",
        deliveredAt: isSuccess ? new Date() : null,
        failedAt: isSuccess ? null : new Date(),
        lastError: isSuccess ? null : `HTTP ${response.status}`,
      })
      .where(eq(publicApiWebhookDelivery.id, replay[0]!.id));

    return replay[0]!;
  } catch (error) {
    await db
      .update(publicApiWebhookDelivery)
      .set({
        attemptCount: 1,
        status: "FAILED",
        failedAt: new Date(),
        lastError: error instanceof Error ? error.message : "Falha de replay",
      })
      .where(eq(publicApiWebhookDelivery.id, replay[0]!.id));

    return replay[0]!;
  }
}

export async function getApiKeyById(apiKeyId: string) {
  return db.query.organizationApiKey.findFirst({
    where: eq(organizationApiKey.id, apiKeyId),
  });
}
