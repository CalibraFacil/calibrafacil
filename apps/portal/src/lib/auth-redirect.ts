import { sanitizeInternalRedirect } from "@calibra-facil/shared/internal-redirect";

export function sanitizePortalRedirect(value: string | undefined): string {
  return sanitizeInternalRedirect(value, {
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
  });
}
