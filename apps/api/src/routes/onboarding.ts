import { Hono } from "hono";

import {
  requireLabProtected,
  requireOrgType,
  type AuthVariables,
} from "../middleware/permission";
import { getActivationChecklist } from "../services/activation-checklist";

/**
 * What a laboratory still has to do before it can issue its first certificate.
 *
 * Read-only and derived on every call, so two people onboarding the same
 * laboratory always see the same answer and a step that stops being true stops
 * being ticked. Deliberately its own endpoint rather than fields on the session:
 * Better Auth's custom session data bypasses the cookie cache and would run
 * these existence checks on every route transition, for every user, forever.
 */
export const onboardingRouter = new Hono<{ Variables: AuthVariables }>().get(
  "/checklist",
  ...requireLabProtected,
  requireOrgType("LAB"),
  async (c) => {
    const member = c.get("member");

    return c.json(await getActivationChecklist(member.organizationId));
  },
);
