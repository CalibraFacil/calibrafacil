import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  certificateRelease,
  customer,
  portalExportJob,
  service,
  type MethodSnapshot,
  type PortalAuditPackParams,
} from "@calibra-facil/db/schema";
import type { CertificateReleaseStatus } from "@calibra-facil/shared";

// Seed helpers SPECIFIC to the worker's AUDIT_PACK handler (#738,
// processAuditPackJob). The handler reads: a portal_export_job row (whose
// params carry the frozen customer scope), APPROVED calibration_jobs with a
// certificate_url inside the approval-date window, their certificate_release
// rows (the gate re-check), and the customer's active assets for the fleet
// report. Reuse `seedOrg` from seed.ts for the org/unit/user.

const EPOCH = new Date("2026-01-01T00:00:00.000Z");

/** Minimal MethodSnapshot: the audit-pack handler never reads it, but the
 * column is NOT NULL (deep-freeze invariant). */
function minimalMethodSnapshot(): MethodSnapshot {
  return {
    methodId: 0,
    methodName: "Método de Teste",
    methodVersion: 1,
    accreditedScope: false,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
  };
}

export async function seedPortalCustomer(params: {
  organizationId: string;
  name?: string;
}): Promise<{ customerId: number }> {
  const [customerRow] = await db
    .insert(customer)
    .values({
      name: params.name ?? "Cliente de Teste",
      taxId: "12345678000199",
      authOrganizationId: params.organizationId,
      labOrganizationId: params.organizationId,
      createdAt: EPOCH,
    })
    .returning();
  if (!customerRow) throw new Error("seedPortalCustomer: insert failed");
  return { customerId: customerRow.id };
}

export type SeededCertificateJob = {
  jobId: number;
  jobNumber: string;
  certificateR2Key: string;
  verificationToken: string;
};

/**
 * Seed one APPROVED calibration job with a certificate_url pointing at a
 * deterministic R2 key (the caller `put`s fake PDF bytes there). Optionally
 * writes a certificate_release row so the gate re-check sees `releaseStatus`.
 */
export async function seedApprovedCertificate(params: {
  organizationId: string;
  unitId: number;
  userId: string;
  customerId: number;
  jobNumber: string;
  approvedAt?: Date;
  releaseStatus?: CertificateReleaseStatus;
}): Promise<SeededCertificateJob> {
  const approvedAt = params.approvedAt ?? new Date("2026-03-10T12:00:00.000Z");
  const certificateR2Key = `org/test-${params.organizationId}/certs/${params.jobNumber}.pdf`;

  const [assetTypeRow] = await db
    .insert(assetType)
    .values({
      name: `Balança ${params.jobNumber}`,
      slug: `balanca-${params.jobNumber.toLowerCase()}`,
      definition: [],
      createdAt: EPOCH,
    })
    .returning();
  if (!assetTypeRow)
    throw new Error("seedApprovedCertificate: assetType failed");

  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: params.customerId,
      labOrganizationId: params.organizationId,
      assetTypeId: assetTypeRow.id,
      name: "Balança Analítica",
      serialNumber: `SN-${params.jobNumber}`,
      tag: `TAG-${params.jobNumber}`,
      manufacturer: "Fabricante Teste",
      model: "MOD-100",
      nextCalibrationDate: new Date("2027-03-10T12:00:00.000Z"),
      lastCalibrationDate: approvedAt,
      calibrationIntervalMonths: 12,
      createdAt: EPOCH,
    })
    .returning();
  if (!assetRow) throw new Error("seedApprovedCertificate: asset failed");

  const [serviceRow] = await db
    .insert(service)
    .values({
      unitId: params.unitId,
      organizationId: params.organizationId,
      name: `Calibração ${params.jobNumber}`,
      createdAt: EPOCH,
    })
    .returning();
  if (!serviceRow) throw new Error("seedApprovedCertificate: service failed");

  const [jobRow] = await db
    .insert(calibrationJob)
    .values({
      jobId: params.jobNumber,
      certificateName: params.jobNumber,
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      assetId: assetRow.id,
      serviceId: serviceRow.id,
      methodSnapshot: minimalMethodSnapshot(),
      status: "APPROVED",
      certificateUrl: `https://certificates.calibrafacil.com/${certificateR2Key}`,
      performedAt: approvedAt,
      approvedAt,
      approvedBy: params.userId,
      createdBy: params.userId,
      createdAt: EPOCH,
    })
    .returning();
  if (!jobRow) throw new Error("seedApprovedCertificate: job failed");

  if (params.releaseStatus) {
    await db.insert(certificateRelease).values({
      organizationId: params.organizationId,
      calibrationJobId: jobRow.id,
      status: params.releaseStatus,
    });
  }

  return {
    jobId: jobRow.id,
    jobNumber: params.jobNumber,
    certificateR2Key,
    verificationToken: jobRow.verificationToken,
  };
}

/** Seed the PENDING portal_export_job row the AUDIT_PACK message points at. */
export async function seedAuditPackExport(params: {
  organizationId: string;
  userId: string;
  customerIds: number[];
  dateFrom?: string;
  dateTo?: string;
  include?: PortalAuditPackParams["include"];
}): Promise<{ exportId: number }> {
  const [exportRow] = await db
    .insert(portalExportJob)
    .values({
      kind: "AUDIT_PACK",
      labOrganizationId: params.organizationId,
      authOrganizationId: params.organizationId,
      requestedByUserId: params.userId,
      params: {
        dateFrom: params.dateFrom ?? "2026-01-01",
        dateTo: params.dateTo ?? "2026-12-31",
        unitId: null,
        include: params.include ?? {
          certificates: true,
          fleetReport: false,
          verificationIndex: true,
        },
        customerIds: params.customerIds,
      },
      status: "PENDING",
    })
    .returning();
  if (!exportRow) throw new Error("seedAuditPackExport: insert failed");
  return { exportId: exportRow.id };
}
