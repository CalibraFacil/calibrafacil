import { createRouter } from "../../../server/router";
import {
  DEFAULT_API_KEY_LIFETIME_DAYS,
  apiKeyEndpoints,
} from "@calibra-facil/contracts";
import { zValidator } from "@hono/zod-validator";
import {
  organizationApiKey,
  organizationApiKeyAuditLog,
} from "@calibra-facil/db/schema";
import {
  DEFAULT_PUBLIC_API_SCOPES,
  type PublicApiScope,
  createApiKeySecret,
} from "../../../lib/api-keys";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
  withLabPermission,
} from "../../../middleware/permission";
import { and, desc, eq, isNull } from "drizzle-orm";
import { writeOrganizationAuditEvent } from "../../../lib/audit";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { notFound } from "../../../lib/domain-errors";
import { withOrg, type OrgContext } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

import { requireFreshSession } from "../../../middleware/fresh-session";
const DAY_MS = 24 * 60 * 60 * 1000;

function expiryFrom(now: Date, days: number) {
  return new Date(now.getTime() + days * DAY_MS);
}

/** The key's own audit row (`organization_api_key_audit_log`), in the change's transaction. */
async function writeAuditLog(
  ctx: OrgContext,
  params: {
    apiKeyId: string;
    action: string;
    details?: Record<string, unknown>;
  },
) {
  await ctx.o.insert(organizationApiKeyAuditLog).values({
    apiKeyId: params.apiKeyId,
    organizationId: ctx.org,
    action: params.action,
    performedBy: ctx.actor.userId,
    ipAddress: ctx.actor.ipAddress,
    details: params.details ?? null,
  });
}

function apiKeyNotFound() {
  return notFound("api_key_not_found", "Chave de API não encontrada");
}

const PREFIX = "/api/api-keys";

export const apiKeysRouter = createRouter<{ Variables: AuthVariables }>();

mount(
  apiKeysRouter,
  PREFIX,
  apiKeyEndpoints.list,
  [
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
  ],
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

    return { data: keys };
  },
);

mount(
  apiKeysRouter,
  PREFIX,
  apiKeyEndpoints.create,
  [
    ...withLabPermission({ organization: ["update"] }),
    requireFreshSession,
    requireRole(["admin", "owner"]),
  ],
  async (c, { body }) => {
    const member = c.get("member");
    const session = c.get("session");
    const input = body;
    const generated = createApiKeySecret();
    const scopes: PublicApiScope[] = [
      ...(input.scopes ?? DEFAULT_PUBLIC_API_SCOPES),
    ];
    const keyId = crypto.randomUUID();
    const expiresAt = expiryFrom(new Date(), input.expiresInDays);
    const allowedIps =
      input.allowedIps && input.allowedIps.length > 0 ? input.allowedIps : null;

    // The key and both audit entries commit together.
    await withOrg(member.organizationId, requestActor(c), async (ctx) => {
      await ctx.o.insert(organizationApiKey).values({
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

      await writeAuditLog(ctx, {
        apiKeyId: keyId,
        action: "create",
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
            ipAddress: ctx.actor.ipAddress,
          },
        },
        ctx.o,
      );
    });

    return {
      secret: generated.key,
      key: {
        id: keyId,
        name: input.name,
        keyPrefix: generated.keyPrefix,
        scopes,
        expiresAt,
        allowedIps,
      },
    };
  },
);

mount(
  apiKeysRouter,
  PREFIX,
  apiKeyEndpoints.rotate,
  [
    ...withLabPermission({ organization: ["update"] }),
    requireFreshSession,
    requireRole(["admin", "owner"]),
  ],
  async (c, { params }) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = params.id;

    const generated = createApiKeySecret();
    // Rotating renews the key: the new secret lives a fresh year.
    const expiresAt = expiryFrom(new Date(), DEFAULT_API_KEY_LIFETIME_DAYS);

    // Look-up, rotation and audit entries are one transaction.
    const existing = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [row] = await ctx.o
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
        if (!row) throw apiKeyNotFound();

        await ctx.o
          .update(organizationApiKey)
          .set({
            keyPrefix: generated.keyPrefix,
            keyHash: generated.keyHash,
            expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(organizationApiKey.id, row.id));

        await writeAuditLog(ctx, { apiKeyId: row.id, action: "rotate" });

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
              ipAddress: ctx.actor.ipAddress,
            },
          },
          ctx.o,
        );
        return row;
      },
    );

    return {
      secret: generated.key,
      key: {
        id: existing.id,
        name: existing.name,
        keyPrefix: generated.keyPrefix,
        scopes: existing.scopes,
        expiresAt,
        allowedIps: existing.allowedIps,
      },
    };
  },
);

mount(
  apiKeysRouter,
  PREFIX,
  apiKeyEndpoints.revoke,
  [
    ...withLabPermission({ organization: ["update"] }),
    requireFreshSession,
    requireRole(["admin", "owner"]),
  ],
  async (c, { params }) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = params.id;

    await withOrg(member.organizationId, requestActor(c), async (ctx) => {
      const [row] = await ctx.o
        .select()
        .from(organizationApiKey)
        .where(
          and(
            eq(organizationApiKey.id, id),
            eq(organizationApiKey.organizationId, member.organizationId),
          ),
        )
        .limit(1);
      if (!row) throw apiKeyNotFound();

      await ctx.o
        .update(organizationApiKey)
        .set({
          revokedAt: row.revokedAt ?? new Date(),
          revokedBy: session.user.id,
        })
        .where(eq(organizationApiKey.id, row.id));

      await writeAuditLog(ctx, { apiKeyId: row.id, action: "revoke" });

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
            ipAddress: ctx.actor.ipAddress,
          },
        },
        ctx.o,
      );
    });

    return { success: true as const };
  },
);
