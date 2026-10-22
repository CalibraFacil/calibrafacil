import { currentEnv, type EnvSource } from "./define";
import {
  apiRuntime,
  localServerRuntime,
  portalRuntime,
  webRuntime,
  workerRuntime,
} from "./runtimes";

/**
 * Validated configuration, one loader per runtime.
 *
 * Each loader reads an environment (default: `process.env`), checks every
 * variable of its runtime in one pass and returns a deeply frozen, typed
 * object, or throws one `ConfigError` that lists every problem (variable name
 * and reason, never a value).
 *
 * Code outside this package does not read `process.env`: a runtime loads its
 * configuration once at start-up (`loadApiConfig()`), and a library several
 * runtimes share reads its own concern (`readDatabaseConfig()`, ...).
 */

export function loadApiConfig(env: EnvSource = currentEnv()) {
  return apiRuntime.load(env);
}

export function loadWorkerConfig(env: EnvSource = currentEnv()) {
  return workerRuntime.load(env);
}

export function loadLocalServerConfig(env: EnvSource = currentEnv()) {
  return localServerRuntime.load(env);
}

export function loadWebConfig(env: EnvSource) {
  return webRuntime.load(env);
}

export function loadPortalConfig(env: EnvSource) {
  return portalRuntime.load(env);
}

export type ApiConfig = ReturnType<typeof loadApiConfig>;
export type WorkerConfig = ReturnType<typeof loadWorkerConfig>;
export type LocalServerConfigSettings = ReturnType<
  typeof loadLocalServerConfig
>["localServer"];

export {
  ConfigError,
  isProductionEnv,
  varMetaOf,
  groupMetaOf,
  type ConfigIssue,
  type EnvSource,
  type RuntimeName,
  type VarMeta,
} from "./define";
export type { PlatformEmailTransport } from "./groups/email";
export {
  readAuthConfig,
  readDatabaseConfig,
  readEmailConfig,
  readIntegrationsConfig,
  readJobsConfig,
  readLocalServerSettings,
  readObservabilityConfig,
  readOriginsConfig,
  readRenderingConfig,
  readRetentionConfig,
  readRuntimeConfig,
  readSigningConfig,
  readStorageConfig,
} from "./runtimes";
export { rawEnv, setProcessEnv, setProcessEnvDefault } from "./process-env";
export { failFast } from "./startup";
