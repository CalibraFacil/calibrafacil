import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@calibra-facil/db";
import { certificateTemplate } from "@calibra-facil/db/schema";
import {
  type CertificateTemplateConfig,
  DEFAULT_CERTIFICATE_TEMPLATE_CONFIG,
  normalizeCertificateTemplateConfig,
} from "@calibra-facil/shared";
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
  uploadToR2,
  generatePresignedUrl,
  type R2Env,
} from "../lib/storage";
import { writeOrganizationAuditEvent } from "../lib/audit";
import { and, desc, eq, ne } from "drizzle-orm";

const TemplateConfigSchema = z.object({
  version: z.literal(1).optional(),
  theme: z
    .object({
      primaryColor: z.string().trim().min(4).max(32).optional(),
      accentColor: z.string().trim().min(4).max(32).optional(),
      logoUrl: z.string().url().nullable().optional(),
    })
    .optional(),
  content: z
    .object({
      documentTitle: z.string().trim().min(4).max(120).optional(),
      introText: z.string().trim().max(500).nullable().optional(),
      footerNote: z.string().trim().max(500).nullable().optional(),
    })
    .optional(),
  sections: z
    .object({
      showLabAddress: z.boolean().optional(),
      showLabContact: z.boolean().optional(),
      showAccreditation: z.boolean().optional(),
      showCustomerContact: z.boolean().optional(),
      showEnvironmental: z.boolean().optional(),
      showStandards: z.boolean().optional(),
      showResults: z.boolean().optional(),
      showSignature: z.boolean().optional(),
      showAmendmentNotice: z.boolean().optional(),
    })
    .optional(),
  layout: z
    .object({
      headerStyle: z.enum(["classic", "split", "minimal"]).optional(),
      density: z.enum(["comfortable", "compact"]).optional(),
      emphasis: z.enum(["brand", "formal", "neutral"]).optional(),
    })
    .optional(),
});

const CreateTemplateSchema = z.object({
  name: z.string().trim().min(3).max(80),
  config: TemplateConfigSchema.optional(),
});

const UpdateTemplateSchema = z.object({
  name: z.string().trim().min(3).max(80).optional(),
  config: TemplateConfigSchema.optional(),
});

const MAX_LOGO_FILE_SIZE = 2 * 1024 * 1024;
const ALLOWED_LOGO_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];
const LOGO_URL_EXPIRY = 900;

function slugifyTemplateName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function toTemplateConfigRecord(
  config: CertificateTemplateConfig,
): Record<string, unknown> {
  return config as unknown as Record<string, unknown>;
}

function getApiBaseUrl(): string {
  return process.env.API_URL || "https://localhost:3000";
}

function buildTemplateLogoKey(organizationId: string, templateId: number): string {
  return `branding-logos/${organizationId}/${templateId}/${Date.now()}-${randomUUID()}`;
}

function encodeLogoAssetKey(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

function decodeLogoAssetKey(key: string): string | null {
  try {
    return Buffer.from(key, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function buildTemplateLogoUrl(key: string): string {
  return `${getApiBaseUrl()}/api/certificate-templates/logo/${encodeLogoAssetKey(key)}`;
}
export const certificateTemplatesRouter = new Hono<{ Variables: AuthVariables }>()
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
        config: certificateTemplate.config,
        createdAt: certificateTemplate.createdAt,
        updatedAt: certificateTemplate.updatedAt,
      })
      .from(certificateTemplate)
      .where(eq(certificateTemplate.organizationId, member.organizationId))
      .orderBy(desc(certificateTemplate.isDefault), certificateTemplate.name);

    return c.json({
      canManage,
      items:
        templates.length > 0
          ? templates.map((template) => ({
              ...template,
              config: normalizeCertificateTemplateConfig(template.config as any),
            }))
          : [
              {
                id: null,
                name: "Padrão do Sistema",
                slug: "padrao-sistema",
                version: 1,
                status: "SYSTEM",
                isDefault: true,
                config: DEFAULT_CERTIFICATE_TEMPLATE_CONFIG,
                createdAt: null,
                updatedAt: null,
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
          config: toTemplateConfigRecord(
            normalizeCertificateTemplateConfig(
              input.config as Partial<CertificateTemplateConfig> | undefined,
            ),
          ),
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

      return c.json(
        {
          item: {
            ...created,
            config: normalizeCertificateTemplateConfig(created?.config as any),
          },
        },
        201,
      );
    },
  )
  .post(
    "/:id/logo",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const env = c.env as R2Env;

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

      const formData = await c.req.formData();
      const file = formData.get("logo") as File | null;

      if (!file) {
        return c.json({ error: "Nenhum arquivo enviado" }, 400);
      }

      if (!ALLOWED_LOGO_CONTENT_TYPES.includes(file.type)) {
        return c.json(
          { error: "Formato inválido. Use PNG, JPG, WebP ou SVG." },
          400,
        );
      }

      if (file.size > MAX_LOGO_FILE_SIZE) {
        return c.json(
          {
            error: `Arquivo muito grande. Máximo ${MAX_LOGO_FILE_SIZE / 1024 / 1024}MB.`,
          },
          400,
        );
      }

      const key = buildTemplateLogoKey(member.organizationId, existing.id);
      const buffer = await file.arrayBuffer();
      const r2Client = createR2Client(env);
      await uploadToR2(r2Client, env.R2_BUCKET_NAME, key, buffer, file.type);

      const currentConfig = normalizeCertificateTemplateConfig(
        existing.config as Partial<CertificateTemplateConfig> | undefined,
      );

      const [updated] = await db
        .update(certificateTemplate)
        .set({
          version: existing.version + 1,
          config: toTemplateConfigRecord({
            ...currentConfig,
            theme: {
              ...currentConfig.theme,
              logoUrl: buildTemplateLogoUrl(key),
            },
          }),
          updatedAt: new Date(),
        })
        .where(eq(certificateTemplate.id, existing.id))
        .returning();

      if (updated) {
        await writeOrganizationAuditEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "certificate_template.logo.uploaded",
          entityType: "certificate_template",
          entityId: String(updated.id),
          details: {
            name: updated.name,
            key,
            contentType: file.type,
            size: file.size,
          },
        });
      }

      return c.json({
        item: {
          ...updated,
          config: normalizeCertificateTemplateConfig(updated?.config as any),
        },
      });
    },
  )
  .delete(
    "/:id/logo",
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

      const currentConfig = normalizeCertificateTemplateConfig(
        existing.config as Partial<CertificateTemplateConfig> | undefined,
      );

      const [updated] = await db
        .update(certificateTemplate)
        .set({
          version: existing.version + 1,
          config: toTemplateConfigRecord({
            ...currentConfig,
            theme: {
              ...currentConfig.theme,
              logoUrl: null,
            },
          }),
          updatedAt: new Date(),
        })
        .where(eq(certificateTemplate.id, existing.id))
        .returning();

      if (updated) {
        await writeOrganizationAuditEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "certificate_template.logo.deleted",
          entityType: "certificate_template",
          entityId: String(updated.id),
          details: {
            name: updated.name,
          },
        });
      }

      return c.json({
        item: {
          ...updated,
          config: normalizeCertificateTemplateConfig(updated?.config as any),
        },
      });
    },
  )
  .get("/logo/:key", async (c) => {
    const env = c.env as R2Env;
    const decodedKey = decodeLogoAssetKey(c.req.param("key"));

    if (!decodedKey) {
      return c.json({ error: "Asset inválido" }, 400);
    }

    try {
      const r2Client = createR2Client(env);
      const url = await generatePresignedUrl(
        r2Client,
        env.R2_BUCKET_NAME,
        decodedKey,
        LOGO_URL_EXPIRY,
      );

      return c.redirect(url, 302);
    } catch (error) {
      console.error("Error fetching template logo:", error);
      return c.json({ error: "Erro ao carregar logo" }, 404);
    }
  })
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
          config: toTemplateConfigRecord(
            normalizeCertificateTemplateConfig({
              ...(existing.config as Record<string, unknown> | null | undefined),
              ...(input.config as Record<string, unknown> | undefined),
              theme: {
                ...(((existing.config as any)?.theme ?? {}) as Record<
                  string,
                  unknown
                >),
                ...((input.config?.theme as Record<string, unknown>) ?? {}),
              },
              content: {
                ...(((existing.config as any)?.content ?? {}) as Record<
                  string,
                  unknown
                >),
                ...((input.config?.content as Record<string, unknown>) ?? {}),
              },
              sections: {
                ...(((existing.config as any)?.sections ?? {}) as Record<
                  string,
                  unknown
                >),
                ...((input.config?.sections as Record<string, unknown>) ?? {}),
              },
              layout: {
                ...(((existing.config as any)?.layout ?? {}) as Record<
                  string,
                  unknown
                >),
                ...((input.config?.layout as Record<string, unknown>) ?? {}),
              },
            } as unknown as Partial<CertificateTemplateConfig>,
            ),
          ),
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
              config: input.config !== undefined,
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
        item: {
          ...updated,
          config: normalizeCertificateTemplateConfig(updated?.config as any),
        },
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
          config: toTemplateConfigRecord(
            normalizeCertificateTemplateConfig(
              existing.config as Partial<CertificateTemplateConfig> | undefined,
            ),
          ),
          createdBy: session.user.id,
        })
        .returning();

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
          },
        });
      }

      return c.json(
        {
          item: {
            ...created,
            config: normalizeCertificateTemplateConfig(created?.config as any),
          },
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
