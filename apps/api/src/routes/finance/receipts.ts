import { createRouter } from "../../server/router";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  BILLING_DOCUMENT_MACHINE,
  RECEIVABLE_INSTALLMENT_MACHINE,
} from "@calibra-facil/schemas/machines";

import {
  billingDocument,
  customer,
  paymentReceipt,
  receivableInstallment,
} from "@calibra-facil/db/schema";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { invalid, notFound } from "../../lib/domain-errors";
import { withOrg } from "../../lib/org-context";
import { orgDb } from "../../lib/org-db";
import { buildUnitScopeCondition } from "../../lib/units";
import { requestActor } from "../../middleware/request-actor";

const RecordReceiptSchema = z.object({
  amountCents: z.number().int().positive(),
  paymentMethod: z.enum([
    "CREDIT_CARD",
    "PIX",
    "BOLETO",
    "BANK_TRANSFER",
    "CASH",
    "OTHER",
  ]),
  receivedAt: z.string().datetime().optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(5000).optional(),
});

export const financeReceiptsRouter = createRouter<{
  Variables: AuthVariables;
}>().get("/", ...withLabPermission({ financial: ["read"] }), async (c) => {
  const member = c.get("member");

  const data = await orgDb(member.organizationId).transaction((o) =>
    o
      .select({
        installmentId: receivableInstallment.id,
        documentId: billingDocument.id,
        documentNumber: billingDocument.documentNumber,
        documentStatus: billingDocument.status,
        customerName: customer.name,
        dueDate: receivableInstallment.dueDate,
        amountCents: receivableInstallment.amountCents,
        installmentStatus: receivableInstallment.status,
        paidAt: receivableInstallment.paidAt,
        paymentMethod: receivableInstallment.paymentMethod,
        paymentReference: receivableInstallment.paymentReference,
      })
      .from(receivableInstallment)
      .innerJoin(
        billingDocument,
        eq(receivableInstallment.documentId, billingDocument.id),
      )
      .innerJoin(customer, eq(billingDocument.customerId, customer.id))
      .where(
        and(
          eq(billingDocument.organizationId, member.organizationId),
          buildUnitScopeCondition(billingDocument.unitId, member),
        ),
      )
      .orderBy(
        desc(receivableInstallment.dueDate),
        desc(receivableInstallment.id),
      ),
  );

  return c.json({ data });
});

export const financeInstallmentsRouter = createRouter<{
  Variables: AuthVariables;
}>().post(
  "/:id/receive",
  ...withLabPermission({ financial: ["receipt_record"] }),
  zValidator("json", RecordReceiptSchema),
  async (c) => {
    const member = c.get("member");
    const installmentId = Number.parseInt(c.req.param("id"), 10);
    const input = c.req.valid("json");

    if (!Number.isInteger(installmentId)) {
      throw invalid("invalid_request", "ID invalido");
    }

    const receivedAt = input.receivedAt
      ? new Date(input.receivedAt)
      : new Date();

    // The checks and the receipt (installment, document and audit rows) are one
    // transaction naming the laboratory.
    const receipt = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [installment] = await ctx.o
          .select({
            id: receivableInstallment.id,
            amountCents: receivableInstallment.amountCents,
            status: receivableInstallment.status,
            documentId: billingDocument.id,
            documentStatus: billingDocument.status,
          })
          .from(receivableInstallment)
          .innerJoin(
            billingDocument,
            eq(receivableInstallment.documentId, billingDocument.id),
          )
          .where(
            and(
              eq(receivableInstallment.id, installmentId),
              eq(billingDocument.organizationId, member.organizationId),
              buildUnitScopeCondition(billingDocument.unitId, member),
            ),
          )
          .limit(1)
          // Both rows locked: two receipts for one installment serialise, and
          // the second sees it PAID.
          .for("update");

        if (!installment) {
          throw notFound("installment_not_found", "Parcela nao encontrada");
        }

        if (
          !RECEIVABLE_INSTALLMENT_MACHINE.canTransition(
            installment.status,
            "pay",
          )
        ) {
          throw invalid(
            "installment_not_receivable",
            "Parcela nao pode ser baixada",
          );
        }

        if (
          !BILLING_DOCUMENT_MACHINE.canTransition(
            installment.documentStatus,
            "record_payment",
          )
        ) {
          throw invalid(
            "installment_document_void",
            "Documento anulado nao pode receber baixa",
          );
        }

        if (input.amountCents !== installment.amountCents) {
          throw invalid(
            "installment_partial_receipt_unsupported",
            "O MVP aceita apenas baixa integral do valor em aberto",
          );
        }

        const [createdReceipt] = await ctx.o
          .insert(paymentReceipt)
          .values({
            organizationId: member.organizationId,
            installmentId,
            recordedBy: ctx.actor.userId,
            receivedAt,
            amountCents: input.amountCents,
            paymentMethod: input.paymentMethod,
            reference: input.reference?.trim() || null,
            notes: input.notes?.trim() || null,
          })
          .returning();

        await ctx.o
          .update(receivableInstallment)
          .set({
            status: RECEIVABLE_INSTALLMENT_MACHINE.requireTargetOf(
              installment.status,
              "pay",
            ),
            paidAt: receivedAt,
            paymentMethod: input.paymentMethod,
            paymentReference: input.reference?.trim() || null,
            updatedAt: new Date(),
          })
          .where(eq(receivableInstallment.id, installmentId));

        await ctx.o
          .update(billingDocument)
          .set({
            status: BILLING_DOCUMENT_MACHINE.requireTargetOf(
              installment.documentStatus,
              "record_payment",
            ),
            updatedAt: new Date(),
            updatedBy: ctx.actor.userId,
          })
          .where(eq(billingDocument.id, installment.documentId));

        await ctx.audit(
          "financialReceipt",
          createdReceipt?.id ?? installmentId,
          {
            action: "receipt.record",
            changes: {
              installmentId,
              amountCents: input.amountCents,
              paymentMethod: input.paymentMethod,
              receivedAt: receivedAt.toISOString(),
            },
            reason: input.notes?.trim() || null,
          },
        );

        return createdReceipt;
      },
    );

    return c.json({ data: receipt }, 201);
  },
);
