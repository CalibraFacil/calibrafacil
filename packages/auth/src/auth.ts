import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { randomBytes } from "node:crypto";
import { getDb } from "@calibra-facil/db";
import * as schema from "@calibra-facil/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { organization } from "better-auth/plugins";
import { sso } from "@better-auth/sso";
import { Resend } from "resend";
import { OrganizationInvitationEmail } from "@calibra-facil/email";
import { hasEntitlement } from "@calibra-facil/shared";
import { ac, roles } from "./access";

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
  "http://localhost:5173",
  "http://localhost:5174",
  "https://localhost:5173",
  "https://localhost:5174",
  "http://192.168.0.10:5173",
  "http://192.168.0.10:5174",
  "https://192.168.0.10:5173",
  "https://192.168.0.10:5174",
];

const PROD_TRUSTED_ORIGINS = [
  "https://calibrafacil.com",
  "https://portal.calibrafacil.com",
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

function createTrustedOrigins(
  isProduction: boolean,
): string[] | ((request?: Request) => Promise<string[]>) {
  const baseOrigins = isProduction ? PROD_TRUSTED_ORIGINS : DEV_TRUSTED_ORIGINS;

  return async (request?: Request) => {
    const origins = new Set(baseOrigins);
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

    if (requestOrigin && (await isActivePortalCustomOrigin(requestOrigin))) {
      origins.add(requestOrigin);
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

      await resend.emails.send({
        from:
          process.env.EMAIL_FROM || "Calibra Fácil <noreply@calibrafacil.com>",
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
  const isProduction = process.env.NODE_ENV === "production";
  const authSecret = resolveAuthSecret(isProduction);
  const defaultSameSite: "lax" | "none" = isProduction ? "none" : "lax";
  const sessionCookieStrategy: "jwe" = "jwe";

  return {
    secret: authSecret,
    database: drizzleAdapter(getDb(), {
      provider: "pg" as const,
      schema,
    }),
    emailAndPassword: {
      enabled: true,
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
      crossSubDomainCookies: isProduction
        ? {
            enabled: true,
            domain: ".calibrafacil.com",
          }
        : { enabled: false },
      defaultCookieAttributes: {
        sameSite: defaultSameSite,
        secure: isProduction,
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
  const baseURL =
    process.env.NODE_ENV === "production"
      ? getRequiredEnv("API_URL")
      : "http://localhost:3000";

  return betterAuth({
    ...sharedConfig,
    basePath: "/api/auth/lab",
    baseURL,
    databaseHooks: {
      session: {
        create: {
          async before(session) {
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
 * Factory function to create Portal Auth instance
 * Call this inside request handlers to ensure env vars are available
 */
export function createPortalAuth() {
  const sharedConfig = createSharedConfig();
  const baseURL =
    process.env.NODE_ENV === "production"
      ? getRequiredEnv("API_URL")
      : "http://localhost:3000";

  return betterAuth({
    ...sharedConfig,
    basePath: "/api/auth/portal",
    baseURL,
    databaseHooks: {
      session: {
        create: {
          async before(session) {
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
    plugins: [createOrganizationPlugin()],
  });
}

// For backwards compatibility in non-Worker environments (like local dev with Bun)
// These are lazily initialized on first use
let _labAuth: ReturnType<typeof createLabAuth> | null = null;
let _portalAuth: ReturnType<typeof createPortalAuth> | null = null;

export function getLabAuth() {
  if (!_labAuth) {
    _labAuth = createLabAuth();
  }
  return _labAuth;
}

export function getPortalAuth() {
  if (!_portalAuth) {
    _portalAuth = createPortalAuth();
  }
  return _portalAuth;
}

// Type definitions for auth instances with organization plugin
export type LabAuth = ReturnType<typeof createLabAuth>;
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
