import { z } from "zod";

import { endpoint, type EndpointGroup } from "./define";

/**
 * The first-access (claim) flow of a laboratory account: the setup token the
 * invitation e-mail carries. Public, authenticated by the token alone. Response
 * schemas are the wire bodies of `apps/api/src/routes/lab-setup.ts`. Cloud-only.
 *
 * A refused token answers 400, 404 or 410 with the metadata body (`status`
 * says why): the SDK's `get` hands that body back instead of throwing
 * (`client-runtime/src/modules/lab-setup.ts`).
 */

const LAB_SETUP_STATUSES = [
  "ready",
  "invalid",
  "expired",
  "consumed",
  "user_invalid",
  "email_mismatch",
  "organization_invalid",
  "membership_missing",
  "invitation_invalid",
] as const;

/** GET /api/lab-setup/:token: what the token is good for. */
export const labSetupMetadataSchema = z.object({
  status: z.enum(LAB_SETUP_STATUSES),
  email: z.string().optional(),
  organizationName: z.string().optional(),
  organizationSlug: z.string().optional(),
  expiresAt: z.string().optional(),
  passkeyPreferred: z.literal(true),
  fallbackMethods: z.array(z.enum(["magic_link", "email_otp"])),
});
export type LabSetupMetadata = z.infer<typeof labSetupMetadataSchema>;

const DESKTOP_LABEL = "Configuração de acesso";

export const labSetupEndpoints = {
  get: endpoint({
    method: "get",
    path: "/api/lab-setup/:token",
    response: labSetupMetadataSchema,
    failure: "Falha ao carregar configuração de acesso",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  requestMagicLink: endpoint({
    method: "post",
    path: "/api/lab-setup/:token/request-magic-link",
    response: z.object({ magicLinkRequested: z.literal(true) }),
    failure: "Falha ao enviar link mágico",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  requestOtp: endpoint({
    method: "post",
    path: "/api/lab-setup/:token/request-otp",
    response: z.object({ otpRequested: z.literal(true) }),
    failure: "Falha ao enviar código",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  complete: endpoint({
    method: "post",
    path: "/api/lab-setup/:token/complete",
    response: z.object({
      claimed: z.literal(true),
      organizationId: z.string(),
      needsOnboarding: z.boolean(),
    }),
    failure: "Falha ao concluir acesso",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
