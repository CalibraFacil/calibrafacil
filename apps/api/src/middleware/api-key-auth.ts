import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { db } from "@calibra-facil/db";
import { organizationApiKey } from "@calibra-facil/db/schema";
import {
  type PublicApiScope,
  extractApiKeyFromRequest,
  hashApiKey,
} from "../lib/api-keys";
import { and, eq, isNull } from "drizzle-orm";
import { organizationHasEntitlement } from "../lib/organization-plan";

export interface ApiKeyAuthVariables {
  apiKey: {
    id: string;
    organizationId: string;
    scopes: string[];
    name: string;
    createdBy: string;
  };
}

function getRequestIp(headers: Headers) {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    null
  );
}

export const requireApiKeyAuth = createMiddleware<{
  Variables: ApiKeyAuthVariables;
}>(async (c, next) => {
  const rawKey = extractApiKeyFromRequest(c.req.raw);

  if (!rawKey) {
    throw new HTTPException(401, { message: "API key ausente" });
  }

  const keyHash = hashApiKey(rawKey);
  const keyRecord = await db.query.organizationApiKey.findFirst({
    where: and(
      eq(organizationApiKey.keyHash, keyHash),
      isNull(organizationApiKey.revokedAt),
    ),
  });

  if (!keyRecord) {
    throw new HTTPException(401, { message: "API key inválida" });
  }

  const hasApi = await organizationHasEntitlement(
    keyRecord.organizationId,
    "api",
  );
  if (!hasApi) {
    throw new HTTPException(403, {
      message: "API não disponível no plano atual",
    });
  }

  c.set("apiKey", {
    id: keyRecord.id,
    organizationId: keyRecord.organizationId,
    scopes: keyRecord.scopes,
    name: keyRecord.name,
    createdBy: keyRecord.createdBy,
  });

  await db
    .update(organizationApiKey)
    .set({
      lastUsedAt: new Date(),
      lastUsedIp: getRequestIp(c.req.raw.headers),
    })
    .where(eq(organizationApiKey.id, keyRecord.id));

  await next();
});

export function requireApiScope(scope: PublicApiScope) {
  return createMiddleware<{ Variables: ApiKeyAuthVariables }>(
    async (c, next) => {
      const apiKey = c.get("apiKey");
      if (!apiKey.scopes.includes(scope)) {
        throw new HTTPException(403, {
          message: `Escopo "${scope}" não permitido para esta chave`,
        });
      }

      await next();
    },
  );
}
