/** Managed laboratory sending domains, with read support for legacy BYOK rows. */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import { organizationEmailDomain } from "@calibra-facil/db/schema";
import {
  decryptResendApiKey,
  getEmailDomainMasterKey,
  getResendDomain,
  verifyResendDomain,
  type ResendFailureClass,
} from "@calibra-facil/email-sender";
import {
  buildEmailDomainStatusSummary,
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
import { eq } from "drizzle-orm";
import {
  saveManagedEmailDomain,
  removeEmailDomain,
} from "../lib/email-domain-lifecycle";

const CreateEmailDomainSchema = z.object({
  /** The laboratory's sending host, e.g. certificados.laboratorio.com.br. */
  hostname: z.string().trim().min(4).max(253),
  fromLocalPart: z.string().trim().min(1).max(64),
});

function resendFailureMessage(failureClass: ResendFailureClass): string {
  switch (failureClass) {
    case "invalid_key":
      return "O serviço de envio precisa de uma atualização de acesso. Contate o suporte.";
    case "quota_exhausted":
    case "rate_limited":
      return "O Resend recusou a chamada por limite de uso. Aguarde alguns instantes e tente novamente.";
    case "sender_config":
      return "Não foi possível consultar este domínio no serviço de envio. Contate o suporte.";
    default:
      return "Não foi possível falar com o Resend agora. Tente novamente em instantes.";
  }
}

function resendFailureStatus(failureClass: ResendFailureClass): 400 | 502 {
  return failureClass === "transient" ? 502 : 400;
}

const MASTER_KEY_MISSING_MESSAGE =
  "Configuração do servidor incompleta para armazenar a chave (EMAIL_DOMAIN_MASTER_KEY ausente). Contate o suporte.";

const PLATFORM_KEY_MISSING_MESSAGE =
  "Configuração do servidor incompleta para criar o domínio de envio (RESEND_API_KEY ausente). Contate o suporte.";

/**
 * Which Resend account this row lives in.
 *
 * Managed rows are ours, so they use the platform key. Legacy bring-your-own-key
 * rows are the laboratory's own account and still need their stored key
 * decrypted. No new row is ever created in that mode.
 */
function resolveRowApiKey(record: {
  mode: string;
  resendApiKeyEncrypted: string | null;
  resendApiKeyIv: string | null;
}): { ok: true; apiKey: string } | { ok: false; message: string } {
  if (record.mode === "managed") {
    const platformKey = process.env.RESEND_API_KEY;
    return platformKey
      ? { ok: true, apiKey: platformKey }
      : { ok: false, message: PLATFORM_KEY_MISSING_MESSAGE };
  }

  const masterKey = getEmailDomainMasterKey();
  if (!masterKey) return { ok: false, message: MASTER_KEY_MISSING_MESSAGE };
  if (!record.resendApiKeyEncrypted || !record.resendApiKeyIv) {
    return { ok: false, message: MASTER_KEY_MISSING_MESSAGE };
  }

  try {
    return {
      ok: true,
      apiKey: decryptResendApiKey(
        record.resendApiKeyEncrypted,
        record.resendApiKeyIv,
        masterKey,
      ),
    };
  } catch {
    return {
      ok: false,
      message:
        "Não foi possível ler a chave armazenada deste domínio. Remova e configure novamente.",
    };
  }
}

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
    "/",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    zValidator("json", CreateEmailDomainSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const fromLocalPart = sanitizeFromLocalPart(input.fromLocalPart);
      if (!fromLocalPart) {
        return c.json(
          { error: "Parte local do remetente inválida (ex.: os, contato)" },
          400,
        );
      }

      const hostname = sanitizeEmailHostname(input.hostname);
      if (!hostname) {
        return c.json({ error: "Domínio inválido para envio de e-mail" }, 400);
      }

      const result = await saveManagedEmailDomain(
        {
          organizationId: member.organizationId,
          userId: session.user.id,
          memberId: member.id,
        },
        { hostname, fromLocalPart },
      );
      return c.json(
        {
          domain: serializeEmailDomain(result.domain),
          statusSummary: buildEmailDomainStatusSummary(result.domain),
        },
        result.created ? 201 : 200,
      );
    },
  )
  .post(
    "/verify",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");

      const record = await getOrganizationEmailDomain(member.organizationId);
      if (!record) {
        return c.json({ error: "Nenhum domínio de envio configurado" }, 404);
      }

      const credential = resolveRowApiKey(record);
      if (!credential.ok) {
        return c.json({ error: credential.message }, 500);
      }
      const apiKey = credential.apiKey;

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
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");

      const record = await getOrganizationEmailDomain(member.organizationId);
      if (!record) {
        return c.json({ error: "Nenhum domínio de envio configurado" }, 404);
      }

      if (!record.verifiedAt) {
        return c.json(
          {
            error:
              "Publique os registros DNS e verifique o domínio antes de ativá-lo",
          },
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

      await removeEmailDomain({
        organizationId: member.organizationId,
        userId: session.user.id,
        memberId: member.id,
      });
      return c.json({ success: true });
    },
  );
