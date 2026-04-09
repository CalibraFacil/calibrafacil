import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  commercialAgreement,
  commercialAgreementServiceTerm,
  commercialAgreementUnitScope,
  customer,
} from "@calibra-facil/db/schema";
import { type CommercialAgreementStatus } from "@calibra-facil/shared";
import {
  loadCustomerActiveCommercialAgreement,
  syncComplianceWithActiveAgreement,
} from "../../lib/finance";
import { withInvalidation } from "../../middleware/cache";
import { withLabPermission, type AuthVariables } from "../../middleware/permission";
import { requireFeature } from "../../middleware/tier-guard";

const COMMERCIAL_AGREEMENT_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "EXPIRED",
  "CANCELED",
] as const satisfies readonly CommercialAgreementStatus[];

const AgreementServiceTermSchema = z.object({
  id: z.number().int().optional(),
  serviceId: z.number().int().positive(),
  unitId: z.number().int().positive().nullable().optional(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().trim().min(3).max(8).default("BRL"),
  tatDays: z.number().int().nonnegative().nullable().optional(),
  isActive: z.boolean().default(true),
});

const CreateAgreementSchema = z.object({
  customerId: z.number().int().positive(),
  title: z.string().trim().min(3).max(120),
  agreementCode: z.string().trim().max(60).optional(),
  externalReference: z.string().trim().max(120).optional(),
  currency: z.string().trim().min(3).max(8).default("BRL"),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().optional(),
  defaultPaymentTermDays: z.number().int().min(1).max(180).default(28),
  notes: z.string().trim().max(5000).optional(),
  unitIds: z.array(z.number().int().positive()).default([]),
  serviceTerms: z.array(AgreementServiceTermSchema).min(1),
});

const UpdateAgreementSchema = CreateAgreementSchema.extend({
  status: z.enum(COMMERCIAL_AGREEMENT_STATUSES).optional(),
});

const ListContractsQuerySchema = z.object({
  query: z.string().trim().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  status: z.enum(COMMERCIAL_AGREEMENT_STATUSES).optional(),
});

async function getAgreementById(organizationId: string, agreementId: number) {
  const [agreement] = await db
    .select({
      id: commercialAgreement.id,
      organizationId: commercialAgreement.organizationId,
      customerId: commercialAgreement.customerId,
      customerName: customer.name,
      customerCompliance: customer.compliance,
      status: commercialAgreement.status,
      agreementCode: commercialAgreement.agreementCode,
      title: commercialAgreement.title,
      externalReference: commercialAgreement.externalReference,
      currency: commercialAgreement.currency,
      effectiveFrom: commercialAgreement.effectiveFrom,
      effectiveTo: commercialAgreement.effectiveTo,
      defaultPaymentTermDays: commercialAgreement.defaultPaymentTermDays,
      notes: commercialAgreement.notes,
      createdAt: commercialAgreement.createdAt,
      updatedAt: commercialAgreement.updatedAt,
    })
    .from(commercialAgreement)
    .innerJoin(customer, eq(commercialAgreement.customerId, customer.id))
    .where(
      and(
        eq(commercialAgreement.id, agreementId),
        eq(commercialAgreement.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!agreement) {
    return null;
  }

  const [unitScopes, serviceTerms] = await Promise.all([
    db
      .select({
        unitId: commercialAgreementUnitScope.unitId,
      })
      .from(commercialAgreementUnitScope)
      .where(eq(commercialAgreementUnitScope.agreementId, agreement.id)),
    db
      .select()
      .from(commercialAgreementServiceTerm)
      .where(eq(commercialAgreementServiceTerm.agreementId, agreement.id))
      .orderBy(
        commercialAgreementServiceTerm.unitId,
        commercialAgreementServiceTerm.serviceId,
      ),
  ]);

  return {
    ...agreement,
    unitIds: unitScopes.map((unit) => unit.unitId),
    serviceTerms,
  };
}

async function syncCustomerComplianceContract(
  organizationId: string,
  customerId: number,
) {
  const [currentCustomer] = await db
    .select({
      compliance: customer.compliance,
    })
    .from(customer)
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.labOrganizationId, organizationId),
      ),
    )
    .limit(1);

  if (!currentCustomer) {
    return null;
  }

  const activeCommercialAgreement = await loadCustomerActiveCommercialAgreement(
    organizationId,
    customerId,
  );
  const nextCompliance = syncComplianceWithActiveAgreement(
    currentCustomer.compliance,
    activeCommercialAgreement,
  );

  const [updatedCustomer] = await db
    .update(customer)
    .set({
      compliance: nextCompliance,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.labOrganizationId, organizationId),
      ),
    )
    .returning();

  return updatedCustomer ?? null;
}

export const financeContractsRouter = new Hono<{ Variables: AuthVariables }>()
  .get(
    "/",
    ...withLabPermission({ financial: ["read"] }),
    requireFeature("financial"),
    zValidator("query", ListContractsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const query = c.req.valid("query");
      const conditions = [eq(commercialAgreement.organizationId, member.organizationId)];

      if (query.customerId) {
        conditions.push(eq(commercialAgreement.customerId, query.customerId));
      }

      if (query.status) {
        conditions.push(eq(commercialAgreement.status, query.status));
      }

      if (query.query) {
        conditions.push(
          ilike(
            sql<string>`coalesce(${commercialAgreement.title}, '') || ' ' || coalesce(${customer.name}, '') || ' ' || coalesce(${commercialAgreement.agreementCode}, '')`,
            `%${query.query}%`,
          ),
        );
      }

      const agreements = await db
        .select({
          id: commercialAgreement.id,
          customerId: commercialAgreement.customerId,
          customerName: customer.name,
          status: commercialAgreement.status,
          agreementCode: commercialAgreement.agreementCode,
          title: commercialAgreement.title,
          currency: commercialAgreement.currency,
          effectiveFrom: commercialAgreement.effectiveFrom,
          effectiveTo: commercialAgreement.effectiveTo,
          defaultPaymentTermDays: commercialAgreement.defaultPaymentTermDays,
          updatedAt: commercialAgreement.updatedAt,
        })
        .from(commercialAgreement)
        .innerJoin(customer, eq(commercialAgreement.customerId, customer.id))
        .where(and(...conditions))
        .orderBy(desc(commercialAgreement.updatedAt));

      return c.json({ data: agreements });
    },
  )
  .post(
    "/",
    ...withLabPermission({ financial: ["contract_create"] }),
    requireFeature("financial"),
    withInvalidation("finance"),
    zValidator("json", CreateAgreementSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const [created] = await db.transaction(async (tx) => {
        const [agreement] = await tx
          .insert(commercialAgreement)
          .values({
            organizationId: member.organizationId,
            customerId: input.customerId,
            status: "DRAFT",
            agreementCode: input.agreementCode?.trim() || null,
            title: input.title,
            externalReference: input.externalReference?.trim() || null,
            currency: input.currency,
            effectiveFrom: new Date(input.effectiveFrom),
            effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
            defaultPaymentTermDays: input.defaultPaymentTermDays,
            notes: input.notes?.trim() || null,
            createdBy: session.user.id,
            updatedBy: session.user.id,
          })
          .returning();

        if (!agreement) {
          throw new Error("Falha ao criar contrato comercial");
        }

        if (input.unitIds.length > 0) {
          await tx.insert(commercialAgreementUnitScope).values(
            input.unitIds.map((unitId) => ({
              agreementId: agreement.id,
              unitId,
            })),
          );
        }

        await tx.insert(commercialAgreementServiceTerm).values(
          input.serviceTerms.map((term) => ({
            agreementId: agreement.id,
            serviceId: term.serviceId,
            unitId: term.unitId ?? null,
            priceCents: term.priceCents,
            currency: term.currency,
            tatDays: term.tatDays ?? null,
            isActive: term.isActive,
          })),
        );

        return [agreement];
      });

      return c.json({ data: created }, 201);
    },
  )
  .get(
    "/:id",
    ...withLabPermission({ financial: ["read"] }),
    requireFeature("financial"),
    async (c) => {
      const member = c.get("member");
      const id = Number.parseInt(c.req.param("id"), 10);

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const agreement = await getAgreementById(member.organizationId, id);
      if (!agreement) {
        return c.json({ error: "Contrato nao encontrado" }, 404);
      }

      return c.json({ data: agreement });
    },
  )
  .put(
    "/:id",
    ...withLabPermission({ financial: ["contract_update"] }),
    requireFeature("financial"),
    withInvalidation("finance"),
    zValidator("json", UpdateAgreementSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const existing = await getAgreementById(member.organizationId, id);
      if (!existing) {
        return c.json({ error: "Contrato nao encontrado" }, 404);
      }

      const [updated] = await db.transaction(async (tx) => {
        const [agreement] = await tx
          .update(commercialAgreement)
          .set({
            customerId: input.customerId,
            status: input.status ?? existing.status,
            agreementCode: input.agreementCode?.trim() || null,
            title: input.title,
            externalReference: input.externalReference?.trim() || null,
            currency: input.currency,
            effectiveFrom: new Date(input.effectiveFrom),
            effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
            defaultPaymentTermDays: input.defaultPaymentTermDays,
            notes: input.notes?.trim() || null,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(commercialAgreement.id, id),
              eq(commercialAgreement.organizationId, member.organizationId),
            ),
          )
          .returning();

        await tx
          .delete(commercialAgreementUnitScope)
          .where(eq(commercialAgreementUnitScope.agreementId, id));
        await tx
          .delete(commercialAgreementServiceTerm)
          .where(eq(commercialAgreementServiceTerm.agreementId, id));

        if (input.unitIds.length > 0) {
          await tx.insert(commercialAgreementUnitScope).values(
            input.unitIds.map((unitId) => ({
              agreementId: id,
              unitId,
            })),
          );
        }

        await tx.insert(commercialAgreementServiceTerm).values(
          input.serviceTerms.map((term) => ({
            agreementId: id,
            serviceId: term.serviceId,
            unitId: term.unitId ?? null,
            priceCents: term.priceCents,
            currency: term.currency,
            tatDays: term.tatDays ?? null,
            isActive: term.isActive,
          })),
        );

        return [agreement];
      });

      if ((input.status ?? existing.status) === "ACTIVE") {
        const customerIdsToSync = new Set([existing.customerId, input.customerId]);
        for (const customerId of customerIdsToSync) {
          await syncCustomerComplianceContract(member.organizationId, customerId);
        }
      }

      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/activate",
    ...withLabPermission({ financial: ["contract_update"] }),
    requireFeature("financial"),
    withInvalidation("finance"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const existing = await getAgreementById(member.organizationId, id);
      if (!existing) {
        return c.json({ error: "Contrato nao encontrado" }, 404);
      }

      if (existing.serviceTerms.length === 0) {
        return c.json(
          { error: "Contrato precisa ter pelo menos um termo de servico" },
          400,
        );
      }

      const [updated] = await db
        .update(commercialAgreement)
        .set({
          status: "ACTIVE",
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(
          and(
            eq(commercialAgreement.id, id),
            eq(commercialAgreement.organizationId, member.organizationId),
          ),
        )
        .returning();

      await syncCustomerComplianceContract(
        member.organizationId,
        existing.customerId,
      );

      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/cancel",
    ...withLabPermission({ financial: ["contract_update"] }),
    requireFeature("financial"),
    withInvalidation("finance"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const [updated] = await db
        .update(commercialAgreement)
        .set({
          status: "CANCELED",
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(
          and(
            eq(commercialAgreement.id, id),
            eq(commercialAgreement.organizationId, member.organizationId),
          ),
        )
        .returning();

      if (!updated) {
        return c.json({ error: "Contrato nao encontrado" }, 404);
      }

      await syncCustomerComplianceContract(
        member.organizationId,
        updated.customerId,
      );

      return c.json({ data: updated });
    },
  );
