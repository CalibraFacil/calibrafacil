import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  billingDocument,
  customer,
  financialAuditLog,
  paymentReceipt,
  receivableInstallment,
} from "@calibra-facil/db/schema";
import { withInvalidation } from "../../middleware/cache";
import { withLabPermission, type AuthVariables } from "../../middleware/permission";
import { requireFeature } from "../../middleware/tier-guard";
import { buildUnitScopeCondition } from "../../lib/units";

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

export const financeReceiptsRouter = new Hono<{ Variables: AuthVariables }>()
  .get(
    "/",
    ...withLabPermission({ financial: ["read"] }),
    requireFeature("financial"),
    async (c) => {
      const member = c.get("member");

      const data = await db
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
        .orderBy(desc(receivableInstallment.dueDate), desc(receivableInstallment.id));

      return c.json({ data });
    },
  );

export const financeInstallmentsRouter = new Hono<{ Variables: AuthVariables }>().post(
  "/:id/receive",
    ...withLabPermission({ financial: ["receipt_record"] }),
    requireFeature("financial"),
    withInvalidation("finance"),
    zValidator("json", RecordReceiptSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const installmentId = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!Number.isInteger(installmentId)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const [installment] = await db
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
        .limit(1);

      if (!installment) {
        return c.json({ error: "Parcela nao encontrada" }, 404);
      }

      if (!["OPEN", "OVERDUE"].includes(installment.status)) {
        return c.json({ error: "Parcela nao pode ser baixada" }, 400);
      }

      if (installment.documentStatus === "VOID") {
        return c.json({ error: "Documento anulado nao pode receber baixa" }, 400);
      }

      if (input.amountCents !== installment.amountCents) {
        return c.json(
          { error: "O MVP aceita apenas baixa integral do valor em aberto" },
          400,
        );
      }

      const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();

      const [receipt] = await db.transaction(async (tx) => {
        const [createdReceipt] = await tx
          .insert(paymentReceipt)
          .values({
            installmentId,
            recordedBy: session.user.id,
            receivedAt,
            amountCents: input.amountCents,
            paymentMethod: input.paymentMethod,
            reference: input.reference?.trim() || null,
            notes: input.notes?.trim() || null,
          })
          .returning();

        await tx
          .update(receivableInstallment)
          .set({
            status: "PAID",
            paidAt: receivedAt,
            paymentMethod: input.paymentMethod,
            paymentReference: input.reference?.trim() || null,
            updatedAt: new Date(),
          })
          .where(eq(receivableInstallment.id, installmentId));

        await tx
          .update(billingDocument)
          .set({
            status: "PAID",
            updatedAt: new Date(),
            updatedBy: session.user.id,
          })
          .where(eq(billingDocument.id, installment.documentId));

        await tx.insert(financialAuditLog).values({
          organizationId: member.organizationId,
          entityType: "receipt",
          entityId: String(createdReceipt?.id ?? installmentId),
          action: "receipt.record",
          changes: {
            installmentId,
            amountCents: input.amountCents,
            paymentMethod: input.paymentMethod,
            receivedAt: receivedAt.toISOString(),
          },
          performedBy: session.user.id,
          reason: input.notes?.trim() || null,
        });

        return [createdReceipt];
      });

      return c.json({ data: receipt }, 201);
    },
  );
