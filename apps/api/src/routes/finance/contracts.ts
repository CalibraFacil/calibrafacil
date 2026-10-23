import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import type { OrgDb } from "@calibra-facil/db/for-org";
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
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import {
  servicesBelongToOrganization,
  unitsBelongToOrganization,
} from "../../lib/tenant-refs";
import { orgDb } from "../../lib/org-db";

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

async function customerBelongsToOrganization(
  executor: OrgDb,
  organizationId: string,
  customerId: number,
) {
  const [ownedCustomer] = await executor
    .select({ id: customer.id })
    .from(customer)
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.labOrganizationId, organizationId),
      ),
    )
    .limit(1);

  return ownedCustomer ?? null;
}

async function getAgreementById(
  o: OrgDb,
  organizationId: string,
  agreementId: number,
) {
  const [agreement] = await o
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
        eq(customer.labOrganizationId, organizationId),
      ),
    )
    .limit(1);

  if (!agreement) {
    return null;
  }

  const [unitScopes, serviceTerms] = await Promise.all([
    o
      .select({
        unitId: commercialAgreementUnitScope.unitId,
      })
      .from(commercialAgreementUnitScope)
      .where(eq(commercialAgreementUnitScope.agreementId, agreement.id)),
    o
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
  o: OrgDb,
  organizationId: string,
  customerId: number,
) {
  const [currentCustomer] = await o
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
    o,
  );
  const nextCompliance = syncComplianceWithActiveAgreement(
    currentCustomer.compliance,
    activeCommercialAgreement,
  );

  const [updatedCustomer] = await o
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

/**
 * The units and services a contract names (scope + price terms) are body-supplied
 * ids: every one must belong to the caller's organization, otherwise the
 * agreement would price or scope another tenant's catalog. Returns the refusal
 * message, or null when all ids are in-org.
 */
async function findForeignAgreementRef(
  o: OrgDb,
  organizationId: string,
  input: z.infer<typeof CreateAgreementSchema>,
) {
  const unitIds = [
    ...input.unitIds,
    ...input.serviceTerms.flatMap((term) =>
      term.unitId == null ? [] : [term.unitId],
    ),
  ];
  if (!(await unitsBelongToOrganization(organizationId, unitIds, o))) {
    return "Unidade invalida";
  }
  const serviceIds = input.serviceTerms.map((term) => term.serviceId);
  if (!(await servicesBelongToOrganization(organizationId, serviceIds, o))) {
    return "Servico invalido";
  }
  return null;
}

export const financeContractsRouter = new Hono<{ Variables: AuthVariables }>()
  .get(
    "/",
    ...withLabPermission({ financial: ["read"] }),
    zValidator("query", ListContractsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const query = c.req.valid("query");
      const conditions = [
        eq(commercialAgreement.organizationId, member.organizationId),
        eq(customer.labOrganizationId, member.organizationId),
      ];

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

      const agreements = await orgDb(member.organizationId).transaction((o) =>
        o
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
          .orderBy(desc(commercialAgreement.updatedAt)),
      );

      return c.json({ data: agreements });
    },
  )
  .post(
    "/",
    ...withLabPermission({ financial: ["contract_create"] }),
    zValidator("json", CreateAgreementSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const outcome = await orgDb(member.organizationId).transaction(
        async (o) => {
          const ownedCustomer = await customerBelongsToOrganization(
            o,
            member.organizationId,
            input.customerId,
          );
          if (!ownedCustomer) return { status: "customer_not_found" as const };

          const foreignRef = await findForeignAgreementRef(
            o,
            member.organizationId,
            input,
          );
          if (foreignRef) return { status: "foreign_ref" as const, foreignRef };

          const [agreement] = await o
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
              effectiveTo: input.effectiveTo
                ? new Date(input.effectiveTo)
                : null,
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
            await o.insert(commercialAgreementUnitScope).values(
              input.unitIds.map((unitId) => ({
                organizationId: member.organizationId,
                agreementId: agreement.id,
                unitId,
              })),
            );
          }

          await o.insert(commercialAgreementServiceTerm).values(
            input.serviceTerms.map((term) => ({
              organizationId: member.organizationId,
              agreementId: agreement.id,
              serviceId: term.serviceId,
              unitId: term.unitId ?? null,
              priceCents: term.priceCents,
              currency: term.currency,
              tatDays: term.tatDays ?? null,
              isActive: term.isActive,
            })),
          );

          return { status: "ok" as const, agreement };
        },
      );
      if (outcome.status === "customer_not_found") {
        return c.json({ error: "Cliente nao encontrado" }, 404);
      }
      if (outcome.status === "foreign_ref") {
        return c.json({ error: outcome.foreignRef }, 400);
      }

      return c.json({ data: outcome.agreement }, 201);
    },
  )
  .get("/:id", ...withLabPermission({ financial: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = Number.parseInt(c.req.param("id"), 10);

    if (!Number.isInteger(id)) {
      return c.json({ error: "ID invalido" }, 400);
    }

    const agreement = await orgDb(member.organizationId).transaction((o) =>
      getAgreementById(o, member.organizationId, id),
    );
    if (!agreement) {
      return c.json({ error: "Contrato nao encontrado" }, 404);
    }

    return c.json({ data: agreement });
  })
  .put(
    "/:id",
    ...withLabPermission({ financial: ["contract_update"] }),
    zValidator("json", UpdateAgreementSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const outcome = await orgDb(member.organizationId).transaction(
        async (o) => {
          const existing = await getAgreementById(o, member.organizationId, id);
          if (!existing) return { status: "agreement_not_found" as const };

          const ownedCustomer = await customerBelongsToOrganization(
            o,
            member.organizationId,
            input.customerId,
          );
          if (!ownedCustomer) return { status: "customer_not_found" as const };

          const foreignRef = await findForeignAgreementRef(
            o,
            member.organizationId,
            input,
          );
          if (foreignRef) return { status: "foreign_ref" as const, foreignRef };

          const [agreement] = await o
            .update(commercialAgreement)
            .set({
              customerId: input.customerId,
              status: input.status ?? existing.status,
              agreementCode: input.agreementCode?.trim() || null,
              title: input.title,
              externalReference: input.externalReference?.trim() || null,
              currency: input.currency,
              effectiveFrom: new Date(input.effectiveFrom),
              effectiveTo: input.effectiveTo
                ? new Date(input.effectiveTo)
                : null,
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

          await o
            .delete(commercialAgreementUnitScope)
            .where(eq(commercialAgreementUnitScope.agreementId, id));
          await o
            .delete(commercialAgreementServiceTerm)
            .where(eq(commercialAgreementServiceTerm.agreementId, id));

          if (input.unitIds.length > 0) {
            await o.insert(commercialAgreementUnitScope).values(
              input.unitIds.map((unitId) => ({
                organizationId: member.organizationId,
                agreementId: id,
                unitId,
              })),
            );
          }

          await o.insert(commercialAgreementServiceTerm).values(
            input.serviceTerms.map((term) => ({
              organizationId: member.organizationId,
              agreementId: id,
              serviceId: term.serviceId,
              unitId: term.unitId ?? null,
              priceCents: term.priceCents,
              currency: term.currency,
              tatDays: term.tatDays ?? null,
              isActive: term.isActive,
            })),
          );

          // The agreement update and the customers' compliance follow-up are
          // separate writes, as before; they share this transaction now.
          if ((input.status ?? existing.status) === "ACTIVE") {
            const customerIdsToSync = new Set([
              existing.customerId,
              input.customerId,
            ]);
            for (const customerId of customerIdsToSync) {
              await syncCustomerComplianceContract(
                o,
                member.organizationId,
                customerId,
              );
            }
          }

          return { status: "ok" as const, agreement };
        },
      );
      if (outcome.status === "agreement_not_found") {
        return c.json({ error: "Contrato nao encontrado" }, 404);
      }
      if (outcome.status === "customer_not_found") {
        return c.json({ error: "Cliente nao encontrado" }, 404);
      }
      if (outcome.status === "foreign_ref") {
        return c.json({ error: outcome.foreignRef }, 400);
      }

      return c.json({ data: outcome.agreement });
    },
  )
  .post(
    "/:id/activate",
    ...withLabPermission({ financial: ["contract_update"] }),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const outcome = await orgDb(member.organizationId).transaction(
        async (o) => {
          const existing = await getAgreementById(o, member.organizationId, id);
          if (!existing) return { status: "not_found" as const };

          if (existing.serviceTerms.length === 0) {
            return { status: "no_terms" as const };
          }

          const [updated] = await o
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
            o,
            member.organizationId,
            existing.customerId,
          );

          return { status: "ok" as const, agreement: updated };
        },
      );
      if (outcome.status === "not_found") {
        return c.json({ error: "Contrato nao encontrado" }, 404);
      }
      if (outcome.status === "no_terms") {
        return c.json(
          { error: "Contrato precisa ter pelo menos um termo de servico" },
          400,
        );
      }

      return c.json({ data: outcome.agreement });
    },
  )
  .post(
    "/:id/cancel",
    ...withLabPermission({ financial: ["contract_update"] }),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const updated = await orgDb(member.organizationId).transaction(
        async (o) => {
          const [agreement] = await o
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

          if (!agreement) return null;

          await syncCustomerComplianceContract(
            o,
            member.organizationId,
            agreement.customerId,
          );

          return agreement;
        },
      );

      if (!updated) {
        return c.json({ error: "Contrato nao encontrado" }, 404);
      }

      return c.json({ data: updated });
    },
  );
