import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  organizationSigningCertificate,
  organizationUnit,
  user,
} from "@calibra-facil/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { UnsignedIssuanceSettingSchema } from "@calibra-facil/schemas";
import {
  requireLabProtected,
  requireOrgType,
  requirePermission,
  type AuthVariables,
} from "../middleware/permission";
import { writeOrganizationAuditEvent } from "../lib/audit";
import {
  conflict,
  domainErrorResponse,
  invalid,
  notFound,
} from "../lib/domain-errors";
import { orgDb } from "../lib/org-db";
import {
  getCertificateInfo,
  encryptBinary,
  encryptPassword,
  SigningError,
} from "@calibra-facil/signing";
import {
  requireUnitOperationalSettingsManager,
  resolveAccessibleUnitContext,
} from "../lib/unit-operational-settings";
import { clientIp } from "../lib/client-ip";

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const UploadCertificateSchema = z.object({
  name: z.string().min(1).max(100),
  p12Base64: z.string().min(1), // Base64-encoded PKCS#12 file
  password: z.string().min(1),
  setAsDefault: z.boolean().optional().default(false),
});

// =============================================================================
// ENVIRONMENT
// =============================================================================

interface SigningEnv {
  SIGNING_MASTER_KEY: string; // 256-bit AES key for encrypting passwords
}

// =============================================================================
// ROUTES
// =============================================================================

export const signingRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: SigningEnv;
}>()
  // ===========================================================================
  // GET /certificates - List organization's signing certificates
  // ===========================================================================
  .get(
    "/certificates",
    ...requireLabProtected,
    requireOrgType("LAB"),
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

        // Calculate status for each certificate
        const now = new Date();
        const certificatesWithStatus = certificates.map((cert) => ({
          ...cert,
          status: !cert.isActive
            ? "revoked"
            : cert.validUntil < now
              ? "expired"
              : cert.validFrom > now
                ? "not_yet_valid"
                : "valid",
        }));

        // #644: the unit's signing policy rides along so the settings page can
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

        return c.json({
          certificates: certificatesWithStatus,
          unit,
          requireSignature: policyRow[0]?.requireSignature ?? false,
          // Q51: the explicit "emitir sem assinatura digital" setting.
          unsignedIssuance: {
            enabled: Boolean(policyRow[0]?.unsignedIssuanceReason),
            reason: policyRow[0]?.unsignedIssuanceReason ?? null,
            setAt: policyRow[0]?.unsignedIssuanceSetAt ?? null,
            setByName: policyRow[0]?.unsignedIssuanceSetByName ?? null,
          },
        });
      });
    },
  )

  // ===========================================================================
  // PATCH /unsigned-issuance - "Emitir sem assinatura digital" (Q51)
  //
  // Once a unit has had a signing certificate, issuance fails closed when none is
  // valid (P0-8). This explicit setting is the only way to issue unsigned again:
  // admin/owner only (a unit_admin must not relax the lab's signing), a mandatory
  // reason, never implicit, and every change lands in the organization audit
  // trail in the same transaction.
  // ===========================================================================
  .patch(
    "/unsigned-issuance",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requirePermission({ settings: ["update"] }),
    zValidator("json", UnsignedIssuanceSettingSchema),
    async (c) => {
      const input = c.req.valid("json");
      const memberData = c.get("member");
      const session = c.get("session");

      return orgDb(memberData.organizationId).transaction(async (o) => {
        const unit = resolveAccessibleUnitContext(memberData);
        if (unit.unitId === null) {
          return domainErrorResponse(
            c,
            invalid("invalid_request", "Selecione uma unidade"),
          );
        }
        const scope = and(
          eq(organizationUnit.id, unit.unitId),
          eq(organizationUnit.organizationId, memberData.organizationId),
        );

        const [before] = await o
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
          return domainErrorResponse(
            c,
            notFound("unit_not_found", "Unidade não encontrada"),
          );
        }
        // "Assinatura obrigatória" and "emitir sem assinatura" contradict each
        // other: the stricter one wins, so the second cannot be switched on.
        if (input.enabled && before.requireSignature) {
          return domainErrorResponse(
            c,
            conflict(
              "conflict",
              "A assinatura é obrigatória nesta unidade: desative-a antes de permitir a emissão sem assinatura digital",
            ),
          );
        }

        const now = new Date();
        await o
          .update(organizationUnit)
          .set(
            input.enabled
              ? {
                  unsignedIssuanceReason: input.reason,
                  unsignedIssuanceSetBy: session.user.id,
                  unsignedIssuanceSetAt: now,
                }
              : {
                  unsignedIssuanceReason: null,
                  unsignedIssuanceSetBy: null,
                  unsignedIssuanceSetAt: null,
                },
          )
          .where(scope);

        await writeOrganizationAuditEvent(
          {
            organizationId: memberData.organizationId,
            unitId: unit.unitId,
            actorUserId: session.user.id,
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
              ipAddress: clientIp(c),
            },
          },
          o,
        );

        return c.json({
          unsignedIssuance: {
            enabled: input.enabled,
            reason: input.enabled ? input.reason : null,
            setAt: input.enabled ? now : null,
          },
        });
      });
    },
  )

  // ===========================================================================
  // PATCH /policy - Set the unit's "assinatura obrigatória" flag (#644)
  // ===========================================================================
  .patch(
    "/policy",
    ...requireLabProtected,
    requireOrgType("LAB"),
    zValidator("json", z.object({ requireSignature: z.boolean() })),
    async (c) => {
      return orgDb(c.get("member").organizationId).transaction(async (o) => {
        const memberData = c.get("member");
        requireUnitOperationalSettingsManager(memberData);
        const unit = resolveAccessibleUnitContext(memberData);
        const { requireSignature } = c.req.valid("json");

        // Row lock, taken for both values of the flag and shared with
        // PATCH /unsigned-issuance: the exclusion with "emitir sem assinatura"
        // is checked and written under it, so a race cannot set both.
        const [current] = await o
          .select({ reason: organizationUnit.unsignedIssuanceReason })
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
          return domainErrorResponse(
            c,
            conflict(
              "conflict",
              "Esta unidade emite sem assinatura digital: desative essa opção antes de tornar a assinatura obrigatória",
            ),
          );
        }

        const updated = await o
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
          return c.json({ error: "Unidade não encontrada" }, 404);
        }
        return c.json({ requireSignature: row.requireSignature });
      });
    },
  )

  // ===========================================================================
  // POST /certificates - Upload new signing certificate
  // ===========================================================================
  .post(
    "/certificates",
    ...requireLabProtected,
    requireOrgType("LAB"),
    zValidator("json", UploadCertificateSchema),
    async (c) => {
      const input = c.req.valid("json");
      const memberData = c.get("member");
      const session = c.get("session");
      const env = c.env;
      requireUnitOperationalSettingsManager(memberData);
      const unit = resolveAccessibleUnitContext(memberData);

      if (!env.SIGNING_MASTER_KEY) {
        console.error("SIGNING_MASTER_KEY not configured");
        return c.json(
          { error: "Assinatura digital não configurada no servidor" },
          500,
        );
      }

      try {
        // 1. Decode and validate certificate
        const p12Buffer = Buffer.from(input.p12Base64, "base64");

        let certInfo;
        try {
          certInfo = getCertificateInfo(p12Buffer, input.password);
        } catch (error) {
          if (error instanceof SigningError) {
            if (error.code === "WRONG_PASSWORD") {
              return c.json({ error: "Senha do certificado inválida" }, 400);
            }
            return c.json({ error: error.message }, 400);
          }
          throw error;
        }

        // 2. Check if certificate is expired
        const now = new Date();
        if (certInfo.validUntil < now) {
          return c.json(
            {
              error: `Certificado expirado em ${certInfo.validUntil.toLocaleDateString("pt-BR")}`,
            },
            400,
          );
        }

        // 3. + 5. Check for a duplicate serial number and insert the
        // certificate in one organization-bound transaction (it also keeps the
        // "default" flag race-free).
        const saved = await orgDb(memberData.organizationId).transaction(
          async (o) => {
            const [existing] = await o
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

            if (existing) return { duplicate: true as const };

            // 4. Encrypt password
            const { encryptedPassword, iv } = encryptPassword(
              input.password,
              env.SIGNING_MASTER_KEY,
            );
            const encryptedP12 = encryptBinary(
              p12Buffer,
              env.SIGNING_MASTER_KEY,
            );

            // Unset current default if setting this as default
            if (input.setAsDefault) {
              await o
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

            const [inserted] = await o
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
                encryptedP12,
                encryptedPassword,
                passwordIv: iv,
                isActive: true,
                isDefault: input.setAsDefault,
                createdBy: session.user.id,
              })
              .returning();

            return { duplicate: false as const, inserted };
          },
        );

        if (saved.duplicate) {
          return c.json(
            { error: "Certificado com este número de série já existe" },
            400,
          );
        }

        const newCert = saved.inserted;
        if (!newCert) {
          return c.json({ error: "Erro ao inserir certificado" }, 500);
        }

        return c.json({
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
        });
      } catch (error) {
        console.error("Error uploading certificate:", error);
        return c.json({ error: "Erro ao processar certificado" }, 500);
      }
    },
  )

  // ===========================================================================
  // POST /certificates/:id/set-default - Set certificate as default
  // ===========================================================================
  .post(
    "/certificates/:id/set-default",
    ...requireLabProtected,
    requireOrgType("LAB"),
    async (c) => {
      return orgDb(c.get("member").organizationId).transaction(async (o) => {
        const id = parseInt(c.req.param("id"));
        const memberData = c.get("member");
        requireUnitOperationalSettingsManager(memberData);
        const unit = resolveAccessibleUnitContext(memberData);

        if (isNaN(id)) {
          return c.json({ error: "ID inválido" }, 400);
        }

        // Verify certificate belongs to organization
        const [cert] = await o
          .select({
            id: organizationSigningCertificate.id,
            isActive: organizationSigningCertificate.isActive,
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
          return c.json({ error: "Certificado não encontrado" }, 404);
        }

        if (!cert.isActive) {
          return c.json(
            { error: "Certificado revogado não pode ser padrão" },
            400,
          );
        }

        // Unset current default and set new default (one organization-bound
        // transaction with the read above)
        await o
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

        await o
          .update(organizationSigningCertificate)
          .set({ isDefault: true })
          // Defense-in-depth (SEC-08): repeat the org + unit scope proven by the
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

        return c.json({ message: "Certificado definido como padrão" });
      });
    },
  )

  // ===========================================================================
  // DELETE /certificates/:id - Revoke certificate
  // ===========================================================================
  .delete(
    "/certificates/:id",
    ...requireLabProtected,
    requireOrgType("LAB"),
    zValidator(
      "json",
      z.object({
        reason: z.string().min(1).max(500),
      }),
    ),
    async (c) => {
      return orgDb(c.get("member").organizationId).transaction(async (o) => {
        const id = parseInt(c.req.param("id"));
        const { reason } = c.req.valid("json");
        const memberData = c.get("member");
        const session = c.get("session");
        requireUnitOperationalSettingsManager(memberData);
        const unit = resolveAccessibleUnitContext(memberData);

        if (isNaN(id)) {
          return c.json({ error: "ID inválido" }, 400);
        }

        // Verify certificate belongs to organization
        const [cert] = await o
          .select({
            id: organizationSigningCertificate.id,
            isActive: organizationSigningCertificate.isActive,
            isDefault: organizationSigningCertificate.isDefault,
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
          return c.json({ error: "Certificado não encontrado" }, 404);
        }

        if (!cert.isActive) {
          return c.json({ error: "Certificado já está revogado" }, 400);
        }

        // Revoke certificate
        await o
          .update(organizationSigningCertificate)
          .set({
            isActive: false,
            isDefault: false,
            revokedAt: new Date(),
            revokedBy: session.user.id,
            revokedReason: reason,
          })
          // Defense-in-depth (SEC-08): repeat the org + unit scope proven by the
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

        return c.json({ message: "Certificado revogado com sucesso" });
      });
    },
  )

  // ===========================================================================
  // GET /certificates/:id - Get certificate details
  // ===========================================================================
  .get(
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
          return c.json({ error: "ID inválido" }, 400);
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
          return c.json({ error: "Certificado não encontrado" }, 404);
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
