import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import {
  authorizedSignatory,
  authorizedSignatoryAuditLog,
  user,
  assetType,
} from "@calibra-facil/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";

/**
 * Authorized Signatories Router - ISO/IEC 17025:2017 Clause 6.2.6
 *
 * Manages the roster of personnel authorized to APPROVE / sign off calibration
 * certificates, optionally scoped per asset type. Enforcement lives in the job
 * approval handler (see lib/signatory.ts). Distinct from personnel competence,
 * which authorizes who may EXECUTE a calibration.
 *
 * Granting/revoking reuses the competence-approve authority (a quality-manager
 * function): read = competence:read, write = competence:approve (admin/owner).
 */
const GrantSignatorySchema = z.object({
  userId: z.string().min(1),
  assetTypeId: z.number().int().positive().nullable().optional(),
  scopeDescription: z.string().max(500).optional(),
  expiresAt: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

const RevokeSignatorySchema = z.object({
  reason: z.string().max(500).optional(),
});

export const authorizedSignatoriesRouter = new Hono<{
  Variables: AuthVariables;
}>()
  // =========================================================================
  // GET / - List the organization's signatory roster
  // =========================================================================
  .get("/", ...withLabPermission({ competence: ["read"] }), async (c) => {
    const memberData = c.get("member");
    const rows = await db
      .select({
        id: authorizedSignatory.id,
        userId: authorizedSignatory.userId,
        userName: user.name,
        assetTypeId: authorizedSignatory.assetTypeId,
        assetTypeName: assetType.name,
        scopeDescription: authorizedSignatory.scopeDescription,
        status: authorizedSignatory.status,
        authorizedAt: authorizedSignatory.authorizedAt,
        expiresAt: authorizedSignatory.expiresAt,
      })
      .from(authorizedSignatory)
      .leftJoin(user, eq(authorizedSignatory.userId, user.id))
      .leftJoin(assetType, eq(authorizedSignatory.assetTypeId, assetType.id))
      .where(
        and(
          eq(authorizedSignatory.organizationId, memberData.organizationId),
          isNull(authorizedSignatory.deletedAt),
        ),
      )
      .orderBy(desc(authorizedSignatory.authorizedAt));
    return c.json({ signatories: rows });
  })

  // =========================================================================
  // POST / - Grant a signatory authorization
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ competence: ["approve"] }),
    zValidator("json", GrantSignatorySchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const [created] = await db
        .insert(authorizedSignatory)
        .values({
          organizationId: memberData.organizationId,
          userId: input.userId,
          assetTypeId: input.assetTypeId ?? null,
          scopeDescription: input.scopeDescription ?? null,
          status: "ACTIVE",
          authorizedBy: session.user.id,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          notes: input.notes ?? null,
        })
        .returning();

      if (created) {
        await db.insert(authorizedSignatoryAuditLog).values({
          signatoryId: created.id,
          action: "grant",
          changes: { status: { old: null, new: "ACTIVE" } },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });
      }

      return c.json({ signatory: created }, 201);
    },
  )

  // =========================================================================
  // POST /:id/revoke - Revoke a signatory authorization
  // =========================================================================
  .post(
    "/:id/revoke",
    ...withLabPermission({ competence: ["approve"] }),
    zValidator("json", RevokeSignatorySchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }
      const input = c.req.valid("json");

      const [existing] = await db
        .select()
        .from(authorizedSignatory)
        .where(
          and(
            eq(authorizedSignatory.id, id),
            eq(authorizedSignatory.organizationId, memberData.organizationId),
            isNull(authorizedSignatory.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Signatário não encontrado" }, 404);
      }

      const [updated] = await db
        .update(authorizedSignatory)
        .set({
          status: "REVOKED",
          revokedBy: session.user.id,
          revokedAt: new Date(),
        })
        .where(eq(authorizedSignatory.id, id))
        .returning();

      await db.insert(authorizedSignatoryAuditLog).values({
        signatoryId: id,
        action: "revoke",
        changes: { status: { old: existing.status, new: "REVOKED" } },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.reason || null,
      });

      return c.json({ signatory: updated });
    },
  );
