import { queryOptions } from "@tanstack/react-query";

import { getApiBaseUrl } from "@/lib/utils";

export interface PortalBranding {
  name: string | null;
  logo: string | null;
}

const DEFAULT_BRANDING: PortalBranding = { name: null, logo: null };

/**
 * Public lab identity for the current portal host. Resolved server-side from
 * the request Origin (the custom domain). Never throws — any failure degrades
 * to the CalibraFácil default so the sign-in page always renders.
 */
export async function fetchBranding(): Promise<PortalBranding> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/portal/branding`, {
      credentials: "include",
    });
    if (!response.ok) return DEFAULT_BRANDING;
    return await response.json();
  } catch {
    return DEFAULT_BRANDING;
  }
}

export function brandingQueryOptions() {
  return queryOptions({
    queryKey: ["portal-branding"],
    queryFn: fetchBranding,
    // Branding is fixed per host for the session; no need to refetch.
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
