/**
 * `calibrafacil://` deep links.
 *
 * These are **externally supplied input that navigates the app**: any website,
 * e-mail or chat message can hand the OS a `calibrafacil://…` URL and the OS
 * will hand it to us. So this module allows one shape and rejects everything
 * else, rather than sanitizing whatever arrives.
 *
 * What a link may do is navigate to an in-app route. It may not choose a
 * document to load, reach another origin, or carry a scheme the renderer would
 * interpret — those are the ways a URL handler turns into remote code
 * execution. Authorization is unaffected: the renderer still resolves the
 * route behind the normal auth guards, so a link to a record the user cannot
 * see lands on the same denial it would from the sidebar.
 */

import { isUnsafeDeepLinkPath } from "./deep-link-path";

export const desktopDeepLinkScheme = "calibrafacil";

/**
 * A resolved link. `path` is guaranteed to be a *same-app route path*:
 *
 * - begins with exactly one `/` — never `//`, which a renderer would read as
 *   protocol-relative and follow to another origin;
 * - carries no scheme prefix, so it cannot be `javascript:` or `data:`;
 * - contains no `..` segment and no control characters or spaces.
 *
 * It is **not** a promise that the route exists or that the user may see it.
 * The renderer resolves it through the normal router and auth guards, so a
 * link to a record the user has no access to lands on the same denial it
 * would from the sidebar.
 */
export type DeepLinkResolution =
  | { ok: true; path: string }
  | { ok: false; reason: DeepLinkRejection };

export type DeepLinkRejection =
  | "not-a-url"
  | "wrong-scheme"
  | "empty-path"
  | "unsafe-path";

export function resolveDeepLink(rawUrl: string): DeepLinkResolution {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "not-a-url" };
  }

  if (url.protocol !== `${desktopDeepLinkScheme}:`) {
    return { ok: false, reason: "wrong-scheme" };
  }

  // `calibrafacil://dashboard/jobs/12` parses with host "dashboard" and
  // pathname "/jobs/12"; `calibrafacil:///dashboard/jobs/12` puts it all in
  // pathname. Accept both spellings and rebuild one path.
  const path = normalizePath(`${url.host}${url.pathname}`);
  if (!path) return { ok: false, reason: "empty-path" };

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A malformed percent-escape is not something to guess at.
    return { ok: false, reason: "unsafe-path" };
  }

  if (isUnsafeDeepLinkPath(decoded)) {
    return { ok: false, reason: "unsafe-path" };
  }

  // Search and hash are re-attached from the parsed URL, not from the raw
  // string, so they cannot carry a second path past the checks above.
  return { ok: true, path: `${path}${url.search}${url.hash}` };
}

function normalizePath(value: string) {
  // Collapsing repeated slashes is what makes the leading-`//` case
  // impossible rather than merely unlikely: `calibrafacil:////evil.example`
  // parses with an empty host and a `//evil.example` pathname.
  const trimmed = value.replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
  if (!trimmed) return null;

  return `/${trimmed}`;
}

/**
 * Pick the deep link out of a process argv.
 *
 * Windows and Linux deliver the URL as a command-line argument — on first
 * launch in `process.argv`, on subsequent launches in the `second-instance`
 * event. macOS uses `open-url` instead and never comes through here.
 *
 * Scanned from the end because Electron's own switches come first, and a
 * packaged app's argv also contains the executable path.
 */
export function findDeepLinkInArgv(argv: readonly string[]): string | null {
  for (let index = argv.length - 1; index >= 0; index -= 1) {
    const candidate = argv[index];
    if (
      typeof candidate === "string" &&
      candidate.toLowerCase().startsWith(`${desktopDeepLinkScheme}://`)
    ) {
      return candidate;
    }
  }

  return null;
}

const rejectionMessages = {
  "not-a-url": "O link recebido não é um endereço válido.",
  "wrong-scheme": "O link recebido não pertence ao CalibraFácil.",
  "empty-path": "O link recebido não aponta para nenhuma tela.",
  "unsafe-path": "O link recebido foi bloqueado por segurança.",
} as const satisfies Record<DeepLinkRejection, string>;

export function describeDeepLinkRejection(reason: DeepLinkRejection) {
  return rejectionMessages[reason];
}
