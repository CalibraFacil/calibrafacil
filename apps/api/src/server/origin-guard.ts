import type { Context, Hono } from "hono";
import { getCorsOrigin } from "./cors";
import type { Env } from "./env";

/**
 * Cross-site request defence for the API's own routes (roadmap 2 D1, review 3.3).
 *
 * A state-changing request (anything but GET/HEAD/OPTIONS) that carries the
 * browser's ambient credentials (a cookie) must come from a page of an allowed
 * origin: the same origin as the API (a custom portal domain serves the API under
 * its own /api), or one of the configured app/portal origins. The browser always
 * sends `Origin` on such a request; when it does not (an older browser), the
 * Fetch Metadata header `Sec-Fetch-Site` must say same-origin, or the request was
 * not made by a page at all ("none": typed URL, bookmark).
 *
 * Requests that authenticate with a header the browser never attaches on its own
 * (`Authorization`, `x-api-key`) and requests without a cookie are not CSRF
 * candidates and pass through: integrations, the desktop shell's bearer calls,
 * webhooks and the public endpoints keep working.
 */
export function applyOriginGuard(app: Hono<{ Bindings: Env }>) {
  app.use("/api/*", async (c, next) => {
    if (await crossSiteRequestRefused(c)) {
      return c.json(
        {
          error: "Esta requisição não veio de uma página do Calibra Fácil.",
          code: "CROSS_SITE_REQUEST_BLOCKED",
        },
        403,
      );
    }
    await next();
  });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function crossSiteRequestRefused(
  c: Context<{ Bindings: Env }>,
): Promise<boolean> {
  if (SAFE_METHODS.has(c.req.method)) return false;
  if (!c.req.header("cookie")) return false;
  if (c.req.header("authorization") || c.req.header("x-api-key")) return false;

  const origin = c.req.header("origin");
  if (origin !== undefined) {
    if (origin === "null") return true;
    if (sameOriginAsRequest(origin, c.req.header("host"))) return false;
    return (await getCorsOrigin(origin, c.env)) === undefined;
  }

  const site = c.req.header("sec-fetch-site");
  return site !== undefined && site !== "same-origin" && site !== "none";
}

function sameOriginAsRequest(origin: string, host: string | undefined) {
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
