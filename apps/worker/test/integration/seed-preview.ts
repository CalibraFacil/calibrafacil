import { db } from "@calibra-facil/db";
import {
  certificateTemplate,
  certificateTemplatePreview,
  certificateTemplateVersion,
} from "@calibra-facil/db/schema";
import type { CertificateXlsxTemplatePreviewStatus } from "@calibra-facil/db/schema";

// Seed helpers SPECIFIC to the worker's XLSX certificate-template PREVIEW
// handler (processXlsxPreviewJob, index.ts:2666). The handler reads a far
// narrower graph than issuance: a certificate_template + a
// certificate_template_version (which supplies xlsx_r2_key / xlsx_sha256 /
// binding_manifest / binding_manifest_sha256) joined to the organization, plus a
// certificate_template_preview row it transitions PENDING -> RENDERED (or
// FAILED). There is NO job/asset/service/customer graph here. We DO NOT touch the
// shared seed.ts — these helpers live alongside it and reuse the same drizzle
// singleton. Use `seedOrg` from seed.ts for the org/unit/user, then call
// seedPreview here.

const EPOCH = new Date("2026-01-01T00:00:00.000Z");
// The preview's expires_at is NOT NULL; a far-future value keeps the row valid.
const EXPIRES_AT = new Date("2027-01-01T00:00:00.000Z");

/** A minimal, schema-valid binding manifest the REAL
 * validateCertificateXlsxBindingManifest (Zod) accepts verbatim. Empty bindings
 * -> the mocked engine returns the source workbook unchanged. */
export const MINIMAL_PREVIEW_BINDING_MANIFEST = {
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

export type SeededPreview = {
  previewId: number;
  templateId: number;
  templateVersionId: number;
  xlsxR2Key: string;
  xlsxSha256: string;
  bindingManifestSha256: string;
};

/**
 * Seed the full graph the preview handler reads for one org, leaving a
 * certificate_template_preview row in `status` (default PENDING — the
 * pre-render state). Returns the ids + the source-XLSX R2 key the caller must
 * `put` into the env MEDIA bucket before invoking the handler (the handler reads
 * it via getStoredObject(env, "media", xlsx_r2_key)).
 */
export async function seedPreview(params: {
  organizationId: string;
  userId: string;
  /** Distinguishes templates/keys when seeding two orgs in one test. */
  label?: string;
  /** Override the preview's starting status (default PENDING). */
  status?: CertificateXlsxTemplatePreviewStatus;
  /** Override the source-XLSX R2 key (lets a test seed two distinct previews). */
  xlsxR2Key?: string;
  /** sample_data the engine fills with (default {}). */
  sampleData?: Record<string, unknown>;
}): Promise<SeededPreview> {
  const label = params.label ?? "preview";
  const xlsxR2Key =
    params.xlsxR2Key ?? `media/templates/${params.organizationId}-${label}.xlsx`;
  const xlsxSha256 = `sha256-xlsx-${params.organizationId}-${label}`;
  const bindingManifestSha256 = `sha256-manifest-${params.organizationId}-${label}`;

  const [templateRow] = await db
    .insert(certificateTemplate)
    .values({
      organizationId: params.organizationId,
      name: "Modelo de Certificado",
      slug: `modelo-${params.organizationId}-${label}`.toLowerCase(),
      version: 1,
      status: "ACTIVE",
      isDefault: true,
      createdBy: params.userId,
      createdAt: EPOCH,
    })
    .returning();
  if (!templateRow) throw new Error("seedPreview: template insert failed");

  const [versionRow] = await db
    .insert(certificateTemplateVersion)
    .values({
      organizationId: params.organizationId,
      templateId: templateRow.id,
      version: 1,
      status: "DRAFT",
      xlsxR2Key,
      xlsxSha256,
      bindingManifest: { ...MINIMAL_PREVIEW_BINDING_MANIFEST },
      bindingManifestSha256,
      renderPolicy: {
        formulas: "preserve",
        macros: "reject",
        externalLinks: "reject",
        converter: "gotenberg-libreoffice",
      },
      createdBy: params.userId,
      createdAt: EPOCH,
    })
    .returning();
  if (!versionRow) throw new Error("seedPreview: template version insert failed");

  const [previewRow] = await db
    .insert(certificateTemplatePreview)
    .values({
      organizationId: params.organizationId,
      templateVersionId: versionRow.id,
      sampleData: params.sampleData ?? {},
      status: params.status ?? "PENDING",
      requestedBy: params.userId,
      expiresAt: EXPIRES_AT,
      createdAt: EPOCH,
    })
    .returning();
  if (!previewRow) throw new Error("seedPreview: preview insert failed");

  return {
    previewId: previewRow.id,
    templateId: templateRow.id,
    templateVersionId: versionRow.id,
    xlsxR2Key,
    xlsxSha256,
    bindingManifestSha256,
  };
}
