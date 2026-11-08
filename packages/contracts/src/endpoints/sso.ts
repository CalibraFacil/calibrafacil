import { z } from "zod";

import { nullableString } from "../common";
import { endpoint, noContent, type EndpointGroup } from "./define";

/**
 * Single sign-on: the laboratory's OIDC provider (owner and admin) and the
 * sign-in start. Response schemas are wire schemas written from what
 * `apps/api/src/domains/org/routes/sso.ts` returns. Cloud-only: the desktop shows a fixed
 * "no provider" answer (`desktop-client.ts`).
 */

export const CreateSsoProviderSchema = z.object({
  providerId: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "providerId invalido"),
  issuer: z.string().trim().url("Issuer invalido"),
  domain: z.string().trim().min(1, "Dominio obrigatorio"),
  clientId: z.string().trim().min(1, "Client ID obrigatorio"),
  clientSecret: z.string().trim().min(1, "Client Secret obrigatorio"),
  scopes: z.array(z.string().trim().min(1)).optional(),
});

export const StartSsoSchema = z.object({
  organizationSlug: z.string().trim().min(1),
  email: z.string().trim().email().optional(),
  redirectPath: z.string().trim().optional(),
});

const providerParams = z.object({ providerId: z.string().trim().min(1) });

const verificationRecordSchema = z.object({
  type: z.literal("TXT"),
  host: z.string(),
  value: z.string(),
});

export type SsoVerificationRecord = z.infer<typeof verificationRecordSchema>;

const ssoProviderSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  issuer: z.string(),
  domain: z.string(),
  domainHost: z.string(),
  domainVerified: z.boolean(),
  organizationId: nullableString,
  type: z.string(),
  redirectURI: z.string(),
  oidcConfig: z
    .object({
      discoveryEndpoint: nullableString,
      authorizationEndpoint: nullableString,
      tokenEndpoint: nullableString,
      userInfoEndpoint: nullableString,
      jwksEndpoint: nullableString,
      scopes: z.array(z.string()),
      pkce: z.boolean(),
      clientIdLastFour: nullableString,
      tokenEndpointAuthentication: nullableString,
    })
    .nullable(),
});

/** GET /api/sso/providers */
export const ssoSettingsResponseSchema = z.object({
  provider: ssoProviderSchema.nullable(),
  access: z.object({
    role: z.string(),
    canCreate: z.boolean(),
    canManage: z.boolean(),
    canDelete: z.boolean(),
  }),
});
export type SsoSettingsResponse = z.infer<typeof ssoSettingsResponseSchema>;

const DESKTOP_LABEL = "Configuração SSO";

export const ssoEndpoints = {
  // Pre-authentication: asks the provider's sign-in URL for an organization.
  start: endpoint({
    method: "post",
    path: "/api/sso/start",
    body: StartSsoSchema,
    response: z.object({ url: z.string(), redirect: z.boolean() }),
    failure: "Falha ao iniciar login via SSO",
    policy: "cloud-only",
    desktopLabel: "Login SSO",
  }),
  getProviders: endpoint({
    method: "get",
    path: "/api/sso/providers",
    response: ssoSettingsResponseSchema,
    failure: "Falha ao carregar configuração SSO",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { organization: ["update"] },
  }),
  createProvider: endpoint({
    method: "post",
    path: "/api/sso/providers",
    body: CreateSsoProviderSchema,
    response: z.object({
      provider: ssoProviderSchema,
      verificationRecord: verificationRecordSchema.nullable(),
    }),
    status: 201,
    failure: "Falha ao registrar provedor SSO",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { organization: ["update"] },
  }),
  requestDomainVerification: endpoint({
    method: "post",
    path: "/api/sso/providers/:providerId/request-domain-verification",
    params: providerParams,
    response: z.object({ verificationRecord: verificationRecordSchema }),
    failure: "Falha ao gerar token DNS",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { organization: ["update"] },
  }),
  verifyDomain: endpoint({
    method: "post",
    path: "/api/sso/providers/:providerId/verify-domain",
    params: providerParams,
    response: z.object({ provider: ssoProviderSchema }),
    failure: "Falha ao verificar domínio",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { organization: ["update"] },
  }),
  deleteProvider: endpoint({
    method: "delete",
    path: "/api/sso/providers/:providerId",
    params: providerParams,
    response: noContent,
    status: 204,
    failure: "Falha ao remover provedor SSO",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { organization: ["update"] },
  }),
} as const satisfies EndpointGroup;
