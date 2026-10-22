import { ConfigError, isProductionEnv, type EnvSource } from "./define";
import {
  loadApiConfig,
  loadLocalServerConfig,
  loadWorkerConfig,
} from "./index";

/** The runtimes `config:check` can validate without starting anything. */
export const CHECKABLE_RUNTIMES = ["api", "worker", "local-server"] as const;
export type CheckableRuntime = (typeof CHECKABLE_RUNTIMES)[number];

export function isCheckableRuntime(value: string): value is CheckableRuntime {
  return CHECKABLE_RUNTIMES.some((runtime) => runtime === value);
}

export interface EnvFile {
  readonly env: Record<string, string>;
  /** Malformed lines, by number: a line's content is never quoted. */
  readonly problems: readonly string[];
}

/**
 * Parse a dotenv-style file: `KEY=VALUE` lines, `#` comments, optional
 * `export`, single or double quotes around the value.
 */
export function parseEnvFile(contents: string): EnvFile {
  const env: Record<string, string> = {};
  const problems: string[] = [];

  contents.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return;

    const match = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/,
    );
    if (!match?.[1]) {
      problems.push(`line ${index + 1} is not KEY=VALUE`);
      return;
    }

    let value = (match[2] ?? "").trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  });

  return { env, problems };
}

export interface CheckResult {
  readonly ok: boolean;
  /** Human-readable; lists variables and reasons, never a value. */
  readonly report: string;
}

/**
 * Validate `env` against a runtime's schema without starting anything.
 * `production` applies the production requirements even when the environment
 * does not say NODE_ENV=production.
 */
export function checkConfig(
  runtime: CheckableRuntime,
  env: EnvSource,
  options: { production?: boolean } = {},
): CheckResult {
  const effective: EnvSource = options.production
    ? { ...env, NODE_ENV: "production" }
    : env;

  try {
    switch (runtime) {
      case "api":
        loadApiConfig(effective);
        break;
      case "worker":
        loadWorkerConfig(effective);
        break;
      case "local-server":
        loadLocalServerConfig(effective);
        break;
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      return { ok: false, report: error.message };
    }
    throw error;
  }

  const production = isProductionEnv(effective);
  const mode = production
    ? "production requirements applied"
    : "NODE_ENV is not production: only types were checked; add --production to apply the production requirements";
  return { ok: true, report: `${runtime} configuration is valid (${mode})` };
}
