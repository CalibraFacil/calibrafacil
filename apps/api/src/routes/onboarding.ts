import { createRouter } from "../server/router";
import { onboardingEndpoints } from "@calibra-facil/contracts";

import {
  requireLabProtected,
  requireOrgType,
  type AuthVariables,
} from "../middleware/permission";
import { getActivationChecklist } from "../services/activation-checklist";
import { mount } from "../lib/endpoint-mount";

/**
 * What a laboratory still has to do before it can issue its first certificate.
 *
 * Read-only and derived on every call, so two people onboarding the same
 * laboratory always see the same answer and a step that stops being true stops
 * being ticked. Deliberately its own endpoint rather than fields on the session:
 * Better Auth's custom session data bypasses the cookie cache and would run
 * these existence checks on every route transition, for every user, forever.
 */
const PREFIX = "/api/onboarding";

export const onboardingRouter = createRouter<{
  Variables: AuthVariables;
}>();

mount(
  onboardingRouter,
  PREFIX,
  onboardingEndpoints.getChecklist,
  [...requireLabProtected, requireOrgType("LAB")],
  async (c) => {
    const member = c.get("member");

    return await getActivationChecklist(member.organizationId);
  },
);
