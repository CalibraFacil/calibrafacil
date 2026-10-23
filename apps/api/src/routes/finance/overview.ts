import { Hono } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { isCalendarDatePast, labDaysUntil } from "@calibra-facil/shared";
import {
  billingDocument,
  customer,
  organizationUnit,
  paymentReceipt,
  receivableInstallment,
} from "@calibra-facil/db/schema";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { orgDb } from "../../lib/org-db";
import { buildUnitScopeCondition } from "../../lib/units";

function getAgingBucketLabel(daysOverdue: number) {
  if (daysOverdue <= 30) return "0_30";
  if (daysOverdue <= 60) return "31_60";
  if (daysOverdue <= 90) return "61_90";
  return "90_plus";
}

export const financeOverviewRouter = new Hono<{
  Variables: AuthVariables;
}>().get("/", ...withLabPermission({ financial: ["read"] }), async (c) => {
  const member = c.get("member");
  const { documentSummary, recentDocuments, openInstallments, receipts } =
    await orgDb(member.organizationId).transaction(async (o) => {
      const [summaryRow] = await o
        .select({
          issuedCents:
            sql<number>`coalesce(sum(case when ${billingDocument.status} in ('ISSUED', 'OVERDUE', 'PAID') then ${billingDocument.totalCents} else 0 end), 0)`.mapWith(
              Number,
            ),
          draftDocuments:
            sql<number>`count(*) filter (where ${billingDocument.status} = 'DRAFT')`.mapWith(
              Number,
            ),
          issuedDocuments:
            sql<number>`count(*) filter (where ${billingDocument.status} = 'ISSUED')`.mapWith(
              Number,
            ),
          overdueDocuments:
            sql<number>`count(*) filter (where ${billingDocument.status} = 'OVERDUE')`.mapWith(
              Number,
            ),
          paidDocuments:
            sql<number>`count(*) filter (where ${billingDocument.status} = 'PAID')`.mapWith(
              Number,
            ),
          pendingExports:
            sql<number>`count(*) filter (where ${billingDocument.exportStatus} = 'NOT_EXPORTED')`.mapWith(
              Number,
            ),
        })
        .from(billingDocument)
        .where(
          and(
            eq(billingDocument.organizationId, member.organizationId),
            buildUnitScopeCondition(billingDocument.unitId, member),
            inArray(billingDocument.status, [
              "DRAFT",
              "ISSUED",
              "PAID",
              "OVERDUE",
            ]),
          ),
        );

      const recentRows = await o
        .select({
          id: billingDocument.id,
          publicId: billingDocument.publicId,
          documentNumber: billingDocument.documentNumber,
          status: billingDocument.status,
          exportStatus: billingDocument.exportStatus,
          totalCents: billingDocument.totalCents,
          dueDate: billingDocument.dueDate,
          issueDate: billingDocument.issueDate,
          createdAt: billingDocument.createdAt,
          customerName: customer.name,
          unitName: organizationUnit.name,
        })
        .from(billingDocument)
        .innerJoin(customer, eq(billingDocument.customerId, customer.id))
        .innerJoin(
          organizationUnit,
          eq(billingDocument.unitId, organizationUnit.id),
        )
        .where(
          and(
            eq(billingDocument.organizationId, member.organizationId),
            buildUnitScopeCondition(billingDocument.unitId, member),
            inArray(billingDocument.status, [
              "DRAFT",
              "ISSUED",
              "PAID",
              "OVERDUE",
            ]),
          ),
        )
        .orderBy(desc(billingDocument.createdAt))
        .limit(8);

      const openRows = await o
        .select({
          amountCents: receivableInstallment.amountCents,
          dueDate: receivableInstallment.dueDate,
          status: receivableInstallment.status,
        })
        .from(receivableInstallment)
        .innerJoin(
          billingDocument,
          eq(receivableInstallment.documentId, billingDocument.id),
        )
        .where(
          and(
            eq(billingDocument.organizationId, member.organizationId),
            buildUnitScopeCondition(billingDocument.unitId, member),
            inArray(receivableInstallment.status, ["OPEN", "OVERDUE"]),
          ),
        );

      const receiptRows = await o
        .select({
          amountCents: paymentReceipt.amountCents,
        })
        .from(paymentReceipt)
        .innerJoin(
          receivableInstallment,
          eq(paymentReceipt.installmentId, receivableInstallment.id),
        )
        .innerJoin(
          billingDocument,
          eq(receivableInstallment.documentId, billingDocument.id),
        )
        .where(
          and(
            eq(billingDocument.organizationId, member.organizationId),
            buildUnitScopeCondition(billingDocument.unitId, member),
          ),
        );

      return {
        documentSummary: summaryRow,
        recentDocuments: recentRows,
        openInstallments: openRows,
        receipts: receiptRows,
      };
    });

  const now = new Date();
  const aging = {
    "0_30": 0,
    "31_60": 0,
    "61_90": 0,
    "90_plus": 0,
  };

  for (const installment of openInstallments) {
    // Whole laboratory days past the due day (due dates are calendar days).
    const daysOverdue = -labDaysUntil(installment.dueDate, now);

    if (daysOverdue > 0) {
      aging[getAgingBucketLabel(daysOverdue)] += installment.amountCents;
    }
  }

  return c.json({
    totals: {
      issuedCents: documentSummary?.issuedCents ?? 0,
      openCents: openInstallments.reduce(
        (sum, installment) => sum + installment.amountCents,
        0,
      ),
      overdueCents: openInstallments
        .filter((installment) => isCalendarDatePast(installment.dueDate, now))
        .reduce((sum, installment) => sum + installment.amountCents, 0),
      receivedCents: receipts.reduce(
        (sum, receipt) => sum + receipt.amountCents,
        0,
      ),
    },
    counts: {
      draftDocuments: documentSummary?.draftDocuments ?? 0,
      issuedDocuments: documentSummary?.issuedDocuments ?? 0,
      overdueDocuments: documentSummary?.overdueDocuments ?? 0,
      paidDocuments: documentSummary?.paidDocuments ?? 0,
    },
    aging,
    recentDocuments,
    pendingExports: documentSummary?.pendingExports ?? 0,
  });
});
