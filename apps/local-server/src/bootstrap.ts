import path from "node:path";
import { Buffer } from "node:buffer";
import {
  localServerBootstrapConfigSchema,
  type LocalEnvironmentBootstrap,
  type LocalServerBootstrapConfig,
} from "@calibra-facil/contracts";
import {
  currentLocalDbSchemaVersion,
  localDatabasePartitionPath,
} from "@calibra-facil/local-db";

export type LocalServerConfig = LocalServerBootstrapConfig;

/**
 * The database file this config should open.
 *
 * Derived here rather than by the Electron host so that the partition path and
 * the ownership check that enforces it live in one place. A host that passed a
 * stale `dbPath` alongside a fresh identity would otherwise open the wrong
 * account's file and rely on the check to catch it; deriving means the two
 * cannot disagree in the first place.
 */
export class LocalServerPartitionRequiredError extends Error {
  constructor() {
    super(
      "Local server refused to start: a packaged build must open a database that belongs to a signed-in account and organization.",
    );
    this.name = "LocalServerPartitionRequiredError";
  }
}

/**
 * Enforces the packaged-build guarantee independently of the host.
 *
 * The Electron main process already declines to spawn an unpartitioned server
 * when packaged. This is the second lock on the same door: a guarantee that
 * only holds while one caller remembers to check it is not a guarantee.
 */
export function assertLocalServerPartitionConfigured(
  config: LocalServerConfig,
): void {
  if (!config.requirePartition) return;
  if (config.userId && config.organizationId) return;

  throw new LocalServerPartitionRequiredError();
}

export function resolveLocalServerDbPath(config: LocalServerConfig): string {
  if (!config.dataRoot || !config.userId || !config.organizationId) {
    return config.dbPath;
  }

  return localDatabasePartitionPath(config.dataRoot, {
    userId: config.userId,
    organizationId: config.organizationId,
  });
}

export function readLocalServerConfig(
  env: Record<string, string | undefined>,
): LocalServerConfig {
  const bootstrapConfig = readBootstrapConfig(
    env.CALIBRA_LOCAL_SERVER_BOOTSTRAP,
  );
  if (bootstrapConfig) {
    return bootstrapConfig;
  }

  const dbPath =
    env.CALIBRA_LOCAL_DB_PATH ??
    new URL(
      /* @vite-ignore */ "../../../.calibra-local/calibra.sqlite",
      import.meta.url,
    ).pathname;

  return {
    dataRoot: env.CALIBRA_LOCAL_DATA_ROOT ?? null,
    requirePartition: env.CALIBRA_LOCAL_REQUIRE_PARTITION === "true",
    host: env.CALIBRA_LOCAL_HOST ?? "127.0.0.1",
    port: Number(env.CALIBRA_LOCAL_PORT ?? "4317"),
    appVersion: env.CALIBRA_APP_VERSION ?? "0.0.0-dev",
    localServerVersion: env.CALIBRA_LOCAL_SERVER_VERSION ?? "0.0.0-dev",
    dbPath,
    storageRoot:
      env.CALIBRA_LOCAL_STORAGE_DIR ?? path.join(path.dirname(dbPath), "files"),
    deviceId: env.CALIBRA_DEVICE_ID ?? "local-dev-device",
    tenantId: env.CALIBRA_TENANT_ID ?? null,
    organizationId: env.CALIBRA_ORGANIZATION_ID ?? null,
    unitId: env.CALIBRA_UNIT_ID ? Number(env.CALIBRA_UNIT_ID) : null,
    userId: env.CALIBRA_USER_ID ?? null,
    syncEnabled: env.CALIBRA_SYNC_ENABLED !== "false",
    autoStartSync: env.CALIBRA_LOCAL_AUTO_START_SYNC !== "false",
    bootstrapToken: env.CALIBRA_LOCAL_BOOTSTRAP_TOKEN ?? null,
    cloudApiUrl: env.CALIBRA_CLOUD_API_URL ?? null,
    cloudAuthToken: env.CALIBRA_CLOUD_AUTH_TOKEN ?? null,
    cloudProxyToken: env.CALIBRA_CLOUD_PROXY_TOKEN ?? null,
    desktopRunId: env.CALIBRA_DESKTOP_RUN_ID ?? "desktop-dev-run",
    localServerRunId: env.CALIBRA_LOCAL_SERVER_RUN_ID ?? "local-server-dev-run",
  };
}

export function parseLocalServerBootstrapConfig(
  rawJson: string,
): LocalServerConfig {
  try {
    return localServerBootstrapConfigSchema.parse(JSON.parse(rawJson));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown bootstrap parsing error.";
    throw new Error(`Invalid local server bootstrap config: ${message}`);
  }
}

function readBootstrapConfig(
  encodedBootstrap: string | undefined,
): LocalServerConfig | null {
  if (!encodedBootstrap) {
    return null;
  }

  try {
    const rawJson = Buffer.from(encodedBootstrap, "base64url").toString("utf8");
    return parseLocalServerBootstrapConfig(rawJson);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown bootstrap decoding error.";
    throw new Error(`Invalid local server bootstrap config: ${message}`);
  }
}

export function createLocalEnvironmentBootstrap(
  config: LocalServerConfig,
): LocalEnvironmentBootstrap {
  return {
    appVersion: config.appVersion,
    localServerVersion: config.localServerVersion,
    deviceId: config.deviceId,
    tenantId: config.tenantId,
    organizationId: config.organizationId,
    unitId: config.unitId,
    userId: config.userId,
    dbSchemaVersion: currentLocalDbSchemaVersion,
    syncEnabled: config.syncEnabled,
    syncState: config.syncEnabled ? "idle" : "offline",
    httpBaseUrl: `http://${config.host}:${config.port}`,
    localApiToken: null,
  };
}
