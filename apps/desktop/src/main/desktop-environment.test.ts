import { describe, expect, it } from "vitest";
import { readDesktopConfig } from "@calibra-facil/config";
import { createDesktopEnvironment } from "./desktop-environment";

function environment(
  env: Record<string, string>,
  overrides: {
    isPackaged?: boolean;
    buildCloudApiUrl?: string;
    buildCloudWebOrigin?: string;
  } = {},
) {
  return createDesktopEnvironment({
    config: readDesktopConfig(env),
    isPackaged: overrides.isPackaged ?? false,
    buildCloudApiUrl: overrides.buildCloudApiUrl,
    buildCloudWebOrigin: overrides.buildCloudWebOrigin,
  });
}

describe("desktop environment", () => {
  it("falls back to the local development stack", () => {
    const env = environment({});

    expect(env.defaultCloudApiUrl).toBe("http://localhost:3000");
    expect(env.cloudApiUrl).toBe("http://localhost:3000");
    expect(env.rendererUrl).toBe("http://localhost:5173");
    expect(env.skipLocalServer).toBe(false);
  });

  it("prefers the runtime override over the build-time cloud address", () => {
    const env = environment(
      { CALIBRA_DESKTOP_AUTH_API_URL: "http://127.0.0.1:4000" },
      { buildCloudApiUrl: "https://api.calibrafacil.com" },
    );

    expect(env.defaultCloudApiUrl).toBe("https://api.calibrafacil.com");
    expect(env.cloudApiUrl).toBe("http://127.0.0.1:4000");
    expect([...env.allowedCloudApiOrigins()].sort()).toEqual([
      "http://127.0.0.1:3000",
      "http://127.0.0.1:4000",
      "http://localhost:3000",
      "https://api.calibrafacil.com",
    ]);
  });

  it("serves a packaged build from the app scheme and ignores the renderer override", () => {
    const env = environment(
      { CALIBRA_DESKTOP_RENDERER_URL: "http://localhost:9999" },
      { isPackaged: true },
    );

    expect(env.rendererUrl).toBe("app://calibra-facil/");
  });

  it("treats an empty build-time value as unset", () => {
    expect(environment({}, { buildCloudApiUrl: "" }).defaultCloudApiUrl).toBe(
      "http://localhost:3000",
    );
  });

  it("presents the configured web origin, else the renderer for a local API, else the build's", () => {
    const configured = environment({
      CALIBRA_DESKTOP_AUTH_ORIGIN: "https://app.example.com/path",
    });
    expect(
      configured.cloudAuthOrigin(new URL("https://api.example.com/api/x")),
    ).toBe("https://app.example.com");

    const local = environment({
      CALIBRA_DESKTOP_RENDERER_URL: "http://localhost:5999",
    });
    expect(local.cloudAuthOrigin(new URL("http://localhost:3000/api/x"))).toBe(
      "http://localhost:5999",
    );

    const remote = environment(
      {},
      { buildCloudWebOrigin: "https://app.calibrafacil.com" },
    );
    expect(
      remote.cloudAuthOrigin(new URL("https://api.calibrafacil.com/api/x")),
    ).toBe("https://app.calibrafacil.com");
  });

  it("ignores an unparseable origin override", () => {
    const env = environment({ CALIBRA_DESKTOP_AUTH_ORIGIN: "not a url" });

    expect(env.cloudAuthOrigin(new URL("http://localhost:3000/api/x"))).toBe(
      "http://localhost:5173",
    );
  });
});
