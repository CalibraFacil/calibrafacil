import { choice, defineGroup, example, integer, text } from "../define";
import { nodeEnvVar } from "./runtime";

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
      description: `Connections per process (default ${DEFAULT_POOL_MAX}). An unusable value means the default.`,
      min: 1,
      tolerant: true,
      example: example.commented("5"),
    }),
    rlsMode: choice({
      env: "DATABASE_RLS_MODE",
      description:
        "Row-level security (migration 0123). `shadow` (default): the application connects as the owner of the tables, which RLS does not bind, and start-up refuses a role that RLS would bind. `enforced`: set only after the role split (DEPLOYMENT.md), when the application connects as a member of calibra_app and the policies apply.",
      values: ["shadow", "enforced"],
      default: "shadow",
      example: example.commented("shadow"),
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
    nodeEnv: nodeEnvVar,
  },
  derive: (values) => ({
    /** The pool size: the setting, else the default. */
    poolMax: values.configuredPoolMax ?? DEFAULT_POOL_MAX,
  }),
});
