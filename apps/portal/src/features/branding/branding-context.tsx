import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { brandingQueryOptions, type PortalBranding } from "./queries";

const DEFAULT_BRAND_NAME = "CalibraFácil";

export interface ResolvedBranding {
  /** Always present — the lab name, or the CalibraFácil default. */
  name: string;
  /** Lab logo URL, or null to fall back to the CalibraFácil mark. */
  logo: string | null;
  /** True when this host carries a real lab identity (custom domain). */
  isCustom: boolean;
}

const DEFAULT_RESOLVED: ResolvedBranding = {
  name: DEFAULT_BRAND_NAME,
  logo: null,
  isCustom: false,
};

const BrandingContext = createContext<ResolvedBranding>(DEFAULT_RESOLVED);

export function useBranding(): ResolvedBranding {
  return useContext(BrandingContext);
}

function resolveBranding(data: PortalBranding | undefined): ResolvedBranding {
  if (!data) return DEFAULT_RESOLVED;
  const logo = data.logo ?? null;
  return {
    name: data.name ?? DEFAULT_BRAND_NAME,
    logo,
    isCustom: Boolean(data.name) || Boolean(logo),
  };
}

/**
 * Reflects the resolved branding into the document chrome (tab title +
 * favicon). The branding query is prefetched in the root loader, so the value
 * is already settled on first render; it never changes within a session, so a
 * mount-only sync is correct here.
 */
function useBrandedDocument(branding: ResolvedBranding): void {
  useMountEffect(() => {
    document.title = `${branding.name} | Portal do Cliente`;

    if (!branding.logo) return;
    const iconLink =
      document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!iconLink) return;
    iconLink.href = branding.logo;
    // Let the browser sniff the type from the response (logo may be png/svg/…).
    iconLink.removeAttribute("type");
  });
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery(brandingQueryOptions());
  const branding = resolveBranding(data);

  useBrandedDocument(branding);

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}
