import {
  loadApiConfig,
  type ApiConfig,
  type EnvSource,
} from "@calibra-facil/config";

// What the Bun entry (src/bun.ts) does with the environment before it serves a
// request, kept free of Bun APIs so it is testable: assemble the bindings (the
// development defaults, then the local .env files, then the real environment)
// and validate them with the API configuration schema. A bad deploy fails here,
// at start, with one error that lists every problem.

const LOCAL_URL_DEFAULTS = {
  API_URL: "http://localhost:3000",
  APP_URL: "http://localhost:5173",
  PORTAL_APP_URL: "http://localhost:5174",
};

export type ApiBootEnv = {
  /** The bindings handed to the Hono app (and mirrored into the process env). */
  bindings: Record<string, unknown>;
  config: ApiConfig;
};

function stringEntries(env: Record<string, unknown>): EnvSource {
  const strings: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") strings[key] = value;
  }
  return strings;
}

/**
 * @param processEnv the real environment
 * @param localEnv   the parsed `.env` / `.env.local` files (empty in production)
 * @throws ConfigError when the resulting configuration is invalid
 */
export function buildApiBootEnv(
  processEnv: EnvSource,
  localEnv: Readonly<Record<string, string>> = {},
): ApiBootEnv {
  const isProduction = processEnv.NODE_ENV === "production";
  const defaults = isProduction
    ? { NODE_ENV: "production" }
    : {
        NODE_ENV: processEnv.NODE_ENV ?? "development",
        ...LOCAL_URL_DEFAULTS,
        R2_BUCKET_NAME: "calibrafacil-documents-dev",
        R2_MEDIA_BUCKET_NAME: "calibrafacil-media-dev",
        RESEND_FROM_EMAIL: "Calibra Facil <noreply@example.com>",
      };

  const bindings: Record<string, unknown> = {
    ...defaults,
    ...localEnv,
    ...processEnv,
  };

  if (!isProduction) {
    for (const [key, fallback] of Object.entries(LOCAL_URL_DEFAULTS)) {
      const configuredValue =
        typeof bindings[key] === "string" ? bindings[key].trim() : undefined;
      bindings[key] = configuredValue || fallback;
    }
  }

  return { bindings, config: loadApiConfig(stringEntries(bindings)) };
}
