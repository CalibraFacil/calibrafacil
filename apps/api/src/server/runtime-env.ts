import type { Hono } from "hono";
import type { Env } from "./env";

export function applyRuntimeEnv(app: Hono<{ Bindings: Env }>) {
  app.use("*", async (c, next) => {
    for (const [key, value] of Object.entries(c.env)) {
      if (typeof value === "string") {
        process.env[key] = value;
      }
    }

    const hyperdrive = c.env.HYPERDRIVE as
      | { connectionString?: string }
      | undefined;
    if ((c.env.NODE_ENV ?? "").toLowerCase() !== "production") {
      const localConnectionString = (c.env as Record<string, unknown>)
        .CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE;

      if (
        typeof localConnectionString === "string" &&
        localConnectionString.trim().length > 0
      ) {
        process.env.DATABASE_URL = localConnectionString.trim();
        delete process.env.HYPERDRIVE_URL;
      } else if (hyperdrive?.connectionString) {
        process.env.HYPERDRIVE_URL = hyperdrive.connectionString;
      }
    } else if (hyperdrive?.connectionString) {
      process.env.HYPERDRIVE_URL = hyperdrive.connectionString;
    }

    await next();
  });
}
