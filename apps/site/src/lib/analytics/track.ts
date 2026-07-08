declare global {
  interface Window {
    // GTM data layer + Consent Mode gtag shim. The shim + defaults are set by
    // the inline snippet in layout.tsx before GTM loads.
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

// Push a semantic marketing event onto the GTM data layer. Tags inside the GTM
// container (GA4, Meta, LinkedIn) trigger off these event names — all still
// gated by Consent Mode, so nothing fires until the visitor opts in.
export function track(event: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;

  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event, ...params });
}
