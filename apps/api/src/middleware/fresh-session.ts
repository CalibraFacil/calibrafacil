import { createLabAuth } from "@calibra-facil/auth";
import { systemDb } from "@calibra-facil/db";
import { user } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AuthVariables } from "./permission";

/**
 * Re-validates the session against the database before a sensitive action
 * (roadmap 2 D3, review 3.3): approving a calibration, managing the signing
 * credentials, managing API keys.
 *
 * Routine requests are served from Better Auth's signed cookie cache (up to five
 * minutes old), so a session revoked a moment ago, or a user banned since, would
 * still pass `requireLabAuth`. Here the session is read without the cache (it must
 * still exist and be the same one) and the user's `banned` flag is read from the
 * user row. Placed after the permission middleware, which set `session`.
 */
export const requireFreshSession = createMiddleware<{
  Variables: AuthVariables;
}>(async (c, next) => {
  const current = c.get("session");
  const fresh = await createLabAuth().api.getSession({
    headers: c.req.raw.headers,
    query: { disableCookieCache: true },
  });
  if (!fresh || fresh.session.id !== current.session.id) {
    throw new HTTPException(401, {
      message: "Sessão encerrada: entre novamente",
    });
  }

  // System path (identity, not a tenant table): the person's own account row.
  const [account] = await systemDb
    .select({ banned: user.banned, banExpires: user.banExpires })
    .from(user)
    .where(eq(user.id, current.user.id))
    .limit(1);
  if (!account || isBanned(account, new Date())) {
    throw new HTTPException(401, {
      message: "Sessão encerrada: entre novamente",
    });
  }

  await next();
});

export function isBanned(
  account: { banned: boolean; banExpires: Date | null },
  now: Date,
): boolean {
  if (!account.banned) return false;
  return account.banExpires === null || account.banExpires > now;
}
