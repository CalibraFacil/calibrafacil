import { type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  buildPublicApiError,
  findIdempotencyRecord,
  getIdempotencyKey,
  hashIdempotencyPayload,
  storeIdempotencyRecord,
} from "../../lib/public-api";
import { type ApiKeyAuthVariables } from "../../middleware/api-key-auth";
import { toIdempotencyResponseStatus, toRecord } from "./helpers";

export async function withIdempotentMutation<
  E extends { Variables: ApiKeyAuthVariables },
>(
  c: Context<E>,
  body: unknown,
  handler: () => Promise<{
    status: ContentfulStatusCode;
    body: Record<string, unknown>;
    resourceType?: "customer" | "asset" | "request" | "job";
    resourceId?: string | number | null;
  }>,
) {
  const apiKey = c.get("apiKey");
  const key = getIdempotencyKey(c.req.raw.headers);

  if (!key) {
    return c.json(
      buildPublicApiError({
        code: "missing_idempotency_key",
        message: "Informe o header Idempotency-Key para operações de escrita",
      }),
      400,
    );
  }

  const requestHash = hashIdempotencyPayload(body);
  const requestPath = new URL(c.req.url).pathname;
  const existing = await findIdempotencyRecord({
    organizationId: apiKey.organizationId,
    apiKeyId: apiKey.id,
    requestMethod: c.req.method,
    requestPath,
    idempotencyKey: key,
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return c.json(
        buildPublicApiError({
          code: "idempotency_conflict",
          message:
            "A mesma Idempotency-Key já foi usada com um payload diferente",
        }),
        409,
      );
    }

    const replayStatus = toIdempotencyResponseStatus(existing.responseStatus);
    if (replayStatus === 204) {
      // 204 responses have no body — replay them without one.
      return c.body(null, 204);
    }
    return c.json(toRecord(existing.responseBody), replayStatus);
  }

  const result = await handler();

  await storeIdempotencyRecord({
    organizationId: apiKey.organizationId,
    apiKeyId: apiKey.id,
    requestMethod: c.req.method,
    requestPath,
    idempotencyKey: key,
    requestHash,
    responseStatus: result.status,
    responseBody: result.body,
    resourceType: result.resourceType,
    resourceId: result.resourceId,
  });

  return c.json(result.body, result.status);
}
