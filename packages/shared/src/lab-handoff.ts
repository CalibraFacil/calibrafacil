/**
 * The portal's "Ir para o laboratório" link. The lab app remembers its active
 * organization in its own localStorage, which the portal cannot reach (storage
 * is per origin), so the choice travels in the URL and the lab stores it.
 */

/** Search param of `/dashboard` that names the laboratory to open. */
export const LAB_HANDOFF_ORGANIZATION_PARAM = "organization";

export function labHandoffUrl(
  webAppUrl: string,
  organizationId: string,
): string {
  const url = new URL("/dashboard", webAppUrl);
  url.searchParams.set(LAB_HANDOFF_ORGANIZATION_PARAM, organizationId);
  return url.toString();
}

/** The organization a handoff link names, or null when the search has none. */
export function readLabHandoffOrganizationId(
  searchStr: string | undefined,
): string | null {
  if (!searchStr) return null;
  const value = new URLSearchParams(searchStr).get(
    LAB_HANDOFF_ORGANIZATION_PARAM,
  );
  return value?.trim() ? value : null;
}
