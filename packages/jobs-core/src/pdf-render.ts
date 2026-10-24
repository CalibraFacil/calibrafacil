import { Client, type QueryResult, type QueryResultRow } from "pg";
import { inOrganizationTransaction } from "./job-events.js";
import { type Env } from "./runtime-types.js";

/** What opening a connection needs; every handler's env satisfies it. */
export type DatabaseEnv = Pick<Env, "DATABASE_URL">;

/** What the system path needs on top: the owner connection and the RLS mode. */
export type SystemDatabaseEnv = Pick<
  Env,
  "DATABASE_URL" | "DATABASE_OWNER_URL" | "DATABASE_RLS_MODE"
>;

// Helper to run a database operation with a fresh connection
export async function withDbClient<T>(
  env: DatabaseEnv,
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

/**
 * The system path: a connection of the table owner, for the statements that are
 * cross-organization by design (which laboratory owns this job; which
 * laboratories exist; which rows of every laboratory are owed). Each use is ONE
 * lookup or listing with a comment saying why, never per-laboratory work.
 * `DATABASE_OWNER_URL` is the owner once the application connects as
 * `calibra_app`; unset, the system path shares `DATABASE_URL` (the owner while
 * row-level security is in shadow mode).
 */
export async function withSystemDbClient<T>(
  env: Pick<Env, "DATABASE_URL" | "DATABASE_OWNER_URL">,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  return withDbClient(
    { ...env, DATABASE_URL: env.DATABASE_OWNER_URL || env.DATABASE_URL },
    operation,
  );
}

/**
 * The laboratory a queue message's subject belongs to, or null when there is no
 * such row. A queue message names a job, an order, an export, not its
 * laboratory, so this is the one lookup per message that cannot name an
 * organization yet: it runs on the system path (`select <organization column>
 * ... where id = $1`, one column of one row by primary key). Everything after
 * it runs in `withOrgDbClient`.
 *
 * Null means the row does not exist, EXCEPT when the worker runs under
 * `DATABASE_RLS_MODE=enforced` without `DATABASE_OWNER_URL`: then the lookup runs
 * as the application role, which sees no row at all, and "not found" would be a
 * lie that marks the work permanently failed (or leaves it stuck with the sweep
 * blind to it). That case throws a plain error, so the queue retries the
 * message and the misconfiguration is loud.
 */
export async function findOrganizationOnSystemPath(
  env: SystemDatabaseEnv,
  subject: string,
  lookupSql: string,
  values: unknown[],
): Promise<string | null> {
  return withSystemDbClient(env, async (client) => {
    const result = await client.query<{ organization_id: string }>(
      lookupSql,
      values,
    );
    const organizationId = result.rows[0]?.organization_id ?? null;
    if (
      organizationId === null &&
      env.DATABASE_RLS_MODE === "enforced" &&
      !env.DATABASE_OWNER_URL
    ) {
      throw new Error(
        `Cannot tell which laboratory ${subject} belongs to: DATABASE_RLS_MODE=enforced but DATABASE_OWNER_URL is not set, so the lookup ran as the application role. Set DATABASE_OWNER_URL on the worker.`,
      );
    }
    return organizationId;
  });
}

/** The laboratory a calibration job belongs to (see `findOrganizationOnSystemPath`). */
export async function findJobOrganization(
  env: Env,
  jobId: number,
): Promise<string | null> {
  return findOrganizationOnSystemPath(
    env,
    `job ${jobId}`,
    "select organization_id from calibration_job where id = $1 limit 1",
    [jobId],
  );
}

/**
 * A fresh connection and ONE transaction that names the laboratory (row-level
 * security): `operation` and everything it queries on `client` commit or roll
 * back together. Never call out to storage or HTTP inside `operation`.
 */
export function withOrgDbClient<T>(
  env: DatabaseEnv,
  organizationId: string,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  return withDbClient(env, (client) =>
    inOrganizationTransaction(client, organizationId, () => operation(client)),
  );
}

/**
 * One laboratory's work on ONE connection, for a handler that interleaves
 * database statements with I/O (an e-mail, a remote HTTP call) and so must
 * never hold a transaction open across the I/O. Every `query` and every
 * `transaction` is its own short transaction that names the laboratory
 * (`calibra.organization_id`, row-level security); between them the connection
 * sits idle and no transaction is open.
 */
export interface OrgSession {
  readonly organizationId: string;
  /** One statement in a transaction of its own (BEGIN, set_config, the statement, COMMIT). */
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
  /**
   * Several statements that commit or roll back together (an update and its
   * audit row). Never call out to I/O inside `operation`.
   */
  transaction<T>(operation: (client: Client) => Promise<T>): Promise<T>;
}

/** A fresh connection serving the `OrgSession` of one laboratory until `operation` ends. */
export function withOrgSession<T>(
  env: DatabaseEnv,
  organizationId: string,
  operation: (session: OrgSession) => Promise<T>,
): Promise<T> {
  return withDbClient(env, (client) => {
    const transaction = <R>(run: (client: Client) => Promise<R>) =>
      inOrganizationTransaction(client, organizationId, () => run(client));
    return operation({
      organizationId,
      transaction,
      query: <R extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: unknown[],
      ) => transaction((tx) => tx.query<R>(text, values)),
    });
  });
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
