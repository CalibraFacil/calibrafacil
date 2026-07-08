declare global {
  interface Window {
    // GTM data layer + Consent Mode gtag shim. The shim is defined by the
    // inline snippet in index.html so Consent Mode defaults exist before any
    // tag loads; GTM itself is injected at runtime from gtm.ts (never on
    // desktop).
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

// Push a semantic marketing event onto the GTM data layer. Tags inside the GTM
// container (GA4, Meta, LinkedIn) trigger off these event names — all still
// gated by Consent Mode, so nothing fires until the visitor opts in. Safe to
// call before GTM loads: events queue on the data layer and replay on load.
export function track(event: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined') return

  window.dataLayer = window.dataLayer ?? []
  window.dataLayer.push({ event, ...params })
}
