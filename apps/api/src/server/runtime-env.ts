import { setProcessEnv } from "@calibra-facil/config";
import type { Hono } from "hono";
import type { Env } from "./env";

export function applyRuntimeEnv(app: Hono<{ Bindings: Env }>) {
  app.use("*", async (c, next) => {
    for (const [key, value] of Object.entries(c.env)) {
      if (typeof value === "string") {
        setProcessEnv(key, value);
      }
    }

    await next();
  });
}
