import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { orgDb } from "../../lib/org-db";
import { automaticSendRule, customer } from "@calibra-facil/db/schema";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import type { AutomaticSendMilestone } from "@calibra-facil/shared";
import { agreementBelongsToOrganization } from "../../lib/tenant-refs";
import { isUniqueViolationOf } from "../../lib/db-errors";

/** Partial unique index: one organization-wide default rule (migration 0031). */
const ORG_DEFAULT_RULE_INDEX = "automatic_send_rule_org_default_uidx";

const RuleIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const MILESTONES = [
  "certificate_approved",
  "service_order_delivered",
  "contract_anniversary",
  "manual_only",
] as const satisfies readonly AutomaticSendMilestone[];

const MilestoneSchema = z.enum(MILESTONES);

const CreateRuleSchema = z.object({
  milestone: MilestoneSchema,
  customerId: z.number().int().positive().nullable().optional(),
  commercialAgreementId: z.number().int().positive().nullable().optional(),
  serviceCategory: z
    .string()
    .min(1)
    .max(200)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? null : value?.trim() || null)),
  priority: z.number().int().min(0).max(1000).optional(),
});

const UpdateRuleSchema = z.object({
  milestone: MilestoneSchema.optional(),
  archived: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});

type Scope = "customer" | "agreement" | "service" | "organization";

function ruleScope(row: {
  customerId: number | null;
  commercialAgreementId: number | null;
  serviceCategory: string | null;
}): Scope {
  if (row.customerId !== null) return "customer";
  if (row.commercialAgreementId !== null) return "agreement";
  if (row.serviceCategory !== null) return "service";
  return "organization";
}

export const financeAutomaticSendRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .get("/", ...withLabPermission({ financial: ["read"] }), async (c) => {
    const member = c.get("member");
    const rows = await orgDb(member.organizationId).transaction((o) =>
      o
        .select({
          id: automaticSendRule.id,
          milestone: automaticSendRule.milestone,
          customerId: automaticSendRule.customerId,
          customerName: customer.name,
          commercialAgreementId: automaticSendRule.commercialAgreementId,
          serviceCategory: automaticSendRule.serviceCategory,
          priority: automaticSendRule.priority,
          archivedAt: automaticSendRule.archivedAt,
          createdAt: automaticSendRule.createdAt,
          updatedAt: automaticSendRule.updatedAt,
        })
        .from(automaticSendRule)
        .leftJoin(customer, eq(customer.id, automaticSendRule.customerId))
        .where(eq(automaticSendRule.organizationId, member.organizationId))
        .orderBy(automaticSendRule.id),
    );

    return c.json({
      data: rows.map((row) => ({
        id: row.id,
        milestone: row.milestone,
        customerId: row.customerId,
        customerName: row.customerName ?? null,
        commercialAgreementId: row.commercialAgreementId,
        serviceCategory: row.serviceCategory,
        priority: row.priority,
        scope: ruleScope(row),
        archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  })
  .post(
    "/",
    ...withLabPermission({ financial: ["contract_create"] }),
    zValidator("json", CreateRuleSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const body = c.req.valid("json");

      // The partial unique index is the authority: a second org-wide default rule
      // violates it, also when two requests race. Map that one index to 409. The
      // violation aborts the transaction, so it is caught outside it.
      const outcome = await orgDb(member.organizationId)
        .transaction(async (o) => {
          if (body.customerId != null) {
            const [matched] = await o
              .select({ id: customer.id })
              .from(customer)
              .where(
                and(
                  eq(customer.id, body.customerId),
                  eq(customer.labOrganizationId, member.organizationId),
                ),
              )
              .limit(1);
            if (!matched) return { status: "invalid_customer" as const };
          }

          // Same cross-tenant guard for the agreement the override is pinned to.
          if (
            body.commercialAgreementId != null &&
            !(await agreementBelongsToOrganization(
              member.organizationId,
              body.commercialAgreementId,
              o,
            ))
          ) {
            return { status: "invalid_agreement" as const };
          }

          const rows = await o
            .insert(automaticSendRule)
            .values({
              organizationId: member.organizationId,
              milestone: body.milestone,
              customerId: body.customerId ?? null,
              commercialAgreementId: body.commercialAgreementId ?? null,
              serviceCategory: body.serviceCategory ?? null,
              priority: body.priority ?? 0,
              createdByUserId: session.user.id,
            })
            .returning();
          return { status: "ok" as const, rows };
        })
        .catch((error: unknown) => {
          if (isUniqueViolationOf(error, ORG_DEFAULT_RULE_INDEX)) {
            return { status: "duplicate_default" as const };
          }
          throw error;
        });
      if (outcome.status === "invalid_customer") {
        return c.json({ error: "Cliente inválido" }, 400);
      }
      if (outcome.status === "invalid_agreement") {
        return c.json({ error: "Contrato inválido" }, 400);
      }
      if (outcome.status === "duplicate_default") {
        return c.json(
          { error: "Já existe uma regra padrão para a organização" },
          409,
        );
      }

      const created = outcome.rows[0];
      if (!created) return c.json({ error: "Falha ao criar regra" }, 500);

      return c.json({
        data: {
          id: created.id,
          milestone: created.milestone,
          customerId: created.customerId,
          commercialAgreementId: created.commercialAgreementId,
          serviceCategory: created.serviceCategory,
          priority: created.priority,
          scope: ruleScope(created),
          archivedAt: created.archivedAt
            ? created.archivedAt.toISOString()
            : null,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      });
    },
  )
  .put(
    "/:id",
    ...withLabPermission({ financial: ["contract_update"] }),
    zValidator("param", RuleIdParamSchema),
    zValidator("json", UpdateRuleSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");

      const outcome = await orgDb(member.organizationId).transaction(
        async (o) => {
          const [existing] = await o
            .select({
              id: automaticSendRule.id,
              customerId: automaticSendRule.customerId,
              commercialAgreementId: automaticSendRule.commercialAgreementId,
              serviceCategory: automaticSendRule.serviceCategory,
            })
            .from(automaticSendRule)
            .where(
              and(
                eq(automaticSendRule.id, id),
                eq(automaticSendRule.organizationId, member.organizationId),
              ),
            )
            .limit(1);
          if (!existing) return { status: "not_found" as const };

          const isOrgDefault =
            existing.customerId === null &&
            existing.commercialAgreementId === null &&
            existing.serviceCategory === null;
          if (isOrgDefault && body.archived === true) {
            return { status: "default_not_archivable" as const };
          }

          await o
            .update(automaticSendRule)
            .set({
              ...(body.milestone !== undefined
                ? { milestone: body.milestone }
                : {}),
              ...(body.priority !== undefined
                ? { priority: body.priority }
                : {}),
              ...(body.archived === true ? { archivedAt: new Date() } : {}),
              ...(body.archived === false ? { archivedAt: null } : {}),
              updatedAt: new Date(),
            })
            .where(eq(automaticSendRule.id, id));

          return { status: "ok" as const };
        },
      );
      if (outcome.status === "not_found") {
        return c.json({ error: "Regra não encontrada" }, 404);
      }
      if (outcome.status === "default_not_archivable") {
        return c.json(
          { error: "Regra padrão da organização não pode ser arquivada" },
          400,
        );
      }

      return c.json({ data: { id } });
    },
  );
