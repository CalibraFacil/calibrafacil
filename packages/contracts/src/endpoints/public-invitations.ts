import { z } from "zod";

import { nullableString } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The public side of a laboratory invitation: the not-yet-signed-up invitee
 * reads it and asks for the access-setup link. Unauthenticated. Response
 * schemas are the wire bodies of `apps/api/src/domains/org/routes/invitations.ts`.
 * Cloud-only.
 */

/** GET /api/invitations/:id: only what the accept page needs. */
export const publicInvitationResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: nullableString,
  status: z.string(),
  expiresAt: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  organizationSlug: z.string(),
  inviterEmail: z.string(),
});
export type PublicInvitationResponse = z.infer<
  typeof publicInvitationResponseSchema
>;

const DESKTOP_LABEL = "Convites";

export const publicInvitationEndpoints = {
  get: endpoint({
    method: "get",
    path: "/api/invitations/:id",
    response: publicInvitationResponseSchema,
    failure: "Falha ao carregar o convite",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  requestSetupLink: endpoint({
    method: "post",
    path: "/api/invitations/:id/request-setup-link",
    response: z.object({
      setupLinkRequested: z.literal(true),
      userCreated: z.boolean(),
    }),
    failure: "Falha ao enviar link de acesso",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
