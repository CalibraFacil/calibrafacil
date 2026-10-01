// Canonical identity for the project site, shared by metadata, JSON-LD,
// sitemap and robots so absolute URLs never drift. NEXT_PUBLIC_SERVER_URL can
// override the origin (previews, forks hosting their own copy).
const RAW_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "https://calibrafacil.com";

export const SITE_URL = RAW_URL.replace(/\/+$/, "");
export const SITE_NAME = "CalibraFácil";
export const SITE_DESCRIPTION =
  "Software de código aberto para laboratórios de calibração ISO/IEC 17025 e oficinas do Inmetro: incerteza (GUM), certificados assinados em ICP-Brasil e portal do cliente.";
export const LOCALE = "pt_BR";

// The source code. Every primary call to action on the site points here.
export const REPOSITORY_URL = "https://github.com/CalibraFacil/calibrafacil";
export const CONTRIBUTING_URL = `${REPOSITORY_URL}/blob/main/CONTRIBUTING.md`;
export const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`;
export const DISCUSSIONS_URL = `${REPOSITORY_URL}/discussions`;

// User and self-hosting documentation (apps/docs, served under /docs).
export const DOCS_URL = "/docs";

// In-page anchor of the "run it yourself" section on the home page.
export const OPEN_SOURCE_URL = "/#codigo-aberto";

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
