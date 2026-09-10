import path from "node:path";
import { Buffer } from "node:buffer";
import {
  localServerBootstrapConfigSchema,
  type LocalEnvironmentBootstrap,
  type LocalServerBootstrapConfig,
} from "@calibra-facil/contracts";
import { currentLocalDbSchemaVersion } from "@calibra-facil/local-db";

export type LocalServerConfig = LocalServerBootstrapConfig;

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
