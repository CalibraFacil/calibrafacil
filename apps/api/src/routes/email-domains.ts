/**
 * Lab-owned email sending domain (issue #584, BYOK v1).
 *
 * The lab brings its own Resend account: it pastes an API key, we live-list
 * the account's domains and the lab PICKS an already-verified one (v1
 * verified-domain-picker; domain creation/DNS handholding happens in the
 * lab's Resend dashboard). The key is stored AES-256-GCM encrypted and is
 * NEVER returned by any response — only the masked last-4.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import { organizationEmailDomain } from "@calibra-facil/db/schema";
import {
  decryptResendApiKey,
  encryptResendApiKey,
  getEmailDomainMasterKey,
  getResendDomain,
  resendApiKeyLast4,
  validateResendApiKey,
  verifyResendDomain,
  type ResendFailureClass,
} from "@calibra-facil/email-sender";
import {
  buildEmailDomainStatusSummary,
  buildFromAddress,
  getOrganizationEmailDomain,
  getOrganizationReplyToEmail,
  sanitizeEmailHostname,
  sanitizeFromLocalPart,
  serializeEmailDomain,
} from "../lib/email-domains";
import { writeOrganizationAuditEvent } from "../lib/audit";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
  withLabPermission,
} from "../middleware/permission";
import { requireFeature } from "../middleware/tier-guard";
import { and, eq, ne } from "drizzle-orm";

const ApiKeySchema = z.string().trim().min(8).max(200);

const ValidateKeySchema = z.object({
  apiKey: ApiKeySchema,
});

const CreateEmailDomainSchema = z.object({
  apiKey: ApiKeySchema,
  resendDomainId: z.string().trim().min(1).max(120),
  fromLocalPart: z.string().trim().min(1).max(64),
});

const RotateKeySchema = z.object({
  apiKey: ApiKeySchema,
});

function resendFailureMessage(failureClass: ResendFailureClass): string {
  switch (failureClass) {
    case "invalid_key":
      return "Chave de API do Resend inválida ou sem as permissões necessárias. Gere uma chave com acesso total no painel do Resend.";
    case "quota_exhausted":
    case "rate_limited":
      return "O Resend recusou a chamada por limite de uso. Aguarde alguns instantes e tente novamente.";
    case "sender_config":
      return "O Resend não encontrou este domínio na conta da chave informada.";
    default:
      return "Não foi possível falar com o Resend agora. Tente novamente em instantes.";
  }
}

function resendFailureStatus(failureClass: ResendFailureClass): 400 | 502 {
  return failureClass === "transient" ? 502 : 400;
}

const MASTER_KEY_MISSING_MESSAGE =
  "Configuração do servidor incompleta para armazenar a chave (EMAIL_DOMAIN_MASTER_KEY ausente). Contate o suporte.";

export const emailDomainsRouter = new Hono<{ Variables: AuthVariables }>()
  .get("/", ...requireLabProtected, requireOrgType("LAB"), async (c) => {
    const member = c.get("member");
    const record = await getOrganizationEmailDomain(member.organizationId);
    const replyToEmail = await getOrganizationReplyToEmail(
      member.organizationId,
    );

    return c.json({
      domain: serializeEmailDomain(record ?? null),
      statusSummary: buildEmailDomainStatusSummary(record ?? null),
      // Replies are the point of the feature: customers answer OS/quote mail
      // with purchase orders and approvals, so the lab must receive them.
      // Every send sets Reply-To to organization.email; when that is unset,
      // replies would go to the send-only subdomain and be lost — the UI
      // warns on null.
      replyToEmail,
    });
  })
  .post(
    "/validate-key",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("email_sender_domain"),
    zValidator("json", ValidateKeySchema),
    async (c) => {
      const input = c.req.valid("json");
      const result = await validateResendApiKey(input.apiKey);

      if (!result.valid) {
        return c.json(
          { error: resendFailureMessage(result.failureClass) },
          resendFailureStatus(result.failureClass),
        );
      }

      return c.json({
        valid: true,
        domains: result.domains,
      });
    },
  )
  .post(
    "/",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("email_sender_domain"),
    zValidator("json", CreateEmailDomainSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const masterKey = getEmailDomainMasterKey();
      if (!masterKey) {
        return c.json({ error: MASTER_KEY_MISSING_MESSAGE }, 500);
      }

      const fromLocalPart = sanitizeFromLocalPart(input.fromLocalPart);
      if (!fromLocalPart) {
        return c.json(
          { error: "Parte local do remetente inválida (ex.: os, contato)" },
          400,
        );
      }

      // The pasted key must reach the picked domain in ITS OWN account —
      // this both live-validates the key and pins hostname/status/records.
      const details = await getResendDomain(input.apiKey, input.resendDomainId);
      if (!details.ok) {
        return c.json(
          { error: resendFailureMessage(details.failureClass) },
          resendFailureStatus(details.failureClass),
        );
      }

      const hostname = sanitizeEmailHostname(details.data.name);
      if (!hostname) {
        return c.json({ error: "Domínio inválido para envio de e-mail" }, 400);
      }

      const collision = await db.query.organizationEmailDomain.findFirst({
        where: and(
          eq(organizationEmailDomain.hostname, hostname),
          ne(organizationEmailDomain.organizationId, member.organizationId),
        ),
      });
      if (collision) {
        return c.json(
          { error: "Este domínio já está em uso por outra organização" },
          409,
        );
      }

      const encryptedKey = encryptResendApiKey(input.apiKey, masterKey);
      const isVerified = details.data.status === "verified";
      const now = new Date();
      const values = {
        mode: "byok" as const,
        hostname,
        resendDomainId: details.data.id,
        resendApiKeyEncrypted: encryptedKey.encrypted,
        resendApiKeyIv: encryptedKey.iv,
        resendApiKeyLast4: resendApiKeyLast4(input.apiKey),
        fromAddress: buildFromAddress(fromLocalPart, hostname),
        dnsRecords: details.data.records,
        status: details.data.status,
        verifiedAt: isVerified ? now : null,
        lastVerifiedAt: isVerified ? now : null,
        keyStatus: "ok" as const,
        keyLastError: null,
      };

      const existing = await getOrganizationEmailDomain(member.organizationId);

      if (existing) {
        const [updated] = await db
          .update(organizationEmailDomain)
          .set({
            ...values,
            // Re-picking a domain resets activation on purpose: the lab must
            // review and activate the new sender explicitly.
            isActive: false,
            activatedAt: null,
            updatedAt: now,
          })
          .where(eq(organizationEmailDomain.id, existing.id))
          .returning();

        if (updated) {
          await writeOrganizationAuditEvent({
            organizationId: member.organizationId,
            actorUserId: session.user.id,
            actorMemberId: member.id,
            action: "email_sender_domain.updated",
            entityType: "email_sender_domain",
            entityId: updated.id,
            details: {
              hostname: updated.hostname,
              fromAddress: updated.fromAddress,
              previousHostname: existing.hostname,
              apiKeyLast4: updated.resendApiKeyLast4,
            },
          });
        }

        return c.json({
          domain: serializeEmailDomain(updated ?? null),
          statusSummary: buildEmailDomainStatusSummary(updated ?? null),
        });
      }

      const [created] = await db
        .insert(organizationEmailDomain)
        .values({
          id: crypto.randomUUID(),
          organizationId: member.organizationId,
          createdBy: session.user.id,
          ...values,
        })
        .returning();

      if (created) {
        await writeOrganizationAuditEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "email_sender_domain.created",
          entityType: "email_sender_domain",
          entityId: created.id,
          details: {
            hostname: created.hostname,
            fromAddress: created.fromAddress,
            apiKeyLast4: created.resendApiKeyLast4,
          },
        });
      }

      return c.json(
        {
          domain: serializeEmailDomain(created ?? null),
          statusSummary: buildEmailDomainStatusSummary(created ?? null),
        },
        201,
      );
    },
  )
  .post(
    "/key",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("email_sender_domain"),
    zValidator("json", RotateKeySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const record = await getOrganizationEmailDomain(member.organizationId);
      if (!record) {
        return c.json({ error: "Nenhum domínio de envio configurado" }, 404);
      }

      const masterKey = getEmailDomainMasterKey();
      if (!masterKey) {
        return c.json({ error: MASTER_KEY_MISSING_MESSAGE }, 500);
      }

      // The new key must reach the SAME domain (same Resend account).
      const details = await getResendDomain(
        input.apiKey,
        record.resendDomainId,
      );
      if (!details.ok) {
        return c.json(
          { error: resendFailureMessage(details.failureClass) },
          resendFailureStatus(details.failureClass),
        );
      }

      const encryptedKey = encryptResendApiKey(input.apiKey, masterKey);
      const [updated] = await db
        .update(organizationEmailDomain)
        .set({
          resendApiKeyEncrypted: encryptedKey.encrypted,
          resendApiKeyIv: encryptedKey.iv,
          resendApiKeyLast4: resendApiKeyLast4(input.apiKey),
          keyStatus: "ok",
          keyLastError: null,
          updatedAt: new Date(),
        })
        .where(eq(organizationEmailDomain.id, record.id))
        .returning();

      if (updated) {
        await writeOrganizationAuditEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "email_sender_domain.key_rotated",
          entityType: "email_sender_domain",
          entityId: updated.id,
          details: {
            hostname: updated.hostname,
            apiKeyLast4: updated.resendApiKeyLast4,
          },
        });
      }

      return c.json({
        domain: serializeEmailDomain(updated ?? null),
        statusSummary: buildEmailDomainStatusSummary(updated ?? null),
      });
    },
  )
  .post(
    "/verify",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("email_sender_domain"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");

      const record = await getOrganizationEmailDomain(member.organizationId);
      if (!record) {
        return c.json({ error: "Nenhum domínio de envio configurado" }, 404);
      }

      const masterKey = getEmailDomainMasterKey();
      if (!masterKey) {
        return c.json({ error: MASTER_KEY_MISSING_MESSAGE }, 500);
      }

      let apiKey: string;
      try {
        apiKey = decryptResendApiKey(
          record.resendApiKeyEncrypted,
          record.resendApiKeyIv,
          masterKey,
        );
      } catch {
        return c.json(
          {
            error:
              "Não foi possível ler a chave armazenada. Cole a chave novamente.",
          },
          500,
        );
      }

      // Nudge Resend to re-check DNS, then read back the verdict. The trigger
      // failing on an unverifiable state is fine; the GET is what we trust.
      await verifyResendDomain(apiKey, record.resendDomainId);
      const details = await getResendDomain(apiKey, record.resendDomainId);

      if (!details.ok) {
        if (details.failureClass === "invalid_key") {
          await db
            .update(organizationEmailDomain)
            .set({
              keyStatus: "invalid",
              keyLastError: `${details.errorName}: ${details.message}`,
              updatedAt: new Date(),
            })
            .where(eq(organizationEmailDomain.id, record.id));
        }
        return c.json(
          { error: resendFailureMessage(details.failureClass) },
          resendFailureStatus(details.failureClass),
        );
      }

      const isVerified = details.data.status === "verified";
      const becameVerified = isVerified && !record.verifiedAt;
      const now = new Date();
      const [updated] = await db
        .update(organizationEmailDomain)
        .set({
          status: details.data.status,
          dnsRecords: details.data.records,
          verifiedAt: isVerified ? (record.verifiedAt ?? now) : null,
          lastVerifiedAt: isVerified ? now : record.lastVerifiedAt,
          // A successful round-trip proves the key is healthy again.
          keyStatus: "ok",
          keyLastError: null,
          updatedAt: now,
        })
        .where(eq(organizationEmailDomain.id, record.id))
        .returning();

      if (updated && becameVerified) {
        await writeOrganizationAuditEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "email_sender_domain.verified",
          entityType: "email_sender_domain",
          entityId: updated.id,
          details: { hostname: updated.hostname },
        });
      }

      return c.json({
        domain: serializeEmailDomain(updated ?? null),
        statusSummary: buildEmailDomainStatusSummary(updated ?? null),
      });
    },
  )
  .post(
    "/activate",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("email_sender_domain"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");

      const record = await getOrganizationEmailDomain(member.organizationId);
      if (!record) {
        return c.json({ error: "Nenhum domínio de envio configurado" }, 404);
      }

      if (!record.verifiedAt) {
        return c.json(
          { error: "Verifique o domínio no Resend antes de ativá-lo" },
          400,
        );
      }

      const [updated] = await db
        .update(organizationEmailDomain)
        .set({
          isActive: true,
          activatedAt: record.activatedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(organizationEmailDomain.id, record.id))
        .returning();

      if (updated) {
        await writeOrganizationAuditEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "email_sender_domain.activated",
          entityType: "email_sender_domain",
          entityId: updated.id,
          details: {
            hostname: updated.hostname,
            fromAddress: updated.fromAddress,
          },
        });
      }

      return c.json({
        domain: serializeEmailDomain(updated ?? null),
        statusSummary: buildEmailDomainStatusSummary(updated ?? null),
      });
    },
  )
  .delete(
    "/",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");

      const record = await getOrganizationEmailDomain(member.organizationId);
      if (!record) {
        return c.json({ success: true });
      }

      await db
        .delete(organizationEmailDomain)
        .where(eq(organizationEmailDomain.id, record.id));

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "email_sender_domain.deleted",
        entityType: "email_sender_domain",
        entityId: record.id,
        details: {
          hostname: record.hostname,
          wasVerified: Boolean(record.verifiedAt),
          wasActive: record.isActive,
        },
      });

      return c.json({ success: true });
    },
  );
