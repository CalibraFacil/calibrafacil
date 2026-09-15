import type { Hono } from "hono";
import type { Env } from "./env";

function getConnectionString(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const connectionString = Object.fromEntries(
    Object.entries(value),
  ).connectionString;
  return typeof connectionString === "string" ? connectionString : null;
}

export function applyRuntimeEnv(app: Hono<{ Bindings: Env }>) {
  app.use("*", async (c, next) => {
    for (const [key, value] of Object.entries(c.env)) {
      if (typeof value === "string") {
        process.env[key] = value;
      }
    }

    const hyperdriveConnectionString = getConnectionString(c.env.HYPERDRIVE);
    if ((c.env.NODE_ENV ?? "").toLowerCase() !== "production") {
      const localConnectionString =
        c.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE;

      if (
        typeof localConnectionString === "string" &&
        localConnectionString.trim().length > 0
      ) {
        process.env.DATABASE_URL = localConnectionString.trim();
        delete process.env.HYPERDRIVE_URL;
      } else if (hyperdriveConnectionString) {
        process.env.HYPERDRIVE_URL = hyperdriveConnectionString;
      }
    } else if (hyperdriveConnectionString) {
      process.env.HYPERDRIVE_URL = hyperdriveConnectionString;
    }

    await next();
  });
}
