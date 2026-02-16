import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import { organizationSigningCertificate, user } from "@calibra-facil/db/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import {
  getCertificateInfo,
  encryptBinary,
  encryptPassword,
  SigningError,
} from "@calibra-facil/signing";

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
    ...withLabPermission({ organization: ["update"] }), // Admin/owner only
    async (c) => {
      const memberData = c.get("member");

      const certificates = await db
        .select({
          id: organizationSigningCertificate.id,
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
          eq(
            organizationSigningCertificate.organizationId,
            memberData.organizationId,
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

      return c.json({ certificates: certificatesWithStatus });
    },
  )

  // ===========================================================================
  // POST /certificates - Upload new signing certificate
  // ===========================================================================
  .post(
    "/certificates",
    ...withLabPermission({ organization: ["update"] }), // Admin/owner only
    zValidator("json", UploadCertificateSchema),
    async (c) => {
      const input = c.req.valid("json");
      const memberData = c.get("member");
      const session = c.get("session");
      const env = c.env as SigningEnv;

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

        // 3. Check for duplicate serial number
        const [existing] = await db
          .select({ id: organizationSigningCertificate.id })
          .from(organizationSigningCertificate)
          .where(
            and(
              eq(
                organizationSigningCertificate.organizationId,
                memberData.organizationId,
              ),
              eq(
                organizationSigningCertificate.serialNumber,
                certInfo.serialNumber,
              ),
            ),
          )
          .limit(1);

        if (existing) {
          return c.json(
            { error: "Certificado com este número de série já existe" },
            400,
          );
        }

        // 4. Encrypt password
        const { encryptedPassword, iv } = encryptPassword(
          input.password,
          env.SIGNING_MASTER_KEY,
        );
        const encryptedP12 = encryptBinary(p12Buffer, env.SIGNING_MASTER_KEY);

        // 5. Insert certificate (with transaction to prevent race condition on default)
        const newCert = await db.transaction(async (tx) => {
          // Unset current default if setting this as default
          if (input.setAsDefault) {
            await tx
              .update(organizationSigningCertificate)
              .set({ isDefault: false })
              .where(
                and(
                  eq(
                    organizationSigningCertificate.organizationId,
                    memberData.organizationId,
                  ),
                  eq(organizationSigningCertificate.isDefault, true),
                ),
              );
          }

          const [inserted] = await tx
            .insert(organizationSigningCertificate)
            .values({
              organizationId: memberData.organizationId,
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

          return inserted;
        });
        if (!newCert) {
          return c.json({ error: "Erro ao inserir certificado" }, 500);
        }

        return c.json({
          message: "Certificado adicionado com sucesso",
          certificate: {
            id: newCert.id,
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
    ...withLabPermission({ organization: ["update"] }),
    async (c) => {
      const id = parseInt(c.req.param("id"));
      const memberData = c.get("member");

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      // Verify certificate belongs to organization
      const [cert] = await db
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

      // Unset current default and set new default in transaction
      await db.transaction(async (tx) => {
        await tx
          .update(organizationSigningCertificate)
          .set({ isDefault: false })
          .where(
            and(
              eq(
                organizationSigningCertificate.organizationId,
                memberData.organizationId,
              ),
              eq(organizationSigningCertificate.isDefault, true),
            ),
          );

        await tx
          .update(organizationSigningCertificate)
          .set({ isDefault: true })
          .where(eq(organizationSigningCertificate.id, id));
      });

      return c.json({ message: "Certificado definido como padrão" });
    },
  )

  // ===========================================================================
  // DELETE /certificates/:id - Revoke certificate
  // ===========================================================================
  .delete(
    "/certificates/:id",
    ...withLabPermission({ organization: ["update"] }),
    zValidator(
      "json",
      z.object({
        reason: z.string().min(1).max(500),
      }),
    ),
    async (c) => {
      const id = parseInt(c.req.param("id"));
      const { reason } = c.req.valid("json");
      const memberData = c.get("member");
      const session = c.get("session");

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      // Verify certificate belongs to organization
      const [cert] = await db
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
      await db
        .update(organizationSigningCertificate)
        .set({
          isActive: false,
          isDefault: false,
          revokedAt: new Date(),
          revokedBy: session.user.id,
          revokedReason: reason,
        })
        .where(eq(organizationSigningCertificate.id, id));

      return c.json({ message: "Certificado revogado com sucesso" });
    },
  )

  // ===========================================================================
  // GET /certificates/:id - Get certificate details
  // ===========================================================================
  .get(
    "/certificates/:id",
    ...withLabPermission({ organization: ["update"] }),
    async (c) => {
      const id = parseInt(c.req.param("id"));
      const memberData = c.get("member");

      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [cert] = await db
        .select({
          id: organizationSigningCertificate.id,
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
        daysUntilExpiry: Math.ceil(
          (cert.validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      });
    },
  );
