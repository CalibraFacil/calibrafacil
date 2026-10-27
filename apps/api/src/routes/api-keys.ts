import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { OrgDb } from "@calibra-facil/db/for-org";
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
import { and, desc, eq, isNull } from "drizzle-orm";
import { writeOrganizationAuditEvent } from "../lib/audit";
import { orgDb } from "../lib/org-db";
import { clientIp } from "../lib/client-ip";
import { parseCidr } from "@calibra-facil/shared/ip-range";

import { requireFreshSession } from "../middleware/fresh-session";
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

/** A key lives a year unless the laboratory asks for less (at most two years). */
const DEFAULT_KEY_LIFETIME_DAYS = 365;
const MAX_KEY_LIFETIME_DAYS = 730;
const DAY_MS = 24 * 60 * 60 * 1000;

const AllowedIpSchema = z
  .string()
  .trim()
  .refine((entry) => parseCidr(entry) !== null, {
    message: "Endereço IP ou faixa CIDR inválido",
  });

const CreateApiKeySchema = z.object({
  name: z.string().trim().min(3).max(80),
  scopes: z.array(ScopeSchema).min(1).max(12).optional(),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(MAX_KEY_LIFETIME_DAYS)
    .default(DEFAULT_KEY_LIFETIME_DAYS),
  allowedIps: z.array(AllowedIpSchema).max(20).optional(),
});

function expiryFrom(now: Date, days: number) {
  return new Date(now.getTime() + days * DAY_MS);
}

function getRequestIp(c: Context<{ Variables: AuthVariables }>) {
  return clientIp(c);
}

async function writeAuditLog(
  o: OrgDb,
  params: {
    apiKeyId: string;
    organizationId: string;
    action: string;
    performedBy: string;
    ipAddress: string | null;
    details?: Record<string, unknown>;
  },
) {
  await o.insert(organizationApiKeyAuditLog).values({
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

      const keys = await orgDb(member.organizationId).transaction((o) =>
        o
          .select({
            id: organizationApiKey.id,
            name: organizationApiKey.name,
            keyPrefix: organizationApiKey.keyPrefix,
            scopes: organizationApiKey.scopes,
            lastUsedAt: organizationApiKey.lastUsedAt,
            expiresAt: organizationApiKey.expiresAt,
            allowedIps: organizationApiKey.allowedIps,
            createdAt: organizationApiKey.createdAt,
            revokedAt: organizationApiKey.revokedAt,
          })
          .from(organizationApiKey)
          .where(eq(organizationApiKey.organizationId, member.organizationId))
          .orderBy(desc(organizationApiKey.createdAt)),
      );

      return c.json({ data: keys });
    },
  )
  .post(
    "/",
    ...withLabPermission({ organization: ["update"] }),
    requireFreshSession,
    requireRole(["admin", "owner"]),
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
      const expiresAt = expiryFrom(new Date(), input.expiresInDays);
      const allowedIps =
        input.allowedIps && input.allowedIps.length > 0
          ? input.allowedIps
          : null;

      // The key and both audit entries commit together.
      await orgDb(member.organizationId).transaction(async (o) => {
        await o.insert(organizationApiKey).values({
          id: keyId,
          organizationId: member.organizationId,
          name: input.name,
          keyPrefix: generated.keyPrefix,
          keyHash: generated.keyHash,
          scopes,
          expiresAt,
          allowedIps,
          createdBy: session.user.id,
        });

        await writeAuditLog(o, {
          apiKeyId: keyId,
          organizationId: member.organizationId,
          action: "create",
          performedBy: session.user.id,
          ipAddress: getRequestIp(c),
          details: {
            name: input.name,
            scopes,
            expiresAt: expiresAt.toISOString(),
            allowedIps,
          },
        });

        await writeOrganizationAuditEvent(
          {
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
          },
          o,
        );
      });

      return c.json(
        {
          secret: generated.key,
          key: {
            id: keyId,
            name: input.name,
            keyPrefix: generated.keyPrefix,
            scopes,
            expiresAt,
            allowedIps,
          },
        },
        201,
      );
    },
  )
  .post(
    "/:id/rotate",
    ...withLabPermission({ organization: ["update"] }),
    requireFreshSession,
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");

      const generated = createApiKeySecret();
      // Rotating renews the key: the new secret lives a fresh year.
      const expiresAt = expiryFrom(new Date(), DEFAULT_KEY_LIFETIME_DAYS);

      // Look-up, rotation and audit entries are one transaction.
      const existing = await orgDb(member.organizationId).transaction(
        async (o) => {
          const [row] = await o
            .select()
            .from(organizationApiKey)
            .where(
              and(
                eq(organizationApiKey.id, id),
                eq(organizationApiKey.organizationId, member.organizationId),
                isNull(organizationApiKey.revokedAt),
              ),
            )
            .limit(1);
          if (!row) return null;

          await o
            .update(organizationApiKey)
            .set({
              keyPrefix: generated.keyPrefix,
              keyHash: generated.keyHash,
              expiresAt,
              updatedAt: new Date(),
            })
            .where(eq(organizationApiKey.id, row.id));

          await writeAuditLog(o, {
            apiKeyId: row.id,
            organizationId: member.organizationId,
            action: "rotate",
            performedBy: session.user.id,
            ipAddress: getRequestIp(c),
          });

          await writeOrganizationAuditEvent(
            {
              organizationId: member.organizationId,
              actorUserId: session.user.id,
              actorMemberId: member.id,
              action: "api_key.rotated",
              entityType: "api_key",
              entityId: row.id,
              details: {
                name: row.name,
                keyPrefix: generated.keyPrefix,
                previousKeyPrefix: row.keyPrefix,
                scopes: row.scopes,
                ipAddress: getRequestIp(c),
              },
            },
            o,
          );
          return row;
        },
      );

      if (!existing) {
        return c.json({ error: "Chave de API não encontrada" }, 404);
      }

      return c.json({
        secret: generated.key,
        key: {
          id: existing.id,
          name: existing.name,
          keyPrefix: generated.keyPrefix,
          scopes: existing.scopes,
          expiresAt,
          allowedIps: existing.allowedIps,
        },
      });
    },
  )
  .post(
    "/:id/revoke",
    ...withLabPermission({ organization: ["update"] }),
    requireFreshSession,
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");

      const existing = await orgDb(member.organizationId).transaction(
        async (o) => {
          const [row] = await o
            .select()
            .from(organizationApiKey)
            .where(
              and(
                eq(organizationApiKey.id, id),
                eq(organizationApiKey.organizationId, member.organizationId),
              ),
            )
            .limit(1);
          if (!row) return null;

          await o
            .update(organizationApiKey)
            .set({
              revokedAt: row.revokedAt ?? new Date(),
              revokedBy: session.user.id,
            })
            .where(eq(organizationApiKey.id, row.id));

          await writeAuditLog(o, {
            apiKeyId: row.id,
            organizationId: member.organizationId,
            action: "revoke",
            performedBy: session.user.id,
            ipAddress: getRequestIp(c),
          });

          await writeOrganizationAuditEvent(
            {
              organizationId: member.organizationId,
              actorUserId: session.user.id,
              actorMemberId: member.id,
              action: "api_key.revoked",
              entityType: "api_key",
              entityId: row.id,
              details: {
                name: row.name,
                keyPrefix: row.keyPrefix,
                scopes: row.scopes,
                alreadyRevoked: Boolean(row.revokedAt),
                ipAddress: getRequestIp(c),
              },
            },
            o,
          );
          return row;
        },
      );

      if (!existing) {
        return c.json({ error: "Chave de API não encontrada" }, 404);
      }

      return c.json({ success: true });
    },
  );
