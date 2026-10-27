import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { db, systemDb } from "@calibra-facil/db";
import { organization, organizationApiKey } from "@calibra-facil/db/schema";
import {
  type PublicApiScope,
  extractApiKeyFromRequest,
  hashApiKey,
} from "../lib/api-keys";
import { and, eq, isNull } from "drizzle-orm";
import { domainErrorBody, forbidden } from "../lib/domain-errors";
import { orgDb } from "../lib/org-db";
import { clientIp } from "../lib/client-ip";

export interface ApiKeyAuthVariables {
  apiKey: {
    id: string;
    organizationId: string;
    scopes: string[];
    name: string;
    keyPrefix: string;
    createdBy: string;
  };
}

/**
 * A 403 whose body carries the stable code (`{ error, code }`) like every
 * DomainError, but as an HTTPException so it also works under a bare
 * sub-router (the public API routers are mounted with and without the
 * app-level error hook).
 */
function forbiddenOrganization(
  code: "organization_deleted" | "organization_suspended",
  message: string,
) {
  const body = domainErrorBody(forbidden(code, message));
  return new HTTPException(403, {
    message,
    res: new Response(JSON.stringify(body), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }),
  });
}

export const requireApiKeyAuth = createMiddleware<{
  Variables: ApiKeyAuthVariables;
}>(async (c, next) => {
  const rawKey = extractApiKeyFromRequest(c.req.raw);

  if (!rawKey) {
    throw new HTTPException(401, { message: "API key ausente" });
  }

  const keyHash = hashApiKey(rawKey);
  // System path (tenant-sql-allowlist.ts "auth-session"): the key hash IS the
  // lookup and it yields the laboratory, so this one statement cannot name an
  // organization yet. Everything after it runs under the key's laboratory.
  const [keyRecord] = await systemDb
    .select()
    .from(organizationApiKey)
    .where(
      and(
        eq(organizationApiKey.keyHash, keyHash),
        isNull(organizationApiKey.revokedAt),
      ),
    )
    .limit(1);

  if (!keyRecord) {
    throw new HTTPException(401, { message: "API key inválida" });
  }

  // A key authenticates straight to its organization, with no session in
  // between, so the tenant lifecycle has to be enforced here: a suspended or
  // soft-deleted laboratory (records retention, decision Q16) gets nothing,
  // revoked or not.
  const [lab] = await db
    .select({ status: organization.status, deletedAt: organization.deletedAt })
    .from(organization)
    .where(eq(organization.id, keyRecord.organizationId))
    .limit(1);

  if (!lab) {
    throw new HTTPException(401, { message: "API key inválida" });
  }
  if (lab.deletedAt) {
    throw forbiddenOrganization(
      "organization_deleted",
      "Organização excluída: a chave de API não pode mais ser usada",
    );
  }
  if (lab.status === "SUSPENDED") {
    throw forbiddenOrganization(
      "organization_suspended",
      "Organização suspensa: a chave de API não pode ser usada",
    );
  }

  c.set("apiKey", {
    id: keyRecord.id,
    organizationId: keyRecord.organizationId,
    scopes: keyRecord.scopes,
    name: keyRecord.name,
    keyPrefix: keyRecord.keyPrefix,
    createdBy: keyRecord.createdBy,
  });

  await orgDb(keyRecord.organizationId).transaction(async (o) => {
    await o
      .update(organizationApiKey)
      .set({
        lastUsedAt: new Date(),
        lastUsedIp: clientIp(c),
      })
      .where(eq(organizationApiKey.id, keyRecord.id));
  });

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
