import { readEmailConfig } from "@calibra-facil/config";
/** Managed laboratory sending domains, with read support for legacy BYOK rows. */

import { createRouter } from "../../../server/router";
import { emailDomainEndpoints } from "@calibra-facil/contracts";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
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
} from "../email-domains";
import { writeOrganizationAuditEvent } from "../../../lib/audit";
import { DomainError, invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
  withLabPermission,
} from "../../../middleware/permission";
import { eq } from "drizzle-orm";
import {
  saveManagedEmailDomain,
  removeEmailDomain,
} from "../email-domain-lifecycle";

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

/** The provider refused or was unreachable: 502 when it is worth retrying, 400 otherwise. */
function resendFailure(failureClass: ResendFailureClass) {
  return new DomainError({
    code: "email_domain_provider_failed",
    status: failureClass === "transient" ? 502 : 400,
    message: resendFailureMessage(failureClass),
  });
}

function noEmailDomain() {
  return notFound(
    "email_domain_not_found",
    "Nenhum domínio de envio configurado",
  );
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
    const platformKey = readEmailConfig().resendApiKey;
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

const PREFIX = "/api/email-domains";

export const emailDomainsRouter = createRouter<{ Variables: AuthVariables }>();

mount(
  emailDomainsRouter,
  PREFIX,
  emailDomainEndpoints.get,
  [...requireLabProtected, requireOrgType("LAB")],
  async (c) => {
    const member = c.get("member");
    const record = await orgDb(member.organizationId).transaction((o) =>
      getOrganizationEmailDomain(member.organizationId, o),
    );
    const replyToEmail = await getOrganizationReplyToEmail(
      member.organizationId,
    );

    return {
      domain: serializeEmailDomain(record ?? null),
      statusSummary: buildEmailDomainStatusSummary(record ?? null),
      // Replies are the point of the feature: customers answer OS/quote mail
      // with purchase orders and approvals, so the lab must receive them.
      // Every send sets Reply-To to organization.email; when that is unset,
      // replies would go to the send-only subdomain and be lost — the UI
      // warns on null.
      replyToEmail,
    };
  },
);

mount(
  emailDomainsRouter,
  PREFIX,
  emailDomainEndpoints.create,
  [
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
  ],
  async (c, { body: input }) => {
    const member = c.get("member");
    const session = c.get("session");

    const fromLocalPart = sanitizeFromLocalPart(input.fromLocalPart);
    if (!fromLocalPart) {
      throw invalid(
        "invalid_request",
        "Parte local do remetente inválida (ex.: os, contato)",
      );
    }

    const hostname = sanitizeEmailHostname(input.hostname);
    if (!hostname) {
      throw invalid("invalid_request", "Domínio inválido para envio de e-mail");
    }

    const result = await saveManagedEmailDomain(
      {
        organizationId: member.organizationId,
        userId: session.user.id,
        memberId: member.id,
      },
      { hostname, fromLocalPart },
    );
    const body = {
      domain: serializeEmailDomain(result.domain),
      statusSummary: buildEmailDomainStatusSummary(result.domain),
    };
    // 201 when the domain is new: a status the definition (200) does not describe.
    return result.created ? c.json(body, 201) : body;
  },
);

mount(
  emailDomainsRouter,
  PREFIX,
  emailDomainEndpoints.verify,
  [
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
  ],
  async (c) => {
    const member = c.get("member");
    const session = c.get("session");

    const record = await orgDb(member.organizationId).transaction((o) =>
      getOrganizationEmailDomain(member.organizationId, o),
    );
    if (!record) {
      throw noEmailDomain();
    }

    const credential = resolveRowApiKey(record);
    if (!credential.ok) {
      throw new DomainError({
        code: "email_domain_server_config",
        status: 500,
        message: credential.message,
      });
    }
    const apiKey = credential.apiKey;

    // Nudge Resend to re-check DNS, then read back the verdict. The trigger
    // failing on an unverifiable state is fine; the GET is what we trust.
    await verifyResendDomain(apiKey, record.resendDomainId);
    const details = await getResendDomain(apiKey, record.resendDomainId);

    if (!details.ok) {
      if (details.failureClass === "invalid_key") {
        await withOrg(member.organizationId, requestActor(c), (ctx) =>
          ctx.o
            .update(organizationEmailDomain)
            .set({
              keyStatus: "invalid",
              keyLastError: `${details.errorName}: ${details.message}`,
              updatedAt: new Date(),
            })
            .where(eq(organizationEmailDomain.id, record.id)),
        );
      }
      throw resendFailure(details.failureClass);
    }

    const isVerified = details.data.status === "verified";
    const becameVerified = isVerified && !record.verifiedAt;
    const now = new Date();
    // The verdict and its audit entry commit together; the provider calls
    // above ran outside any transaction.
    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [row] = await ctx.o
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

        if (row && becameVerified) {
          await writeOrganizationAuditEvent(
            {
              organizationId: member.organizationId,
              actorUserId: session.user.id,
              actorMemberId: member.id,
              action: "email_sender_domain.verified",
              entityType: "email_sender_domain",
              entityId: row.id,
              details: { hostname: row.hostname },
            },
            ctx.o,
          );
        }
        return row;
      },
    );

    return {
      domain: serializeEmailDomain(updated ?? null),
      statusSummary: buildEmailDomainStatusSummary(updated ?? null),
    };
  },
);

mount(
  emailDomainsRouter,
  PREFIX,
  emailDomainEndpoints.activate,
  [
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
  ],
  async (c) => {
    const member = c.get("member");
    const session = c.get("session");

    const record = await orgDb(member.organizationId).transaction((o) =>
      getOrganizationEmailDomain(member.organizationId, o),
    );
    if (!record) {
      throw noEmailDomain();
    }

    if (!record.verifiedAt) {
      throw invalid(
        "email_domain_not_verified",
        "Publique os registros DNS e verifique o domínio antes de ativá-lo",
      );
    }

    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [row] = await ctx.o
          .update(organizationEmailDomain)
          .set({
            isActive: true,
            activatedAt: record.activatedAt ?? new Date(),
            updatedAt: new Date(),
          })
          .where(eq(organizationEmailDomain.id, record.id))
          .returning();

        if (row) {
          await writeOrganizationAuditEvent(
            {
              organizationId: member.organizationId,
              actorUserId: session.user.id,
              actorMemberId: member.id,
              action: "email_sender_domain.activated",
              entityType: "email_sender_domain",
              entityId: row.id,
              details: {
                hostname: row.hostname,
                fromAddress: row.fromAddress,
              },
            },
            ctx.o,
          );
        }
        return row;
      },
    );

    return {
      domain: serializeEmailDomain(updated ?? null),
      statusSummary: buildEmailDomainStatusSummary(updated ?? null),
    };
  },
);

mount(
  emailDomainsRouter,
  PREFIX,
  emailDomainEndpoints.delete,
  [
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
  ],
  async (c) => {
    const member = c.get("member");
    const session = c.get("session");

    await removeEmailDomain({
      organizationId: member.organizationId,
      userId: session.user.id,
      memberId: member.id,
    });
    return { success: true as const };
  },
);
