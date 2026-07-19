import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@calibra-facil/db";
import {
  certificateTemplate,
  certificateTemplatePreview,
  certificateTemplateVersion,
  calibrationMethod,
  organization,
} from "@calibra-facil/db/schema";
import {
  certificateXlsxBindingManifestSchema,
  ExcelTsCertificateWorkbookEngine,
  getCertificateXlsxManifestFieldWarnings,
  hashCertificateXlsxBindingManifest,
  normalizeWorkbookPrintSettings,
  validateCertificateXlsxBindingManifest,
  type CertificateXlsxBindingManifest,
  type WorkbookAnalysis,
} from "@calibra-facil/certificate-xlsx-template";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
  withLabPermission,
} from "../middleware/permission";
import { requireFeature } from "../middleware/tier-guard";
import { getOrganizationPlanAccess } from "../lib/organization-plan";
import {
  createR2Client,
  downloadFromR2,
  resolveBucketName,
  resolveReadBucketName,
  uploadToR2,
  generatePresignedUrl,
  type R2Env,
} from "../lib/storage";
import { templateXlsxKey } from "@calibra-facil/shared/storage-keys";
import { writeOrganizationAuditEvent } from "../lib/audit";
import { enqueueBackgroundJob } from "../lib/background-jobs";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

const CreateTemplateSchema = z.object({
  name: z.string().trim().min(3).max(80),
});

const UpdateTemplateSchema = z.object({
  name: z.string().trim().min(3).max(80).optional(),
});

const UpdateXlsxBindingsSchema = z.object({
  manifest: certificateXlsxBindingManifestSchema,
});

const RequestXlsxPreviewSchema = z.object({
  sampleData: z.record(z.string(), z.unknown()).optional(),
});

const MAX_XLSX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_XLSX_CONTENT_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "",
];
const DEFAULT_XLSX_RENDER_POLICY = {
  formulas: "preserve",
  macros: "reject",
  externalLinks: "reject",
  converter: "gotenberg-libreoffice",
} as const;

function slugifyTemplateName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function sha256Hex(bytes: Uint8Array | ArrayBuffer): string {
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isR2BucketLike(value: unknown): value is R2Env["CERTIFICATES_BUCKET"] {
  return typeof toRecord(value).get === "function";
}

function getR2Env(value: unknown): R2Env | null {
  const env = toRecord(value);
  const accountId = getString(env.R2_ACCOUNT_ID);
  const accessKeyId = getString(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = getString(env.R2_SECRET_ACCESS_KEY);
  const bucketName = getString(env.R2_BUCKET_NAME);
  const mediaBucketName = getString(env.R2_MEDIA_BUCKET_NAME);

  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucketName ||
    !mediaBucketName
  ) {
    return null;
  }

  return {
    R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET_NAME: bucketName,
    R2_MEDIA_BUCKET_NAME: mediaBucketName,
    CERTIFICATES_BUCKET: isR2BucketLike(env.CERTIFICATES_BUCKET)
      ? env.CERTIFICATES_BUCKET
      : undefined,
    MEDIA_BUCKET: isR2BucketLike(env.MEDIA_BUCKET)
      ? env.MEDIA_BUCKET
      : undefined,
    NODE_ENV: getString(env.NODE_ENV) ?? undefined,
    API_URL: getString(env.API_URL) ?? undefined,
  };
}

function countSheetPlaceholders(sheet: unknown) {
  const placeholders = toRecord(sheet).placeholders;
  return Array.isArray(placeholders) ? placeholders.length : 0;
}

function createDefaultXlsxBindingManifest(
  analysis: WorkbookAnalysis,
): CertificateXlsxBindingManifest {
  const scalarBindings = analysis.sheets.flatMap((sheet) =>
    sheet.placeholders
      .filter(
        (placeholder) =>
          getImageKindForFieldPath(placeholder.fieldPath) == null,
      )
      .map((placeholder) => ({
        id: `${placeholder.sheet}:${placeholder.cell}:${placeholder.fieldPath}`,
        sheet: placeholder.sheet,
        cell: placeholder.cell,
        fieldPath: placeholder.fieldPath,
        governed: true,
      })),
  );
  const imageBindings = analysis.sheets.flatMap((sheet) =>
    sheet.placeholders
      .map((placeholder) => ({
        placeholder,
        imageKind: getImageKindForFieldPath(placeholder.fieldPath),
      }))
      .filter(
        (
          item,
        ): item is {
          placeholder: (typeof item)["placeholder"];
          imageKind:
            | "signature"
            | "organization_logo"
            | "accreditation_seal"
            | "eccentricity_indicator";
        } => item.imageKind != null,
      )
      .map(({ placeholder, imageKind }) => ({
        id: `${placeholder.sheet}:${placeholder.cell}:${placeholder.fieldPath}`,
        kind: "image" as const,
        sheet: placeholder.sheet,
        targetRange: placeholder.targetRange ?? placeholder.cell,
        imageKind,
        sourcePath: placeholder.fieldPath,
        placeholderName: `CF_${placeholder.fieldPath
          .replace(/[^A-Za-z0-9]+/g, "_")
          .toUpperCase()}`,
      })),
  );
  const governedFields = Array.from(
    new Set(scalarBindings.map((binding) => binding.fieldPath)),
  ).sort((left, right) => left.localeCompare(right));

  return {
    schemaVersion: "calibrafacil.certificateXlsxBinding.v1",
    requiredFields: [],
    governedFields,
    scalarBindings,
    imageBindings,
    tableBindings: [],
    renderPolicy: DEFAULT_XLSX_RENDER_POLICY,
  };
}

function getImageKindForFieldPath(
  fieldPath: string,
):
  | "signature"
  | "organization_logo"
  | "accreditation_seal"
  | "eccentricity_indicator"
  | null {
  if (fieldPath === "approval.signatureUrl") {
    return "signature";
  }

  if (fieldPath === "organization.logo") {
    return "organization_logo";
  }

  if (fieldPath === "organization.accreditationSealPng") {
    return "accreditation_seal";
  }

  if (fieldPath === "graphics.eccentricityIndicator") {
    return "eccentricity_indicator";
  }

  return null;
}

function getBlockingWorkbookWarnings(analysis: WorkbookAnalysis) {
  return analysis.warnings.filter((warning) =>
    [
      "unsupported_file_type",
      "macros_rejected",
      "external_links",
      "missing_print_area",
      "missing_fit_to_width",
    ].includes(warning.code),
  );
}

function getWorkbookPolicyWarnings(
  analysis: WorkbookAnalysis,
  manifest: CertificateXlsxBindingManifest,
) {
  return analysis.warnings.filter(
    (warning) =>
      manifest.renderPolicy.formulas === "rejectVolatile" &&
      warning.code === "volatile_formula",
  );
}

function previewMatchesPublishedInputs(
  preview: {
    filledXlsxR2Key: string | null;
    pdfR2Key: string | null;
    pdfSha256: string | null;
    renderMetadata: Record<string, unknown> | null;
  },
  version: {
    xlsxSha256: string;
    bindingManifestSha256: string;
  },
): boolean {
  const metadata = preview.renderMetadata;

  return (
    Boolean(preview.filledXlsxR2Key) &&
    Boolean(preview.pdfR2Key) &&
    Boolean(preview.pdfSha256) &&
    metadata?.xlsxSha256 === version.xlsxSha256 &&
    metadata?.bindingManifestSha256 === version.bindingManifestSha256
  );
}

function summarizeXlsxVersion(
  version: typeof certificateTemplateVersion.$inferSelect,
) {
  const analysis = toRecord(version.analysis);
  const sheets = Array.isArray(analysis.sheets) ? analysis.sheets : [];

  return {
    id: version.id,
    templateId: version.templateId,
    version: version.version,
    status: version.status,
    xlsxSha256: version.xlsxSha256,
    bindingManifestSha256: version.bindingManifestSha256,
    sheetCount: sheets.length,
    placeholderCount: sheets.reduce(
      (total, sheet) => total + countSheetPlaceholders(sheet),
      0,
    ),
    warningCount: Array.isArray(analysis.warnings)
      ? analysis.warnings.length
      : 0,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    publishedAt: version.publishedAt,
  };
}

export const certificateTemplatesRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .get("/", ...requireLabProtected, requireOrgType("LAB"), async (c) => {
    const member = c.get("member");
    const access = await getOrganizationPlanAccess(member.organizationId);
    const canManage = access.entitlements.includes("custom_templates");

    const templates = await db
      .select({
        id: certificateTemplate.id,
        name: certificateTemplate.name,
        slug: certificateTemplate.slug,
        version: certificateTemplate.version,
        status: certificateTemplate.status,
        isDefault: certificateTemplate.isDefault,
        createdAt: certificateTemplate.createdAt,
        updatedAt: certificateTemplate.updatedAt,
      })
      .from(certificateTemplate)
      .where(eq(certificateTemplate.organizationId, member.organizationId))
      .orderBy(desc(certificateTemplate.isDefault), certificateTemplate.name);

    const templateIds = templates.map((template) => template.id);
    const versions =
      templateIds.length > 0
        ? await db
            .select()
            .from(certificateTemplateVersion)
            .where(
              and(
                eq(
                  certificateTemplateVersion.organizationId,
                  member.organizationId,
                ),
                inArray(certificateTemplateVersion.templateId, templateIds),
              ),
            )
            .orderBy(
              certificateTemplateVersion.templateId,
              desc(certificateTemplateVersion.version),
            )
        : [];
    const currentVersionByTemplateId = new Map<
      number,
      ReturnType<typeof summarizeXlsxVersion>
    >();

    for (const version of versions) {
      if (!currentVersionByTemplateId.has(version.templateId)) {
        currentVersionByTemplateId.set(
          version.templateId,
          summarizeXlsxVersion(version),
        );
      }
    }

    return c.json({
      canManage,
      items:
        templates.length > 0
          ? templates.map((template) => ({
              ...template,
              currentXlsxVersion:
                currentVersionByTemplateId.get(template.id) ?? null,
            }))
          : [
              {
                id: null,
                name: "Padrão do Sistema",
                slug: "padrao-sistema",
                version: 1,
                status: "SYSTEM",
                isDefault: true,
                createdAt: null,
                updatedAt: null,
                currentXlsxVersion: null,
              },
            ],
    });
  })
  .post(
    "/",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    zValidator("json", CreateTemplateSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");
      const slug = slugifyTemplateName(input.name);

      if (!slug) {
        return c.json({ error: "Nome inválido para template" }, 400);
      }

      const existing = await db.query.certificateTemplate.findFirst({
        where: and(
          eq(certificateTemplate.organizationId, member.organizationId),
          eq(certificateTemplate.slug, slug),
        ),
      });

      if (existing) {
        return c.json({ error: "Já existe um template com esse nome" }, 409);
      }

      const [currentDefault] = await db
        .select({ id: certificateTemplate.id })
        .from(certificateTemplate)
        .where(
          and(
            eq(certificateTemplate.organizationId, member.organizationId),
            eq(certificateTemplate.isDefault, true),
          ),
        )
        .limit(1);

      const [created] = await db
        .insert(certificateTemplate)
        .values({
          organizationId: member.organizationId,
          name: input.name,
          slug,
          isDefault: !currentDefault,
          createdBy: session.user.id,
        })
        .returning();

      if (created) {
        await writeOrganizationAuditEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "certificate_template.created",
          entityType: "certificate_template",
          entityId: String(created.id),
          details: {
            name: created.name,
            slug: created.slug,
            isDefault: created.isDefault,
            status: created.status,
          },
        });
      }

      return c.json({ item: created }, 201);
    },
  )
  .post(
    "/:id/versions/upload-xlsx",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const env = getR2Env(c.env);

      if (!Number.isFinite(id)) {
        return c.json({ error: "Template inválido" }, 400);
      }
      if (!env) return c.json({ error: "Storage R2 nao configurado" }, 500);

      const template = await db.query.certificateTemplate.findFirst({
        where: and(
          eq(certificateTemplate.id, id),
          eq(certificateTemplate.organizationId, member.organizationId),
        ),
      });

      if (!template) {
        return c.json({ error: "Template não encontrado" }, 404);
      }

      const formData = await c.req.formData();
      const file = formData.get("xlsx");

      if (!(file instanceof File)) {
        return c.json({ error: "Nenhum arquivo XLSX enviado" }, 400);
      }

      const fileName = file.name.toLowerCase();
      if (
        !fileName.endsWith(".xlsx") ||
        !ALLOWED_XLSX_CONTENT_TYPES.includes(file.type)
      ) {
        return c.json(
          { error: "Formato inválido. Envie um arquivo .xlsx." },
          400,
        );
      }

      if (file.size > MAX_XLSX_FILE_SIZE) {
        return c.json(
          {
            error: `Arquivo muito grande. Máximo ${MAX_XLSX_FILE_SIZE / 1024 / 1024}MB.`,
          },
          400,
        );
      }

      let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
      try {
        bytes = await normalizeWorkbookPrintSettings(bytes);
      } catch {
        return c.json(
          {
            error:
              "Arquivo XLSX inválido ou corrompido. Envie uma pasta de trabalho .xlsx válida.",
            warnings: [
              {
                code: "unsupported_file_type",
                message: "Input is not a readable XLSX workbook.",
              },
            ],
          },
          400,
        );
      }
      const engine = new ExcelTsCertificateWorkbookEngine();
      const analysis = await engine.analyze(bytes);
      const blockingWarnings = getBlockingWorkbookWarnings(analysis);

      if (blockingWarnings.length > 0) {
        return c.json(
          {
            error: "A pasta XLSX possui avisos bloqueantes",
            warnings: blockingWarnings,
          },
          400,
        );
      }

      const xlsxSha256 = sha256Hex(bytes);
      const manifest = createDefaultXlsxBindingManifest(analysis);
      const bindingManifestSha256 =
        hashCertificateXlsxBindingManifest(manifest);
      const r2Client = createR2Client(env);
      const [orgRow] = await db
        .select({ slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, member.organizationId))
        .limit(1);
      const orgSlug = orgRow?.slug ?? "";

      const { version, nextVersion, xlsxR2Key } = await db.transaction(
        async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`certificate-template-version:${template.id}`}))`,
          );

          const [latestVersion] = await tx
            .select({ version: certificateTemplateVersion.version })
            .from(certificateTemplateVersion)
            .where(eq(certificateTemplateVersion.templateId, template.id))
            .orderBy(desc(certificateTemplateVersion.version))
            .limit(1);
          const nextVersion = (latestVersion?.version ?? 0) + 1;
          const xlsx = templateXlsxKey({
            org: { id: member.organizationId, slug: orgSlug },
            templateId: template.id,
            version: nextVersion,
            uniqueId: randomUUID(),
          });
          const xlsxR2Key = xlsx.key;

          await uploadToR2(
            r2Client,
            resolveBucketName(env, xlsx.bucket),
            xlsxR2Key,
            bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );

          const [version] = await tx
            .insert(certificateTemplateVersion)
            .values({
              organizationId: member.organizationId,
              templateId: template.id,
              version: nextVersion,
              status: "DRAFT",
              xlsxR2Key,
              xlsxSha256,
              bindingManifest: manifest,
              bindingManifestSha256,
              renderPolicy: DEFAULT_XLSX_RENDER_POLICY,
              analysis,
              validationResult: {
                ok: false,
                warnings: analysis.warnings,
                checkedAt: new Date().toISOString(),
              },
              createdBy: session.user.id,
            })
            .returning();

          if (!version) {
            throw new Error("Falha ao criar versão XLSX");
          }

          return { version, nextVersion, xlsxR2Key };
        },
      );

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "certificate_template.xlsx_uploaded",
        entityType: "certificate_template_version",
        entityId: version ? String(version.id) : undefined,
        details: {
          templateId: template.id,
          version: nextVersion,
          xlsxR2Key,
          xlsxSha256,
          bindingManifestSha256,
          warnings: analysis.warnings,
        },
      });

      return c.json(
        {
          item: version,
          analysis,
          bindingManifest: manifest,
        },
        201,
      );
    },
  )
  .get(
    "/:id/versions/:versionId",
    ...requireLabProtected,
    requireOrgType("LAB"),
    async (c) => {
      const member = c.get("member");
      const id = Number.parseInt(c.req.param("id"), 10);
      const versionId = Number.parseInt(c.req.param("versionId"), 10);

      if (!Number.isFinite(id) || !Number.isFinite(versionId)) {
        return c.json({ error: "Template ou versão inválidos" }, 400);
      }

      const version = await db.query.certificateTemplateVersion.findFirst({
        where: and(
          eq(certificateTemplateVersion.id, versionId),
          eq(certificateTemplateVersion.templateId, id),
          eq(certificateTemplateVersion.organizationId, member.organizationId),
        ),
      });

      if (!version) {
        return c.json({ error: "Versão XLSX não encontrada" }, 404);
      }

      return c.json({
        item: summarizeXlsxVersion(version),
        analysis: version.analysis ?? {
          sheets: [],
          warnings: [],
        },
        bindingManifest: validateCertificateXlsxBindingManifest(
          version.bindingManifest,
        ),
      });
    },
  )
  .get(
    "/:id/versions/:versionId/analyze",
    ...requireLabProtected,
    requireOrgType("LAB"),
    async (c) => {
      const member = c.get("member");
      const id = Number.parseInt(c.req.param("id"), 10);
      const versionId = Number.parseInt(c.req.param("versionId"), 10);
      const env = getR2Env(c.env);

      if (!Number.isFinite(id) || !Number.isFinite(versionId)) {
        return c.json({ error: "Template ou versão inválidos" }, 400);
      }
      if (!env) return c.json({ error: "Storage R2 nao configurado" }, 500);

      const version = await db.query.certificateTemplateVersion.findFirst({
        where: and(
          eq(certificateTemplateVersion.id, versionId),
          eq(certificateTemplateVersion.templateId, id),
          eq(certificateTemplateVersion.organizationId, member.organizationId),
        ),
      });

      if (!version || version.xlsxR2Key === null) {
        return c.json({ error: "Versão XLSX não encontrada" }, 404);
      }

      const r2Client = createR2Client(env);
      const bucketName = await resolveReadBucketName(
        r2Client,
        env,
        "media",
        version.xlsxR2Key,
      );
      const bytes = await downloadFromR2(
        r2Client,
        bucketName,
        version.xlsxR2Key,
      );
      const analysis = await new ExcelTsCertificateWorkbookEngine().analyze(
        bytes,
      );

      return c.json({
        item: {
          id: version.id,
          templateId: version.templateId,
          version: version.version,
          status: version.status,
          xlsxSha256: version.xlsxSha256,
          bindingManifestSha256: version.bindingManifestSha256,
        },
        analysis,
      });
    },
  )
  .patch(
    "/:id/versions/:versionId/bindings",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    zValidator("json", UpdateXlsxBindingsSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const versionId = Number.parseInt(c.req.param("versionId"), 10);
      const { manifest } = c.req.valid("json");

      if (!Number.isFinite(id) || !Number.isFinite(versionId)) {
        return c.json({ error: "Template ou versão inválidos" }, 400);
      }

      const existing = await db.query.certificateTemplateVersion.findFirst({
        where: and(
          eq(certificateTemplateVersion.id, versionId),
          eq(certificateTemplateVersion.templateId, id),
          eq(certificateTemplateVersion.organizationId, member.organizationId),
        ),
      });

      if (!existing) {
        return c.json({ error: "Versão XLSX não encontrada" }, 404);
      }

      if (existing.status === "PUBLISHED" || existing.status === "ARCHIVED") {
        return c.json(
          { error: "Versões publicadas ou arquivadas são imutáveis" },
          409,
        );
      }

      const validatedManifest =
        validateCertificateXlsxBindingManifest(manifest);
      const fieldWarnings =
        getCertificateXlsxManifestFieldWarnings(validatedManifest);
      if (fieldWarnings.length > 0) {
        return c.json(
          {
            error: "Manifesto possui campos desconhecidos",
            warnings: fieldWarnings,
          },
          400,
        );
      }

      const bindingManifestSha256 =
        hashCertificateXlsxBindingManifest(validatedManifest);

      const [updated] = await db
        .update(certificateTemplateVersion)
        .set({
          bindingManifest: validatedManifest,
          bindingManifestSha256,
          renderPolicy: validatedManifest.renderPolicy,
          status: "DRAFT",
          validationResult: null,
          updatedAt: new Date(),
        })
        .where(eq(certificateTemplateVersion.id, existing.id))
        .returning();

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "certificate_template.xlsx_bindings_updated",
        entityType: "certificate_template_version",
        entityId: String(existing.id),
        details: {
          templateId: id,
          versionId,
          bindingManifestSha256,
        },
      });

      return c.json({ item: updated });
    },
  )
  .post(
    "/:id/versions/:versionId/validate",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const versionId = Number.parseInt(c.req.param("versionId"), 10);
      const env = getR2Env(c.env);

      if (!Number.isFinite(id) || !Number.isFinite(versionId)) {
        return c.json({ error: "Template ou versão inválidos" }, 400);
      }
      if (!env) return c.json({ error: "Storage R2 nao configurado" }, 500);

      const existing = await db.query.certificateTemplateVersion.findFirst({
        where: and(
          eq(certificateTemplateVersion.id, versionId),
          eq(certificateTemplateVersion.templateId, id),
          eq(certificateTemplateVersion.organizationId, member.organizationId),
        ),
      });

      if (!existing || existing.xlsxR2Key === null) {
        return c.json({ error: "Versão XLSX não encontrada" }, 404);
      }

      if (existing.status === "PUBLISHED" || existing.status === "ARCHIVED") {
        return c.json(
          { error: "Versões publicadas ou arquivadas são imutáveis" },
          409,
        );
      }

      const manifest = validateCertificateXlsxBindingManifest(
        existing.bindingManifest,
      );
      const r2Client = createR2Client(env);
      const bucketName = await resolveReadBucketName(
        r2Client,
        env,
        "media",
        existing.xlsxR2Key,
      );
      const bytes = await downloadFromR2(
        r2Client,
        bucketName,
        existing.xlsxR2Key,
      );
      const analysis = await new ExcelTsCertificateWorkbookEngine().analyze(
        bytes,
      );
      const blockingWarnings = getBlockingWorkbookWarnings(analysis);
      const policyWarnings = getWorkbookPolicyWarnings(analysis, manifest);
      const fieldWarnings = getCertificateXlsxManifestFieldWarnings(manifest);
      const unknownSheets = new Set(analysis.sheets.map((sheet) => sheet.name));
      const bindingWarnings = [
        ...manifest.scalarBindings,
        ...manifest.imageBindings,
        ...manifest.tableBindings,
      ]
        .filter((binding) => !unknownSheets.has(binding.sheet))
        .map((binding) => ({
          code: "missing_sheet",
          message: `Sheet "${binding.sheet}" was not found.`,
          sheet: binding.sheet,
        }));
      const validationResult = {
        ok:
          blockingWarnings.length === 0 &&
          policyWarnings.length === 0 &&
          fieldWarnings.length === 0 &&
          bindingWarnings.length === 0,
        warnings: [...analysis.warnings, ...fieldWarnings, ...bindingWarnings],
        checkedAt: new Date().toISOString(),
      };

      const [updated] = await db
        .update(certificateTemplateVersion)
        .set({
          analysis,
          validationResult,
          status: validationResult.ok ? "VALIDATED" : "DRAFT",
          updatedAt: new Date(),
        })
        .where(eq(certificateTemplateVersion.id, existing.id))
        .returning();

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "certificate_template.xlsx_validated",
        entityType: "certificate_template_version",
        entityId: String(existing.id),
        details: {
          templateId: id,
          versionId,
          ok: validationResult.ok,
          warningCount: validationResult.warnings.length,
        },
      });

      return c.json({ item: updated, validation: validationResult, analysis });
    },
  )
  .post(
    "/:id/versions/:versionId/preview",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    zValidator("json", RequestXlsxPreviewSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const versionId = Number.parseInt(c.req.param("versionId"), 10);
      const input = c.req.valid("json");

      if (!Number.isFinite(id) || !Number.isFinite(versionId)) {
        return c.json({ error: "Template ou versão inválidos" }, 400);
      }

      const version = await db.query.certificateTemplateVersion.findFirst({
        where: and(
          eq(certificateTemplateVersion.id, versionId),
          eq(certificateTemplateVersion.templateId, id),
          eq(certificateTemplateVersion.organizationId, member.organizationId),
        ),
      });

      if (!version) {
        return c.json({ error: "Versão XLSX não encontrada" }, 404);
      }

      const [preview] = await db
        .insert(certificateTemplatePreview)
        .values({
          organizationId: member.organizationId,
          templateVersionId: version.id,
          sampleData: input.sampleData ?? {},
          status: "PENDING",
          requestedBy: session.user.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning();

      if (!preview) {
        return c.json({ error: "Falha ao criar prévia XLSX" }, 500);
      }

      await enqueueBackgroundJob(
        {
          type: "CERTIFICATE_XLSX_PREVIEW",
          previewId: preview.id,
          templateVersionId: version.id,
          userId: session.user.id,
        },
        {
          idempotencyKey: `certificate-xlsx-preview-${preview.id}`,
        },
      );

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "certificate.render_preview_requested",
        entityType: "certificate_template_preview",
        entityId: String(preview.id),
        details: {
          templateId: id,
          versionId: version.id,
        },
      });

      return c.json({ item: preview }, 202);
    },
  )
  .get(
    "/:id/versions/:versionId/previews/:previewId",
    ...requireLabProtected,
    requireOrgType("LAB"),
    async (c) => {
      const member = c.get("member");
      const id = Number.parseInt(c.req.param("id"), 10);
      const versionId = Number.parseInt(c.req.param("versionId"), 10);
      const previewId = Number.parseInt(c.req.param("previewId"), 10);
      const env = getR2Env(c.env);

      if (
        !Number.isFinite(id) ||
        !Number.isFinite(versionId) ||
        !Number.isFinite(previewId)
      ) {
        return c.json({ error: "Template, versão ou prévia inválidos" }, 400);
      }
      if (!env) return c.json({ error: "Storage R2 nao configurado" }, 500);

      const preview = await db.query.certificateTemplatePreview.findFirst({
        with: {
          templateVersion: true,
        },
        where: and(
          eq(certificateTemplatePreview.id, previewId),
          eq(certificateTemplatePreview.templateVersionId, versionId),
          eq(certificateTemplatePreview.organizationId, member.organizationId),
        ),
      });

      if (!preview || preview.templateVersion.templateId !== id) {
        return c.json({ error: "Prévia XLSX não encontrada" }, 404);
      }

      let pdfUrl: string | null = null;
      if (preview.pdfR2Key && preview.status === "RENDERED") {
        const r2Client = createR2Client(env);
        pdfUrl = await generatePresignedUrl(
          r2Client,
          env.R2_BUCKET_NAME,
          preview.pdfR2Key,
          900,
        );
      }

      return c.json({ item: preview, pdfUrl });
    },
  )
  .post(
    "/:id/versions/:versionId/publish",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const versionId = Number.parseInt(c.req.param("versionId"), 10);

      if (!Number.isFinite(id) || !Number.isFinite(versionId)) {
        return c.json({ error: "Template ou versão inválidos" }, 400);
      }

      const existing = await db.query.certificateTemplateVersion.findFirst({
        where: and(
          eq(certificateTemplateVersion.id, versionId),
          eq(certificateTemplateVersion.templateId, id),
          eq(certificateTemplateVersion.organizationId, member.organizationId),
        ),
      });

      if (!existing) {
        return c.json({ error: "Versão XLSX não encontrada" }, 404);
      }

      // Publishing onto an archived template would create an ARCHIVED
      // template with a fresh PUBLISHED version — incoherent audit trail.
      const parentTemplate = await db.query.certificateTemplate.findFirst({
        where: and(
          eq(certificateTemplate.id, id),
          eq(certificateTemplate.organizationId, member.organizationId),
        ),
      });
      if (!parentTemplate || parentTemplate.status !== "ACTIVE") {
        return c.json(
          {
            error:
              "Template arquivado — restaure-o antes de publicar novas versões",
          },
          409,
        );
      }

      if (
        existing.xlsxSha256 === null ||
        existing.bindingManifestSha256 === null
      ) {
        return c.json(
          { error: "Versão XLSX sem artefatos — não pode ser publicada" },
          409,
        );
      }

      const publishedInputs = {
        xlsxSha256: existing.xlsxSha256,
        bindingManifestSha256: existing.bindingManifestSha256,
      };

      const validation = toRecord(existing.validationResult);
      if (validation.ok !== true && existing.status !== "VALIDATED") {
        return c.json({ error: "Valide a versão XLSX antes de publicar" }, 409);
      }

      const renderedPreviews = await db
        .select({
          id: certificateTemplatePreview.id,
          filledXlsxR2Key: certificateTemplatePreview.filledXlsxR2Key,
          pdfR2Key: certificateTemplatePreview.pdfR2Key,
          pdfSha256: certificateTemplatePreview.pdfSha256,
          renderMetadata: certificateTemplatePreview.renderMetadata,
        })
        .from(certificateTemplatePreview)
        .where(
          and(
            eq(
              certificateTemplatePreview.organizationId,
              member.organizationId,
            ),
            eq(certificateTemplatePreview.templateVersionId, existing.id),
            eq(certificateTemplatePreview.status, "RENDERED"),
          ),
        )
        .orderBy(desc(certificateTemplatePreview.createdAt))
        .limit(10);
      const matchingPreview = renderedPreviews.find((preview) =>
        previewMatchesPublishedInputs(preview, publishedInputs),
      );

      if (!matchingPreview) {
        return c.json(
          {
            error:
              "Gere uma prévia XLSX concluída para esta versão antes de publicar",
          },
          409,
        );
      }

      const [updated] = await db
        .update(certificateTemplateVersion)
        .set({
          status: "PUBLISHED",
          publishedAt: new Date(),
          publishedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(certificateTemplateVersion.id, existing.id),
            inArray(certificateTemplateVersion.status, ["DRAFT", "VALIDATED"]),
          ),
        )
        .returning();

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "certificate_template.xlsx_published",
        entityType: "certificate_template_version",
        entityId: String(existing.id),
        details: {
          templateId: id,
          versionId,
          bindingManifestSha256: existing.bindingManifestSha256,
          previewId: matchingPreview.id,
        },
      });

      return c.json({ item: updated });
    },
  )
  .put(
    "/:id",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    zValidator("json", UpdateTemplateSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!Number.isFinite(id)) {
        return c.json({ error: "Template inválido" }, 400);
      }

      const existing = await db.query.certificateTemplate.findFirst({
        where: and(
          eq(certificateTemplate.id, id),
          eq(certificateTemplate.organizationId, member.organizationId),
        ),
      });

      if (!existing) {
        return c.json({ error: "Template não encontrado" }, 404);
      }

      const nextName = input.name ?? existing.name;
      const nextSlug = slugifyTemplateName(nextName);

      const duplicate = await db.query.certificateTemplate.findFirst({
        where: and(
          eq(certificateTemplate.organizationId, member.organizationId),
          eq(certificateTemplate.slug, nextSlug),
          ne(certificateTemplate.id, existing.id),
        ),
      });

      if (duplicate) {
        return c.json({ error: "Já existe um template com esse nome" }, 409);
      }

      const [updated] = await db
        .update(certificateTemplate)
        .set({
          name: nextName,
          slug: nextSlug,
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(certificateTemplate.id, existing.id))
        .returning();

      if (updated) {
        await writeOrganizationAuditEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "certificate_template.updated",
          entityType: "certificate_template",
          entityId: String(updated.id),
          details: {
            changedFields: {
              name: input.name !== undefined && input.name !== existing.name,
            },
            before: {
              name: existing.name,
              slug: existing.slug,
              version: existing.version,
            },
            after: {
              name: updated.name,
              slug: updated.slug,
              version: updated.version,
            },
          },
        });
      }

      return c.json({
        item: updated,
      });
    },
  )
  .post(
    "/:id/duplicate",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);

      if (!Number.isFinite(id)) {
        return c.json({ error: "Template inválido" }, 400);
      }

      const existing = await db.query.certificateTemplate.findFirst({
        where: and(
          eq(certificateTemplate.id, id),
          eq(certificateTemplate.organizationId, member.organizationId),
        ),
      });

      if (!existing) {
        return c.json({ error: "Template não encontrado" }, 404);
      }

      let duplicateName = `${existing.name} copy`;
      let duplicateSlug = slugifyTemplateName(duplicateName);
      let counter = 2;

      while (
        await db.query.certificateTemplate.findFirst({
          where: and(
            eq(certificateTemplate.organizationId, member.organizationId),
            eq(certificateTemplate.slug, duplicateSlug),
          ),
        })
      ) {
        duplicateName = `${existing.name} copy ${counter}`;
        duplicateSlug = slugifyTemplateName(duplicateName);
        counter += 1;
      }

      const [created] = await db
        .insert(certificateTemplate)
        .values({
          organizationId: member.organizationId,
          name: duplicateName,
          slug: duplicateSlug,
          version: 1,
          isDefault: false,
          status: "ACTIVE",
          createdBy: session.user.id,
        })
        .returning();

      // Copy the CONTENT, not just the shell: a duplicate that arrives with
      // no versions silently loses the entire layout ("same template, new
      // unit" is the #1 duplication use case). Prefer the latest PUBLISHED
      // version, else the latest of any status; the copy lands as DRAFT v1.
      let copiedVersionId: number | null = null;
      if (created) {
        const sourceVersions =
          await db.query.certificateTemplateVersion.findMany({
            where: and(
              eq(certificateTemplateVersion.templateId, existing.id),
              eq(
                certificateTemplateVersion.organizationId,
                member.organizationId,
              ),
            ),
            orderBy: [desc(certificateTemplateVersion.version)],
          });
        const sourceVersion =
          sourceVersions.find(
            (candidate) => candidate.status === "PUBLISHED",
          ) ??
          sourceVersions[0] ??
          null;
        if (sourceVersion) {
          const [copiedVersion] = await db
            .insert(certificateTemplateVersion)
            .values({
              organizationId: member.organizationId,
              templateId: created.id,
              version: 1,
              status: "DRAFT",
              // Immutable artifacts (R2 objects) are shared by reference —
              // both rows point at the same frozen upload.
              xlsxR2Key: sourceVersion.xlsxR2Key,
              xlsxSha256: sourceVersion.xlsxSha256,
              bindingManifest: sourceVersion.bindingManifest,
              bindingManifestSha256: sourceVersion.bindingManifestSha256,
              renderPolicy: sourceVersion.renderPolicy,
              validationResult: null,
              createdBy: session.user.id,
            })
            .returning();
          copiedVersionId = copiedVersion?.id ?? null;
        }
      }

      if (created) {
        await writeOrganizationAuditEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "certificate_template.duplicated",
          entityType: "certificate_template",
          entityId: String(created.id),
          details: {
            sourceTemplateId: existing.id,
            sourceTemplateName: existing.name,
            name: created.name,
            slug: created.slug,
            copiedVersionId,
          },
        });
      }

      return c.json(
        {
          item: created,
        },
        201,
      );
    },
  )
  .post(
    "/:id/set-default",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);

      if (!Number.isFinite(id)) {
        return c.json({ error: "Template inválido" }, 400);
      }

      const existing = await db.query.certificateTemplate.findFirst({
        where: and(
          eq(certificateTemplate.id, id),
          eq(certificateTemplate.organizationId, member.organizationId),
        ),
      });

      if (!existing) {
        return c.json({ error: "Template não encontrado" }, 404);
      }

      await db
        .update(certificateTemplate)
        .set({ isDefault: false })
        .where(eq(certificateTemplate.organizationId, member.organizationId));

      await db
        .update(certificateTemplate)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(certificateTemplate.id, existing.id));

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "certificate_template.default_set",
        entityType: "certificate_template",
        entityId: String(existing.id),
        details: {
          name: existing.name,
          slug: existing.slug,
        },
      });

      return c.json({ success: true });
    },
  )
  .post(
    "/:id/archive",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);

      if (!Number.isFinite(id)) {
        return c.json({ error: "Template inválido" }, 400);
      }

      const existing = await db.query.certificateTemplate.findFirst({
        where: and(
          eq(certificateTemplate.id, id),
          eq(certificateTemplate.organizationId, member.organizationId),
        ),
      });

      if (!existing) {
        return c.json({ error: "Template não encontrado" }, 404);
      }

      if (existing.isDefault) {
        return c.json(
          { error: "Defina outro template como padrão antes de arquivar este" },
          400,
        );
      }

      // Archiving a template that methods still issue with would break their
      // next certificate — block until every method is re-pointed.
      const linkedMethods = await db
        .select({ id: calibrationMethod.id })
        .from(calibrationMethod)
        .where(
          and(
            eq(calibrationMethod.certificateTemplateId, existing.id),
            eq(calibrationMethod.organizationId, member.organizationId),
            ne(calibrationMethod.status, "ARCHIVED"),
          ),
        );
      if (linkedMethods.length > 0) {
        return c.json(
          {
            error: `Modelo vinculado a ${linkedMethods.length} método(s) — desvincule os métodos antes de arquivar, ou os certificados dessas calibrações falharão`,
          },
          409,
        );
      }

      await db
        .update(certificateTemplate)
        .set({
          status: "ARCHIVED",
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(certificateTemplate.id, existing.id));

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "certificate_template.archived",
        entityType: "certificate_template",
        entityId: String(existing.id),
        details: {
          name: existing.name,
          slug: existing.slug,
        },
      });

      return c.json({ success: true });
    },
  );
