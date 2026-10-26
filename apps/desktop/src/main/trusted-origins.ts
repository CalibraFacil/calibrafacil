/**
 * Which page URLs the privileged desktop window may be running.
 *
 * The IPC bridge hands the page `authFetch`, the local API token and
 * `openExternal`, so every handler first asks whether the calling frame is
 * the app. The answer has to come from a **parsed** URL: a prefix test is
 * defeated by `http://localhost:5173@evil.example/` (the real host is after
 * the `@`) and by `http://localhost:51730/` (a different port that shares the
 * prefix).
 */

/** The Vite dev server's default origins; unpackaged builds only. */
const devRendererOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

export type TrustedOrigins = {
  /** The packaged renderer: scheme and host, compared exactly. */
  app: { protocol: string; host: string };
  /** `protocol//host[:port]` of every http(s) origin allowed to host the UI. */
  web: ReadonlySet<string>;
};

export type TrustedOriginInput = {
  appScheme: string;
  appHost: string;
  isPackaged: boolean;
  /** `CALIBRA_DESKTOP_RENDERER_URL`: honoured only when unpackaged. */
  configuredRendererUrl?: string | undefined;
};

export function resolveTrustedOrigins(
  input: TrustedOriginInput,
): TrustedOrigins {
  const web = new Set<string>();

  // A packaged build serves the UI from the app scheme and nothing else. The
  // dev server origins (and an environment override) would otherwise let any
  // local process that binds port 5173 impersonate the app.
  if (!input.isPackaged) {
    for (const origin of devRendererOrigins) web.add(origin);

    const configured = parseWebOrigin(input.configuredRendererUrl);
    if (configured) web.add(configured);
  }

  return {
    app: { protocol: `${input.appScheme}:`, host: input.appHost },
    web,
  };
}

/**
 * True only when `rawUrl` parses and its scheme and authority equal a trusted
 * origin exactly. Anything unparseable, or carrying credentials, is untrusted.
 */
export function isTrustedUrl(
  rawUrl: unknown,
  trusted: TrustedOrigins,
): boolean {
  if (typeof rawUrl !== "string") return false;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.username !== "" || url.password !== "") return false;

  if (url.protocol === trusted.app.protocol) {
    return url.host === trusted.app.host;
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    return trusted.web.has(`${url.protocol}//${url.host}`);
  }

  return false;
}

function parseWebOrigin(value: string | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    // An invalid renderer URL fails later in BrowserWindow.loadURL.
    return null;
  }
}
