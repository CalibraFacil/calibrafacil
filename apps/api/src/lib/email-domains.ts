/**
 * Helpers for the lab-owned email sending domain routes (issue #584).
 * Mirrors lib/portal-domains.ts, but verification is Resend's verdict (DKIM/
 * SPF records generated and checked by the lab's own Resend account) rather
 * than a self-issued TXT token.
 */

import { db, systemDb } from "@calibra-facil/db";
import {
  organization,
  organizationEmailDomain,
} from "@calibra-facil/db/schema";
import { isLocalHostname, normalizeHostname } from "@calibra-facil/shared";
import { and, eq, ne } from "drizzle-orm";
import { withOrgReader } from "./org-transaction";

export function sanitizeEmailHostname(input: string): string | null {
  const hostname = normalizeHostname(input);
  if (!hostname || isLocalHostname(hostname)) return null;
  return hostname;
}

/** RFC-ish local part, conservative: dot-atom without leading/trailing dot. */
const FROM_LOCAL_PART_PATTERN = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/i;

export function sanitizeFromLocalPart(input: string): string | null {
  const localPart = input.trim().toLowerCase();
  if (!FROM_LOCAL_PART_PATTERN.test(localPart) || localPart.includes("..")) {
    return null;
  }
  return localPart;
}

export function buildFromAddress(localPart: string, hostname: string): string {
  return `${localPart}@${hostname}`;
}

/**
 * The laboratory's sending-domain row (`organization_email_domain` is a tenant
 * table): read in a short transaction that names the laboratory, or on the
 * caller's own organization-bound handle.
 */
export async function getOrganizationEmailDomain(
  organizationId: string,
  executor?: Parameters<typeof withOrgReader>[1],
) {
  const [record] = await withOrgReader(organizationId, executor, (reader) =>
    reader
      .select()
      .from(organizationEmailDomain)
      .where(eq(organizationEmailDomain.organizationId, organizationId))
      .limit(1),
  );
  return record;
}

/**
 * Whether a laboratory other than `organizationId` already holds a sending
 * hostname.
 *
 * System path (P2-18j): a hostname is unique across the platform
 * (`org_email_domain_hostname_uidx`), so "does ANOTHER laboratory hold it" is
 * cross-organization by design and cannot be asked under one laboratory's
 * `calibra.organization_id` (it would always answer "nobody"). One row, only its
 * existence is used.
 */
export async function otherOrganizationHoldsHostname(
  hostname: string,
  organizationId: string,
) {
  const [holder] = await systemDb
    .select({ id: organizationEmailDomain.id })
    .from(organizationEmailDomain)
    .where(
      and(
        eq(organizationEmailDomain.hostname, hostname),
        ne(organizationEmailDomain.organizationId, organizationId),
      ),
    )
    .limit(1);
  return holder !== undefined;
}

/**
 * Where customer REPLIES land. Every send (lab domain or platform) sets
 * Reply-To to organization.email — the whole point of the lab sender is the
 * back-and-forth (customers answer with purchase orders / approvals), so the
 * settings UI must warn when this is unset: without it, replies would go to
 * the send-only subdomain and be lost.
 */
export async function getOrganizationReplyToEmail(
  organizationId: string,
): Promise<string | null> {
  const [lab] = await db
    .select({ email: organization.email })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  const email = lab?.email?.trim();
  return email && email.includes("@") ? email : null;
}

type EmailDomainRecord = typeof organizationEmailDomain.$inferSelect;

export function serializeEmailDomain(record: EmailDomainRecord | null) {
  if (!record) return null;

  return {
    id: record.id,
    mode: record.mode,
    hostname: record.hostname,
    fromAddress: record.fromAddress,
    status: record.status,
    verifiedAt: record.verifiedAt,
    lastVerifiedAt: record.lastVerifiedAt,
    activatedAt: record.activatedAt,
    isActive: record.isActive,
    keyStatus: record.keyStatus,
    keyLastError: record.keyLastError,
    /** The only key representation that ever leaves the server. */
    apiKeyMasked:
      record.mode === "byok" ? `••••${record.resendApiKeyLast4}` : "",
    dnsRecords: record.dnsRecords ?? [],
    createdAt: record.createdAt,
  };
}

export function buildEmailDomainStatusSummary(
  record: EmailDomainRecord | null,
) {
  const keyHealth = record
    ? { status: record.keyStatus, lastError: record.keyLastError }
    : { status: "ok" as const, lastError: null };

  if (!record) {
    return {
      status: "not_configured" as const,
      canActivate: false,
      message:
        "Nenhum domínio de envio configurado. Os e-mails saem do remetente padrão da plataforma.",
      keyHealth,
    };
  }

  if (record.isActive && record.verifiedAt) {
    return {
      status: "active" as const,
      canActivate: false,
      message: `E-mails para clientes são enviados de ${record.fromAddress}.`,
      keyHealth,
    };
  }

  if (record.verifiedAt) {
    return {
      status: "verified" as const,
      canActivate: true,
      message: "Domínio verificado no Resend e pronto para ativação.",
      keyHealth,
    };
  }

  return {
    status: "waiting_verification" as const,
    canActivate: false,
    message:
      "Publique os registros DNS exibidos nesta página e clique em Verificar novamente. A confirmação pode levar algumas horas.",
    keyHealth,
  };
}
