import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  certificateNumberingAuditLog,
  certificateNumberingProfile,
  organization,
  type CertificateNumberingConfig,
} from "@calibra-facil/db/schema";
import { UpdateCertificateNumberingProfileSchema } from "@calibra-facil/schemas";
import { and, desc, eq } from "drizzle-orm";
import {
  requireLabProtected,
  requireOrgType,
  type AuthVariables,
} from "../middleware/permission";
import { requireUnitOperationalSettingsManager } from "../lib/unit-operational-settings";
import {
  DEFAULT_CERTIFICATE_NUMBERING_CONFIG,
  buildCertificateSequenceKey,
  renderCertificateTemplate,
  validateCertificateNumberingConfig,
} from "../lib/certificate-numbering";

export const certificateNumberingRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .get("/", ...requireLabProtected, requireOrgType("LAB"), async (c) => {
    const memberData = c.get("member");

    const [profile] = await db
      .select()
      .from(certificateNumberingProfile)
      .where(
        eq(
          certificateNumberingProfile.organizationId,
          memberData.organizationId,
        ),
      )
      .limit(1);

    const [org] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, memberData.organizationId))
      .limit(1);

    const effectiveConfig =
      profile?.config ?? DEFAULT_CERTIFICATE_NUMBERING_CONFIG;
    const example = buildPreview(
      effectiveConfig,
      org?.name ?? "Laboratorio",
      new Date(),
    );

    return c.json({
      profile: profile
        ? {
            id: profile.id,
            name: profile.name,
            config: profile.config,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
          }
        : {
            id: null,
            name: "Padrao",
            config: DEFAULT_CERTIFICATE_NUMBERING_CONFIG,
            createdAt: null,
            updatedAt: null,
          },
      example,
      supportedTokens: [
        "{labCode}",
        "{labName}",
        "{labSlug}",
        "{projectCode}",
        "{yyyy}",
        "{yy}",
        "{mm}",
        "{mon}",
        "{dd}",
        "{seq}",
        "{number}",
      ],
    });
  })

  .put(
    "/",
    ...requireLabProtected,
    requireOrgType("LAB"),
    zValidator("json", UpdateCertificateNumberingProfileSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      requireUnitOperationalSettingsManager(memberData);

      const input = c.req.valid("json");
      let config;
      try {
        config = validateCertificateNumberingConfig(input.config);
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Configuracao de numeracao invalida",
          },
          400,
        );
      }

      const [existing] = await db
        .select()
        .from(certificateNumberingProfile)
        .where(
          eq(
            certificateNumberingProfile.organizationId,
            memberData.organizationId,
          ),
        )
        .limit(1);

      const [profile] = await db
        .insert(certificateNumberingProfile)
        .values({
          organizationId: memberData.organizationId,
          name: input.name,
          config,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        })
        .onConflictDoUpdate({
          target: certificateNumberingProfile.organizationId,
          set: {
            name: input.name,
            config,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!profile) {
        return c.json({ error: "Falha ao salvar perfil" }, 500);
      }

      await db.insert(certificateNumberingAuditLog).values({
        organizationId: memberData.organizationId,
        profileId: profile.id,
        action: existing ? "update" : "create",
        changes: {
          old: existing
            ? {
                name: existing.name,
                config: existing.config,
              }
            : null,
          new: {
            name: profile.name,
            config: profile.config,
          },
        },
        performedBy: session.user.id,
        ipAddress:
          c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null,
      });

      return c.json({
        message: "Perfil de numeracao atualizado",
        profile,
      });
    },
  )

  .get(
    "/audit-log",
    ...requireLabProtected,
    requireOrgType("LAB"),
    async (c) => {
      const memberData = c.get("member");
      requireUnitOperationalSettingsManager(memberData);

      const rows = await db
        .select({
          id: certificateNumberingAuditLog.id,
          profileId: certificateNumberingAuditLog.profileId,
          action: certificateNumberingAuditLog.action,
          changes: certificateNumberingAuditLog.changes,
          performedBy: certificateNumberingAuditLog.performedBy,
          performedAt: certificateNumberingAuditLog.performedAt,
        })
        .from(certificateNumberingAuditLog)
        .where(
          and(
            eq(
              certificateNumberingAuditLog.organizationId,
              memberData.organizationId,
            ),
          ),
        )
        .orderBy(desc(certificateNumberingAuditLog.performedAt))
        .limit(50);

      return c.json({ data: rows });
    },
  );

function buildPreview(
  config: CertificateNumberingConfig,
  organizationName: string,
  generatedAt: Date,
) {
  const sequenceKey = buildCertificateSequenceKey(
    config.sequence.resetScope,
    { organizationId: "preview", generatedAt, projectCode: config.projectCode },
    config,
  );
  const yyyy = String(generatedAt.getFullYear());
  const month = generatedAt.getMonth() + 1;
  const sequence = String(123).padStart(config.sequence.padding, "0");
  const tokens = {
    number: "",
    labCode: config.labCode,
    labName: organizationName,
    labSlug: organizationName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
    projectCode: config.projectCode?.trim() || "GERAL",
    yyyy,
    yy: yyyy.slice(-2),
    mm: String(month).padStart(2, "0"),
    mon:
      [
        "JAN",
        "FEB",
        "MAR",
        "APR",
        "MAY",
        "JUN",
        "JUL",
        "AUG",
        "SEP",
        "OCT",
        "NOV",
        "DEC",
      ][month - 1] ?? "",
    dd: String(generatedAt.getDate()).padStart(2, "0"),
    seq: sequence,
  };
  const number = renderCertificateTemplate(config.numberTemplate, tokens);

  return {
    number,
    name: renderCertificateTemplate(config.certificateNameTemplate, {
      ...tokens,
      number,
    }),
    sequenceKey,
  };
}
