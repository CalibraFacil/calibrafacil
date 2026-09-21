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

// Where the on-site lead form lives (the Vite landing owns "/"). This is the
// PRIMARY CTA everywhere: it is the only channel with no capacity ceiling.
export const CONTACT_URL = "/#contato";

// The live demo, always a SECONDARY action. Availability is deliberately thin
// (Saturdays and weekday evenings) because there is no full-time salesperson,
// so no copy next to this link may promise a slot on demand — say that the
// hours are limited and let the calendar show what is actually free.
export const DEMO_URL = "https://cal.com/calibrafacil/30min?user=calibrafacil";

// The one synchronous-ish channel we do offer. Centralised so the number lives
// in a single place (floating button, footer, lead confirmation).
export const WHATSAPP_NUMBER = "5551900000000";

export function whatsappUrl(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
