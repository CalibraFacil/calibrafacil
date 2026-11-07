import { sanitizeInternalRedirect } from "@calibra-facil/shared/internal-redirect";

// A redirect after sign-in comes from a signed-in location, so the allowed
// prefixes are the top-level segments of the `_authenticated` route folder.
// Reading them from the route files keeps a new portal route from needing a
// hand edit here. The glob is lazy: nothing is imported, only the paths used.
const AUTHENTICATED_ROUTE_FILES = Object.keys(
  import.meta.glob("../routes/_authenticated/**/*.tsx"),
);

const LAYOUT_FILE = /^(index|route)\.tsx$/;

export function authenticatedRoutePrefixes(
  routeFiles: readonly string[],
): string[] {
  const segments = new Set<string>();
  for (const file of routeFiles) {
    const relative = file.split("/_authenticated/")[1];
    if (!relative) continue;
    const [first, ...rest] = relative.split("/");
    if (!first) continue;
    if (rest.length === 0 && LAYOUT_FILE.test(first)) continue;
    segments.add(`/${first.replace(/\.tsx$/, "")}`);
  }
  return [...segments].sort();
}

const ALLOWED_PREFIXES = [
  "/",
  ...authenticatedRoutePrefixes(AUTHENTICATED_ROUTE_FILES),
];

export function sanitizePortalRedirect(value: string | undefined): string {
  return sanitizeInternalRedirect(value, {
    fallback: "/",
    allowedPrefixes: ALLOWED_PREFIXES,
    blockedPrefixes: ["/sign-in"],
  });
}
