import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@calibra-facil/db";
import * as schema from "@calibra-facil/db/schema";
import { organization } from "better-auth/plugins";
import { Resend } from "resend";
import { OrganizationInvitationEmail } from "@calibra-facil/email";
import { ac, roles } from "./access";

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
        },
      },
    },
    async sendInvitationEmail(data) {
      const appUrl = process.env.APP_URL || "https://localhost:5173";
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

  return {
    secret: process.env.BETTER_AUTH_SECRET || "BUILD_PLACEHOLDER_NOT_FOR_PRODUCTION",
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
    trustedOrigins: isProduction
      ? [
        "https://calibrafacil.com",
        "https://portal.calibrafacil.com",
      ]
      : [
        "https://localhost:5173",
        "https://localhost:5174",
        "https://192.168.0.10:5173",
        "https://192.168.0.10:5174",
      ],
    advanced: {
      crossSubDomainCookies: isProduction
        ? {
          enabled: true,
          domain: ".calibrafacil.com",
        }
        : { enabled: false },
      defaultCookieAttributes: {
        sameSite: "none" as const,
        secure: true,
      },
    },
  };
}

/**
 * Factory function to create Lab Auth instance
 * Call this inside request handlers to ensure env vars are available
 */
export function createLabAuth() {
  const sharedConfig = createSharedConfig();
  return betterAuth({
    ...sharedConfig,
    basePath: "/api/auth/lab",
    baseURL:
      process.env.NODE_ENV === "production"
        ? process.env.API_URL!
        : "https://localhost:3000",
    advanced: {
      ...sharedConfig.advanced,
      cookiePrefix: "lab",
    },
    plugins: [createOrganizationPlugin()],
  });
}

/**
 * Factory function to create Portal Auth instance
 * Call this inside request handlers to ensure env vars are available
 */
export function createPortalAuth() {
  const sharedConfig = createSharedConfig();
  return betterAuth({
    ...sharedConfig,
    basePath: "/api/auth/portal",
    baseURL:
      process.env.NODE_ENV === "production"
        ? process.env.API_URL!
        : "https://localhost:3000",
    advanced: {
      ...sharedConfig.advanced,
      cookiePrefix: "portal",
    },
    plugins: [createOrganizationPlugin()],
  });
}

// For backwards compatibility in non-Worker environments (like local dev with Bun)
// These are lazily initialized on first use
let _labAuth: ReturnType<typeof betterAuth> | null = null;
let _portalAuth: ReturnType<typeof betterAuth> | null = null;

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

// Legacy exports for backwards compatibility (lazy getters)
export const labAuth = {
  get api() { return getLabAuth().api; },
  get handler() { return getLabAuth().handler; },
};

export const portalAuth = {
  get api() { return getPortalAuth().api; },
  get handler() { return getPortalAuth().handler; },
};

export const auth = labAuth;

export type Auth = ReturnType<typeof betterAuth>;
export type Session = Auth["$Infer"]["Session"];
