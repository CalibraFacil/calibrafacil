import type { readDesktopConfig } from "@calibra-facil/config";

type DesktopConfig = ReturnType<typeof readDesktopConfig>;

/** The Vite dev server the unpackaged shell loads when nothing says otherwise. */
const developmentRendererUrl = "http://localhost:5173";

/** Dev API origins the shell may always call, whatever is configured. */
const developmentApiOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

export type DesktopEnvironmentInput = {
  /** The typed `CALIBRA_DESKTOP_*` overrides (`readDesktopConfig()`). */
  config: DesktopConfig;
  isPackaged: boolean;
  /** Baked into the bundle at build time; an empty value counts as unset. */
  buildCloudApiUrl: string | undefined;
  buildCloudWebOrigin: string | undefined;
};

/**
 * Where the desktop shell loads its UI from and which cloud it talks to, with
 * the build-time defaults and the runtime overrides already merged. Built once
 * at start-up and passed to the modules that need an address, so none of them
 * reads the environment itself.
 */
export function createDesktopEnvironment(input: DesktopEnvironmentInput) {
  const { config, isPackaged } = input;
  const defaultCloudApiUrl = input.buildCloudApiUrl || "http://localhost:3000";
  const defaultCloudWebOrigin =
    input.buildCloudWebOrigin || developmentRendererUrl;
  const packagedRendererUrl = "app://calibra-facil/";

  const cloudApiUrl = config.authApiUrl ?? defaultCloudApiUrl;
  const rendererUrl = isPackaged
    ? packagedRendererUrl
    : (config.rendererUrl ?? developmentRendererUrl);

  return {
    isPackaged,
    defaultCloudApiUrl,
    /** The cloud API this run talks to. */
    cloudApiUrl,
    /** The web app the window loads. */
    rendererUrl,
    /** `CALIBRA_DESKTOP_RENDERER_URL`, for the trusted-origin check. */
    configuredRendererUrl: config.rendererUrl,
    skipLocalServer: config.skipLocalServer,
    smokeDownloadedUpdateVersion: config.smokeDownloadedUpdateVersion,

    /** The origins `authFetch` may reach. */
    allowedCloudApiOrigins(): Set<string> {
      const origins = [
        safeUrlOrigin(defaultCloudApiUrl),
        ...developmentApiOrigins,
        config.authApiUrl ? safeUrlOrigin(config.authApiUrl) : null,
      ];
      return new Set(origins.filter((origin) => origin !== null));
    },

    /**
     * The `Origin` the cloud API sees for a request to `url`: the configured
     * web origin, else the dev renderer for a local API, else the build's.
     */
    cloudAuthOrigin(url: URL): string {
      const configured = config.authOrigin
        ? safeUrlOrigin(config.authOrigin)
        : null;
      if (configured) return configured;

      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        return safeUrlOrigin(rendererUrl) ?? developmentRendererUrl;
      }

      return defaultCloudWebOrigin;
    },
  };
}

export type DesktopEnvironment = ReturnType<typeof createDesktopEnvironment>;

function safeUrlOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
