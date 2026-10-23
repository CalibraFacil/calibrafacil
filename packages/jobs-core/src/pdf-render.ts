import { Client } from "pg";
import { type Env } from "./runtime-types.js";

// Helper to run a database operation with a fresh connection
export async function withDbClient<T>(
  env: Env,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: env.DATABASE_URL,
  });
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Render HTML to PDF via the Gotenberg Chromium engine (services/gotenberg),
 * replacing the previous in-function headless Chromium so the worker no
 * longer bundles puppeteer or downloads a Chromium pack.
 */
function requireGotenbergUrl(env: Env): string {
  if (!env.GOTENBERG_URL) {
    throw new Error("GOTENBERG_URL is required for HTML to PDF conversion.");
  }
  // Tolerate scheme-less values (fetch() rejects them with the opaque
  // "fetch() URL is invalid"): default to https.
  const raw = env.GOTENBERG_URL.trim().replace(/\/$/, "");
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export async function gotenbergHtmlToPdf(
  env: Env,
  html: string,
  properties: Record<string, string>,
  extraFiles: Record<string, string> = {},
): Promise<Uint8Array> {
  const url = requireGotenbergUrl(env);
  const form = new FormData();
  form.append(
    "files",
    new Blob([`<!DOCTYPE html>${html}`], { type: "text/html" }),
    "index.html",
  );
  for (const [filename, content] of Object.entries(extraFiles)) {
    form.append("files", new Blob([content], { type: "text/html" }), filename);
  }
  for (const [key, value] of Object.entries(properties)) {
    form.set(key, value);
  }

  const headers: Record<string, string> = {};
  if (env.GOTENBERG_TOKEN) {
    headers["X-Gotenberg-Token"] = env.GOTENBERG_TOKEN;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${url}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Falha na renderização do PDF — o serviço de conversão retornou ${response.status}. Tente novamente; se persistir, contate o suporte.`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

// A4 paper size in inches.
const A4_PAPER = { paperWidth: "8.27", paperHeight: "11.69" } as const;

// Footer with page numbers (Chromium fills pageNumber/totalPages), matching the
// previous puppeteer footerTemplate.
const DOC_PAGE_FOOTER_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8" /></head>' +
  '<body><div style="width:100%;font-size:9px;text-align:center;color:#666;">' +
  'Página <span class="pageNumber"></span> de <span class="totalPages"></span>' +
  "</div></body></html>";

/**
 * Generates an A4 PDF from HTML. Three layouts, distinguished by the
 * `data-pdf-layout` attribute the document sets on its own <html>:
 *
 *   full-page   — CSS @page size, zero margins, no running furniture.
 *   certificate — CSS @page size AND margins, plus a running header and
 *                 footer on every page (#865).
 *   (default)   — fixed A4 with our margins and a "Página X de Y" footer.
 *
 * The certificate branch exists because it is the only document that needs
 * both its own margins and a running header: NIE-Cgcre-009 §11.5.2 wants the
 * accreditation sentence carried on continuation pages, and §7.8.2.1(d) wants
 * every page identifiable on its own. `preferCssPageSize` makes Chromium take
 * the margin box from the stylesheet, and the header/footer render inside it —
 * so the layout owns its own geometry and the preview in a browser matches.
 */
/**
 * Chooses the Gotenberg conversion properties for a document, from the
 * `data-pdf-layout` attribute it sets on its own <html>.
 *
 *   certificate — CSS @page size AND margins, plus a running header and footer
 *                 on every page (#865). NIE-Cgcre-009 §11.5.2 carries the
 *                 accreditation sentence onto continuation pages, and
 *                 §7.8.2.1(d) wants every page identifiable on its own.
 *                 `preferCssPageSize` hands the margin box to the stylesheet,
 *                 so the layout owns its geometry and a browser preview agrees
 *                 with the PDF.
 *   full-page   — CSS @page size, zero margins, no running furniture.
 *   (default)   — fixed A4 with our margins and a "Página X de Y" footer.
 *
 * Split out from `generatePdfFromHtml` so the branch is a pure function: which
 * geometry a certificate gets is a compliance property, and asserting it should
 * not require a Gotenberg container.
 */
export function resolvePdfRenderRequest(
  html: string,
  options: { headerHtml?: string; footerHtml?: string } = {},
): { properties: Record<string, string>; extraFiles: Record<string, string> } {
  if (html.includes('data-pdf-layout="certificate"')) {
    const extraFiles: Record<string, string> = {};
    if (options.headerHtml) extraFiles["header.html"] = options.headerHtml;
    if (options.footerHtml) extraFiles["footer.html"] = options.footerHtml;
    return {
      properties: { preferCssPageSize: "true", printBackground: "true" },
      extraFiles,
    };
  }

  if (html.includes('data-pdf-layout="full-page"')) {
    return {
      properties: {
        preferCssPageSize: "true",
        printBackground: "true",
        marginTop: "0",
        marginBottom: "0",
        marginLeft: "0",
        marginRight: "0",
      },
      extraFiles: {},
    };
  }

  return {
    properties: {
      ...A4_PAPER,
      printBackground: "true",
      marginTop: "0.3937", // 10mm
      marginBottom: "0.5906", // 15mm — room for the footer
      marginLeft: "0.3937",
      marginRight: "0.3937",
    },
    extraFiles: { "footer.html": DOC_PAGE_FOOTER_HTML },
  };
}

/** Generates a PDF from HTML, with the geometry its layout asks for. */
export async function generatePdfFromHtml(
  env: Env,
  html: string,
  options: {
    /** Running header markup, for the certificate layout. */
    headerHtml?: string;
    /** Running footer markup, for the certificate layout. */
    footerHtml?: string;
  } = {},
): Promise<Uint8Array> {
  const { properties, extraFiles } = resolvePdfRenderRequest(html, options);
  return gotenbergHtmlToPdf(env, html, properties, extraFiles);
}
