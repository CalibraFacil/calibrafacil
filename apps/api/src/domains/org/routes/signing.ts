import { createRouter } from "../../../server/router";
import { signingCertificateEndpoints } from "@calibra-facil/contracts";
import {
  organizationSigningCertificate,
  organizationUnit,
  user,
} from "@calibra-facil/db/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  requireLabProtected,
  requireOrgType,
  requirePermission,
  type AuthVariables,
} from "../../../middleware/permission";
import { writeOrganizationAuditEvent } from "../../../lib/audit";
import { writeComplianceAuditEvent } from "../../../lib/compliance-audit";
import {
  DomainError,
  conflict,
  invalid,
  notFound,
  unprocessable,
} from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { requestActor } from "../../../middleware/request-actor";
import {
  parsePkcs12,
  resolveSigningTrustAnchors,
  sealSigningCredential,
  signingKeyringFromEnv,
  validateSigningCredential,
  SigningError,
} from "@calibra-facil/signing";
import {
  requireUnitOperationalSettingsManager,
  resolveAccessibleUnitContext,
} from "../unit-operational-settings";

import { requireFreshSession } from "../../../middleware/fresh-session";

interface SigningEnv {
  SIGNING_MASTER_KEY: string; // The current KEK (256-bit AES key) wrapping the credentials' data keys
  SIGNING_MASTER_KEY_ID?: string; // Id of the current KEK (unset: k1)
  SIGNING_MASTER_KEY_PREVIOUS?: string; // Previous KEKs, `id:base64key,...`
  SIGNING_TRUST_STORE_FILE?: string; // PEM bundle replacing the bundled ICP-Brasil roots
}

function signingNotConfigured() {
  return new DomainError({
    code: "signing_not_configured",
    status: 500,
    message: "Assinatura digital não configurada no servidor",
  });
}

function certificateNotFound() {
  return notFound("certificate_not_found", "Certificado não encontrado");
}

const PREFIX = "/api/signing";

export const signingRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: SigningEnv;
}>();

mount(
  signingRouter,
  PREFIX,
  signingCertificateEndpoints.list,
  [...requireLabProtected, requireOrgType("LAB")],
  async (c) => {
    return orgDb(c.get("member").organizationId).transaction(async (o) => {
      const memberData = c.get("member");
      requireUnitOperationalSettingsManager(memberData);
      const unit = resolveAccessibleUnitContext(memberData);

      const certificates = await o
        .select({
          id: organizationSigningCertificate.id,
          unitId: organizationSigningCertificate.unitId,
          name: organizationSigningCertificate.name,
          serialNumber: organizationSigningCertificate.serialNumber,
          issuerCn: organizationSigningCertificate.issuerCn,
          subjectCn: organizationSigningCertificate.subjectCn,
          subjectCpfCnpj: organizationSigningCertificate.subjectCpfCnpj,
          validFrom: organizationSigningCertificate.validFrom,
          validUntil: organizationSigningCertificate.validUntil,
          isActive: organizationSigningCertificate.isActive,
          isDefault: organizationSigningCertificate.isDefault,
          createdAt: organizationSigningCertificate.createdAt,
          createdByName: user.name,
          revokedAt: organizationSigningCertificate.revokedAt,
          revokedReason: organizationSigningCertificate.revokedReason,
        })
        .from(organizationSigningCertificate)
        .leftJoin(user, eq(organizationSigningCertificate.createdBy, user.id))
        .where(
          and(
            eq(
              organizationSigningCertificate.organizationId,
              memberData.organizationId,
            ),
            eq(organizationSigningCertificate.unitId, unit.unitId),
          ),
        )
        .orderBy(desc(organizationSigningCertificate.createdAt));

      const now = new Date();
      const certificatesWithStatus = certificates.map((cert) => ({
        ...cert,
        status: !cert.isActive
          ? ("revoked" as const)
          : cert.validUntil < now
            ? ("expired" as const)
            : cert.validFrom > now
              ? ("not_yet_valid" as const)
              : ("valid" as const),
      }));

      // The unit's signing policy rides along so the settings page can
      // render the "assinatura obrigatória" toggle without a second call.
      const policyRow = await o
        .select({
          requireSignature: organizationUnit.requireSignature,
          unsignedIssuanceReason: organizationUnit.unsignedIssuanceReason,
          unsignedIssuanceSetAt: organizationUnit.unsignedIssuanceSetAt,
          unsignedIssuanceSetByName: user.name,
        })
        .from(organizationUnit)
        .leftJoin(user, eq(organizationUnit.unsignedIssuanceSetBy, user.id))
        .where(
          and(
            eq(organizationUnit.id, unit.unitId),
            eq(organizationUnit.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      return {
        certificates: certificatesWithStatus,
        unit,
        requireSignature: policyRow[0]?.requireSignature ?? false,
        // The explicit "emitir sem assinatura digital" setting.
        unsignedIssuance: {
          enabled: Boolean(policyRow[0]?.unsignedIssuanceReason),
          reason: policyRow[0]?.unsignedIssuanceReason ?? null,
          setAt: policyRow[0]?.unsignedIssuanceSetAt ?? null,
          setByName: policyRow[0]?.unsignedIssuanceSetByName ?? null,
        },
      };
    });
  },
);

// ===========================================================================
// PATCH /unsigned-issuance - "Emitir sem assinatura digital"
//
// Once a unit has had a signing certificate, issuance fails closed when none is
// valid. This explicit setting is the only way to issue unsigned again:
// admin/owner only (a unit_admin must not relax the lab's signing), a mandatory
// reason, never implicit, and every change lands in the organization audit
// trail in the same transaction.
// ===========================================================================
mount(
  signingRouter,
  PREFIX,
  signingCertificateEndpoints.setUnsignedIssuance,
  [
    ...requireLabProtected,
    requireFreshSession,
    requireOrgType("LAB"),
    requirePermission({ settings: ["update"] }),
  ],
  async (c, { body }) => {
    const input = body;
    const memberData = c.get("member");

    return withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      const unit = resolveAccessibleUnitContext(memberData);
      if (unit.unitId === null) {
        throw invalid("invalid_request", "Selecione uma unidade");
      }
      const scope = and(
        eq(organizationUnit.id, unit.unitId),
        eq(organizationUnit.organizationId, memberData.organizationId),
      );

      const [before] = await ctx.o
        .select({
          requireSignature: organizationUnit.requireSignature,
          reason: organizationUnit.unsignedIssuanceReason,
        })
        .from(organizationUnit)
        .where(scope)
        .limit(1)
        // Row lock: "assinatura obrigatória" (PATCH /policy) takes the same lock
        // before it reads this setting, so two concurrent writes cannot leave
        // both switched on.
        .for("update");
      if (!before) {
        throw notFound("unit_not_found", "Unidade não encontrada");
      }
      // "Assinatura obrigatória" and "emitir sem assinatura" contradict each
      // other: the stricter one wins, so the second cannot be switched on.
      if (input.enabled && before.requireSignature) {
        throw conflict(
          "conflict",
          "A assinatura é obrigatória nesta unidade: desative-a antes de permitir a emissão sem assinatura digital",
        );
      }

      const now = new Date();
      await ctx.o
        .update(organizationUnit)
        .set(
          input.enabled
            ? {
                unsignedIssuanceReason: input.reason,
                unsignedIssuanceSetBy: ctx.actor.userId,
                unsignedIssuanceSetAt: now,
              }
            : {
                unsignedIssuanceReason: null,
                unsignedIssuanceSetBy: null,
                unsignedIssuanceSetAt: null,
              },
        )
        .where(scope);

      await writeComplianceAuditEvent(
        {
          organizationId: memberData.organizationId,
          unitId: unit.unitId,
          action: "signing_policy.unsigned_issuance_changed",
          entityType: "organization_unit",
          entityId: String(unit.unitId),
          changes: {
            before: {
              enabled: Boolean(before.reason),
              reason: before.reason,
            },
            after: {
              enabled: input.enabled,
              reason: input.enabled ? input.reason : null,
            },
          },
          performedBy: ctx.actor.userId,
          ipAddress: c.req.header("x-forwarded-for") ?? null,
        },
        ctx.o,
      );

      await writeOrganizationAuditEvent(
        {
          organizationId: memberData.organizationId,
          unitId: unit.unitId,
          actorUserId: ctx.actor.userId,
          actorMemberId: memberData.id,
          action: input.enabled
            ? "signing.unsigned_issuance_enabled"
            : "signing.unsigned_issuance_disabled",
          entityType: "organization_unit",
          entityId: String(unit.unitId),
          details: {
            enabled: input.enabled,
            wasEnabled: Boolean(before.reason),
            ...(input.enabled ? { reason: input.reason } : {}),
            previousReason: before.reason,
            ipAddress: ctx.actor.ipAddress,
          },
        },
        ctx.o,
      );

      return {
        unsignedIssuance: {
          enabled: input.enabled,
          reason: input.enabled ? input.reason : null,
          setAt: input.enabled ? now : null,
        },
      };
    });
  },
);

mount(
  signingRouter,
  PREFIX,
  signingCertificateEndpoints.setPolicy,
  [...requireLabProtected, requireFreshSession, requireOrgType("LAB")],
  async (c, { body }) => {
    const memberData = c.get("member");
    return withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      requireUnitOperationalSettingsManager(memberData);
      const unit = resolveAccessibleUnitContext(memberData);
      const { requireSignature } = body;

      // Row lock, taken for both values of the flag and shared with
      // PATCH /unsigned-issuance: the exclusion with "emitir sem assinatura"
      // is checked and written under it, so a race cannot set both.
      const [current] = await ctx.o
        .select({
          reason: organizationUnit.unsignedIssuanceReason,
          requireSignature: organizationUnit.requireSignature,
        })
        .from(organizationUnit)
        .where(
          and(
            eq(organizationUnit.id, unit.unitId),
            eq(organizationUnit.organizationId, memberData.organizationId),
          ),
        )
        .limit(1)
        .for("update");
      if (requireSignature && current?.reason) {
        throw conflict(
          "conflict",
          "Esta unidade emite sem assinatura digital: desative essa opção antes de tornar a assinatura obrigatória",
        );
      }

      const updated = await ctx.o
        .update(organizationUnit)
        .set({ requireSignature })
        .where(
          and(
            eq(organizationUnit.id, unit.unitId),
            eq(organizationUnit.organizationId, memberData.organizationId),
          ),
        )
        .returning();

      const row = updated[0];
      if (!row) {
        throw notFound("unit_not_found", "Unidade não encontrada");
      }
      if ((current?.requireSignature ?? false) !== row.requireSignature) {
        await writeComplianceAuditEvent(
          {
            organizationId: memberData.organizationId,
            unitId: unit.unitId,
            action: "signing_policy.require_signature_changed",
            entityType: "organization_unit",
            entityId: String(unit.unitId),
            changes: {
              before: {
                requireSignature: current?.requireSignature ?? false,
              },
              after: { requireSignature: row.requireSignature },
            },
            performedBy: ctx.actor.userId,
            ipAddress: c.req.header("x-forwarded-for") ?? null,
          },
          ctx.o,
        );
      }
      return { requireSignature: row.requireSignature };
    });
  },
);

mount(
  signingRouter,
  PREFIX,
  signingCertificateEndpoints.upload,
  [...requireLabProtected, requireFreshSession, requireOrgType("LAB")],
  async (c, { body }) => {
    const input = body;
    const memberData = c.get("member");
    const env = c.env;
    requireUnitOperationalSettingsManager(memberData);
    const unit = resolveAccessibleUnitContext(memberData);

    if (!env.SIGNING_MASTER_KEY) {
      console.error("SIGNING_MASTER_KEY not configured");
      throw signingNotConfigured();
    }

    // The key ring (current KEK + previous ones). A malformed setting is a
    // server misconfiguration, not the caller's mistake.
    const keyring = signingKeyringFromEnv(env);
    if (!keyring) {
      throw signingNotConfigured();
    }

    // 1. Decode and validate certificate
    const p12Buffer = Buffer.from(input.p12Base64, "base64");

    let certInfo;
    try {
      certInfo = parsePkcs12(p12Buffer, input.password);
    } catch (error) {
      if (error instanceof SigningError) {
        if (error.code === "WRONG_PASSWORD") {
          throw invalid("invalid_request", "Senha do certificado inválida");
        }
        throw invalid("invalid_request", error.message);
      }
      throw error;
    }

    // 2. REQ-B4A-3: validity window, key usage and the chain to the
    // configured trust store (the bundled ICP-Brasil roots by default).
    // Rejected with 422 and a pt-BR reason before anything is stored.
    const verdict = await validateSigningCredential(certInfo, {
      trustAnchors: resolveSigningTrustAnchors(env),
    });
    if (!verdict.ok) {
      throw unprocessable("unprocessable", verdict.message, {
        details: { reason: verdict.code },
      });
    }

    // 3. + 5. Check for a duplicate serial number and insert the
    // certificate in one organization-bound transaction (it also keeps the
    // "default" flag race-free).
    const newCert = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const [existing] = await ctx.o
          .select({ id: organizationSigningCertificate.id })
          .from(organizationSigningCertificate)
          .where(
            and(
              eq(
                organizationSigningCertificate.organizationId,
                memberData.organizationId,
              ),
              eq(organizationSigningCertificate.unitId, unit.unitId),
              eq(
                organizationSigningCertificate.serialNumber,
                certInfo.serialNumber,
              ),
            ),
          )
          .limit(1);

        if (existing) {
          throw invalid(
            "invalid_request",
            "Certificado com este número de série já existe",
          );
        }

        // 4. Seal the P12 and its password: a data key per field, wrapped
        // by the current KEK, AAD = organization + unit + serial.
        const sealed = sealSigningCredential(
          { p12: p12Buffer, password: input.password },
          {
            organizationId: memberData.organizationId,
            unitId: unit.unitId,
            serialNumber: certInfo.serialNumber,
          },
          keyring,
        );

        let displaced: { id: number; serialNumber: string } | null = null;
        if (input.setAsDefault) {
          const [previous] = await ctx.o
            .select({
              id: organizationSigningCertificate.id,
              serialNumber: organizationSigningCertificate.serialNumber,
            })
            .from(organizationSigningCertificate)
            .where(
              and(
                eq(
                  organizationSigningCertificate.organizationId,
                  memberData.organizationId,
                ),
                eq(organizationSigningCertificate.unitId, unit.unitId),
                eq(organizationSigningCertificate.isDefault, true),
              ),
            )
            .limit(1);
          displaced = previous ?? null;
          await ctx.o
            .update(organizationSigningCertificate)
            .set({ isDefault: false })
            .where(
              and(
                eq(
                  organizationSigningCertificate.organizationId,
                  memberData.organizationId,
                ),
                eq(organizationSigningCertificate.unitId, unit.unitId),
                eq(organizationSigningCertificate.isDefault, true),
              ),
            );
        }

        const [inserted] = await ctx.o
          .insert(organizationSigningCertificate)
          .values({
            organizationId: memberData.organizationId,
            unitId: unit.unitId,
            name: input.name,
            serialNumber: certInfo.serialNumber,
            issuerCn: certInfo.issuerCn,
            subjectCn: certInfo.subjectCn,
            subjectCpfCnpj: certInfo.subjectCpfCnpj,
            validFrom: certInfo.validFrom,
            validUntil: certInfo.validUntil,
            encryptedP12: sealed.encryptedP12,
            encryptedPassword: sealed.encryptedPassword,
            passwordIv: sealed.passwordIv,
            kekId: sealed.kekId,
            custodyFormatVersion: sealed.formatVersion,
            isActive: true,
            isDefault: input.setAsDefault,
            createdBy: ctx.actor.userId,
          })
          .returning();

        if (!inserted) throw new Error("Erro ao inserir certificado");

        {
          const ipAddress = c.req.header("x-forwarded-for") ?? null;
          await writeComplianceAuditEvent(
            {
              organizationId: memberData.organizationId,
              unitId: unit.unitId,
              action: "signing_credential.created",
              entityType: "organization_signing_certificate",
              entityId: String(inserted.id),
              changes: {
                before: null,
                after: {
                  name: inserted.name,
                  serialNumber: inserted.serialNumber,
                  issuerCn: inserted.issuerCn,
                  subjectCn: inserted.subjectCn,
                  validFrom: inserted.validFrom.toISOString(),
                  validUntil: inserted.validUntil.toISOString(),
                  isDefault: inserted.isDefault,
                  kekId: sealed.kekId,
                  custodyFormatVersion: sealed.formatVersion,
                },
              },
              performedBy: ctx.actor.userId,
              ipAddress,
            },
            ctx.o,
          );
          if (displaced) {
            await writeComplianceAuditEvent(
              {
                organizationId: memberData.organizationId,
                unitId: unit.unitId,
                action: "signing_credential.default_replaced",
                entityType: "organization_signing_certificate",
                entityId: String(inserted.id),
                changes: {
                  before: {
                    defaultCertificateId: displaced.id,
                    serialNumber: displaced.serialNumber,
                  },
                  after: {
                    defaultCertificateId: inserted.id,
                    serialNumber: inserted.serialNumber,
                  },
                },
                performedBy: ctx.actor.userId,
                ipAddress,
              },
              ctx.o,
            );
          }
        }

        return inserted;
      },
    );

    return {
      message: "Certificado adicionado com sucesso",
      certificate: {
        id: newCert.id,
        unitId: newCert.unitId,
        name: newCert.name,
        serialNumber: newCert.serialNumber,
        issuerCn: newCert.issuerCn,
        subjectCn: newCert.subjectCn,
        validFrom: newCert.validFrom,
        validUntil: newCert.validUntil,
        isDefault: newCert.isDefault,
      },
    };
  },
);

mount(
  signingRouter,
  PREFIX,
  signingCertificateEndpoints.setDefault,
  [...requireLabProtected, requireFreshSession, requireOrgType("LAB")],
  async (c, { params }) => {
    const memberData = c.get("member");
    return withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      const id = params.id;
      requireUnitOperationalSettingsManager(memberData);
      const unit = resolveAccessibleUnitContext(memberData);

      if (isNaN(id)) {
        throw invalid("invalid_request", "ID inválido");
      }

      const [cert] = await ctx.o
        .select({
          id: organizationSigningCertificate.id,
          isActive: organizationSigningCertificate.isActive,
          serialNumber: organizationSigningCertificate.serialNumber,
        })
        .from(organizationSigningCertificate)
        .where(
          and(
            eq(organizationSigningCertificate.id, id),
            eq(
              organizationSigningCertificate.organizationId,
              memberData.organizationId,
            ),
            eq(organizationSigningCertificate.unitId, unit.unitId),
          ),
        )
        .limit(1);

      if (!cert) {
        throw certificateNotFound();
      }

      if (!cert.isActive) {
        throw invalid(
          "invalid_request",
          "Certificado revogado não pode ser padrão",
        );
      }

      const [previousDefault] = await ctx.o
        .select({
          id: organizationSigningCertificate.id,
          serialNumber: organizationSigningCertificate.serialNumber,
        })
        .from(organizationSigningCertificate)
        .where(
          and(
            eq(
              organizationSigningCertificate.organizationId,
              memberData.organizationId,
            ),
            eq(organizationSigningCertificate.unitId, unit.unitId),
            eq(organizationSigningCertificate.isDefault, true),
          ),
        )
        .limit(1);

      // Unset current default and set new default (one organization-bound
      // transaction with the read above)
      await ctx.o
        .update(organizationSigningCertificate)
        .set({ isDefault: false })
        .where(
          and(
            eq(
              organizationSigningCertificate.organizationId,
              memberData.organizationId,
            ),
            eq(organizationSigningCertificate.unitId, unit.unitId),
            eq(organizationSigningCertificate.isDefault, true),
          ),
        );

      await ctx.o
        .update(organizationSigningCertificate)
        .set({ isDefault: true })
        // Defense-in-depth: repeat the org + unit scope proven by the
        // SELECT above so this custody UPDATE stays tenant-scoped even if the
        // guarding read is refactored away. Reuses the in-scope member values.
        .where(
          and(
            eq(organizationSigningCertificate.id, id),
            eq(
              organizationSigningCertificate.organizationId,
              memberData.organizationId,
            ),
            eq(organizationSigningCertificate.unitId, unit.unitId),
          ),
        );

      if (previousDefault?.id !== id) {
        await writeComplianceAuditEvent(
          {
            organizationId: memberData.organizationId,
            unitId: unit.unitId,
            action: "signing_credential.default_replaced",
            entityType: "organization_signing_certificate",
            entityId: String(id),
            changes: {
              before: previousDefault
                ? {
                    defaultCertificateId: previousDefault.id,
                    serialNumber: previousDefault.serialNumber,
                  }
                : null,
              after: {
                defaultCertificateId: id,
                serialNumber: cert.serialNumber,
              },
            },
            performedBy: ctx.actor.userId,
            ipAddress: c.req.header("x-forwarded-for") ?? null,
          },
          ctx.o,
        );
      }

      return { message: "Certificado definido como padrão" };
    });
  },
);

mount(
  signingRouter,
  PREFIX,
  signingCertificateEndpoints.revoke,
  [...requireLabProtected, requireFreshSession, requireOrgType("LAB")],
  async (c, { params, body }) => {
    const memberData = c.get("member");
    return withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      const id = params.id;
      const { reason } = body;
      requireUnitOperationalSettingsManager(memberData);
      const unit = resolveAccessibleUnitContext(memberData);

      if (isNaN(id)) {
        throw invalid("invalid_request", "ID inválido");
      }

      const [cert] = await ctx.o
        .select({
          id: organizationSigningCertificate.id,
          isActive: organizationSigningCertificate.isActive,
          isDefault: organizationSigningCertificate.isDefault,
          serialNumber: organizationSigningCertificate.serialNumber,
          validUntil: organizationSigningCertificate.validUntil,
        })
        .from(organizationSigningCertificate)
        .where(
          and(
            eq(organizationSigningCertificate.id, id),
            eq(
              organizationSigningCertificate.organizationId,
              memberData.organizationId,
            ),
            eq(organizationSigningCertificate.unitId, unit.unitId),
          ),
        )
        .limit(1);

      if (!cert) {
        throw certificateNotFound();
      }

      if (!cert.isActive) {
        throw invalid("invalid_request", "Certificado já está revogado");
      }

      await ctx.o
        .update(organizationSigningCertificate)
        .set({
          isActive: false,
          isDefault: false,
          revokedAt: new Date(),
          revokedBy: ctx.actor.userId,
          revokedReason: reason,
        })
        // Defense-in-depth: repeat the org + unit scope proven by the
        // SELECT above so this custody UPDATE stays tenant-scoped even if the
        // guarding read is refactored away. Reuses the in-scope member values.
        .where(
          and(
            eq(organizationSigningCertificate.id, id),
            eq(
              organizationSigningCertificate.organizationId,
              memberData.organizationId,
            ),
            eq(organizationSigningCertificate.unitId, unit.unitId),
          ),
        );

      await writeComplianceAuditEvent(
        {
          organizationId: memberData.organizationId,
          unitId: unit.unitId,
          action: "signing_credential.deleted",
          entityType: "organization_signing_certificate",
          entityId: String(id),
          changes: {
            before: {
              serialNumber: cert.serialNumber,
              validUntil: cert.validUntil.toISOString(),
              isActive: true,
              isDefault: cert.isDefault,
            },
            after: { isActive: false, isDefault: false, reason },
          },
          performedBy: ctx.actor.userId,
          ipAddress: c.req.header("x-forwarded-for") ?? null,
        },
        ctx.o,
      );

      return { message: "Certificado revogado com sucesso" };
    });
  },
);

signingRouter.get(
  "/certificates/:id",
  ...requireLabProtected,
  requireOrgType("LAB"),
  async (c) => {
    return orgDb(c.get("member").organizationId).transaction(async (o) => {
      const id = parseInt(c.req.param("id"));
      const memberData = c.get("member");
      requireUnitOperationalSettingsManager(memberData);
      const unit = resolveAccessibleUnitContext(memberData);

      if (isNaN(id)) {
        throw invalid("invalid_request", "ID inválido");
      }

      const [cert] = await o
        .select({
          id: organizationSigningCertificate.id,
          unitId: organizationSigningCertificate.unitId,
          name: organizationSigningCertificate.name,
          serialNumber: organizationSigningCertificate.serialNumber,
          issuerCn: organizationSigningCertificate.issuerCn,
          subjectCn: organizationSigningCertificate.subjectCn,
          subjectCpfCnpj: organizationSigningCertificate.subjectCpfCnpj,
          validFrom: organizationSigningCertificate.validFrom,
          validUntil: organizationSigningCertificate.validUntil,
          isActive: organizationSigningCertificate.isActive,
          isDefault: organizationSigningCertificate.isDefault,
          createdAt: organizationSigningCertificate.createdAt,
          createdByName: user.name,
          revokedAt: organizationSigningCertificate.revokedAt,
          revokedReason: organizationSigningCertificate.revokedReason,
        })
        .from(organizationSigningCertificate)
        .leftJoin(user, eq(organizationSigningCertificate.createdBy, user.id))
        .where(
          and(
            eq(organizationSigningCertificate.id, id),
            eq(
              organizationSigningCertificate.organizationId,
              memberData.organizationId,
            ),
            eq(organizationSigningCertificate.unitId, unit.unitId),
          ),
        )
        .limit(1);

      if (!cert) {
        throw certificateNotFound();
      }

      const now = new Date();
      const status = !cert.isActive
        ? "revoked"
        : cert.validUntil < now
          ? "expired"
          : cert.validFrom > now
            ? "not_yet_valid"
            : "valid";

      return c.json({
        ...cert,
        status,
        unit,
        daysUntilExpiry: Math.ceil(
          (cert.validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      });
    });
  },
);
