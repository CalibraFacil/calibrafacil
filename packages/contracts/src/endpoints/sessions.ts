import { z } from "zod";

import { endpoint, type EndpointGroup } from "./define";

/**
 * The signed-in user's own sessions. The response schema is the wire body of
 * `apps/api/src/domains/org/routes/sessions.ts`. Cloud-only.
 */

export const RevokeSessionSchema = z.object({
  sessionId: z.string().trim().min(1, "sessionId is required"),
});

export const sessionEndpoints = {
  revoke: endpoint({
    method: "post",
    path: "/api/sessions/revoke",
    body: RevokeSessionSchema,
    response: z.object({ status: z.literal(true) }),
    failure: "Falha ao encerrar sessao",
    policy: "cloud-only",
    desktopLabel: "Gerenciamento de sessoes",
  }),
} as const satisfies EndpointGroup;
