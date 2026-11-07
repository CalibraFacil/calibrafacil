import { createRouter } from "../../../server/router";
import { sessionEndpoints } from "@calibra-facil/contracts";

import { notFound } from "../../../lib/domain-errors";
import { mount } from "../../../lib/endpoint-mount";
import { revokeOwnSession } from "../../../lib/identity";
import {
  requireLabAuth,
  type AuthVariables,
} from "../../../middleware/permission";

export const sessionsRouter = createRouter<{ Variables: AuthVariables }>();

mount(
  sessionsRouter,
  "/api/sessions",
  sessionEndpoints.revoke,
  [requireLabAuth],
  async (c, { body }) => {
    const currentSession = c.get("session");
    const userId = currentSession.user.id;

    if (!(await revokeOwnSession(userId, body.sessionId))) {
      throw notFound("session_not_found", "Session not found");
    }

    return { status: true as const };
  },
);
