import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  customer,
  member,
  memberUnitAssignment,
  organization,
  service,
  user,
} from "@calibra-facil/db/schema";

/**
 * Seed an EXTRA user + org member on top of `seedOrg` (which only seeds the
 * logged-in user). Used by the foreign-id (tenant-refs) specs to build "a
 * technician of org B" and "a legitimate technician of org A" fixtures.
 *
 * When `unitRole` is given, the member also gets an explicit
 * `member_unit_assignment` row for `unitId` (technician / unit_admin) — the
 * pre-requisite for being assignable in a unit when the member is not an
 * org-level admin/owner.
 */
export async function seedExtraMember(params: {
  orgId: string;
  userId: string;
  role: "owner" | "admin" | "technician" | "operator" | "member";
  unitId?: number;
  unitRole?: "member" | "technician" | "unit_admin";
}): Promise<{ userId: string; memberId: string }> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const memberId = `member-${params.orgId}-${params.userId}`;

  await db.insert(user).values({
    id: params.userId,
    name: `User ${params.userId}`,
    email: `${params.userId}@lab.test`,
  });
  await db.insert(member).values({
    id: memberId,
    organizationId: params.orgId,
    userId: params.userId,
    role: params.role,
    createdAt: now,
  });

  if (params.unitId !== undefined && params.unitRole !== undefined) {
    await db.insert(memberUnitAssignment).values({
      organizationId: params.orgId,
      memberId,
      unitId: params.unitId,
      role: params.unitRole,
    });
  }

  return { userId: params.userId, memberId };
}

/**
 * Seed one minimal calibration job (plus the customer / asset / service rows its
 * foreign keys need) owned by `orgId`. Returns the job / asset / service ids —
 * "foreign" ids for any caller authenticated in a different org.
 */
export async function seedJobForOrg(params: {
  orgId: string;
  unitId: number;
  createdBy: string;
}): Promise<{ jobId: number; assetId: number; serviceId: number }> {
  const clientOrgId = `client-${params.orgId}-job`;
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "CLIENT",
    status: "ACTIVE",
  });
  const [cust] = await db
    .insert(customer)
    .values({
      name: `Customer ${params.orgId}`,
      authOrganizationId: clientOrgId,
      labOrganizationId: params.orgId,
    })
    .returning({ id: customer.id });
  if (!cust) throw new Error("seedJobForOrg: customer insert failed");

  const [type] = await db
    .insert(assetType)
    .values({
      name: "Instrument",
      slug: `type-${params.orgId}-job`,
      definition: [],
    })
    .returning({ id: assetType.id });
  if (!type) throw new Error("seedJobForOrg: asset type insert failed");

  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: cust.id,
      labOrganizationId: params.orgId,
      assetTypeId: type.id,
      name: "Asset",
      serialNumber: `SN-${params.orgId}-job`,
      tag: `TAG-${params.orgId}-job`,
      status: "ACTIVE",
      metrologyRegime: "INDUSTRIAL",
    })
    .returning({ id: asset.id });
  if (!assetRow) throw new Error("seedJobForOrg: asset insert failed");

  const [svc] = await db
    .insert(service)
    .values({
      organizationId: params.orgId,
      unitId: params.unitId,
      name: "Calibração",
      isActive: true,
    })
    .returning({ id: service.id });
  if (!svc) throw new Error("seedJobForOrg: service insert failed");

  const [job] = await db
    .insert(calibrationJob)
    .values({
      jobId: `JOB-${params.orgId}`,
      organizationId: params.orgId,
      unitId: params.unitId,
      customerId: cust.id,
      assetId: assetRow.id,
      serviceId: svc.id,
      createdBy: params.createdBy,
      status: "DRAFT",
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
      certificateName: `JOB-${params.orgId}`,
    })
    .returning({ id: calibrationJob.id });
  if (!job) throw new Error("seedJobForOrg: job insert failed");
  return { jobId: job.id, assetId: assetRow.id, serviceId: svc.id };
}
