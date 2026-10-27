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
      description:
        "PostgreSQL connection string of the APPLICATION role, `calibra_app` (a login that row-level security binds, see DEPLOYMENT.md).",
      secret: true,
      requiredInProduction: ["api", "worker"],
      example: example.active(
        "postgres://calibra_app:calibra_app@localhost:55432/calibra",
      ),
    }),
    configuredPoolMax: integer({
      env: "DATABASE_POOL_MAX",
      description: `Connections per process (default ${DEFAULT_POOL_MAX}). An unusable value means the default.`,
      min: 1,
      tolerant: true,
      example: example.commented("5"),
    }),
    ownerUrl: text({
      env: "DATABASE_OWNER_URL",
      description:
        "Connection string of the table OWNER, for the system path (`systemDb`): the few statements that are cross-organization by design (the portal scope resolver, the lookups that learn which laboratory a request belongs to, Better Auth, asset_type writes). Required while DATABASE_RLS_MODE=enforced (the default): start-up refuses to run without it, because the application role would silently see nothing on those paths. Migrations (`db:migrate`, `db:bootstrap`) run as the owner too.",
      secret: true,
      example: example.active(
        "postgres://calibra:calibra@localhost:55432/calibra",
      ),
    }),
    rlsMode: choice({
      env: "DATABASE_RLS_MODE",
      description:
        "Row-level security (migration 0123). `enforced` (default): the application connects as `calibra_app`, which the tenant policies bind, and start-up refuses a DATABASE_URL that is the owner of the tables (a connection that RLS would not bind) or a missing DATABASE_OWNER_URL. `shadow`: for diagnosis, the application connects as the owner, which RLS does not bind, and start-up refuses a role that RLS would bind.",
      values: ["shadow", "enforced"],
      default: "enforced",
      example: example.commented("enforced"),
    }),
    nodeEnv: nodeEnvVar,
  },
  derive: (values) => ({
    /** The pool size: the setting, else the default. */
    poolMax: values.configuredPoolMax ?? DEFAULT_POOL_MAX,
  }),
});
