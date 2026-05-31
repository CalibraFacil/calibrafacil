import type { Hono } from "hono";
import type { Env } from "./env";

export function applySecurityHeaders(app: Hono<{ Bindings: Env }>) {
  app.use("*", async (c, next) => {
    await next();

    const requestPath = new URL(c.req.url).pathname;
    const isPublicApiReference = requestPath === "/api/public/v2/reference";
    const isPublicApiOpenApi = requestPath === "/api/public/v2/openapi";
    const isPublicApiDocs = isPublicApiReference || isPublicApiOpenApi;

    if ((c.env.NODE_ENV ?? "").toLowerCase() === "production") {
      c.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload",
      );
    }

    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Permissions-Policy",
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    );

    if (isPublicApiDocs) {
      c.header("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
      c.header("Cache-Control", "private, no-store, max-age=0");
    }

    if (isPublicApiReference) {
      c.header(
        "Content-Security-Policy",
        [
          "default-src 'self' https: data: blob:",
          "script-src 'self' 'unsafe-inline' https:",
          "style-src 'self' 'unsafe-inline' https:",
          "img-src 'self' data: https:",
          "font-src 'self' data: https:",
          "connect-src 'self' https:",
          "frame-ancestors 'none'",
          "base-uri 'self'",
        ].join("; "),
      );
    } else {
      c.header(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
    }
  });
}
