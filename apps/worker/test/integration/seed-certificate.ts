import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  certificateTemplate,
  certificateTemplateAssignment,
  certificateTemplateVersion,
  customer,
  service,
} from "@calibra-facil/db/schema";
import type { JobStatus, MethodSnapshot } from "@calibra-facil/db/schema";
import {
  CERT_HTML_COMPILER_VERSION,
  hashCertificateDocument,
  completeWysiwygDocument,
} from "@calibra-facil/certificate-html-template";

// Seed helpers SPECIFIC to the worker's XLSX certificate-issuance handler
// (processXlsxIssuedCertificate -> updateJobWithCertificate). The shared seed.ts
// only models the integration-sync surface (org + unit + customer + ERP
// connection); the issuance reads a far wider graph: a customer, an asset (with
// its asset_type), a service, a PUBLISHED certificate-template version + an
// ACTIVE assignment that fetchXlsxTemplateSelectionForJob resolves, and a
// calibration_job sitting in the pre-issuance status the handler expects
// (GENERATING_PDF). We DO NOT touch the shared seed.ts — these helpers live
// alongside it and reuse the same drizzle singleton. Use `seedOrg` from seed.ts
// for the org/unit/user, then call seedIssuableJob here.

const EPOCH = new Date("2026-01-01T00:00:00.000Z");

/** A minimal, schema-valid binding manifest that fillXlsxWorkbookFromManifest
 * can iterate over (no bindings -> the mocked engine returns the source
 * workbook unchanged). validateCertificateXlsxBindingManifest (the REAL Zod
 * schema, NOT mocked) must accept this verbatim. */
export const MINIMAL_BINDING_MANIFEST = {
  schemaVersion: "calibrafacil.certificateXlsxBinding.v1",
  requiredFields: [],
  governedFields: [],
  scalarBindings: [],
  imageBindings: [],
  tableBindings: [],
  renderPolicy: {
    formulas: "preserve",
    macros: "reject",
    externalLinks: "reject",
    converter: "gotenberg-libreoffice",
  },
} as const;

/** The minimal MethodSnapshot the issuance reads. The SQL join only uses
 * `methodId`; buildXlsxCertificateData reads `formulas` (-> []) and
 * `accreditedScope`. All MethodSnapshot array members are required, so they are
 * present as empty arrays. */
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

/**
 * MethodSnapshot for the WYSIWYG engine's happy path: the compiler FAILS LOUD
 * without primitive calibration_result rows and expanded-uncertainty/coverage-
 * factor roles (§7.8.2.1/§7.8.4.1), so the snapshot must declare real formulas
 * and the job must carry matching frozen `results`.
 */
function wysiwygMethodSnapshot(): MethodSnapshot {
  return {
    ...minimalMethodSnapshot(),
    dataFields: [
      {
        key: "pontos",
        label: "Pontos de calibração",
        type: "table",
        columns: [
          { key: "nominal", label: "Carga nominal", type: "number", unit: "kg" },
          { key: "leitura", label: "Indicação", type: "number", unit: "kg" },
        ],
      },
      {
        key: "excentricidade",
        label: "Excentricidade",
        type: "table",
        // Weighing-method opt-in: the worker renders the indicator SVG into
        // the frozen snapshot; the html renderer prints it after this grid.
        eccentricityIndicator: { enabled: true, variant: "circular_platform" },
        columns: [
          { key: "posicao", label: "Posição", type: "text" },
          { key: "leitura_exc", label: "Indicação", type: "number", unit: "kg" },
        ],
      },
    ],
    formulas: [
      {
        outputKey: "erro_ponto",
        expression: "leitura - nominal",
        label: "Erro de indicação",
        unit: "kg",
        scope: { kind: "table_row", tableKey: "pontos" },
        reporting: {
          role: "primary_result",
          group: "calibration_result",
          includeInCertificate: true,
        },
      },
      {
        outputKey: "erro_indicacao",
        expression: "leitura - nominal",
        label: "Erro de indicação",
        unit: "kg",
        reporting: {
          role: "primary_result",
          group: "calibration_result",
          includeInCertificate: true,
        },
      },
      {
        outputKey: "incerteza_expandida",
        expression: "u_c * k",
        label: "Incerteza expandida",
        unit: "kg",
        reporting: {
          role: "expanded_uncertainty",
          group: "calibration_result",
          includeInCertificate: true,
        },
      },
      {
        outputKey: "fator_abrangencia",
        expression: "k",
        label: "Fator de abrangência",
        reporting: {
          role: "coverage_factor",
          group: "calibration_result",
          includeInCertificate: true,
        },
      },
    ],
  };
}

/** Frozen job results matching wysiwygMethodSnapshot's formula outputKeys. */
export const WYSIWYG_JOB_RESULTS = {
  erro_indicacao: 0.0001,
  incerteza_expandida: 0.0004,
  fator_abrangencia: 2,
  erro_ponto: [0, -0.5],
} as const;

/** Multi-point table data matching wysiwygMethodSnapshot's `pontos` field. */
export const WYSIWYG_JOB_DATA = {
  excentricidade: [
    { posicao: "Centro", leitura_exc: 500.0 },
    { posicao: "Frente", leitura_exc: 500.1 },
  ],
  pontos: [
    { nominal: 500, leitura: 500 },
    { nominal: 1000, leitura: 999.5 },
  ],
} as const;

export type SeededIssuableJob = {
  jobId: number;
  jobNumber: string;
  customerId: number;
  assetId: number;
  serviceId: number;
  templateId: number;
  templateVersionId: number;
  xlsxR2Key: string;
  bindingManifestSha256: string;
  /** wysiwyg engine only: canonical content hash of the seeded documentJson. */
  documentSha256: string | null;
};

/**
 * Seed the full graph the XLSX certificate-issuance handler reads for one org,
 * leaving a calibration_job in `status` (default GENERATING_PDF — the
 * pre-issuance state). Returns the ids + the source XLSX R2 key the caller must
 * `put` into the env MEDIA bucket before invoking the handler.
 */
export async function seedIssuableJob(params: {
  organizationId: string;
  unitId: number;
  userId: string;
  jobNumber?: string;
  /** Override the job's starting status (e.g. "SUPERSEDED" for the guard test). */
  status?: JobStatus;
  /** Override the source-XLSX R2 key (lets a test seed two distinct jobs). */
  xlsxR2Key?: string;
  /** Approver user id written to approved_by (defaults to params.userId). */
  approvedBy?: string;
  customerName?: string;
  /** Org-media id to reference from an authored image node (wysiwyg only). */
  imageMediaId?: number;
  /** Template engine to seed ("xlsx" default; "wysiwyg" seeds documentJson). */
  engine?: "xlsx" | "wysiwyg";
  /** wysiwyg only: override the frozen job results (e.g. drop U for fail-loud tests). */
  results?: Record<string, unknown> | null;
}): Promise<SeededIssuableJob> {
  const engine = params.engine ?? "xlsx";
  const jobNumber = params.jobNumber ?? "CAL-2026-0001";
  const xlsxR2Key = params.xlsxR2Key ?? `media/templates/${jobNumber}.xlsx`;
  const bindingManifestSha256 = `sha256-manifest-${jobNumber}`;
  const wysiwygDocument = (() => {
    if (engine !== "wysiwyg") return null;
    const doc: { content: Record<string, unknown>[] } = JSON.parse(
      JSON.stringify(completeWysiwygDocument()),
    );
    if (params.imageMediaId) {
      // authored org-media image before the trailing band (roadmap item 3)
      doc.content.splice(doc.content.length - 1, 0, {
        type: "image",
        attrs: { mediaId: params.imageMediaId, alt: "logo interno", widthMm: 40 },
      });
    }
    return doc;
  })();
  const documentSha256 = wysiwygDocument
    ? hashCertificateDocument(wysiwygDocument)
    : null;

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
  if (!assetTypeRow) throw new Error("seedIssuableJob: assetType insert failed");

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

  const [templateRow] = await db
    .insert(certificateTemplate)
    .values({
      organizationId: params.organizationId,
      name: "Modelo de Certificado",
      slug: `modelo-${jobNumber.toLowerCase()}`,
      version: 1,
      status: "ACTIVE",
      isDefault: true,
      createdBy: params.userId,
      createdAt: EPOCH,
    })
    .returning();
  if (!templateRow) throw new Error("seedIssuableJob: template insert failed");

  const [versionRow] = await db
    .insert(certificateTemplateVersion)
    .values(
      engine === "wysiwyg" && wysiwygDocument && documentSha256
        ? {
            organizationId: params.organizationId,
            templateId: templateRow.id,
            version: 1,
            status: "PUBLISHED",
            engine: "wysiwyg",
            documentJson: wysiwygDocument,
            documentSha256,
            renderPolicy: {
              converter: "gotenberg-chromium",
              compiler: "certificate-html-template",
              compilerVersion: CERT_HTML_COMPILER_VERSION,
            },
            createdBy: params.userId,
            publishedAt: EPOCH,
            publishedBy: params.userId,
            createdAt: EPOCH,
          }
        : {
            organizationId: params.organizationId,
            templateId: templateRow.id,
            version: 1,
            status: "PUBLISHED",
            xlsxR2Key,
            xlsxSha256: `sha256-xlsx-${jobNumber}`,
            bindingManifest: { ...MINIMAL_BINDING_MANIFEST },
            bindingManifestSha256,
            renderPolicy: {
              formulas: "preserve",
              macros: "reject",
              externalLinks: "reject",
              converter: "gotenberg-libreoffice",
            },
            createdBy: params.userId,
            publishedAt: EPOCH,
            publishedBy: params.userId,
            createdAt: EPOCH,
          },
    )
    .returning();
  if (!versionRow) throw new Error("seedIssuableJob: template version failed");

  await db.insert(certificateTemplateAssignment).values({
    organizationId: params.organizationId,
    templateId: templateRow.id,
    templateVersionId: versionRow.id,
    certificateType: "calibration",
    status: "ACTIVE",
    priority: 0,
    createdBy: params.userId,
    createdAt: EPOCH,
  });

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
      methodSnapshot:
        engine === "wysiwyg" ? wysiwygMethodSnapshot() : minimalMethodSnapshot(),
      results:
        params.results !== undefined
          ? (params.results ?? undefined)
          : engine === "wysiwyg"
            ? { ...WYSIWYG_JOB_RESULTS }
            : undefined,
      data: engine === "wysiwyg" ? { ...WYSIWYG_JOB_DATA } : undefined,
      status: params.status ?? "GENERATING_PDF",
      performedAt: EPOCH,
      approvedAt: EPOCH,
      approvedBy: params.approvedBy ?? params.userId,
      createdBy: params.userId,
      createdAt: EPOCH,
    })
    .returning();
  if (!jobRow) throw new Error("seedIssuableJob: calibration_job insert failed");

  return {
    jobId: jobRow.id,
    jobNumber,
    customerId: customerRow.id,
    assetId: assetRow.id,
    serviceId: serviceRow.id,
    templateId: templateRow.id,
    templateVersionId: versionRow.id,
    xlsxR2Key,
    bindingManifestSha256,
    documentSha256,
  };
}
