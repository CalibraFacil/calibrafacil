import { describe, expect, it } from "vitest";
import {
  LOCAL_SERVER_DEFAULT_PORT,
  LOCAL_SERVER_DEFAULT_URL,
  localServerEnvNames,
  readDesktopConfig,
  loadLocalServerConfig,
  readLocalServerEnvironment,
} from "./index";

describe("desktop host configuration", () => {
  it("is quiet by default and reads the overrides the smoke scripts set", () => {
    expect(readDesktopConfig({})).toMatchObject({
      skipLocalServer: false,
      smokeDownloadedUpdateVersion: null,
    });
    expect(
      readDesktopConfig({
        CALIBRA_DESKTOP_SKIP_LOCAL_SERVER: "1",
        CALIBRA_DESKTOP_RENDERER_URL: "http://127.0.0.1:5999",
        CALIBRA_DESKTOP_AUTH_API_URL: "http://127.0.0.1:3999",
      }),
    ).toMatchObject({
      skipLocalServer: true,
      rendererUrl: "http://127.0.0.1:5999",
      authApiUrl: "http://127.0.0.1:3999",
    });
  });

  it("gives the smoke update version only while the smoke hooks are on", () => {
    const version = "CALIBRA_DESKTOP_SMOKE_DOWNLOADED_UPDATE_VERSION";
    expect(
      readDesktopConfig({ [version]: " 9.9.9 " }).smokeDownloadedUpdateVersion,
    ).toBeNull();
    expect(
      readDesktopConfig({
        CALIBRA_DESKTOP_ENABLE_SMOKE_HOOKS: "1",
        [version]: " 9.9.9 ",
      }).smokeDownloadedUpdateVersion,
    ).toBe("9.9.9");
  });
});

describe("local server defaults and environment", () => {
  it("the group's port default is the exported default address", () => {
    const { localServer } = loadLocalServerConfig({});
    expect(localServer.port).toBe(LOCAL_SERVER_DEFAULT_PORT);
    expect(LOCAL_SERVER_DEFAULT_URL).toBe(
      `http://${localServer.host}:${localServer.port}`,
    );
  });

  it("lists every variable of the group, bootstrap transport included", () => {
    expect(localServerEnvNames).toEqual(
      expect.arrayContaining([
        "CALIBRA_LOCAL_SERVER_BOOTSTRAP",
        "CALIBRA_LOCAL_SERVER_BOOTSTRAP_STDIN",
        "CALIBRA_LOCAL_PORT",
        "CALIBRA_CLOUD_PROXY_TOKEN",
        "CALIBRA_LOCAL_AUTO_START_SYNC",
      ]),
    );
  });

  it("separates what the environment sets from the group's defaults", () => {
    const { settings, explicit } = readLocalServerEnvironment({
      CALIBRA_LOCAL_PORT: "5001",
      CALIBRA_UNIT_ID: "7",
      CALIBRA_ORGANIZATION_ID: "  ",
    });
    expect(settings).toMatchObject({
      host: "127.0.0.1",
      port: 5001,
      deviceId: "local-dev-device",
    });
    expect(explicit).toEqual({ port: 5001, unitId: 7 });
  });

  it("rejects a malformed value with the variable's name", () => {
    expect(() =>
      readLocalServerEnvironment({ CALIBRA_LOCAL_PORT: "not-a-port" }),
    ).toThrow(/CALIBRA_LOCAL_PORT/);
  });
});
