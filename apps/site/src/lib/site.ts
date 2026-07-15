// Canonical identity for the marketing site, shared by metadata, JSON-LD,
// sitemap and robots so absolute URLs never drift. The site is served at the
// apex (calibrafacil.com); NEXT_PUBLIC_SERVER_URL can override in previews.
const RAW_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "https://calibrafacil.com";

export const SITE_URL = RAW_URL.replace(/\/+$/, "");
export const SITE_NAME = "CalibraFácil";
export const SITE_DESCRIPTION =
  "Gestão para laboratórios de calibração ISO/IEC 17025 e oficinas do Inmetro: incerteza (GUM), certificados assinados em ICP-Brasil e portal do cliente.";
export const LOCALE = "pt_BR";

// Where the on-site lead form lives (the Vite landing owns "/"). Marketing CTAs
// point here so every page routes into the same capture funnel.
export const CONTACT_URL = "/#contato";
export const DEMO_URL = "https://cal.com/calibrafacil/30min?user=calibrafacil";

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
