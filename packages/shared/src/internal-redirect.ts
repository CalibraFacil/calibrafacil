/**
 * Sanitizer for the `redirect` search param of the sign-in routes: only a path
 * on the current origin, under one of the app's own prefixes, survives; anything
 * else (another origin, a protocol-relative `//host`, a blocked prefix, an
 * unparsable value) becomes the fallback. Shared by the lab app and the portal.
 */

/** Origin used where there is no `window` (tests, SSR) to resolve a relative path. */
const DETACHED_ORIGIN = "https://calibra.local";

export type InternalRedirectOptions = {
  fallback: string;
  allowedPrefixes: string[];
  blockedPrefixes?: string[];
};

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return (
    path === prefix ||
    path.startsWith(`${prefix}/`) ||
    path.startsWith(`${prefix}?`) ||
    path.startsWith(`${prefix}#`)
  );
}

// Read through globalThis so the module also type-checks where `window` is not
// declared (this package builds against Node types).
function currentOrigin(): string {
  const location: unknown = Reflect.get(globalThis, "location");
  const origin: unknown =
    typeof location === "object" && location !== null
      ? Reflect.get(location, "origin")
      : undefined;
  return typeof origin === "string" ? origin : DETACHED_ORIGIN;
}

export function sanitizeInternalRedirect(
  value: string | undefined,
  options: InternalRedirectOptions,
): string {
  if (!value || value.startsWith("//")) return options.fallback;

  const baseOrigin = currentOrigin();

  try {
    const url = new URL(value, baseOrigin);

    if (url.origin !== baseOrigin) return options.fallback;

    const path = `${url.pathname}${url.search}${url.hash}`;
    const isAllowed = options.allowedPrefixes.some((prefix) =>
      pathMatchesPrefix(path, prefix),
    );
    const isBlocked = (options.blockedPrefixes ?? []).some((prefix) =>
      pathMatchesPrefix(path, prefix),
    );

    return isAllowed && !isBlocked ? path : options.fallback;
  } catch {
    return options.fallback;
  }
}
