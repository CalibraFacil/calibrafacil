import { Buffer } from "node:buffer";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseLocalServerBootstrapConfig,
  readLocalServerConfig,
  type LocalServerConfig,
} from "./bootstrap";

function encodeBootstrap(config: LocalServerConfig) {
  return Buffer.from(JSON.stringify(config), "utf8").toString("base64url");
}

describe("readLocalServerConfig", () => {
  it("prefers the typed bootstrap envelope over legacy env vars", () => {
    const config: LocalServerConfig = {
      host: "127.0.0.1",
      port: 48418,
      appVersion: "1.2.3",
      localServerVersion: "1.2.3",
      dbPath: path.join("/tmp", "calibra.sqlite"),
      storageRoot: path.join("/tmp", "files"),
      deviceId: "device-1",
      tenantId: null,
      organizationId: "org-1",
      unitId: 10,
      userId: "user-1",
      syncEnabled: true,
      bootstrapToken: "local-token",
      cloudApiUrl: "https://api.calibrafacil.com",
      cloudAuthToken: "cloud-token",
      cloudProxyToken: "proxy-token",
      desktopRunId: "desktop-run-1",
      localServerRunId: "local-server-run-1",
    };

    expect(
      readLocalServerConfig({
        CALIBRA_LOCAL_SERVER_BOOTSTRAP: encodeBootstrap(config),
        CALIBRA_LOCAL_PORT: "4317",
        CALIBRA_CLOUD_AUTH_TOKEN: "stale-token",
      }),
    ).toEqual(config);
  });

  it("keeps legacy env vars as a development fallback", () => {
    const config = readLocalServerConfig({
      CALIBRA_LOCAL_HOST: "127.0.0.1",
      CALIBRA_LOCAL_PORT: "4317",
      CALIBRA_APP_VERSION: "0.1.0",
      CALIBRA_LOCAL_SERVER_VERSION: "0.1.0",
      CALIBRA_LOCAL_DB_PATH: path.join("/tmp", "dev.sqlite"),
      CALIBRA_LOCAL_STORAGE_DIR: path.join("/tmp", "dev-files"),
      CALIBRA_DEVICE_ID: "dev-device",
      CALIBRA_ORGANIZATION_ID: "org-1",
      CALIBRA_UNIT_ID: "7",
      CALIBRA_USER_ID: "user-1",
      CALIBRA_LOCAL_BOOTSTRAP_TOKEN: "local-token",
      CALIBRA_CLOUD_API_URL: "https://api.calibrafacil.com",
      CALIBRA_DESKTOP_RUN_ID: "desktop-run-1",
      CALIBRA_LOCAL_SERVER_RUN_ID: "local-server-run-1",
    });

    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 4317,
      appVersion: "0.1.0",
      localServerVersion: "0.1.0",
      dbPath: path.join("/tmp", "dev.sqlite"),
      storageRoot: path.join("/tmp", "dev-files"),
      deviceId: "dev-device",
      organizationId: "org-1",
      unitId: 7,
      userId: "user-1",
      bootstrapToken: "local-token",
      cloudApiUrl: "https://api.calibrafacil.com",
      desktopRunId: "desktop-run-1",
      localServerRunId: "local-server-run-1",
    });
  });

  it("parses the typed bootstrap JSON used by desktop stdin startup", () => {
    const config: LocalServerConfig = {
      host: "127.0.0.1",
      port: 48418,
      appVersion: "1.2.3",
      localServerVersion: "1.2.3",
      dbPath: path.join("/tmp", "calibra.sqlite"),
      storageRoot: path.join("/tmp", "files"),
      deviceId: "device-1",
      tenantId: null,
      organizationId: "org-1",
      unitId: 10,
      userId: "user-1",
      syncEnabled: true,
      bootstrapToken: "local-token",
      cloudApiUrl: "https://api.calibrafacil.com",
      cloudAuthToken: "cloud-token",
      cloudProxyToken: "proxy-token",
      desktopRunId: "desktop-run-1",
      localServerRunId: "local-server-run-1",
    };

    expect(parseLocalServerBootstrapConfig(JSON.stringify(config))).toEqual(
      config,
    );
  });
});
