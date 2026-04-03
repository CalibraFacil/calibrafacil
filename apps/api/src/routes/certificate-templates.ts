import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
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
});

const CreateTemplateSchema = z.object({
  name: z.string().trim().min(3).max(80),
  config: TemplateConfigSchema.optional(),
});

const UpdateTemplateSchema = z.object({
  name: z.string().trim().min(3).max(80).optional(),
  config: TemplateConfigSchema.optional(),
});

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
  .put(
    "/:id",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    zValidator("json", UpdateTemplateSchema),
    async (c) => {
      const member = c.get("member");
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
            } as unknown as Partial<CertificateTemplateConfig>,
            ),
          ),
          updatedAt: new Date(),
        })
        .where(eq(certificateTemplate.id, existing.id))
        .returning();

      return c.json({
        item: {
          ...updated,
          config: normalizeCertificateTemplateConfig(updated?.config as any),
        },
      });
    },
  )
  .post(
    "/:id/set-default",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_templates"),
    async (c) => {
      const member = c.get("member");
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

      return c.json({ success: true });
    },
  );
