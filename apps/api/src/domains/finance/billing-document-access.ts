import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  billingDocument,
  billingDocumentItem,
  calibrationJob,
  customer,
  financialAuditLog,
  jobCommercialSnapshot,
  organizationUnit,
  paymentReceipt,
  receivableInstallment,
} from "@calibra-facil/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { forbidden, invalid, notFound } from "../../lib/domain-errors";
import type { AuthVariables } from "../../middleware/permission";

export async function getDocumentById(
  o: OrgDb,
  organizationId: string,
  documentId: number,
) {
  const [document] = await o
    .select({
      id: billingDocument.id,
      publicId: billingDocument.publicId,
      organizationId: billingDocument.organizationId,
      customerId: billingDocument.customerId,
      customerName: customer.name,
      unitId: billingDocument.unitId,
      unitName: organizationUnit.name,
      agreementId: billingDocument.agreementId,
      documentNumber: billingDocument.documentNumber,
      status: billingDocument.status,
      issueDate: billingDocument.issueDate,
      dueDate: billingDocument.dueDate,
      currency: billingDocument.currency,
      subtotalCents: billingDocument.subtotalCents,
      discountCents: billingDocument.discountCents,
      totalCents: billingDocument.totalCents,
      notes: billingDocument.notes,
      exportStatus: billingDocument.exportStatus,
      exportedAt: billingDocument.exportedAt,
      createdAt: billingDocument.createdAt,
      updatedAt: billingDocument.updatedAt,
      voidReason: billingDocument.voidReason,
    })
    .from(billingDocument)
    .innerJoin(customer, eq(billingDocument.customerId, customer.id))
    .innerJoin(
      organizationUnit,
      eq(billingDocument.unitId, organizationUnit.id),
    )
    .where(
      and(
        eq(billingDocument.id, documentId),
        eq(billingDocument.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!document) {
    return null;
  }

  const [items, installments, receipts, audit] = await Promise.all([
    o
      .select({
        id: billingDocumentItem.id,
        documentId: billingDocumentItem.documentId,
        jobId: billingDocumentItem.jobId,
        jobDisplayId: calibrationJob.jobId,
        jobCommercialSnapshotId: billingDocumentItem.jobCommercialSnapshotId,
        snapshotServiceName: jobCommercialSnapshot.serviceName,
        snapshotPriceCents: jobCommercialSnapshot.priceCents,
        description: billingDocumentItem.description,
        quantity: billingDocumentItem.quantity,
        unitPriceCents: billingDocumentItem.unitPriceCents,
        totalCents: billingDocumentItem.totalCents,
        sortOrder: billingDocumentItem.sortOrder,
      })
      .from(billingDocumentItem)
      .leftJoin(
        calibrationJob,
        eq(billingDocumentItem.jobId, calibrationJob.id),
      )
      .leftJoin(
        jobCommercialSnapshot,
        eq(
          billingDocumentItem.jobCommercialSnapshotId,
          jobCommercialSnapshot.id,
        ),
      )
      .where(eq(billingDocumentItem.documentId, document.id))
      .orderBy(billingDocumentItem.sortOrder, billingDocumentItem.id),
    o
      .select()
      .from(receivableInstallment)
      .where(eq(receivableInstallment.documentId, document.id))
      .orderBy(receivableInstallment.installmentNumber),
    o
      .select({
        id: paymentReceipt.id,
        installmentId: paymentReceipt.installmentId,
        amountCents: paymentReceipt.amountCents,
        paymentMethod: paymentReceipt.paymentMethod,
        reference: paymentReceipt.reference,
        notes: paymentReceipt.notes,
        receivedAt: paymentReceipt.receivedAt,
      })
      .from(paymentReceipt)
      .innerJoin(
        receivableInstallment,
        eq(paymentReceipt.installmentId, receivableInstallment.id),
      )
      .where(eq(receivableInstallment.documentId, document.id))
      .orderBy(desc(paymentReceipt.receivedAt)),
    o
      .select()
      .from(financialAuditLog)
      .where(
        and(
          eq(financialAuditLog.organizationId, organizationId),
          eq(financialAuditLog.entityType, "document"),
          eq(financialAuditLog.entityId, String(document.id)),
        ),
      )
      .orderBy(desc(financialAuditLog.performedAt)),
  ]);

  return {
    ...document,
    items,
    installments,
    receipts,
    audit,
  };
}

export async function getDocumentByPublicId(
  o: OrgDb,
  organizationId: string,
  publicId: string,
) {
  const [row] = await o
    .select({ id: billingDocument.id })
    .from(billingDocument)
    .where(
      and(
        eq(billingDocument.publicId, publicId),
        eq(billingDocument.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return getDocumentById(o, organizationId, row.id);
}

function isDocumentOutsideActiveUnitScope(
  member: AuthVariables["member"],
  unitId: number,
) {
  return member.selectedUnitScope !== "all" && unitId !== member.activeUnitId;
}

/** Throws 403 when the document belongs to a unit the caller is not working in. */
export function requireDocumentInUnitScope(
  member: AuthVariables["member"],
  unitId: number,
) {
  if (isDocumentOutsideActiveUnitScope(member, unitId)) {
    throw forbidden(
      "billing_document_outside_unit_scope",
      "Documento fora do escopo da unidade ativa",
    );
  }
}

/**
 * The laboratory's billing document (by numeric id) with its items,
 * installments, receipts and audit trail, inside the caller's active unit
 * scope. Throws 404 when none of this laboratory matches and 403 when it
 * belongs to another unit.
 */
export async function requireLabDocument(
  o: OrgDb,
  member: AuthVariables["member"],
  id: number,
) {
  const document = await getDocumentById(o, member.organizationId, id);
  if (!document) {
    throw notFound("billing_document_not_found", "Documento nao encontrado");
  }
  requireDocumentInUnitScope(member, document.unitId);
  return document;
}
