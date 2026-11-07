/**
 * Where a browser app reaches the API. An explicit `VITE_API_URL` wins; without
 * it the API is on the same origin (the Vite dev server proxies /api to
 * DEV_API_ORIGIN, http://localhost:3000 by default, and deployments put a
 * reverse proxy in front of both). With no `window` either (tests, SSR) the
 * caller's fallback is used. The lab app and the portal both resolve through
 * this; each passes its own `import.meta.env` value, which a package cannot read.
 */
export function resolveApiBaseUrl({
  configuredUrl,
  fallbackUrl,
}: {
  configuredUrl: string | undefined;
  fallbackUrl: string;
}): string {
  if (configuredUrl) return configuredUrl;
  const location: unknown = Reflect.get(globalThis, "location");
  const origin: unknown =
    typeof location === "object" && location !== null
      ? Reflect.get(location, "origin")
      : undefined;
  return typeof origin === "string" ? origin : fallbackUrl;
}
