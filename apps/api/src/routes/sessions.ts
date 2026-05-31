import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { session as sessionTable } from "@calibra-facil/db/schema";

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

    const [targetSession] = await db
      .select({
        id: sessionTable.id,
        token: sessionTable.token,
        userId: sessionTable.userId,
      })
      .from(sessionTable)
      .where(eq(sessionTable.id, sessionId))
      .limit(1);

    if (!targetSession || targetSession.userId !== userId) {
      return c.json({ error: "Session not found" }, 404);
    }

    await db.delete(sessionTable).where(eq(sessionTable.id, targetSession.id));

    return c.json({ status: true });
  },
);
