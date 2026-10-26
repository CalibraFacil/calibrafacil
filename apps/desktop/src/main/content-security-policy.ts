/**
 * Content-Security-Policy for the packaged renderer (`app://calibra-facil`).
 *
 * The hosted app gets its policy from `apps/web/public/_headers`; a custom
 * protocol has no such file, so the protocol handler attaches this one to
 * every HTML document. It mirrors the hosted policy and widens it only where
 * the desktop genuinely differs:
 *
 * - `connect-src` adds the local server (a loopback port the host picks at
 *   run time, hence `:*`), the cloud API origin(s) the build points at, and
 *   the ViaCEP lookup the customer forms call directly. Authenticated cloud
 *   calls themselves go through the `authFetch` IPC, not the renderer.
 * - `img-src` and `frame-src` keep `https:` because organization logos,
 *   signatures and the certificate preview are signed storage URLs on a host
 *   the build does not know. `script-src` stays `'self'`: the production
 *   bundle has no inline script, and `theme-init.js` is a same-origin file.
 * - `style-src` keeps `'unsafe-inline'`, as the hosted policy does: the UI
 *   libraries set `style` attributes.
 */

const fallbackLocalHost = "127.0.0.1";
const viaCepOrigin = "https://viacep.com.br";

export type ContentSecurityPolicyInput = {
  /** Host the local server binds (`CALIBRA_LOCAL_HOST`), without a port. */
  localServerHost: string;
  /** Cloud API URLs (build-time default and runtime override). */
  cloudApiUrls: ReadonlyArray<string | undefined>;
};

export function buildContentSecurityPolicy(
  input: ContentSecurityPolicyInput,
): string {
  const cloudOrigins = uniqueHttpOrigins(input.cloudApiUrls);
  const localOrigin = `http://${localHostSource(input.localServerHost)}:*`;

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:", ...cloudOrigins]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", localOrigin, ...cloudOrigins, viaCepOrigin]],
    ["frame-src", ["https:", "blob:", ...cloudOrigins]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];

  return directives
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * Response headers for a file the protocol handler serves. The policy rides on
 * documents only; it has no effect on scripts, styles or images.
 */
export function rendererResponseHeaders(
  contentType: string,
  contentSecurityPolicy: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  };

  if (contentType.startsWith("text/html")) {
    headers["Content-Security-Policy"] = contentSecurityPolicy;
    headers["Referrer-Policy"] = "no-referrer";
  }

  return headers;
}

function uniqueHttpOrigins(urls: ReadonlyArray<string | undefined>) {
  const origins = new Set<string>();

  for (const value of urls) {
    if (!value) continue;

    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") {
        origins.add(url.origin);
      }
    } catch {
      // An unparseable URL contributes nothing; the API call would fail first.
    }
  }

  return [...origins];
}

/**
 * The host as a CSP host-source. The value comes from the environment, so
 * anything that is not a plain hostname or IP literal (a space or `;` would
 * start a new directive) falls back to loopback.
 */
function localHostSource(host: string) {
  if (/^[A-Za-z0-9.-]+$/.test(host)) return host;
  if (/^[0-9A-Fa-f:]+$/.test(host) && host.includes(":")) return `[${host}]`;

  return fallbackLocalHost;
}
