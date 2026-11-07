import { z } from "zod";

import { nullableString } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's custom portal domain (admin and owner only). Response
 * schemas are wire schemas written from what
 * `apps/api/src/domains/org/routes/portal-domains.ts` returns. Cloud-only: the desktop
 * shows a fixed "not configured" answer (`desktop-client.ts`).
 */

export const CreatePortalDomainSchema = z.object({
  hostname: z.string().trim().min(3).max(255),
});

const portalDomainSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  verifiedAt: nullableString,
  lastVerifiedAt: nullableString,
  activatedAt: nullableString,
  isActive: z.boolean(),
  verification: z.object({
    type: z.literal("TXT"),
    host: z.string(),
    value: z.string(),
  }),
});

/** GET /api/portal-domains: the domain (or none), the portal's base URL and what to do next. */
export const portalDomainResponseSchema = z.object({
  portalBaseUrl: z.string(),
  domain: portalDomainSchema.nullable(),
  statusSummary: z.object({
    status: z.enum([
      "not_configured",
      "waiting_dns",
      "token_mismatch",
      "ready_to_verify",
      "verified",
      "active",
    ]),
    readiness: z.enum(["not_ready", "ready", "active"]),
    canActivate: z.boolean(),
    message: z.string(),
    diagnostics: z.object({
      host: nullableString,
      expectedValue: nullableString,
      observedValues: z.array(z.string()),
    }),
  }),
});
export type PortalDomainResponse = z.infer<typeof portalDomainResponseSchema>;

/** What the writes answer: the domain as it is now (create answers 201 for a new one). */
const portalDomainActionResponseSchema = z.object({
  domain: portalDomainSchema.nullable(),
});

const DESKTOP_LABEL = "Domínio do portal";

export const portalDomainEndpoints = {
  get: endpoint({
    method: "get",
    path: "/api/portal-domains",
    response: portalDomainResponseSchema,
    failure: "Falha ao carregar domínio do portal",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  // 201 when the domain is new, 200 when an existing one is changed (the
  // handler answers the 201 itself: a status the definition does not describe).
  create: endpoint({
    method: "post",
    path: "/api/portal-domains",
    body: CreatePortalDomainSchema,
    response: portalDomainActionResponseSchema,
    failure: "Falha ao salvar domínio",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  verify: endpoint({
    method: "post",
    path: "/api/portal-domains/verify",
    response: portalDomainActionResponseSchema,
    failure: "Falha ao verificar domínio",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  activate: endpoint({
    method: "post",
    path: "/api/portal-domains/activate",
    response: portalDomainActionResponseSchema,
    failure: "Falha ao ativar domínio",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  delete: endpoint({
    method: "delete",
    path: "/api/portal-domains",
    response: z.object({ success: z.literal(true) }),
    failure: "Falha ao remover domínio",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
