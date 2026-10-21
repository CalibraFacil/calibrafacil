import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  assetAuditLog,
  billingDocument,
  billingDocumentItem,
  calibrationJob,
  customerAuditLog,
  jobAuditLog,
  jobStandard,
  paymentReceipt,
  receivableInstallment,
  serviceAuditLog,
  serviceOrder,
  serviceOrderAssetSnapshot,
  serviceOrderExecution,
  serviceOrderExecutionItem,
  serviceOrderQuote,
  serviceOrderQuoteItem,
} from "@calibra-facil/db/schema";
import { seedOrg, seedStandard } from "./seed";
import { seedJobForOrg } from "./tenant-refs";

export type Tenant = {
  orgId: string;
  userId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  serviceId: number;
  jobId: number;
  standardId: number;
  documentId: number;
  installmentId: number;
  serviceOrderId: number;
  quoteId: number;
  executionId: number;
};

export const QUOTE_ITEM = {
  type: "service" as const,
  description: "Mao de obra",
  quantity: 1,
  unit: "un",
  unitPriceCents: 100,
  totalPriceCents: 100,
};

/** One laboratory with a record in every parent the 0118 children hang from. */
export async function seedTenant(orgId: string): Promise<Tenant> {
  const org = await seedOrg({ orgId, userId: `user-${orgId}`, role: "admin" });
  const { jobId, assetId, serviceId } = await seedJobForOrg({
    orgId,
    unitId: org.unitId,
    createdBy: org.userId,
  });
  const [job] = await db
    .select({ customerId: calibrationJob.customerId })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.id, jobId),
        eq(calibrationJob.organizationId, orgId),
      ),
    );
  if (!job) throw new Error("job not seeded");
  const standardId = await seedStandard({
    organizationId: orgId,
    unitId: org.unitId,
    createdBy: org.userId,
  });

  const [document] = await db
    .insert(billingDocument)
    .values({
      organizationId: orgId,
      customerId: job.customerId,
      unitId: org.unitId,
      dueDate: new Date("2026-02-01T00:00:00.000Z"),
      subtotalCents: 1000,
      totalCents: 1000,
      createdBy: org.userId,
      updatedBy: org.userId,
    })
    .returning({ id: billingDocument.id });
  if (!document) throw new Error("document not seeded");
  const [installment] = await db
    .insert(receivableInstallment)
    .values({
      organizationId: orgId,
      documentId: document.id,
      dueDate: new Date("2026-02-01T00:00:00.000Z"),
      amountCents: 1000,
    })
    .returning({ id: receivableInstallment.id });
  if (!installment) throw new Error("installment not seeded");

  const [order] = await db
    .insert(serviceOrder)
    .values({
      organizationId: orgId,
      unitId: org.unitId,
      serviceOrderNumber: `OS-${orgId}`,
      customerId: job.customerId,
      assetId,
      openedByUserId: org.userId,
      claimedDefect: "Nao liga",
      intakeCondition: "Riscos",
    })
    .returning({ id: serviceOrder.id });
  if (!order) throw new Error("order not seeded");
  const [quote] = await db
    .insert(serviceOrderQuote)
    .values({
      organizationId: orgId,
      serviceOrderId: order.id,
      quoteNumber: `ORC-${orgId}`,
      version: 1,
      createdByUserId: org.userId,
    })
    .returning({ id: serviceOrderQuote.id });
  if (!quote) throw new Error("quote not seeded");
  const [execution] = await db
    .insert(serviceOrderExecution)
    .values({
      organizationId: orgId,
      serviceOrderId: order.id,
      startedByUserId: org.userId,
    })
    .returning({ id: serviceOrderExecution.id });
  if (!execution) throw new Error("execution not seeded");

  return {
    orgId,
    userId: org.userId,
    unitId: org.unitId,
    customerId: job.customerId,
    assetId,
    serviceId,
    jobId,
    standardId,
    documentId: document.id,
    installmentId: installment.id,
    serviceOrderId: order.id,
    quoteId: quote.id,
    executionId: execution.id,
  };
}

/** Child rows of every parent seeded by `seedTenant`, all carrying `t.orgId`. */
export async function seedTenantChildren(t: Tenant): Promise<void> {
  const organizationId = t.orgId;
  await db.insert(billingDocumentItem).values({
    organizationId,
    documentId: t.documentId,
    description: "Item",
    quantity: 1,
    unitPriceCents: 1000,
    totalCents: 1000,
  });
  await db.insert(paymentReceipt).values({
    organizationId,
    installmentId: t.installmentId,
    recordedBy: t.userId,
    amountCents: 1000,
    paymentMethod: "PIX",
  });
  await db.insert(jobStandard).values({
    organizationId,
    jobId: t.jobId,
    standardId: t.standardId,
  });
  await db.insert(serviceOrderAssetSnapshot).values({
    organizationId,
    serviceOrderId: t.serviceOrderId,
    assetId: t.assetId,
    assetName: "Balanca",
    assetType: "Balanca",
  });
  await db.insert(serviceOrderQuoteItem).values({
    organizationId,
    quoteId: t.quoteId,
    ...QUOTE_ITEM,
  });
  await db.insert(serviceOrderExecutionItem).values({
    organizationId,
    executionId: t.executionId,
    ...QUOTE_ITEM,
    unitCostCents: 0,
  });
  const audit = {
    organizationId,
    action: "create",
    performedBy: t.userId,
  };
  await db.insert(jobAuditLog).values({ ...audit, jobId: t.jobId });
  await db.insert(assetAuditLog).values({ ...audit, assetId: t.assetId });
  await db
    .insert(customerAuditLog)
    .values({ ...audit, customerId: t.customerId });
  await db.insert(serviceAuditLog).values({ ...audit, serviceId: t.serviceId });
}

/** The tables `seedTenantChildren` + `seedTenant` fill, with the 0118 ones first. */
export const SEEDED_CHILD_TABLES = [
  "receivable_installment",
  "payment_receipt",
  "billing_document_item",
  "job_standard",
  "service_order_asset_snapshot",
  "service_order_execution",
  "service_order_execution_item",
  "service_order_quote",
  "service_order_quote_item",
  "job_audit_log",
  "asset_audit_log",
  "customer_audit_log",
  "service_audit_log",
] as const;
