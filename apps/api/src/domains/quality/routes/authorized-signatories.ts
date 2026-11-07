import { createRouter } from "../../../server/router";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { orgDb } from "../../../lib/org-db";
import { conflict, invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import {
  authorizedSignatory,
  member,
  user,
  assetType,
} from "@calibra-facil/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { SIGNATORY_MACHINE } from "@calibra-facil/schemas/machines";

import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";

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
  /** The title printed under the signature of the certificates this person approves (C1). */
  title: z.string().trim().max(160).optional(),
  expiresAt: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

const UpdateSignatoryTitleSchema = z.object({
  /** Blank or null clears it: the certificate then prints no title (never the manager's). */
  title: z
    .string()
    .trim()
    .max(160)
    .transform((value) => value || null)
    .nullable(),
});

const RevokeSignatorySchema = z.object({
  reason: z.string().max(500).optional(),
});

export const authorizedSignatoriesRouter = createRouter<{
  Variables: AuthVariables;
}>()
  // =========================================================================
  // GET / - List the organization's signatory roster
  // =========================================================================
  .get("/", ...withLabPermission({ competence: ["read"] }), async (c) => {
    const memberData = c.get("member");
    return await orgDb(memberData.organizationId).transaction(async (tx) => {
      const rows = await tx
        .select({
          id: authorizedSignatory.id,
          userId: authorizedSignatory.userId,
          userName: user.name,
          assetTypeId: authorizedSignatory.assetTypeId,
          assetTypeName: assetType.name,
          scopeDescription: authorizedSignatory.scopeDescription,
          title: authorizedSignatory.title,
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
    });
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

      // ISO/IEC 17025:2017 §6.2.6 — a signatory record is a regulated roster
      // entry; the granted user MUST be an active member of the caller's
      // organization. Mirror the membership check in signatures.ts
      // (GET /member/:memberId) so a record can never point at a foreign user.
      const created = await withOrg(
        memberData.organizationId,
        requestActor(c),
        async (ctx) => {
          const [targetMember] = await ctx.o
            .select({ id: member.id })
            .from(member)
            .where(
              and(
                eq(member.userId, input.userId),
                eq(member.organizationId, memberData.organizationId),
              ),
            )
            .limit(1);

          if (!targetMember) {
            throw invalid(
              "invalid_request",
              "Usuário não é membro da organização",
            );
          }

          const [row] = await ctx.o
            .insert(authorizedSignatory)
            .values({
              organizationId: memberData.organizationId,
              userId: input.userId,
              assetTypeId: input.assetTypeId ?? null,
              scopeDescription: input.scopeDescription ?? null,
              title: input.title || null,
              status: "ACTIVE",
              authorizedBy: session.user.id,
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
              notes: input.notes ?? null,
            })
            .returning();

          if (row) {
            await ctx.audit("authorizedSignatory", row.id, {
              action: "grant",
              changes: { status: { old: null, new: "ACTIVE" } },
            });
          }
          return row;
        },
      );

      return c.json({ signatory: created }, 201);
    },
  )

  // =========================================================================
  // PATCH /:id - Set or clear the title printed under the signature (C1)
  // =========================================================================
  .patch(
    "/:id",
    ...withLabPermission({ competence: ["approve"] }),
    zValidator("json", UpdateSignatoryTitleSchema),
    async (c) => {
      const memberData = c.get("member");
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id)) {
        throw invalid("invalid_request", "ID invalido");
      }
      const input = c.req.valid("json");

      const result = await withOrg(
        memberData.organizationId,
        requestActor(c),
        async (ctx) => {
          const [existing] = await ctx.o
            .select()
            .from(authorizedSignatory)
            .where(
              and(
                eq(authorizedSignatory.id, id),
                eq(
                  authorizedSignatory.organizationId,
                  memberData.organizationId,
                ),
                isNull(authorizedSignatory.deletedAt),
              ),
            )
            .limit(1);

          if (!existing) {
            throw notFound("not_found", "Signatário não encontrado");
          }
          if (existing.title === input.title) {
            return existing;
          }

          const [updated] = await ctx.o
            .update(authorizedSignatory)
            .set({ title: input.title })
            .where(
              and(
                eq(authorizedSignatory.id, id),
                eq(
                  authorizedSignatory.organizationId,
                  memberData.organizationId,
                ),
              ),
            )
            .returning();

          await ctx.audit("authorizedSignatory", id, {
            action: "update",
            changes: { title: { old: existing.title, new: input.title } },
          });

          return updated;
        },
      );

      return c.json({ signatory: result });
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
        throw invalid("invalid_request", "ID invalido");
      }
      const input = c.req.valid("json");

      const revoked = await withOrg(
        memberData.organizationId,
        requestActor(c),
        async (ctx) => {
          const [existing] = await ctx.o
            .select()
            .from(authorizedSignatory)
            .where(
              and(
                eq(authorizedSignatory.id, id),
                eq(
                  authorizedSignatory.organizationId,
                  memberData.organizationId,
                ),
                isNull(authorizedSignatory.deletedAt),
              ),
            )
            .limit(1);

          if (!existing) {
            throw notFound("not_found", "Signatário não encontrado");
          }
          // `revoke` (SIGNATORY_MACHINE): only an active grant is revoked. A second
          // revoke used to overwrite who revoked it and when.
          if (!SIGNATORY_MACHINE.canTransition(existing.status, "revoke")) {
            throw conflict(
              "status_transition_conflict",
              "Signatário já revogado",
            );
          }

          const [updated] = await ctx.o
            .update(authorizedSignatory)
            .set({
              status: SIGNATORY_MACHINE.requireTargetOf(
                existing.status,
                "revoke",
              ),
              revokedBy: session.user.id,
              revokedAt: new Date(),
            })
            // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
            // above so the UPDATE stays org-scoped even if the guarding read is
            // refactored away. Reuses the in-scope memberData.organizationId.
            .where(
              and(
                eq(authorizedSignatory.id, id),
                eq(
                  authorizedSignatory.organizationId,
                  memberData.organizationId,
                ),
                eq(authorizedSignatory.status, existing.status),
              ),
            )
            .returning();
          if (!updated) {
            throw conflict(
              "status_transition_conflict",
              "Signatário já revogado",
            );
          }

          await ctx.audit("authorizedSignatory", id, {
            action: "revoke",
            changes: { status: { old: existing.status, new: "REVOKED" } },
            reason: input.reason || null,
          });

          return updated;
        },
      );

      return c.json({ signatory: revoked });
    },
  );
