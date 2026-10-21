import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

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

/**
 * How long the first paint may wait for branding. The lab identity is
 * cosmetic, so a slow or hung request must never hold the app: past this
 * budget the default brand renders and the real one swaps in when it lands.
 */
export const BRANDING_FIRST_PAINT_WAIT_MS = 800;

/** Starts the branding request. Never rejects (failures leave the default). */
export function prefetchBranding(queryClient: QueryClient): Promise<void> {
  return queryClient.prefetchQuery(brandingQueryOptions());
}

/**
 * Gives branding a brief head start so a white-labeled host does not flash the
 * CalibraFácil brand, without ever blocking on it: resolves when branding
 * settles, fails, or the wait budget runs out, whichever comes first.
 */
export async function settleBrandingForFirstPaint(
  queryClient: QueryClient,
  waitMs: number = BRANDING_FIRST_PAINT_WAIT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });

  try {
    await Promise.race([prefetchBranding(queryClient), budget]);
  } finally {
    clearTimeout(timer);
  }
}
