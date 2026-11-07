import { sanitizeInternalRedirect } from "@calibra-facil/shared/internal-redirect";

import { portalRedirectPrefixes } from "./route-registry";

// A redirect after sign-in comes from a signed-in location, so the allowed
// prefixes are the registry's signed-in routes (`afterSignIn`): a new portal
// route needs no edit here.
const ALLOWED_PREFIXES = portalRedirectPrefixes();

export function sanitizePortalRedirect(value: string | undefined): string {
  return sanitizeInternalRedirect(value, {
    fallback: "/",
    allowedPrefixes: ALLOWED_PREFIXES,
    blockedPrefixes: ["/sign-in"],
  });
}
