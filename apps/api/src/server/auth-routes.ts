import type { Context, Hono } from "hono";
import { createLabAuth, createPortalAuth } from "@calibra-facil/auth";
import { isAllowedAuthRoute, type AuthSurface } from "./auth-route-allowlist";
import { getCorsOrigin } from "./cors";
import type { Env } from "./env";

function withCors(c: Context<{ Bindings: Env }>, res: Response) {
  return (async () => {
    const origin = await getCorsOrigin(c.req.header("Origin"));
    if (!origin) return res;

    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.append("Vary", "Origin");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  })();
}

/**
 * Forward a request to a Better Auth instance only when the surface exposes that
 * endpoint (`auth-route-allowlist.ts`); everything else is a 404 and never reaches
 * Better Auth. The path is read from the same parsed URL Better Auth routes on.
 */
async function handleAuthRequest(
  c: Context<{ Bindings: Env }>,
  surface: AuthSurface,
  handle: (request: Request) => Promise<Response>,
) {
  const prefix = `/api/auth/${surface}`;
  const { pathname } = new URL(c.req.raw.url);
  const subPath = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length)
    : "";

  if (!isAllowedAuthRoute(surface, c.req.method, subPath)) {
    return await withCors(
      c,
      c.json({ error: "Not found", code: "auth_route_not_found" }, 404),
    );
  }

  return await withCors(c, await handle(c.req.raw));
}

export function mountAuthRoutes(app: Hono<{ Bindings: Env }>) {
  app.on(["GET", "POST"], "/api/auth/lab/*", (c) =>
    handleAuthRequest(c, "lab", (request) => createLabAuth().handler(request)),
  );

  app.on(["GET", "POST"], "/api/auth/portal/*", (c) =>
    handleAuthRequest(c, "portal", (request) =>
      createPortalAuth().handler(request),
    ),
  );
}
