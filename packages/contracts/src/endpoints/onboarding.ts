import { z } from "zod";

import { endpoint, type EndpointGroup } from "./define";

/**
 * What a laboratory still has to do before its first certificate: derived from
 * live domain state on every call. The response schema is the wire body of
 * `apps/api/src/domains/org/routes/onboarding.ts`. Cloud-only: the desktop is reached by a
 * laboratory that already has an account.
 */

const ACTIVATION_STEP_IDS = [
  "organizationProfile",
  "methodPublished",
  "referenceStandard",
  "signingCertificate",
  "customer",
  "firstCertificate",
] as const;
export type ActivationStepId = (typeof ACTIVATION_STEP_IDS)[number];

/** GET /api/onboarding/checklist */
export const activationChecklistResponseSchema = z.object({
  steps: z.array(
    z.object({ id: z.enum(ACTIVATION_STEP_IDS), done: z.boolean() }),
  ),
  /** True once every step is done, including the first issued certificate. */
  complete: z.boolean(),
});
export type ActivationChecklistResponse = z.infer<
  typeof activationChecklistResponseSchema
>;

export const onboardingEndpoints = {
  getChecklist: endpoint({
    method: "get",
    path: "/api/onboarding/checklist",
    response: activationChecklistResponseSchema,
    failure: "Erro ao carregar a configuração inicial",
    policy: "cloud-only",
    desktopLabel: "Configuração inicial",
  }),
} as const satisfies EndpointGroup;
