import { createRouter } from "../../server/router";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { conflict, invalid, notFound } from "../../lib/domain-errors";
import { withOrg } from "../../lib/org-context";
import { orgDb } from "../../lib/org-db";
import { automaticSendRule, customer } from "@calibra-facil/db/schema";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import type { AutomaticSendMilestone } from "@calibra-facil/shared";
import { agreementBelongsToOrganization } from "../../lib/tenant-refs";
import { isUniqueViolationOf } from "../../lib/db-errors";
import { requestActor } from "../../middleware/request-actor";

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

export const financeAutomaticSendRouter = createRouter<{
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
      const body = c.req.valid("json");

      // The partial unique index is the authority: a second org-wide default rule
      // violates it, also when two requests race. Map that one index to 409. The
      // violation aborts the transaction, so it is caught outside it.
      const created = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          if (body.customerId != null) {
            const [matched] = await ctx.o
              .select({ id: customer.id })
              .from(customer)
              .where(
                and(
                  eq(customer.id, body.customerId),
                  eq(customer.labOrganizationId, member.organizationId),
                ),
              )
              .limit(1);
            if (!matched) {
              throw invalid("rule_customer_invalid", "Cliente inválido");
            }
          }

          // Same cross-tenant guard for the agreement the override is pinned to.
          if (
            body.commercialAgreementId != null &&
            !(await agreementBelongsToOrganization(
              member.organizationId,
              body.commercialAgreementId,
              ctx.o,
            ))
          ) {
            throw invalid("rule_agreement_invalid", "Contrato inválido");
          }

          const [row] = await ctx.o
            .insert(automaticSendRule)
            .values({
              organizationId: member.organizationId,
              milestone: body.milestone,
              customerId: body.customerId ?? null,
              commercialAgreementId: body.commercialAgreementId ?? null,
              serviceCategory: body.serviceCategory ?? null,
              priority: body.priority ?? 0,
              createdByUserId: ctx.actor.userId,
            })
            .returning();
          if (!row) throw new Error("Falha ao criar regra");
          return row;
        },
      ).catch((error: unknown) => {
        if (isUniqueViolationOf(error, ORG_DEFAULT_RULE_INDEX)) {
          throw conflict(
            "automatic_send_default_exists",
            "Já existe uma regra padrão para a organização",
          );
        }
        throw error;
      });

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

      await withOrg(member.organizationId, requestActor(c), async (ctx) => {
        const [existing] = await ctx.o
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
        if (!existing) {
          throw notFound(
            "automatic_send_rule_not_found",
            "Regra não encontrada",
          );
        }

        const isOrgDefault =
          existing.customerId === null &&
          existing.commercialAgreementId === null &&
          existing.serviceCategory === null;
        if (isOrgDefault && body.archived === true) {
          throw invalid(
            "automatic_send_default_not_archivable",
            "Regra padrão da organização não pode ser arquivada",
          );
        }

        await ctx.o
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
      });

      return c.json({ data: { id } });
    },
  );
