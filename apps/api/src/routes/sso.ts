import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import {
  organization,
  ssoProvider,
  subscription,
} from "@calibra-facil/db/schema";
import { createLabAuth } from "@calibra-facil/auth";
import {
  getPlan,
  hasFeature,
  isSubscriptionActive,
  isValidPlanId,
  type PlanId,
  type SubscriptionStatus,
} from "@calibra-facil/shared";
import { and, eq } from "drizzle-orm";
import {
  requireRole,
  type AuthVariables,
  withLabPermission,
} from "../middleware/permission";
import { writeOrganizationAuditEvent } from "../lib/audit";

const createProviderSchema = z.object({
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

const providerParamSchema = z.object({
  providerId: z.string().trim().min(1),
});

const startSsoSchema = z.object({
  organizationSlug: z.string().trim().min(1),
  email: z.string().trim().email().optional(),
  redirectPath: z.string().trim().optional(),
});

const providerOidcConfigSchema = z.object({
  discoveryEndpoint: z.string().optional(),
  authorizationEndpoint: z.string().optional(),
  tokenEndpoint: z.string().optional(),
  userInfoEndpoint: z.string().optional(),
  jwksEndpoint: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  clientId: z.string().optional(),
  pkce: z.boolean().optional(),
  tokenEndpointAuthentication: z.string().optional(),
});

const domainVerificationResponseSchema = z.object({
  domainVerificationToken: z.string().optional(),
});

const requiredDomainVerificationResponseSchema = z.object({
  domainVerificationToken: z.string(),
});

const ssoStartResponseSchema = z.object({
  url: z.string(),
  redirect: z.boolean(),
});

type SsoProviderRow = typeof ssoProvider.$inferSelect;

function getApiBaseURL() {
  return process.env.NODE_ENV === "production"
    ? process.env.API_URL || "https://api.calibrafacil.com"
    : "http://localhost:3000";
}

function getDashboardBaseURL() {
  return process.env.NODE_ENV === "production"
    ? process.env.APP_URL || "https://calibrafacil.com"
    : "http://localhost:5173";
}

function normalizeDomain(value: string): string | null {
  const candidate = value.includes("://") ? value : `https://${value}`;

  try {
    const url = new URL(candidate);
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function buildDiscoveryEndpoint(issuer: string) {
  const base = issuer.endsWith("/") ? issuer : `${issuer}/`;
  return new URL(".well-known/openid-configuration", base).toString();
}

function parseScopes(rawScopes?: string[]) {
  const scopes = rawScopes?.map((scope) => scope.trim()).filter(Boolean) ?? [
    "openid",
    "email",
    "profile",
  ];

  return [...new Set(scopes)];
}

function maskClientId(clientId?: string | null) {
  if (!clientId) return null;
  return clientId.length <= 4 ? clientId : clientId.slice(-4);
}

function parseProviderConfig(provider: SsoProviderRow) {
  try {
    if (!provider.oidcConfig) return null;
    const parsed: unknown = JSON.parse(provider.oidcConfig);
    const config = providerOidcConfigSchema.safeParse(parsed);
    return config.success ? config.data : null;
  } catch {
    return null;
  }
}

function getProviderDnsHost(provider: Pick<SsoProviderRow, "domain">) {
  try {
    return new URL(provider.domain).hostname;
  } catch {
    return provider.domain;
  }
}

function buildVerificationRecord(
  provider: Pick<SsoProviderRow, "providerId" | "domain">,
  token: string,
) {
  return {
    type: "TXT" as const,
    host: getProviderDnsHost(provider),
    value: `better-auth-token-${provider.providerId}=${token}`,
  };
}

function serializeProvider(provider: SsoProviderRow) {
  const oidcConfig = parseProviderConfig(provider);

  return {
    id: provider.id,
    providerId: provider.providerId,
    issuer: provider.issuer,
    domain: provider.domain,
    domainHost: getProviderDnsHost(provider),
    domainVerified: provider.domainVerified ?? false,
    organizationId: provider.organizationId,
    type: provider.oidcConfig ? "oidc" : "unknown",
    oidcConfig: oidcConfig
      ? {
          discoveryEndpoint: oidcConfig.discoveryEndpoint ?? null,
          authorizationEndpoint: oidcConfig.authorizationEndpoint ?? null,
          tokenEndpoint: oidcConfig.tokenEndpoint ?? null,
          userInfoEndpoint: oidcConfig.userInfoEndpoint ?? null,
          jwksEndpoint: oidcConfig.jwksEndpoint ?? null,
          scopes: oidcConfig.scopes ?? [],
          pkce: oidcConfig.pkce ?? true,
          clientIdLastFour: maskClientId(oidcConfig.clientId),
          tokenEndpointAuthentication:
            oidcConfig.tokenEndpointAuthentication ?? null,
        }
      : null,
    redirectURI: `${getApiBaseURL()}/api/auth/lab/sso/callback/${provider.providerId}`,
  };
}

async function getPlanAccessForOrg(organizationId: string) {
  const activeSubscription = await db.query.subscription.findFirst({
    where: eq(subscription.organizationId, organizationId),
  });

  const planId = toPlanId(activeSubscription?.planId);
  const status = toSubscriptionStatus(activeSubscription?.status);

  return {
    planId,
    status,
    plan: getPlan(planId),
    hasSso: hasFeature(planId, "sso"),
    isAccessible:
      !activeSubscription ||
      isSubscriptionActive(status) ||
      status === "PAST_DUE",
  };
}

function buildAuthHeaders(requestHeaders: Headers, issuerOrigin?: string) {
  const headers = new Headers(requestHeaders);

  if (issuerOrigin) {
    headers.set("x-sso-issuer-origin", issuerOrigin);
  }

  return headers;
}

function normalizeDashboardRedirectPath(value: string | undefined) {
  if (!value || value.startsWith("//")) return "/dashboard";

  try {
    const url = new URL(value, "https://calibra.local");
    const path = `${url.pathname}${url.search}${url.hash}`;
    const isDashboardPath =
      path === "/dashboard" ||
      path.startsWith("/dashboard/") ||
      path.startsWith("/dashboard?") ||
      path.startsWith("/dashboard#");

    return url.origin === "https://calibra.local" && isDashboardPath
      ? path
      : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

async function forwardBetterAuthError(
  c: {
    json: (body: unknown, status?: number) => Response;
  },
  response: Response,
  fallbackMessage: string,
) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const data = await response
      .json()
      .catch(() => ({ error: fallbackMessage }));
    return c.json(data, response.status);
  }

  const text = await response.text().catch(() => "");
  return c.json({ error: text || fallbackMessage }, response.status);
}

async function getOrganizationProvider(organizationId: string) {
  return db.query.ssoProvider.findFirst({
    where: eq(ssoProvider.organizationId, organizationId),
  });
}

export const ssoRouter = new Hono<{ Variables: AuthVariables }>()
  .get(
    "/providers",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const provider = await getOrganizationProvider(member.organizationId);
      const planAccess = await getPlanAccessForOrg(member.organizationId);

      return c.json({
        provider: provider ? serializeProvider(provider) : null,
        access: {
          role: member.role,
          canCreate: member.role === "owner",
          canManage: member.role === "owner",
          canDelete: member.role === "owner",
        },
        billing: {
          planId: planAccess.planId,
          planName: planAccess.plan.name,
          status: planAccess.status,
          hasSso: planAccess.hasSso,
        },
      });
    },
  )
  .post(
    "/providers",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["owner"]),
    zValidator("json", createProviderSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");
      const normalizedDomain = normalizeDomain(input.domain);

      if (!normalizedDomain) {
        return c.json({ error: "Dominio invalido" }, 400);
      }

      const planAccess = await getPlanAccessForOrg(member.organizationId);

      if (!planAccess.isAccessible) {
        return c.json(
          { error: "Assinatura inativa. Ative um plano para continuar." },
          402,
        );
      }

      if (!planAccess.hasSso) {
        return c.json(
          { error: "SSO esta disponivel apenas no plano Enterprise." },
          403,
        );
      }

      const existingProvider = await getOrganizationProvider(
        member.organizationId,
      );

      if (existingProvider) {
        return c.json(
          { error: "Esta organizacao ja possui um provedor SSO configurado." },
          409,
        );
      }

      const auth = createLabAuth();
      const issuerOrigin = new URL(input.issuer).origin;
      const response = await auth.api.registerSSOProvider({
        body: {
          providerId: input.providerId,
          issuer: input.issuer,
          domain: normalizedDomain,
          organizationId: member.organizationId,
          oidcConfig: {
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            discoveryEndpoint: buildDiscoveryEndpoint(input.issuer),
            pkce: true,
            scopes: parseScopes(input.scopes),
          },
        },
        headers: buildAuthHeaders(c.req.raw.headers, issuerOrigin),
        asResponse: true,
      });

      if (!response.ok) {
        return forwardBetterAuthError(
          c,
          response,
          "Falha ao registrar provedor SSO",
        );
      }

      const data = domainVerificationResponseSchema.parse(
        await response.json(),
      );
      const provider = await getOrganizationProvider(member.organizationId);

      if (!provider) {
        return c.json(
          {
            error:
              "Provedor criado, mas nao foi possivel recarregar a configuracao.",
          },
          500,
        );
      }

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "sso.provider.created",
        entityType: "sso_provider",
        entityId: provider.providerId,
        details: {
          providerId: provider.providerId,
          issuer: provider.issuer,
          domain: provider.domain,
          domainVerified: provider.domainVerified ?? false,
        },
      });

      return c.json(
        {
          provider: serializeProvider(provider),
          verificationRecord: data.domainVerificationToken
            ? buildVerificationRecord(provider, data.domainVerificationToken)
            : null,
        },
        201,
      );
    },
  )
  .post(
    "/providers/:providerId/request-domain-verification",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["owner"]),
    zValidator("param", providerParamSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { providerId } = c.req.valid("param");
      const provider = await db.query.ssoProvider.findFirst({
        where: and(
          eq(ssoProvider.organizationId, member.organizationId),
          eq(ssoProvider.providerId, providerId),
        ),
      });

      if (!provider) {
        return c.json({ error: "Provedor SSO nao encontrado" }, 404);
      }

      const planAccess = await getPlanAccessForOrg(member.organizationId);

      if (!planAccess.isAccessible) {
        return c.json(
          { error: "Assinatura inativa. Ative um plano para continuar." },
          402,
        );
      }

      if (!planAccess.hasSso) {
        return c.json(
          { error: "SSO esta disponivel apenas no plano Enterprise." },
          403,
        );
      }

      const auth = createLabAuth();
      const response = await auth.api.requestDomainVerification({
        body: { providerId },
        headers: buildAuthHeaders(c.req.raw.headers),
        asResponse: true,
      });

      if (!response.ok) {
        return forwardBetterAuthError(
          c,
          response,
          "Falha ao gerar novo token de verificacao",
        );
      }

      const data = requiredDomainVerificationResponseSchema.parse(
        await response.json(),
      );

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "sso.provider.domain_verification.requested",
        entityType: "sso_provider",
        entityId: provider.providerId,
        details: {
          providerId: provider.providerId,
          domain: provider.domain,
          verificationHost: getProviderDnsHost(provider),
          verificationTokenIssued: Boolean(data.domainVerificationToken),
        },
      });

      return c.json({
        verificationRecord: buildVerificationRecord(
          provider,
          data.domainVerificationToken,
        ),
      });
    },
  )
  .post(
    "/providers/:providerId/verify-domain",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["owner"]),
    zValidator("param", providerParamSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { providerId } = c.req.valid("param");
      const provider = await db.query.ssoProvider.findFirst({
        where: and(
          eq(ssoProvider.organizationId, member.organizationId),
          eq(ssoProvider.providerId, providerId),
        ),
      });

      if (!provider) {
        return c.json({ error: "Provedor SSO nao encontrado" }, 404);
      }

      const planAccess = await getPlanAccessForOrg(member.organizationId);

      if (!planAccess.isAccessible) {
        return c.json(
          { error: "Assinatura inativa. Ative um plano para continuar." },
          402,
        );
      }

      if (!planAccess.hasSso) {
        return c.json(
          { error: "SSO esta disponivel apenas no plano Enterprise." },
          403,
        );
      }

      const auth = createLabAuth();
      const response = await auth.api.verifyDomain({
        body: { providerId },
        headers: buildAuthHeaders(c.req.raw.headers),
        asResponse: true,
      });

      if (!response.ok && response.status !== 204) {
        return forwardBetterAuthError(
          c,
          response,
          "Falha ao verificar dominio",
        );
      }

      const refreshedProvider = await getOrganizationProvider(
        member.organizationId,
      );

      if (!refreshedProvider) {
        return c.json(
          {
            error:
              "Dominio verificado, mas o provedor nao foi encontrado apos a atualizacao.",
          },
          500,
        );
      }

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "sso.provider.domain_verified",
        entityType: "sso_provider",
        entityId: refreshedProvider.providerId,
        details: {
          providerId: refreshedProvider.providerId,
          domain: refreshedProvider.domain,
          domainVerified: refreshedProvider.domainVerified ?? false,
        },
      });

      return c.json({ provider: serializeProvider(refreshedProvider) });
    },
  )
  .delete(
    "/providers/:providerId",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["owner"]),
    zValidator("param", providerParamSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { providerId } = c.req.valid("param");
      // Intentionally allow deletion after downgrade so organizations can
      // clean up stale SSO configuration even when SSO sign-in is blocked.
      const provider = await db.query.ssoProvider.findFirst({
        where: and(
          eq(ssoProvider.organizationId, member.organizationId),
          eq(ssoProvider.providerId, providerId),
        ),
      });

      if (!provider) {
        return c.json({ error: "Provedor SSO nao encontrado" }, 404);
      }

      const auth = createLabAuth();
      const response = await auth.api.deleteSSOProvider({
        body: { providerId },
        headers: buildAuthHeaders(c.req.raw.headers),
        asResponse: true,
      });

      if (!response.ok) {
        return forwardBetterAuthError(
          c,
          response,
          "Falha ao remover provedor SSO",
        );
      }

      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "sso.provider.deleted",
        entityType: "sso_provider",
        entityId: provider.providerId,
        details: {
          providerId: provider.providerId,
          issuer: provider.issuer,
          domain: provider.domain,
          domainVerified: provider.domainVerified ?? false,
        },
      });

      return c.body(null, 204);
    },
  )
  .post("/start", zValidator("json", startSsoSchema), async (c) => {
    const input = c.req.valid("json");
    const redirectPath = normalizeDashboardRedirectPath(input.redirectPath);

    const org = await db.query.organization.findFirst({
      where: and(
        eq(organization.slug, input.organizationSlug),
        eq(organization.type, "LAB"),
      ),
    });

    if (!org) {
      return c.json({ error: "Laboratorio nao encontrado" }, 404);
    }

    const planAccess = await getPlanAccessForOrg(org.id);

    if (!planAccess.isAccessible) {
      return c.json(
        { error: "Assinatura inativa. Ative um plano para continuar." },
        402,
      );
    }

    if (!planAccess.hasSso) {
      return c.json(
        { error: "SSO nao esta disponivel para esta organizacao." },
        403,
      );
    }

    const provider = await getOrganizationProvider(org.id);

    if (!provider) {
      return c.json(
        { error: "Esta organizacao ainda nao configurou SSO." },
        404,
      );
    }

    if (!provider.domainVerified) {
      return c.json(
        { error: "O dominio SSO desta organizacao ainda nao foi verificado." },
        403,
      );
    }

    const auth = createLabAuth();
    const response = await auth.api.signInSSO({
      body: {
        organizationSlug: org.slug,
        providerType: "oidc",
        callbackURL: `${getDashboardBaseURL()}${redirectPath}`,
        ...(input.email ? { loginHint: input.email } : {}),
      },
      headers: buildAuthHeaders(c.req.raw.headers),
      asResponse: true,
    });

    if (!response.ok) {
      return forwardBetterAuthError(
        c,
        response,
        "Falha ao iniciar login via SSO",
      );
    }

    const payload = ssoStartResponseSchema.parse(await response.json());

    return c.json(payload);
  });

function toPlanId(value: unknown): PlanId {
  return typeof value === "string" && isValidPlanId(value) ? value : "FREE";
}

function toSubscriptionStatus(value: unknown): SubscriptionStatus {
  switch (value) {
    case "ACTIVE":
    case "PAST_DUE":
    case "CANCELED":
    case "TRIAL":
      return value;
    default:
      return "TRIAL";
  }
}
