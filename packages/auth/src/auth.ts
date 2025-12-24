import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@calibra-facil/db";
import * as schema from "@calibra-facil/db/schema";
import { organization } from "better-auth/plugins";
import { Resend } from "resend";
import { OrganizationInvitationEmail } from "@calibra-facil/email";
import { ac, roles } from "./access";

const resend = new Resend(process.env.RESEND_API_KEY);

export const auth = betterAuth({
  baseURL: process.env.API_URL || "https://localhost:3000",
  database: drizzleAdapter(db, {
    provider: "pg",
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
  plugins: [
    organization({
      ac,
      roles,
      // New members get read-only access by default
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      defaultMemberRole: "member" as any,
      // Organization creator gets full control
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      creatorRole: "owner" as any,
      // Add type field to distinguish LAB vs CLIENT organizations
      schema: {
        organization: {
          additionalFields: {
            type: {
              type: "string",
              defaultValue: "LAB",
              input: false,
            },
          },
        },
      },
      async sendInvitationEmail(data) {
        const appUrl = process.env.APP_URL || "https://localhost:5173";
        const inviteLink = `${appUrl}/accept-invitation/${data.id}`;

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
    }),
  ],
  trustedOrigins:
    process.env.NODE_ENV === "production"
      ? [
          process.env.APP_URL,
          process.env.PORTAL_URL,
        ].filter((url): url is string => Boolean(url))
      : [
          "https://localhost:5173",
          "https://localhost:5174",
          "https://192.168.0.10:5173",
          "https://192.168.0.10:5174",
        ],
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none" as const,
      secure: true,
    },
  },
});

export type Auth = ReturnType<typeof betterAuth>;
export type Session = Auth["$Infer"]["Session"];
