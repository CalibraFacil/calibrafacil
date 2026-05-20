import { Hono } from "hono";
import {
  getCommercialPublicCheckout,
  getCommercialPublicCheckoutStatus,
  getPublicRequestMeta,
  startCommercialPublicCheckout,
} from "../services/commercial/public-checkout";

function resolvePublicAppUrl(c: { env?: unknown }) {
  const configured =
    (c.env as Record<string, unknown> | undefined)?.APP_URL ??
    process.env.APP_URL;

  return typeof configured === "string" && configured.trim().length > 0
    ? configured.trim().replace(/\/$/, "")
    : "https://calibrafacil.com";
}

function withPublicCheckoutHeaders(c: {
  header(name: string, value: string): void;
}) {
  c.header("Cache-Control", "private, no-store, max-age=0");
  c.header("Pragma", "no-cache");
  c.header("X-Robots-Tag", "noindex, nofollow");
}

function mapStartError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message === "INVALID_TOKEN") {
    return {
      status: 404 as const,
      body: { error: "Link de checkout inválido", state: "INVALID" as const },
    };
  }

  if (message.startsWith("TERMINAL_")) {
    return {
      status: 409 as const,
      body: {
        error: "A oferta não pode mais iniciar pagamento",
        state: message.replace("TERMINAL_", "") as
          | "REVOKED"
          | "EXPIRED"
          | "CANCELED"
          | "OVERDUE"
          | "REFUNDED",
      },
    };
  }

  return {
    status: 500 as const,
    body: { error: "Falha ao iniciar o checkout público" },
  };
}

export const publicCommercialCheckoutRouter = new Hono()
  .use("*", async (c, next) => {
    await next();
    withPublicCheckoutHeaders(c);
  })
  .get("/:token", async (c) => {
    const payload = await getCommercialPublicCheckout(
      c.req.param("token"),
      getPublicRequestMeta(c.req.raw),
    );

    return c.json(payload);
  })
  .post("/:token/start", async (c) => {
    try {
      const payload = await startCommercialPublicCheckout({
        token: c.req.param("token"),
        publicAppUrl: resolvePublicAppUrl(c),
        meta: getPublicRequestMeta(c.req.raw),
      });

      return c.json(payload);
    } catch (error) {
      console.error("Public commercial checkout start failed", error);
      const mapped = mapStartError(error);
      return c.json(mapped.body, mapped.status);
    }
  })
  .get("/:token/status", async (c) => {
    const payload = await getCommercialPublicCheckoutStatus(
      c.req.param("token"),
      getPublicRequestMeta(c.req.raw),
    );

    if (payload.state === "INVALID") {
      return c.json(
        { error: "Link de checkout inválido", state: "INVALID" },
        404,
      );
    }

    return c.json(payload);
  });
