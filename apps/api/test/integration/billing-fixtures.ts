import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  organization,
  service,
  serviceOrder,
  serviceOrderCertificateLink,
} from "@calibra-facil/db/schema";
import { insertJobs } from "./job-fixtures";
import { organizationOf } from "./organization-of";
import { seedOrg } from "./seed";

// Harness code: a laboratory with everything the service-order and finance
// endpoints read (a customer with complete billing data, an asset, a priced
// service), plus builders for approved certificate jobs and service orders.
// Shared by service-orders-lab-scope.int.spec.ts and
// finance/finance-lab-scope.int.spec.ts.

const NOW = new Date("2026-01-01T00:00:00.000Z");

export const SERVICE_PRICE_CENTS = 15_000;

export type BillingLab = Awaited<ReturnType<typeof seedBillingLab>>;

/**
 * A laboratory (admin session user, default unit) with a customer that has the
 * tax id, e-mail and address the billing blockers ask for, an asset of that
 * customer and a service priced at SERVICE_PRICE_CENTS.
 */
export async function seedBillingLab(
  orgId: string,
  role: "owner" | "admin" | "technician" | "operator" | "member" = "admin",
) {
  const org = await seedOrg({ orgId, role });
  const clientOrgId = `client-${orgId}`;
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: NOW,
  });
  const [customerRow] = await db
    .insert(customer)
    .values({
      name: `Customer ${orgId}`,
      authOrganizationId: clientOrgId,
      labOrganizationId: orgId,
      taxId: "12345678000190",
      email: `financeiro@${orgId}.test`,
      address: { city: "Sao Paulo", state: "SP" },
    })
    .returning({ id: customer.id });
  const [typeRow] = await db
    .insert(assetType)
    .values({ name: `Type ${orgId}`, slug: `type-${orgId}`, definition: [] })
    .returning({ id: assetType.id });
  if (!customerRow || !typeRow)
    throw new Error("seedBillingLab: insert failed");
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: org.unitId,
      customerId: customerRow.id,
      labOrganizationId: orgId,
      assetTypeId: typeRow.id,
      name: `Instrument ${orgId}`,
      serialNumber: `SN-${orgId}`,
      tag: `TAG-${orgId}`,
    })
    .returning({ id: asset.id });
  const [serviceRow] = await db
    .insert(service)
    .values({
      organizationId: orgId,
      unitId: org.unitId,
      name: `Calibracao ${orgId}`,
      price: SERVICE_PRICE_CENTS,
    })
    .returning({ id: service.id });
  if (!assetRow || !serviceRow)
    throw new Error("seedBillingLab: insert failed");
  return {
    ...org,
    clientOrgId,
    customerId: customerRow.id,
    assetTypeId: typeRow.id,
    assetId: assetRow.id,
    serviceId: serviceRow.id,
  };
}

/** An APPROVED calibration job of the laboratory's customer, asset and service. */
export async function seedApprovedJob(
  lab: BillingLab,
  jobId: string,
): Promise<number> {
  const [row] = await insertJobs({
    jobId,
    organizationId: lab.orgId,
    unitId: lab.unitId,
    customerId: lab.customerId,
    assetId: lab.assetId,
    serviceId: lab.serviceId,
    createdBy: lab.userId,
    status: "APPROVED",
    methodSnapshot: {
      methodId: 1,
      methodName: "Test",
      methodVersion: 1,
      dataFields: [],
      variableBindings: [],
      formulas: [],
      measurementModels: [],
      validations: [],
      uncertaintyParams: [],
    },
    certificateName: jobId,
  });
  if (!row) throw new Error("seedApprovedJob: insert failed");
  return row.id;
}

/**
 * A service order of the laboratory's customer and asset, written directly (not
 * through the intake workflow). Defaults to a closed, billable order with an
 * approved total.
 */
export async function seedBillableOrder(
  lab: BillingLab,
  params: {
    number: string;
    status?: (typeof serviceOrder.$inferInsert)["status"];
    totalApprovedCents?: number;
    totalQuotedCents?: number;
    billingDocumentId?: number | null;
    linkedJobId?: number;
  },
): Promise<number> {
  const [row] = await db
    .insert(serviceOrder)
    .values({
      organizationId: lab.orgId,
      unitId: lab.unitId,
      customerId: lab.customerId,
      assetId: lab.assetId,
      openedByUserId: lab.userId,
      serviceOrderNumber: params.number,
      status: params.status ?? "closed",
      claimedDefect: "Defeito de teste",
      intakeCondition: "Bom estado",
      intakeType: "counter",
      deliveryMethod: "pickup_at_lab",
      priority: "normal",
      totalQuotedCents: params.totalQuotedCents ?? 0,
      totalApprovedCents: params.totalApprovedCents ?? 20_000,
      evaluationFeeCents: 0,
      evaluationFeeApplied: false,
      isExternalService: false,
      billingDocumentId: params.billingDocumentId ?? null,
    })
    .returning({ id: serviceOrder.id });
  if (!row) throw new Error("seedBillableOrder: insert failed");
  if (params.linkedJobId !== undefined) {
    await db.insert(serviceOrderCertificateLink).values({
      organizationId: organizationOf("service_order", row.id),
      serviceOrderId: row.id,
      certificateJobId: params.linkedJobId,
      linkedByUserId: lab.userId,
    });
  }
  return row.id;
}
