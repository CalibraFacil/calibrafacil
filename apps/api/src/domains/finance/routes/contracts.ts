import { createRouter } from "../../../server/router";
import {
  financeEndpoints,
  CreateAgreementSchema,
  UpdateAgreementSchema,
} from "@calibra-facil/contracts";
import { mount } from "../../../lib/endpoint-mount";
import { zValidator } from "@hono/zod-validator";
import type { z } from "zod";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { COMMERCIAL_AGREEMENT_MACHINE } from "@calibra-facil/schemas/machines";
import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  commercialAgreement,
  commercialAgreementServiceTerm,
  commercialAgreementUnitScope,
  customer,
} from "@calibra-facil/db/schema";
import {
  loadCustomerActiveCommercialAgreement,
  syncComplianceWithActiveAgreement,
} from "../finance";
import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";
import {
  servicesBelongToOrganization,
  unitsBelongToOrganization,
} from "../../../lib/tenant-refs";
import { invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { orgDb } from "../../../lib/org-db";
import { requestActor } from "../../../middleware/request-actor";

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
 * agreement would price or scope another tenant's catalog. Throws 400 when one
 * is not.
 */
async function assertAgreementRefsInOrganization(
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
    throw invalid("agreement_reference_invalid", "Unidade invalida");
  }
  const serviceIds = input.serviceTerms.map((term) => term.serviceId);
  if (!(await servicesBelongToOrganization(organizationId, serviceIds, o))) {
    throw invalid("agreement_reference_invalid", "Servico invalido");
  }
}

/**
 * The laboratory's commercial agreement with its unit scope and service terms.
 * Throws 404 when none of this laboratory matches.
 */
async function requireLabAgreement(
  o: OrgDb,
  organizationId: string,
  agreementId: number,
) {
  const agreement = await getAgreementById(o, organizationId, agreementId);
  if (!agreement) {
    throw notFound("agreement_not_found", "Contrato nao encontrado");
  }
  return agreement;
}

/** The laboratory's customer a contract names; throws 404 when it is not theirs. */
async function requireOwnedCustomer(
  o: OrgDb,
  organizationId: string,
  customerId: number,
) {
  const ownedCustomer = await customerBelongsToOrganization(
    o,
    organizationId,
    customerId,
  );
  if (!ownedCustomer) {
    throw notFound("customer_not_found", "Cliente nao encontrado");
  }
  return ownedCustomer;
}

const PREFIX = "/api/finance/contracts";

export const financeContractsRouter = createRouter<{
  Variables: AuthVariables;
}>();
mount(
  financeContractsRouter,
  PREFIX,
  financeEndpoints.listContracts,
  withLabPermission({ financial: ["read"] }),
  async (c, { query }) => {
    const member = c.get("member");
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

    return { data: agreements };
  },
);
mount(
  financeContractsRouter,
  PREFIX,
  financeEndpoints.createContract,
  withLabPermission({ financial: ["contract_create"] }),
  async (c, { body: input }) => {
    const member = c.get("member");

    const agreement = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        await requireOwnedCustomer(
          ctx.o,
          member.organizationId,
          input.customerId,
        );
        await assertAgreementRefsInOrganization(
          ctx.o,
          member.organizationId,
          input,
        );

        const [created] = await ctx.o
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
            createdBy: ctx.actor.userId,
            updatedBy: ctx.actor.userId,
          })
          .returning();

        if (!created) {
          throw new Error("Falha ao criar contrato comercial");
        }

        if (input.unitIds.length > 0) {
          await ctx.o.insert(commercialAgreementUnitScope).values(
            input.unitIds.map((unitId) => ({
              organizationId: member.organizationId,
              agreementId: created.id,
              unitId,
            })),
          );
        }

        await ctx.o.insert(commercialAgreementServiceTerm).values(
          input.serviceTerms.map((term) => ({
            organizationId: member.organizationId,
            agreementId: created.id,
            serviceId: term.serviceId,
            unitId: term.unitId ?? null,
            priceCents: term.priceCents,
            currency: term.currency,
            tatDays: term.tatDays ?? null,
            isActive: term.isActive,
          })),
        );

        return created;
      },
    );

    return { data: agreement };
  },
);
mount(
  financeContractsRouter,
  PREFIX,
  financeEndpoints.getContract,
  withLabPermission({ financial: ["read"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const { id } = params;

    const agreement = await orgDb(member.organizationId).transaction((o) =>
      requireLabAgreement(o, member.organizationId, id),
    );

    return { data: agreement };
  },
);
/** The numeric id of a contract route parameter; throws 400 when unreadable (the plain update route). */
function requireAgreementRouteId(routeId: string): number {
  const id = Number.parseInt(routeId, 10);
  if (!Number.isInteger(id)) throw invalid("invalid_request", "ID invalido");
  return id;
}

// A plain route: nothing in the frontends calls the contract update.
financeContractsRouter.put(
  "/:id",
  ...withLabPermission({ financial: ["contract_update"] }),
  zValidator("json", UpdateAgreementSchema),
  async (c) => {
    const member = c.get("member");
    const id = requireAgreementRouteId(c.req.param("id"));
    const input = c.req.valid("json");

    const agreement = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabAgreement(
          ctx.o,
          member.organizationId,
          id,
        );
        await requireOwnedCustomer(
          ctx.o,
          member.organizationId,
          input.customerId,
        );
        await assertAgreementRefsInOrganization(
          ctx.o,
          member.organizationId,
          input,
        );

        const [updated] = await ctx.o
          .update(commercialAgreement)
          .set({
            customerId: input.customerId,
            status:
              input.status && input.status !== existing.status
                ? COMMERCIAL_AGREEMENT_MACHINE.requireTransition(
                    existing.status,
                    "set_status",
                    input.status,
                  )
                : existing.status,
            agreementCode: input.agreementCode?.trim() || null,
            title: input.title,
            externalReference: input.externalReference?.trim() || null,
            currency: input.currency,
            effectiveFrom: new Date(input.effectiveFrom),
            effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
            defaultPaymentTermDays: input.defaultPaymentTermDays,
            notes: input.notes?.trim() || null,
            updatedBy: ctx.actor.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(commercialAgreement.id, id),
              eq(commercialAgreement.organizationId, member.organizationId),
            ),
          )
          .returning();

        await ctx.o
          .delete(commercialAgreementUnitScope)
          .where(eq(commercialAgreementUnitScope.agreementId, id));
        await ctx.o
          .delete(commercialAgreementServiceTerm)
          .where(eq(commercialAgreementServiceTerm.agreementId, id));

        if (input.unitIds.length > 0) {
          await ctx.o.insert(commercialAgreementUnitScope).values(
            input.unitIds.map((unitId) => ({
              organizationId: member.organizationId,
              agreementId: id,
              unitId,
            })),
          );
        }

        await ctx.o.insert(commercialAgreementServiceTerm).values(
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
        // separate writes; they share this transaction.
        if ((input.status ?? existing.status) === "ACTIVE") {
          // Ascending, so two reassignments in opposite directions lock the
          // customer rows in the same order and cannot deadlock.
          const customerIdsToSync = [
            ...new Set([existing.customerId, input.customerId]),
          ].sort((a, b) => a - b);
          for (const customerId of customerIdsToSync) {
            await syncCustomerComplianceContract(
              ctx.o,
              member.organizationId,
              customerId,
            );
          }
        }

        return updated;
      },
    );

    return c.json({ data: agreement });
  },
);
mount(
  financeContractsRouter,
  PREFIX,
  financeEndpoints.activateContract,
  withLabPermission({ financial: ["contract_update"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const { id } = params;

    const agreement = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabAgreement(
          ctx.o,
          member.organizationId,
          id,
        );

        if (existing.serviceTerms.length === 0) {
          throw invalid(
            "agreement_terms_required",
            "Contrato precisa ter pelo menos um termo de servico",
          );
        }

        const [updated] = await ctx.o
          .update(commercialAgreement)
          .set({
            status: COMMERCIAL_AGREEMENT_MACHINE.requireTargetOf(
              existing.status,
              "activate",
            ),
            updatedAt: new Date(),
            updatedBy: ctx.actor.userId,
          })
          .where(
            and(
              eq(commercialAgreement.id, id),
              eq(commercialAgreement.organizationId, member.organizationId),
            ),
          )
          .returning();
        if (!updated) {
          throw notFound("agreement_not_found", "Contrato nao encontrado");
        }

        await syncCustomerComplianceContract(
          ctx.o,
          member.organizationId,
          existing.customerId,
        );

        return updated;
      },
    );

    return { data: agreement };
  },
);
mount(
  financeContractsRouter,
  PREFIX,
  financeEndpoints.cancelContract,
  withLabPermission({ financial: ["contract_update"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const { id } = params;

    const canceled = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [agreement] = await ctx.o
          .update(commercialAgreement)
          .set({
            // `cancel` of COMMERCIAL_AGREEMENT_MACHINE (from any status).
            status: "CANCELED",
            updatedAt: new Date(),
            updatedBy: ctx.actor.userId,
          })
          .where(
            and(
              eq(commercialAgreement.id, id),
              eq(commercialAgreement.organizationId, member.organizationId),
            ),
          )
          .returning();

        if (!agreement) {
          throw notFound("agreement_not_found", "Contrato nao encontrado");
        }

        await syncCustomerComplianceContract(
          ctx.o,
          member.organizationId,
          agreement.customerId,
        );

        return agreement;
      },
    );

    return { data: canceled };
  },
);
