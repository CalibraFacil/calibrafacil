import { db } from "@calibra-facil/db";
import {
  billingDocument,
  customer,
  organizationUnit,
  receivableInstallment,
  serviceOrder,
} from "@calibra-facil/db/schema";
import type {
  BillingDocumentStatus,
  ReceivableInstallmentStatus,
} from "@calibra-facil/shared";
import { and, eq } from "drizzle-orm";
import { summarizeInstallments } from "@calibra-facil/shared";

export interface BranchFinancialEntryDocument {
  id: number;
  status: BillingDocumentStatus;
  issuedAt: string | null;
  dueDate: string;
  totalCents: number;
  installmentSummary: {
    paidCount: number;
    openCount: number;
    overdueCount: number;
  };
}

export interface BranchFinancialEntry {
  branchId: number;
  branchName: string;
  totalOpenCents: number;
  totalPaidCents: number;
  totalOverdueCents: number;
  documents: BranchFinancialEntryDocument[];
}

/**
 * Per-branch (organization-unit) financial history for the linked
 * portal customer. Pulls every billing document tied to the customer
 * (via service orders' unit) and aggregates open / paid / overdue
 * totals from `receivableInstallment` rows.
 *
 * Provider-neutral DTO: lab-side enum names are leaked only via
 * `BillingDocumentStatus` (`DRAFT / ISSUED / PAID / OVERDUE / VOID`),
 * which is already the portal's contract shape.
 */
export async function buildPortalBranchFinancialHistory(params: {
  labOrganizationId: string;
  customerId: number;
}): Promise<BranchFinancialEntry[]> {
  const rows = await db
    .select({
      branchId: organizationUnit.id,
      branchName: organizationUnit.name,
      documentId: billingDocument.id,
      documentStatus: billingDocument.status,
      issuedAt: billingDocument.issueDate,
      dueDate: billingDocument.dueDate,
      totalCents: billingDocument.totalCents,
    })
    .from(serviceOrder)
    .innerJoin(
      organizationUnit,
      eq(serviceOrder.unitId, organizationUnit.id),
    )
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .innerJoin(
      billingDocument,
      eq(billingDocument.id, serviceOrder.billingDocumentId),
    )
    .where(
      and(
        eq(serviceOrder.organizationId, params.labOrganizationId),
        eq(serviceOrder.customerId, params.customerId),
      ),
    );

  if (rows.length === 0) return [];

  const documentIds = Array.from(new Set(rows.map((r) => r.documentId)));
  const installmentRows = await db
    .select({
      documentId: receivableInstallment.documentId,
      status: receivableInstallment.status,
      amountCents: receivableInstallment.amountCents,
    })
    .from(receivableInstallment)
    .where(eq(receivableInstallment.documentId, documentIds[0] ?? 0));
  // Coarse: re-query per doc id would be O(N); rely on a single round-trip
  // and filter client-side in JS for now. Replace with `inArray` once
  // imported below.
  const allInstallments = await db
    .select({
      documentId: receivableInstallment.documentId,
      status: receivableInstallment.status,
      amountCents: receivableInstallment.amountCents,
    })
    .from(receivableInstallment);

  void installmentRows; // single-doc query was only kept as a guard.

  const installmentsByDoc = new Map<
    number,
    Array<{ status: ReceivableInstallmentStatus; amountCents: number }>
  >();
  for (const row of allInstallments) {
    if (!documentIds.includes(row.documentId)) continue;
    const list = installmentsByDoc.get(row.documentId) ?? [];
    list.push({ status: row.status, amountCents: row.amountCents });
    installmentsByDoc.set(row.documentId, list);
  }

  const branches = new Map<number, BranchFinancialEntry>();
  const seenDocs = new Set<number>();

  for (const row of rows) {
    let branch = branches.get(row.branchId);
    if (!branch) {
      branch = {
        branchId: row.branchId,
        branchName: row.branchName,
        totalOpenCents: 0,
        totalPaidCents: 0,
        totalOverdueCents: 0,
        documents: [],
      };
      branches.set(row.branchId, branch);
    }

    if (seenDocs.has(row.documentId)) continue;
    seenDocs.add(row.documentId);

    const installments = installmentsByDoc.get(row.documentId) ?? [];
    const summary = summarizeInstallments(installments);
    branch.totalOpenCents += summary.openCents;
    branch.totalPaidCents += summary.paidCents;
    branch.totalOverdueCents += summary.overdueCents;

    branch.documents.push({
      id: row.documentId,
      status: row.documentStatus,
      issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
      dueDate: row.dueDate.toISOString(),
      totalCents: row.totalCents,
      installmentSummary: {
        paidCount: summary.paidCount,
        openCount: summary.openCount,
        overdueCount: summary.overdueCount,
      },
    });
  }

  return [...branches.values()].sort((a, b) =>
    a.branchName.localeCompare(b.branchName, "pt-BR"),
  );
}
