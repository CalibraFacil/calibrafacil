import { Hono } from "hono";

import { revokeOwnSession } from "../lib/identity";
import { requireLabAuth, type AuthVariables } from "../middleware/permission";

export const sessionsRouter = new Hono<{ Variables: AuthVariables }>().post(
  "/revoke",
  requireLabAuth,
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
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
      return c.json({ error: "sessionId is required" }, 400);
    }

    const currentSession = c.get("session");
    const userId = currentSession.user.id;

    if (!(await revokeOwnSession(userId, sessionId))) {
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json({ status: true });
  },
);
