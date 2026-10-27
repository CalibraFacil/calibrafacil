import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { db, systemDb } from "@calibra-facil/db";
import {
  member,
  organization,
  organizationApiKey,
} from "@calibra-facil/db/schema";
import {
  isIpInCidr,
  parseCidr,
  parseIp,
  unwrapIpv4,
} from "@calibra-facil/shared/ip-range";
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

/** The roles that may create an API key (routes/api-keys.ts), and so use one. */
const KEY_CREATOR_ROLES = new Set(["owner", "admin"]);

const LAST_USED_REFRESH_MS = 5 * 60 * 1000;

function lastUseIsStale(
  key: { lastUsedAt: Date | null; lastUsedIp: string | null },
  now: Date,
  ip: string | null,
) {
  if (!key.lastUsedAt) return true;
  if (key.lastUsedIp !== ip) return true;
  return now.getTime() - key.lastUsedAt.getTime() >= LAST_USED_REFRESH_MS;
}

/** Whether the client address may use a key bound to `allowed` (none: any). */
export function ipAllowed(
  address: string | null,
  allowed: readonly string[] | null,
): boolean {
  if (!allowed || allowed.length === 0) return true;
  const parsed = address ? parseIp(address) : null;
  if (!parsed) return false;
  const candidates = [parsed, unwrapIpv4(parsed)].filter(
    (ip): ip is NonNullable<typeof ip> => ip !== null,
  );
  return allowed.some((entry) => {
    const cidr = parseCidr(entry.trim());
    return cidr !== null && candidates.some((ip) => isIpInCidr(ip, cidr));
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

  const now = new Date();
  if (keyRecord.expiresAt && keyRecord.expiresAt <= now) {
    throw new HTTPException(401, {
      message: "API key expirada: gere uma nova chave",
    });
  }

  const requestIp = clientIp(c);
  if (!ipAllowed(requestIp, keyRecord.allowedIps)) {
    throw new HTTPException(403, {
      message: "Esta chave de API não aceita requisições deste endereço",
    });
  }

  // A key acts for the person who made it, so it can never do more than that
  // person may do NOW: only an owner or admin may make a key, and a creator who
  // left the laboratory or lost that role takes the key's access with them.
  const [creator] = await orgDb(keyRecord.organizationId).transaction((o) =>
    o
      .select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.organizationId, keyRecord.organizationId),
          eq(member.userId, keyRecord.createdBy),
        ),
      )
      .limit(1),
  );
  if (!creator || !KEY_CREATOR_ROLES.has(creator.role)) {
    throw new HTTPException(401, {
      message:
        "API key inválida: quem a criou não tem mais acesso de administrador a este laboratório",
    });
  }

  c.set("apiKey", {
    id: keyRecord.id,
    organizationId: keyRecord.organizationId,
    scopes: keyRecord.scopes,
    name: keyRecord.name,
    keyPrefix: keyRecord.keyPrefix,
    createdBy: keyRecord.createdBy,
  });

  // One write per key every few minutes (or when the address changes), not one
  // per request.
  if (lastUseIsStale(keyRecord, now, requestIp)) {
    await orgDb(keyRecord.organizationId).transaction(async (o) => {
      await o
        .update(organizationApiKey)
        .set({ lastUsedAt: now, lastUsedIp: requestIp })
        .where(eq(organizationApiKey.id, keyRecord.id));
    });
  }

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
