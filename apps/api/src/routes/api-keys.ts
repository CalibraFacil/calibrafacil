import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import {
  organizationApiKey,
  organizationApiKeyAuditLog,
} from "@calibra-facil/db/schema";
import {
  DEFAULT_PUBLIC_API_SCOPES,
  type PublicApiScope,
  createApiKeySecret,
} from "../lib/api-keys";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
  withLabPermission,
} from "../middleware/permission";
import { requireFeature } from "../middleware/tier-guard";
import { and, desc, eq, isNull } from "drizzle-orm";
import { writeOrganizationAuditEvent } from "../lib/audit";

const ScopeSchema = z.enum([
  "customers:read",
  "customers:write",
  "assets:read",
  "assets:write",
  "requests:read",
  "requests:write",
  "jobs:read",
  "jobs:write",
  "services:read",
  "units:read",
  "reports:read",
  "certificates:read",
  "webhooks:manage",
]);

const CreateApiKeySchema = z.object({
  name: z.string().trim().min(3).max(80),
  scopes: z.array(ScopeSchema).min(1).max(12).optional(),
});

function getRequestIp(c: any) {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    null
  );
}

async function writeAuditLog(params: {
  apiKeyId: string;
  organizationId: string;
  action: string;
  performedBy: string;
  ipAddress: string | null;
  details?: Record<string, unknown>;
}) {
  await db.insert(organizationApiKeyAuditLog).values({
    apiKeyId: params.apiKeyId,
    organizationId: params.organizationId,
    action: params.action,
    performedBy: params.performedBy,
    ipAddress: params.ipAddress,
    details: params.details ?? null,
  });
}

export const apiKeysRouter = new Hono<{ Variables: AuthVariables }>()
  .get(
    "/",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");

      const keys = await db
        .select({
          id: organizationApiKey.id,
          name: organizationApiKey.name,
          keyPrefix: organizationApiKey.keyPrefix,
          scopes: organizationApiKey.scopes,
          lastUsedAt: organizationApiKey.lastUsedAt,
          createdAt: organizationApiKey.createdAt,
          revokedAt: organizationApiKey.revokedAt,
        })
        .from(organizationApiKey)
        .where(eq(organizationApiKey.organizationId, member.organizationId))
        .orderBy(desc(organizationApiKey.createdAt));

      return c.json({ data: keys });
    },
  )
  .post(
    "/",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("api"),
    zValidator("json", CreateApiKeySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");
      const generated = createApiKeySecret();
      const scopes: PublicApiScope[] = [
        ...(input.scopes ?? DEFAULT_PUBLIC_API_SCOPES),
      ];
      const keyId = crypto.randomUUID();

      await db.insert(organizationApiKey).values({
        id: keyId,
        organizationId: member.organizationId,
        name: input.name,
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
        scopes,
        createdBy: session.user.id,
      });

      await writeAuditLog({
        apiKeyId: keyId,
        organizationId: member.organizationId,
        action: "create",
        performedBy: session.user.id,
        ipAddress: getRequestIp(c),
        details: { name: input.name, scopes },
      });

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "api_key.created",
        entityType: "api_key",
        entityId: keyId,
        details: {
          name: input.name,
          keyPrefix: generated.keyPrefix,
          scopes,
          ipAddress: getRequestIp(c),
        },
      });

      return c.json(
        {
          secret: generated.key,
          key: {
            id: keyId,
            name: input.name,
            keyPrefix: generated.keyPrefix,
            scopes,
          },
        },
        201,
      );
    },
  )
  .post(
    "/:id/rotate",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("api"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");

      const existing = await db.query.organizationApiKey.findFirst({
        where: and(
          eq(organizationApiKey.id, id),
          eq(organizationApiKey.organizationId, member.organizationId),
          isNull(organizationApiKey.revokedAt),
        ),
      });

      if (!existing) {
        return c.json({ error: "Chave de API não encontrada" }, 404);
      }

      const generated = createApiKeySecret();

      await db
        .update(organizationApiKey)
        .set({
          keyPrefix: generated.keyPrefix,
          keyHash: generated.keyHash,
          updatedAt: new Date(),
        })
        .where(eq(organizationApiKey.id, existing.id));

      await writeAuditLog({
        apiKeyId: existing.id,
        organizationId: member.organizationId,
        action: "rotate",
        performedBy: session.user.id,
        ipAddress: getRequestIp(c),
      });

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "api_key.rotated",
        entityType: "api_key",
        entityId: existing.id,
        details: {
          name: existing.name,
          keyPrefix: generated.keyPrefix,
          previousKeyPrefix: existing.keyPrefix,
          scopes: existing.scopes,
          ipAddress: getRequestIp(c),
        },
      });

      return c.json({
        secret: generated.key,
        key: {
          id: existing.id,
          name: existing.name,
          keyPrefix: generated.keyPrefix,
          scopes: existing.scopes,
        },
      });
    },
  )
  .post(
    "/:id/revoke",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");

      const existing = await db.query.organizationApiKey.findFirst({
        where: and(
          eq(organizationApiKey.id, id),
          eq(organizationApiKey.organizationId, member.organizationId),
        ),
      });

      if (!existing) {
        return c.json({ error: "Chave de API não encontrada" }, 404);
      }

      await db
        .update(organizationApiKey)
        .set({
          revokedAt: existing.revokedAt ?? new Date(),
          revokedBy: session.user.id,
        })
        .where(eq(organizationApiKey.id, existing.id));

      await writeAuditLog({
        apiKeyId: existing.id,
        organizationId: member.organizationId,
        action: "revoke",
        performedBy: session.user.id,
        ipAddress: getRequestIp(c),
      });

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "api_key.revoked",
        entityType: "api_key",
        entityId: existing.id,
        details: {
          name: existing.name,
          keyPrefix: existing.keyPrefix,
          scopes: existing.scopes,
          alreadyRevoked: Boolean(existing.revokedAt),
          ipAddress: getRequestIp(c),
        },
      });

      return c.json({ success: true });
    },
  );
