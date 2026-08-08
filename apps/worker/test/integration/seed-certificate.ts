import {
  asset,
  assetType,
  calibrationJob,
  calibrationMethod,
  customer,
  service,
  type JobStatus,
  type MethodSnapshot,
} from "@calibra-facil/db/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

/**
 * Seeds the graph the fixed-layout certificate issuance reads, for one org,
 * leaving a calibration_job in `status` (default GENERATING_PDF — the
 * pre-issuance state).
 *
 * Rewritten for #865 Phase 3. The previous version seeded a certificate_template
 * and a published version and linked the method to it; both tables are gone
 * (0108) and the layout is now ours, chosen by the method's declared reporting
 * metadata rather than by a row a laboratory configured.
 *
 * That metadata is the interesting part of this fixture. The adapter refuses to
 * build a results table unless the method declares one, so a snapshot with
 * empty `formulas` — which is what the old fixture used — would now be REJECTED
 * rather than rendered. The snapshot below declares the minimum a real method
 * declares: an error, its expanded uncertainty, and the coverage factor, all
 * row-scoped over a points table.
 */

const EPOCH = new Date("2026-01-01T00:00:00.000Z");

/** The points table the row-scoped formulas evaluate over. */
const POINTS_TABLE_KEY = "pontos";

function issuableMethodSnapshot(methodId: number): MethodSnapshot {
  return {
    methodId,
    methodName: "Método de Teste",
    methodVersion: 1,
    accreditedScope: false,
    dataFields: [
      {
        key: `${POINTS_TABLE_KEY}_carga_nominal`,
        label: "Carga nominal",
        type: "number",
        quantityKind: "reference",
      },
    ],
    variableBindings: [],
    formulas: [
      {
        outputKey: "erro",
        label: "Erro de indicação",
        expression: "indicacao - referencia",
        unit: "g",
        scope: { kind: "table_row", tableKey: POINTS_TABLE_KEY },
        reporting: {
          includeInCertificate: true,
          role: "primary_result",
          group: "calibration_result",
        },
      },
      {
        outputKey: "u_expandida",
        label: "Incerteza expandida",
        expression: "fator_k * u_combinada",
        unit: "g",
        scope: { kind: "table_row", tableKey: POINTS_TABLE_KEY },
        reporting: {
          includeInCertificate: true,
          role: "expanded_uncertainty",
          group: "calibration_result",
        },
      },
      {
        outputKey: "fator_k",
        label: "Fator de abrangência",
        expression: "2",
        scope: { kind: "table_row", tableKey: POINTS_TABLE_KEY },
        reporting: {
          includeInCertificate: true,
          role: "coverage_factor",
          group: "uncertainty_budget",
        },
      },
    ],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
  };
}

/** Two points, values as strings — the shape the math engine actually writes. */
const ISSUABLE_DATA = {
  [POINTS_TABLE_KEY]: [{ carga_nominal: "500" }, { carga_nominal: "1000" }],
};
const ISSUABLE_RESULTS = {
  erro: ["-0.52", "-1.04"],
  u_expandida: ["0.12", "0.13"],
  fator_k: ["2", "2"],
};

export type SeededIssuableJob = {
  jobId: number;
  jobNumber: string;
  customerId: number;
  assetId: number;
  serviceId: number;
  methodId: number;
};

export async function seedIssuableJob(params: {
  organizationId: string;
  unitId: number;
  userId: string;
  jobNumber?: string;
  /** Override the starting status (e.g. "SUPERSEDED" for the guard test). */
  status?: JobStatus;
  /** Approver written to approved_by (defaults to params.userId). */
  approvedBy?: string;
  customerName?: string;
  /**
   * Seed a method that declares NO reported uncertainty. The adapter then has
   * no results table to build and must refuse rather than guess.
   */
  withoutReportedUncertainty?: boolean;
}): Promise<SeededIssuableJob> {
  const jobNumber = params.jobNumber ?? "CAL-2026-0001";

  const [customerRow] = await db
    .insert(customer)
    .values({
      name: params.customerName ?? "Cliente de Teste",
      taxId: "12345678000199",
      authOrganizationId: params.organizationId,
      labOrganizationId: params.organizationId,
      createdAt: EPOCH,
    })
    .returning();
  if (!customerRow) throw new Error("seedIssuableJob: customer insert failed");

  const [assetTypeRow] = await db
    .insert(assetType)
    .values({
      name: `Balança ${jobNumber}`,
      slug: `balanca-${jobNumber.toLowerCase()}`,
      definition: [],
      createdAt: EPOCH,
    })
    .returning();
  if (!assetTypeRow)
    throw new Error("seedIssuableJob: assetType insert failed");

  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: customerRow.id,
      // SEC-03b (#638): asset carries its lab org (== the seeded customer's).
      labOrganizationId: params.organizationId,
      assetTypeId: assetTypeRow.id,
      name: "Balança Analítica",
      serialNumber: `SN-${jobNumber}`,
      tag: `TAG-${jobNumber}`,
      manufacturer: "Fabricante Teste",
      model: "MOD-100",
      createdAt: EPOCH,
    })
    .returning();
  if (!assetRow) throw new Error("seedIssuableJob: asset insert failed");

  const [serviceRow] = await db
    .insert(service)
    .values({
      unitId: params.unitId,
      organizationId: params.organizationId,
      name: "Calibração de Balança",
      createdAt: EPOCH,
    })
    .returning();
  if (!serviceRow) throw new Error("seedIssuableJob: service insert failed");

  const [methodRow] = await db
    .insert(calibrationMethod)
    .values({
      organizationId: params.organizationId,
      assetTypeId: assetTypeRow.id,
      name: `Método ${jobNumber}`,
      version: 1,
      status: "PUBLISHED",
      accreditedScope: false,
      dataFields: [],
      createdBy: params.userId,
      publishedAt: EPOCH,
      createdAt: EPOCH,
    })
    .returning();
  if (!methodRow) throw new Error("seedIssuableJob: method insert failed");

  // Point the service at the method too (mirrors production job creation).
  // The issuance must NOT depend on it — it reads the job's frozen snapshot.
  await db
    .update(service)
    .set({ methodId: methodRow.id })
    .where(eq(service.id, serviceRow.id));

  const snapshot = issuableMethodSnapshot(methodRow.id);
  if (params.withoutReportedUncertainty) {
    snapshot.formulas = (snapshot.formulas ?? []).filter(
      (formula) => formula.reporting?.role !== "expanded_uncertainty",
    );
  }

  const [jobRow] = await db
    .insert(calibrationJob)
    .values({
      jobId: jobNumber,
      certificateName: jobNumber,
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: customerRow.id,
      assetId: assetRow.id,
      serviceId: serviceRow.id,
      methodSnapshot: snapshot,
      data: ISSUABLE_DATA,
      results: ISSUABLE_RESULTS,
      status: params.status ?? "GENERATING_PDF",
      performedAt: EPOCH,
      approvedAt: EPOCH,
      approvedBy: params.approvedBy ?? params.userId,
      createdBy: params.userId,
      createdAt: EPOCH,
    })
    .returning();
  if (!jobRow)
    throw new Error("seedIssuableJob: calibration_job insert failed");

  return {
    jobId: jobRow.id,
    jobNumber,
    customerId: customerRow.id,
    assetId: assetRow.id,
    serviceId: serviceRow.id,
    methodId: methodRow.id,
  };
}
