import type { Context, Hono } from "hono";
import {
  createBackofficeAuth,
  createLabAuth,
  createPortalAuth,
} from "@calibra-facil/auth";
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

export function mountAuthRoutes(app: Hono<{ Bindings: Env }>) {
  app.on(["GET", "POST"], "/api/auth/lab/*", async (c) => {
    const labAuth = createLabAuth();
    const res = await labAuth.handler(c.req.raw);
    return await withCors(c, res);
  });

  app.on(["GET", "POST"], "/api/auth/backoffice/*", async (c) => {
    const backofficeAuth = createBackofficeAuth();
    const res = await backofficeAuth.handler(c.req.raw);
    return await withCors(c, res);
  });

  app.on(["GET", "POST"], "/api/auth/portal/*", async (c) => {
    const portalAuth = createPortalAuth();
    const res = await portalAuth.handler(c.req.raw);
    return await withCors(c, res);
  });
}
