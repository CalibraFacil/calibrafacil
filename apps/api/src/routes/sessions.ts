import { createRouter } from "../server/router";

import { invalid, notFound } from "../lib/domain-errors";
import { revokeOwnSession } from "../lib/identity";
import { requireLabAuth, type AuthVariables } from "../middleware/permission";

export const sessionsRouter = createRouter<{ Variables: AuthVariables }>().post(
  "/revoke",
  requireLabAuth,
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw invalid("invalid_request", "Invalid JSON body");
    }

    const bodyRecord =
      body && typeof body === "object" && !Array.isArray(body)
        ? Object.fromEntries(Object.entries(body))
        : {};
    const sessionId =
      typeof bodyRecord.sessionId === "string"
        ? bodyRecord.sessionId.trim()
        : "";

    if (!sessionId) {
      throw invalid("invalid_request", "sessionId is required");
    }

    const currentSession = c.get("session");
    const userId = currentSession.user.id;

    if (!(await revokeOwnSession(userId, sessionId))) {
      throw notFound("session_not_found", "Session not found");
    }

    return c.json({ status: true });
  },
);
