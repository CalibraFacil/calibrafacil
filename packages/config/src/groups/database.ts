import { defineGroup, example, integer, text } from "../define.ts";
import { vercelVar } from "./runtime.ts";

const DEFAULT_POOL_MAX = 5;

export const databaseGroup = defineGroup({
  name: "database",
  title: "Database",
  intro: ["PostgreSQL. Locally this is the container from docker-compose.yml."],
  vars: {
    url: text({
      env: "DATABASE_URL",
      description: "PostgreSQL connection string.",
      secret: true,
      requiredInProduction: ["api", "worker"],
      example: example.active(
        "postgres://calibra:calibra@localhost:55432/calibra",
      ),
    }),
    configuredPoolMax: integer({
      env: "DATABASE_POOL_MAX",
      description: `Connections per process (default ${DEFAULT_POOL_MAX}, 1 on Vercel). An unusable value means the default.`,
      min: 1,
      tolerant: true,
      example: example.commented("5"),
    }),
    hyperdriveUrl: text({
      env: "HYPERDRIVE_URL",
      description:
        "Connection string taken from a Cloudflare Hyperdrive binding; set by the runtime, not by hand.",
      secret: true,
      hidden: true,
    }),
    hyperdriveLocalConnectionString: text({
      env: "HYPERDRIVE_LOCAL_CONNECTION_STRING",
      description:
        "Local development override of the Hyperdrive connection string.",
      secret: true,
      hidden: true,
    }),
    cloudflareHyperdriveLocalConnectionString: text({
      env: "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE",
      description:
        "Wrangler's local Hyperdrive connection string (Cloudflare Workers development).",
      secret: true,
      hidden: true,
    }),
    vercel: vercelVar,
  },
  derive: (values) => ({
    /** The pool size: the setting, else 1 on Vercel (one connection per function), else 5. */
    poolMax:
      values.configuredPoolMax ??
      (values.vercel !== undefined ? 1 : DEFAULT_POOL_MAX),
  }),
});
