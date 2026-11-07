import { createRouter } from "../../../server/router";
import { slugify } from "@calibra-facil/shared/text";
import { getLabCalendarDay } from "@calibra-facil/shared/calendar-date";
import { certificateNumberingEndpoints } from "@calibra-facil/contracts";
import {
  certificateNumberingAuditLog,
  certificateNumberingProfile,
  organization,
  type CertificateNumberingConfig,
} from "@calibra-facil/db/schema";
import { and, desc, eq } from "drizzle-orm";
import {
  requireLabProtected,
  requireOrgType,
  requirePermission,
  type AuthVariables,
} from "../../../middleware/permission";
import { requireUnitOperationalSettingsManager } from "../../../lib/unit-operational-settings";
import {
  DEFAULT_CERTIFICATE_NUMBERING_CONFIG,
  buildCertificateSequenceKey,
  renderCertificateTemplate,
  validateCertificateNumberingConfig,
} from "../certificates/certificate-numbering";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { invalid } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

const PREFIX = "/api/certificate-numbering";

export const certificateNumberingRouter = createRouter<{
  Variables: AuthVariables;
}>();

mount(
  certificateNumberingRouter,
  PREFIX,
  certificateNumberingEndpoints.getProfile,
  [...requireLabProtected, requireOrgType("LAB")],
  async (c) => {
    const memberData = c.get("member");

    const { profile, org } = await orgDb(memberData.organizationId).transaction(
      async (o) => {
        const [foundProfile] = await o
          .select()
          .from(certificateNumberingProfile)
          .where(
            eq(
              certificateNumberingProfile.organizationId,
              memberData.organizationId,
            ),
          )
          .limit(1);

        const [foundOrg] = await o
          .select({ name: organization.name })
          .from(organization)
          .where(eq(organization.id, memberData.organizationId))
          .limit(1);

        return { profile: foundProfile, org: foundOrg };
      },
    );

    const effectiveConfig =
      profile?.config ?? DEFAULT_CERTIFICATE_NUMBERING_CONFIG;
    const example = buildPreview(
      effectiveConfig,
      org?.name ?? "Laboratorio",
      new Date(),
    );

    return {
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
    };
  },
);

mount(
  certificateNumberingRouter,
  PREFIX,
  certificateNumberingEndpoints.updateProfile,
  [
    ...requireLabProtected,
    requireOrgType("LAB"),
    // The profile is keyed on organizationId and numbers every unit's
    // certificates, so changing it is an organization-level settings write
    // (owner/admin) — not something a single-unit unit_admin may do.
    requirePermission({ settings: ["update"] }),
  ],
  async (c, { body: input }) => {
    const memberData = c.get("member");
    const session = c.get("session");

    let config;
    try {
      config = validateCertificateNumberingConfig(input.config);
    } catch (error) {
      throw invalid(
        "invalid_request",
        error instanceof Error
          ? error.message
          : "Configuracao de numeracao invalida",
      );
    }

    const profile = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const [existing] = await ctx.o
          .select()
          .from(certificateNumberingProfile)
          .where(
            eq(
              certificateNumberingProfile.organizationId,
              memberData.organizationId,
            ),
          )
          .limit(1);

        const [saved] = await ctx.o
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

        if (!saved) throw new Error("Falha ao salvar perfil");

        // Audit row commits atomically with the change (ISO 17025 §7.5/§8.4).
        await ctx.o.insert(certificateNumberingAuditLog).values({
          organizationId: memberData.organizationId,
          profileId: saved.id,
          action: existing ? "update" : "create",
          changes: {
            old: existing
              ? {
                  name: existing.name,
                  config: existing.config,
                }
              : null,
            new: {
              name: saved.name,
              config: saved.config,
            },
          },
          performedBy: ctx.actor.userId,
          ipAddress: ctx.actor.ipAddress,
        });

        return saved;
      },
    );

    return {
      message: "Perfil de numeracao atualizado",
      profile,
    };
  },
);

// GET /audit-log: no SDK method calls it, so no endpoint definition.
certificateNumberingRouter.get(
  "/audit-log",
  ...requireLabProtected,
  requireOrgType("LAB"),
  async (c) => {
    const memberData = c.get("member");
    requireUnitOperationalSettingsManager(memberData);

    const rows = await orgDb(memberData.organizationId).transaction((o) =>
      o
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
        .limit(50),
    );

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
  const labDay = getLabCalendarDay(generatedAt);
  const yyyy = String(labDay.year);
  const month = labDay.month;
  const sequence = String(123).padStart(config.sequence.padding, "0");
  const tokens = {
    number: "",
    labCode: config.labCode,
    labName: organizationName,
    labSlug: slugify(organizationName),
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
    dd: String(labDay.day).padStart(2, "0"),
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
