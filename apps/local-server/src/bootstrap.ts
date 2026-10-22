import path from "node:path";
import { loadLocalServerConfig } from "@calibra-facil/config";
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

  // The development fallback: individual variables, validated as a whole by
  // the local-server schema (a bad port or URL throws one aggregated error).
  const { localServer } = loadLocalServerConfig(env);

  const dbPath =
    localServer.dbPath ??
    new URL(
      /* @vite-ignore */ "../../../.calibra-local/calibra.sqlite",
      import.meta.url,
    ).pathname;

  return {
    dataRoot: localServer.dataRoot ?? null,
    requirePartition: localServer.requirePartition,
    host: localServer.host,
    port: localServer.port,
    appVersion: localServer.appVersion,
    localServerVersion: localServer.localServerVersion,
    dbPath,
    storageRoot:
      localServer.storageDir ?? path.join(path.dirname(dbPath), "files"),
    deviceId: localServer.deviceId,
    tenantId: localServer.tenantId ?? null,
    organizationId: localServer.organizationId ?? null,
    unitId: localServer.unitId ?? null,
    userId: localServer.userId ?? null,
    syncEnabled: localServer.syncEnabled,
    autoStartSync: localServer.autoStartSync,
    bootstrapToken: localServer.bootstrapToken ?? null,
    cloudApiUrl: localServer.cloudApiUrl ?? null,
    cloudAuthToken: localServer.cloudAuthToken ?? null,
    cloudProxyToken: localServer.cloudProxyToken ?? null,
    desktopRunId: localServer.desktopRunId,
    localServerRunId: localServer.localServerRunId,
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
    throw new Error(`Invalid local server bootstrap config: ${message}`, {
      cause: error,
    });
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
    throw new Error(`Invalid local server bootstrap config: ${message}`, {
      cause: error,
    });
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
