/**
 * Deep links for portal-facing notifications.
 *
 * `actionUrl` uses the `/portal/...` convention: `resolveEmailActionUrl` in
 * service.ts rewrites that prefix onto the portal SPA's base URL when the
 * notification is emailed. `portalUrl` is the absolute form used by email
 * templates that link directly.
 */

/**
 * CERTIFICATE_AMENDED (#744): point the customer at the SUPERSEDED
 * certificate's portal detail page, which renders the ISO 17025 §7.8.8
 * supersession banner and, once the retificação is issued, the "versão
 * vigente" link. The amendment itself is still DRAFT when this notification
 * fires, so its own detail page would 404.
 */
export function buildCertificateAmendedLinks(params: {
  portalBaseUrl: string;
  supersededJobIdentifier: string;
}): { actionUrl: string; portalUrl: string } {
  const path = `/certificates/${encodeURIComponent(
    params.supersededJobIdentifier,
  )}`;
  return {
    actionUrl: `/portal${path}`,
    portalUrl: `${params.portalBaseUrl}${path}`,
  };
}
