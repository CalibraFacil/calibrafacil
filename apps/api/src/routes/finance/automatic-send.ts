import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  automaticSendRule,
  customer,
} from "@calibra-facil/db/schema";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { requireFeature } from "../../middleware/tier-guard";
import type { AutomaticSendMilestone } from "@calibra-facil/shared";

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
  .get(
    "/",
    ...withLabPermission({ financial: ["read"] }),
    requireFeature("financial"),
    requireFeature("financial_integrations"),
    async (c) => {
      const member = c.get("member");
      const rows = await db
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
        .orderBy(automaticSendRule.id);

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
    },
  )
  .post(
    "/",
    ...withLabPermission({ financial: ["contract_create"] }),
    requireFeature("financial"),
    requireFeature("financial_integrations"),
    zValidator("json", CreateRuleSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const body = c.req.valid("json");

      if (body.customerId != null) {
        const [matched] = await db
          .select({ id: customer.id })
          .from(customer)
          .where(
            and(
              eq(customer.id, body.customerId),
              eq(customer.labOrganizationId, member.organizationId),
            ),
          )
          .limit(1);
        if (!matched) return c.json({ error: "Cliente inválido" }, 400);
      }

      const inserted = await db
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

      const created = inserted[0];
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
    requireFeature("financial"),
    requireFeature("financial_integrations"),
    zValidator("param", RuleIdParamSchema),
    zValidator("json", UpdateRuleSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");

      const [existing] = await db
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
      if (!existing) return c.json({ error: "Regra não encontrada" }, 404);

      const isOrgDefault =
        existing.customerId === null &&
        existing.commercialAgreementId === null &&
        existing.serviceCategory === null;
      if (isOrgDefault && body.archived === true) {
        return c.json(
          { error: "Regra padrão da organização não pode ser arquivada" },
          400,
        );
      }

      await db
        .update(automaticSendRule)
        .set({
          ...(body.milestone !== undefined
            ? { milestone: body.milestone }
            : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.archived === true ? { archivedAt: new Date() } : {}),
          ...(body.archived === false ? { archivedAt: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(automaticSendRule.id, id));

      return c.json({ data: { id } });
    },
  );
