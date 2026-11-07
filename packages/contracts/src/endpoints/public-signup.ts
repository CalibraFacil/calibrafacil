import { z } from "zod";
import { SelfServeSignupSchema } from "@calibra-facil/schemas";

import { endpoint, type EndpointGroup } from "./define";

/**
 * Public, unauthenticated self-serve sign-up of a laboratory. Called before
 * any session exists, so it carries no identity: the API answers that a claim
 * e-mail is on its way. The response schema is the wire body of
 * `apps/api/src/domains/org/routes/public-signup.ts`. Cloud-only.
 */

/**
 * The 200 of a sign-up, and the 202 when the account exists but the setup
 * e-mail could not be sent (`emailDelivered: false`, with `error` and `code`).
 */
export const selfServeSignupResponseSchema = z.object({
  ok: z.literal(true),
  email: z.string().optional(),
  /** False when the account exists but the setup e-mail could not be sent. */
  emailDelivered: z.boolean().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
});
export type SelfServeSignupResponse = z.infer<
  typeof selfServeSignupResponseSchema
>;

export const publicSignupEndpoints = {
  // The 202 answer is the handler's own Response: a status the definition (200)
  // does not describe.
  start: endpoint({
    method: "post",
    path: "/api/public/signup",
    body: SelfServeSignupSchema,
    response: selfServeSignupResponseSchema,
    failure: "Falha ao criar a conta",
    policy: "cloud-only",
    desktopLabel: "Cadastro de laboratório",
  }),
} as const satisfies EndpointGroup;
