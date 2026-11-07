import { z } from "zod";
import { EMAIL_DOMAIN_KEY_STATUSES } from "@calibra-facil/schemas/machines";

import { nullableString } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's sending e-mail domain (admin and owner only). Response
 * schemas are wire schemas written from what
 * `apps/api/src/domains/org/routes/email-domains.ts` returns. Cloud-only: the desktop shows
 * a fixed "not configured" answer (`desktop-client.ts`).
 */

export const CreateEmailDomainSchema = z.object({
  /** The laboratory's sending host, e.g. certificados.laboratorio.com.br. */
  hostname: z.string().trim().min(4).max(253),
  fromLocalPart: z.string().trim().min(1).max(64),
});

const emailDomainKeyStatusSchema = z.enum(EMAIL_DOMAIN_KEY_STATUSES);

const emailDomainRecordSchema = z.object({
  id: z.string(),
  mode: z.enum(["byok", "managed"]),
  hostname: z.string(),
  fromAddress: z.string(),
  status: z.string(),
  verifiedAt: nullableString,
  lastVerifiedAt: nullableString,
  activatedAt: nullableString,
  isActive: z.boolean(),
  keyStatus: emailDomainKeyStatusSchema,
  keyLastError: nullableString,
  /** Masked representation; the raw key never leaves the server. */
  apiKeyMasked: z.string(),
  dnsRecords: z.array(z.record(z.string(), z.unknown())),
  createdAt: z.string(),
});

/** The domain (or none) and what the laboratory can do next. */
export const emailDomainResponseSchema = z.object({
  domain: emailDomainRecordSchema.nullable(),
  statusSummary: z.object({
    status: z.enum([
      "not_configured",
      "waiting_verification",
      "verified",
      "active",
    ]),
    canActivate: z.boolean(),
    message: z.string(),
    keyHealth: z.object({
      status: emailDomainKeyStatusSchema,
      lastError: nullableString,
    }),
  }),
  /**
   * Where customer replies land (Reply-To = organization.email). Present on
   * GET only; null means replies would be lost: the settings page warns.
   */
  replyToEmail: nullableString.optional(),
});
export type EmailDomainResponse = z.infer<typeof emailDomainResponseSchema>;

const DESKTOP_LABEL = "Domínio de e-mail";

export const emailDomainEndpoints = {
  get: endpoint({
    method: "get",
    path: "/api/email-domains",
    response: emailDomainResponseSchema,
    failure: "Falha ao carregar domínio de e-mail",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  // Creates the sending domain in the platform's own provider account and answers
  // the DNS records to publish: 201 when the domain is new, 200 when it was
  // already there (the handler answers the 201 itself).
  create: endpoint({
    method: "post",
    path: "/api/email-domains",
    body: CreateEmailDomainSchema,
    response: emailDomainResponseSchema,
    failure: "Falha ao salvar domínio de e-mail",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  verify: endpoint({
    method: "post",
    path: "/api/email-domains/verify",
    response: emailDomainResponseSchema,
    failure: "Falha ao verificar domínio de e-mail",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  activate: endpoint({
    method: "post",
    path: "/api/email-domains/activate",
    response: emailDomainResponseSchema,
    failure: "Falha ao ativar domínio de e-mail",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  delete: endpoint({
    method: "delete",
    path: "/api/email-domains",
    response: z.object({ success: z.literal(true) }),
    failure: "Falha ao remover domínio de e-mail",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
