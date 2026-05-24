type RedirectOptions = {
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

export function sanitizePortalRedirect(value: string | undefined): string {
  if (!value || value.startsWith("//")) return "/";

  const baseOrigin =
    typeof window === "undefined"
      ? "https://portal.calibra.local"
      : window.location.origin;
  const options: RedirectOptions = {
    fallback: "/",
    allowedPrefixes: [
      "/",
      "/assets",
      "/certificates",
      "/requests",
      "/service-orders",
      "/settings",
    ],
    blockedPrefixes: ["/sign-in"],
  };

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
