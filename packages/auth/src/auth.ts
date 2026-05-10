import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { randomBytes } from "node:crypto";
import { getDb } from "@calibra-facil/db";
import * as schema from "@calibra-facil/db/schema";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { admin as adminPlugin, organization } from "better-auth/plugins";
import { magicLink } from "better-auth/plugins/magic-link";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { sso } from "@better-auth/sso";
import { Resend } from "resend";
import { OrganizationInvitationEmail } from "@calibra-facil/email";
import { hasEntitlement } from "@calibra-facil/shared";
import {
  PORTAL_ACCESS_ROLES,
  ac,
  platformAc,
  platformRoles,
  roles,
} from "./access";

let devFallbackAuthSecret: string | null = null;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function getRequiredEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

function resolveApiBaseUrl(fallback: string): string {
  return readEnv("API_URL") ?? fallback;
}

function isProductionRuntime(): boolean {
  return process.env.VERCEL_ENV === "production";
}

function createBaseUrlConfig(isProduction: boolean): string {
  if (isProduction) {
    return getRequiredEnv("API_URL");
  }

  const vercelPreviewUrl = readEnv("VERCEL_URL");
  if (vercelPreviewUrl) {
    // Vercel preview deployments use dynamic *.vercel.app hostnames.
    // Resolve Better Auth base URL from VERCEL_URL so preview builds don't require a fixed BETTER_AUTH_URL.
    return `https://${vercelPreviewUrl}`;
  }

  return resolveApiBaseUrl("http://localhost:3000");
}

function getCookieDomainFromApiUrl(apiUrl: string | undefined): string | null {
  if (!apiUrl) return null;

  try {
    const { hostname } = new URL(apiUrl);
    return hostname.endsWith(".calibrafacil.com") ? ".calibrafacil.com" : null;
  } catch {
    return null;
  }
}

function getDevFallbackAuthSecret(): string {
  if (devFallbackAuthSecret) {
    return devFallbackAuthSecret;
  }

  devFallbackAuthSecret = randomBytes(32).toString("base64");
  return devFallbackAuthSecret;
}

function resolveAuthSecret(isProduction: boolean): string {
  const configuredSecret = readEnv("BETTER_AUTH_SECRET");

  if (configuredSecret && configuredSecret.length >= 32) {
    return configuredSecret;
  }

  if (isProduction) {
    if (!configuredSecret) {
      throw new Error("BETTER_AUTH_SECRET environment variable is required");
    }
    throw new Error(
      "BETTER_AUTH_SECRET must be at least 32 characters long in production",
    );
  }

  if (configuredSecret && configuredSecret.length < 32) {
    console.warn(
      "BETTER_AUTH_SECRET is shorter than 32 chars in development; using a secure in-memory fallback secret",
    );
  }

  return getDevFallbackAuthSecret();
}

const DEV_TRUSTED_ORIGINS = [
  "app://calibra-facil",
  "http://localhost:5173",
  "http://localhost:5174",
  "https://localhost:5173",
  "https://localhost:5174",
  "http://192.168.0.10:5173",
  "http://192.168.0.10:5174",
  "https://192.168.0.10:5173",
  "https://192.168.0.10:5174",
];

// Include wildcard preview hosts because Vercel preview domains are intentionally dynamic.
const PROD_TRUSTED_ORIGINS = [
  "app://calibra-facil",
  "https://calibrafacil.com",
  "https://www.calibrafacil.com",
  "https://portal.calibrafacil.com",
  "https://*.vercel.app",
];

function isIpv4Address(hostname: string): boolean {
  const parts = hostname.split(".");

  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }

    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isIpv4Address(hostname)) return false;

  const [first = -1, second = -1] = hostname
    .split(".")
    .map((segment) => Number(segment));

  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function normalizeDynamicTrustedOrigin(
  candidate: string | null,
  isProduction: boolean,
): string | null {
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();

    if (
      url.protocol !== "https:" &&
      (isProduction || url.protocol !== "http:")
    ) {
      return null;
    }

    if (isProduction) {
      if (
        hostname === "localhost" ||
        hostname.endsWith(".local") ||
        isPrivateIpv4(hostname)
      ) {
        return null;
      }
    }

    return url.origin;
  } catch {
    return null;
  }
}

function isVercelPreviewOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" && hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function createTrustedOrigins(
  isProduction: boolean,
): string[] | ((request?: Request) => Promise<string[]>) {
  const baseOrigins = isProduction ? PROD_TRUSTED_ORIGINS : DEV_TRUSTED_ORIGINS;

  return async (request?: Request) => {
    const origins = new Set(baseOrigins);
    const requestUrl = request ? new URL(request.url) : null;
    const issuerOrigin = normalizeDynamicTrustedOrigin(
      request?.headers.get("x-sso-issuer-origin") ?? null,
      isProduction,
    );

    const requestOrigin = normalizeDynamicTrustedOrigin(
      request?.headers.get("origin") ?? null,
      isProduction,
    );

    if (issuerOrigin) {
      origins.add(issuerOrigin);
    }

    if (
      requestOrigin &&
      (isVercelPreviewOrigin(requestOrigin) ||
        (await isActivePortalCustomOrigin(requestOrigin)))
    ) {
      origins.add(requestOrigin);
    }

    for (const callbackParam of [
      "callbackURL",
      "newUserCallbackURL",
      "errorCallbackURL",
    ]) {
      const callbackOrigin = normalizeDynamicTrustedOrigin(
        requestUrl?.searchParams.get(callbackParam) ?? null,
        isProduction,
      );

      if (
        callbackOrigin &&
        (isVercelPreviewOrigin(callbackOrigin) ||
          (await isActivePortalCustomOrigin(callbackOrigin)))
      ) {
        origins.add(callbackOrigin);
      }
    }

    return [...origins];
  };
}

async function isActivePortalCustomOrigin(origin: string): Promise<boolean> {
  try {
    const url = new URL(origin);
    const record = await getDb().query.organizationCustomDomain.findFirst({
      where: and(
        eq(
          schema.organizationCustomDomain.hostname,
          url.hostname.toLowerCase(),
        ),
        eq(schema.organizationCustomDomain.isActive, true),
      ),
    });

    if (!record?.organizationId || !record.verifiedAt) {
      return false;
    }

    const currentSubscription = await getDb().query.subscription.findFirst({
      where: eq(schema.subscription.organizationId, record.organizationId),
    });

    const planId = currentSubscription?.planId ?? "FREE";
    return hasEntitlement(planId, "custom_domain");
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeMailHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function readCallbackUrlFromMagicLinkContext(ctx: unknown): string | null {
  if (!ctx || typeof ctx !== "object" || !("body" in ctx)) return null;

  const body = (ctx as { body?: Record<string, unknown> }).body;
  const callbackURL = body?.callbackURL;

  return typeof callbackURL === "string" ? callbackURL : null;
}

function readInvitationIdFromCallbackUrl(
  callbackURL: string | null,
): string | null {
  if (!callbackURL) return null;

  try {
    const url = new URL(callbackURL);
    const token = url.searchParams.get("token")?.trim();

    if (url.pathname !== "/accept-invite" || !token) {
      return null;
    }

    return token;
  } catch {
    return null;
  }
}

async function findPendingPortalInvitation(
  email: string,
  invitationId?: string | null,
) {
  const conditions = [
    eq(schema.invitation.email, email),
    eq(schema.invitation.status, "pending"),
    gt(schema.invitation.expiresAt, new Date()),
    eq(schema.organization.type, "CLIENT"),
  ];

  if (invitationId) {
    conditions.push(eq(schema.invitation.id, invitationId));
  }

  const [pendingInvitation] = await getDb()
    .select({
      id: schema.invitation.id,
      email: schema.invitation.email,
      role: schema.invitation.role,
      organizationName: schema.organization.name,
    })
    .from(schema.invitation)
    .innerJoin(
      schema.organization,
      eq(schema.invitation.organizationId, schema.organization.id),
    )
    .where(and(...conditions))
    .limit(1);

  return pendingInvitation ?? null;
}

async function hasExistingPortalAccess(email: string): Promise<boolean> {
  const [existingPortalMember] = await getDb()
    .select({ id: schema.member.id })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .innerJoin(
      schema.organization,
      eq(schema.member.organizationId, schema.organization.id),
    )
    .where(
      and(
        eq(schema.user.email, email),
        eq(schema.organization.type, "CLIENT"),
        inArray(schema.member.role, PORTAL_ACCESS_ROLES),
      ),
    )
    .limit(1);

  return Boolean(existingPortalMember);
}

async function sendPortalMagicLink(
  data: { email: string; url: string },
  ctx?: unknown,
) {
  const normalizedEmail = data.email.trim().toLowerCase();
  const callbackURL = readCallbackUrlFromMagicLinkContext(ctx);
  const invitationId = readInvitationIdFromCallbackUrl(callbackURL);
  const pendingInvitation = await findPendingPortalInvitation(
    normalizedEmail,
    invitationId,
  );
  const hasPortalAccess =
    Boolean(pendingInvitation) ||
    (await hasExistingPortalAccess(normalizedEmail));

  if (!hasPortalAccess) {
    console.warn(
      `[Portal Auth] Suppressed magic link for non-portal email: ${normalizedEmail}`,
    );
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const subject = pendingInvitation
    ? sanitizeMailHeader(`Convite para ${pendingInvitation.organizationName}`)
    : "Acesse o Portal CalibraFacil";
  let magicLinkUrl = data.url;

  if (pendingInvitation && !invitationId && callbackURL) {
    try {
      const callbackOrigin = new URL(callbackURL).origin;
      const invitationCallbackURL = `${callbackOrigin}/accept-invite?token=${pendingInvitation.id}`;
      const url = new URL(data.url);
      url.searchParams.set("callbackURL", invitationCallbackURL);
      url.searchParams.set("newUserCallbackURL", invitationCallbackURL);
      magicLinkUrl = url.toString();
    } catch {
      magicLinkUrl = data.url;
    }
  }

  if (!apiKey) {
    if (isProductionRuntime()) {
      throw new Error("RESEND_API_KEY is required to send portal magic links");
    }

    console.info(
      `[Better Auth] Portal magic link for ${normalizedEmail}: ${magicLinkUrl}`,
    );
    return;
  }

  const resend = new Resend(apiKey);
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    "Calibra Facil <noreply@calibrafacil.com>";
  const escapedUrl = escapeHtml(magicLinkUrl);
  const escapedOrgName = pendingInvitation
    ? escapeHtml(pendingInvitation.organizationName)
    : null;

  await resend.emails.send({
    from: fromEmail,
    to: normalizedEmail,
    subject,
    html: pendingInvitation
      ? `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Acesse o portal do cliente</h2>
          <p>Voce recebeu um convite para acessar <strong>${escapedOrgName}</strong> no Calibra Facil.</p>
          <p>
            <a
              href="${escapedUrl}"
              style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:8px;"
            >
              Aceitar convite
            </a>
          </p>
          <p>Este link expira em poucos minutos. Se voce nao esperava este convite, ignore esta mensagem.</p>
          <p><small>Se o botao nao funcionar, copie e cole este link no navegador:</small><br />${escapedUrl}</p>
        </div>
      `
      : `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Acesse o Portal Calibra Facil</h2>
          <p>Use o link abaixo para entrar no portal do cliente.</p>
          <p>
            <a
              href="${escapedUrl}"
              style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:8px;"
            >
              Entrar no portal
            </a>
          </p>
          <p>Este link expira em poucos minutos. Se voce nao solicitou acesso, ignore esta mensagem.</p>
          <p><small>Se o botao nao funcionar, copie e cole este link no navegador:</small><br />${escapedUrl}</p>
        </div>
      `,
    text: pendingInvitation
      ? [
          `Convite para ${pendingInvitation.organizationName}`,
          "",
          "Use o link abaixo para aceitar o convite e acessar o portal:",
          magicLinkUrl,
          "",
          "Se voce nao esperava este convite, ignore esta mensagem.",
        ].join("\n")
      : [
          "Acesse o Portal Calibra Facil",
          "",
          "Use o link abaixo para entrar no portal:",
          magicLinkUrl,
          "",
          "Se voce nao solicitou acesso, ignore esta mensagem.",
        ].join("\n"),
  });
}

// Organization plugin configuration factory
function createOrganizationPlugin() {
  return organization({
    ac,
    roles,
    defaultMemberRole: "member" as any,
    creatorRole: "owner" as any,
    schema: {
      organization: {
        additionalFields: {
          type: {
            type: "string",
            defaultValue: "LAB",
            input: true,
          },
          // ISO 17025 / RBC compliance fields
          cnpj: { type: "string", input: true },
          accreditationNumber: { type: "string", input: true },
          accreditationBody: { type: "string", input: true },
          street: { type: "string", input: true },
          number: { type: "string", input: true },
          complement: { type: "string", input: true },
          neighbourhood: { type: "string", input: true },
          city: { type: "string", input: true },
          state: { type: "string", input: true },
          cep: { type: "string", input: true },
          phone: { type: "string", input: true },
          email: { type: "string", input: true },
          website: { type: "string", input: true },
          technicalManagerName: { type: "string", input: true },
          technicalManagerTitle: { type: "string", input: true },
        },
      },
    },
    organizationHooks: {
      beforeCreateOrganization: async ({ organization, user }) => {
        const requestedType = organization.type ?? "LAB";

        // 3B guardrail: CLIENT organizations are system-owned.
        // They must be created through server-side flows using the
        // configured service account (PORTAL_SERVICE_USER_ID).
        if (requestedType === "CLIENT") {
          const serviceUserId = process.env.PORTAL_SERVICE_USER_ID?.trim();

          if (!serviceUserId) {
            throw new APIError("BAD_REQUEST", {
              message: "PORTAL_SERVICE_USER_ID nao configurado",
            });
          }

          if (!user || user.id !== serviceUserId) {
            throw new APIError("FORBIDDEN", {
              message:
                "CLIENT organizations must be provisioned by the portal service account",
            });
          }
        }
      },
    },
    async sendInvitationEmail(data) {
      const appUrl = process.env.APP_URL || "http://localhost:5173";
      const inviteLink = `${appUrl}/accept-invitation/${data.id}`;
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        throw new Error("RESEND_API_KEY is not configured");
      }
      const resend = new Resend(apiKey);
      const fromEmail =
        process.env.RESEND_FROM_EMAIL ||
        process.env.EMAIL_FROM ||
        "Calibra Fácil <noreply@calibrafacil.com>";

      await resend.emails.send({
        from: fromEmail,
        to: data.email,
        subject: `Convite para ${data.organization.name}`,
        react: OrganizationInvitationEmail({
          invitedByUsername: data.inviter.user.name,
          invitedByEmail: data.inviter.user.email,
          organizationName: data.organization.name,
          inviteLink,
          role: data.role,
        }),
      });
    },
  });
}

// Shared configuration factory - reads env at call time, not module load time
function createSharedConfig() {
  const isProduction = isProductionRuntime();
  const configuredApiUrl = readEnv("API_URL");
  const crossSubDomainCookieDomain =
    getCookieDomainFromApiUrl(configuredApiUrl);
  const useCrossSubDomainCookies =
    isProduction && Boolean(crossSubDomainCookieDomain);
  const useSecureCookies =
    isProduction || configuredApiUrl?.startsWith("https://") === true;
  const authSecret = resolveAuthSecret(isProduction);
  const defaultSameSite: "lax" | "none" = useCrossSubDomainCookies
    ? "none"
    : "lax";
  const sessionCookieStrategy = "jwe" as const;

  return {
    secret: authSecret,
    database: drizzleAdapter(getDb(), {
      provider: "pg" as const,
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({
        user,
        url,
      }: {
        user: { email: string };
        url: string;
      }) => {
        const apiKey = process.env.RESEND_API_KEY;

        if (!apiKey) {
          if (isProduction) {
            throw new Error("RESEND_API_KEY is required to send reset emails");
          }

          console.info(
            `[Better Auth] Reset password link for ${user.email}: ${url}`,
          );
          return;
        }

        const resend = new Resend(apiKey);
        const fromEmail =
          process.env.RESEND_FROM_EMAIL ||
          process.env.EMAIL_FROM ||
          "Calibra Fácil <noreply@calibrafacil.com>";

        await resend.emails.send({
          from: fromEmail,
          to: user.email,
          subject: "Defina sua senha no CalibraFácil",
          html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
              <h2>Defina sua senha</h2>
              <p>Recebemos uma solicitação para definir ou redefinir a sua senha no CalibraFácil.</p>
              <p>
                <a
                  href="${url}"
                  style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:8px;"
                >
                  Definir senha
                </a>
              </p>
              <p>Se você não esperava este email, ignore esta mensagem.</p>
              <p><small>Se o botão não funcionar, copie e cole este link no navegador:</small><br />${url}</p>
            </div>
          `,
          text: [
            "Defina sua senha no CalibraFácil",
            "",
            "Use o link abaixo para definir ou redefinir sua senha:",
            url,
            "",
            "Se você não esperava este email, ignore esta mensagem.",
          ].join("\n"),
        });
      },
      resetPasswordTokenExpiresIn: 60 * 60,
    },
    user: {
      deleteUser: {
        enabled: true,
      },
    },
    trustedOrigins: createTrustedOrigins(isProduction),
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
        strategy: sessionCookieStrategy,
        refreshCache: false,
      },
    },
    advanced: {
      crossSubDomainCookies: useCrossSubDomainCookies
        ? {
            enabled: true,
            domain: crossSubDomainCookieDomain ?? ".calibrafacil.com",
          }
        : { enabled: false },
      defaultCookieAttributes: {
        sameSite: defaultSameSite,
        secure: useSecureCookies,
      },
    },
  };
}

async function findDefaultActiveOrganizationId(
  userId: string,
  organizationType: "CLIENT" | "LAB",
): Promise<string | null> {
  const [membership] = await getDb()
    .select({
      organizationId: schema.member.organizationId,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      eq(schema.member.organizationId, schema.organization.id),
    )
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.organization.type, organizationType),
      ),
    )
    .orderBy(asc(schema.member.createdAt))
    .limit(1);

  return membership?.organizationId ?? null;
}

/**
 * Factory function to create Lab Auth instance
 * Call this inside request handlers to ensure env vars are available
 */
export function createLabAuth() {
  const sharedConfig = createSharedConfig();
  const isProduction = isProductionRuntime();
  const baseURL = createBaseUrlConfig(isProduction);

  return betterAuth({
    ...sharedConfig,
    basePath: "/api/auth/lab",
    baseURL,
    databaseHooks: {
      session: {
        create: {
          async before(session: {
            activeOrganizationId?: string | null;
            userId: string;
          }) {
            if (session.activeOrganizationId) {
              return;
            }

            const activeOrganizationId = await findDefaultActiveOrganizationId(
              session.userId,
              "LAB",
            );

            if (!activeOrganizationId) {
              return;
            }

            return {
              data: {
                activeOrganizationId,
              },
            };
          },
        },
      },
    },
    advanced: {
      ...sharedConfig.advanced,
      cookiePrefix: "lab",
    },
    plugins: [
      adminPlugin({
        ac: platformAc,
        roles: platformRoles,
        defaultRole: "user",
      }),
      oneTimeToken({
        disableClientRequest: true,
        expiresIn: 3,
        storeToken: "hashed",
      }),
      createOrganizationPlugin(),
      sso({
        providersLimit: 1,
        disableImplicitSignUp: true,
        organizationProvisioning: {
          disabled: true,
        },
        domainVerification: {
          enabled: true,
        },
      }),
    ],
  });
}

/**
 * Factory function to create Backoffice Auth instance
 * Call this inside request handlers to ensure env vars are available
 */
export function createBackofficeAuth() {
  const sharedConfig = createSharedConfig();
  const isProduction = isProductionRuntime();
  const baseURL = createBaseUrlConfig(isProduction);

  return betterAuth({
    ...sharedConfig,
    basePath: "/api/auth/backoffice",
    baseURL,
    advanced: {
      ...sharedConfig.advanced,
      cookiePrefix: "backoffice",
    },
    plugins: [
      adminPlugin({
        ac: platformAc,
        roles: platformRoles,
        defaultRole: "user",
      }),
      oneTimeToken({
        disableClientRequest: true,
        expiresIn: 3,
        storeToken: "hashed",
      }),
    ],
  });
}

/**
 * Factory function to create Portal Auth instance
 * Call this inside request handlers to ensure env vars are available
 */
export function createPortalAuth() {
  const sharedConfig = createSharedConfig();
  const isProduction = isProductionRuntime();
  const baseURL = createBaseUrlConfig(isProduction);

  return betterAuth({
    ...sharedConfig,
    basePath: "/api/auth/portal",
    baseURL,
    emailAndPassword: {
      enabled: false,
    },
    databaseHooks: {
      session: {
        create: {
          async before(session: {
            activeOrganizationId?: string | null;
            userId: string;
          }) {
            if (session.activeOrganizationId) {
              return;
            }

            const activeOrganizationId = await findDefaultActiveOrganizationId(
              session.userId,
              "CLIENT",
            );

            if (!activeOrganizationId) {
              return;
            }

            return {
              data: {
                activeOrganizationId,
              },
            };
          },
        },
      },
    },
    advanced: {
      ...sharedConfig.advanced,
      cookiePrefix: "portal",
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 10,
        sendMagicLink: sendPortalMagicLink,
        storeToken: "hashed",
        rateLimit: {
          window: 60,
          max: 5,
        },
      }),
      createOrganizationPlugin(),
    ],
  });
}

// For backwards compatibility in non-Worker environments (like local dev with Bun)
// These are lazily initialized on first use
let _labAuth: ReturnType<typeof createLabAuth> | null = null;
let _backofficeAuth: ReturnType<typeof createBackofficeAuth> | null = null;
let _portalAuth: ReturnType<typeof createPortalAuth> | null = null;

export function getLabAuth() {
  if (!_labAuth) {
    _labAuth = createLabAuth();
  }
  return _labAuth;
}

export function getBackofficeAuth() {
  if (!_backofficeAuth) {
    _backofficeAuth = createBackofficeAuth();
  }
  return _backofficeAuth;
}

export function getPortalAuth() {
  if (!_portalAuth) {
    _portalAuth = createPortalAuth();
  }
  return _portalAuth;
}

// Type definitions for auth instances with organization plugin
export type LabAuth = ReturnType<typeof createLabAuth>;
export type BackofficeAuth = ReturnType<typeof createBackofficeAuth>;
export type PortalAuth = ReturnType<typeof createPortalAuth>;

// Legacy exports for backwards compatibility (lazy getters)
export const labAuth = {
  get api() {
    return getLabAuth().api;
  },
  get handler() {
    return getLabAuth().handler;
  },
} as Pick<LabAuth, "api" | "handler">;

export const backofficeAuth = {
  get api() {
    return getBackofficeAuth().api;
  },
  get handler() {
    return getBackofficeAuth().handler;
  },
} as Pick<BackofficeAuth, "api" | "handler">;

export const portalAuth = {
  get api() {
    return getPortalAuth().api;
  },
  get handler() {
    return getPortalAuth().handler;
  },
} as Pick<PortalAuth, "api" | "handler">;

export const auth = labAuth;

export type Auth = LabAuth;
export type Session = Auth["$Infer"]["Session"];
