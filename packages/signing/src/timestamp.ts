/**
 * RFC-3161 timestamp (carimbo de tempo) wrapper — the PAdES-T building block.
 *
 * Adds a document-level RFC-3161 timestamp to a signed PDF via `pdf-rfc3161`
 * (pure-JS, worker-safe). Disabled unless a TSA endpoint is supplied.
 *
 * ⚠ ICP-Brasil conformance: a timestamp is only ICP-Brasil-conformant when the
 * TSA is a credentialed ICP-Brasil **ACT** (Autoridade de Carimbo do Tempo) — a
 * paid, contracted service. A generic RFC-3161 TSA (e.g. FreeTSA/DigiCert)
 * produces a technically valid timestamp that is NOT ICP-Brasil-conformant; use
 * it only to exercise the pipeline. The `icpBrasilConformant` flag is recorded
 * on the outcome so callers never imply legal/LTV validity they don't have.
 */
import { timestampPdf } from "pdf-rfc3161";

export interface TimestampConfig {
  /** RFC-3161 TSA endpoint URL. ICP-Brasil conformance requires a contracted ACT. */
  tsaUrl: string;
  /**
   * Extra HTTP headers for the TSA request — how contracted ACTs authenticate
   * (e.g. `{ Authorization: "Basic …" }` for BRy, `Bearer` for Serpro's OAuth2
   * wrapper). Generic anonymous TSAs need none.
   */
  headers?: Record<string, string>;
  /** TSA request timeout in milliseconds (pdf-rfc3161 default: 30000). */
  timeoutMs?: number;
  /** Whether `tsaUrl` is a credentialed ICP-Brasil ACT (for honest labeling). */
  icpBrasilConformant?: boolean;
  reason?: string;
  location?: string;
}

export interface TimestampOutcome {
  /** The (possibly) timestamped PDF — unchanged when timestamping is disabled. */
  pdf: Uint8Array;
  /** Whether a timestamp token was embedded. */
  timestamped: boolean;
  /** Whether the TSA used is a credentialed ICP-Brasil ACT. */
  icpBrasilConformant: boolean;
}

/**
 * Add an RFC-3161 timestamp to a (signed) PDF. Returns the input unchanged when
 * no TSA URL is configured, so it is safe to call unconditionally.
 */
export async function addRfc3161Timestamp(
  pdf: Uint8Array,
  config?: TimestampConfig | null,
): Promise<TimestampOutcome> {
  if (!config?.tsaUrl) {
    return { pdf, timestamped: false, icpBrasilConformant: false };
  }

  const result = await timestampPdf({
    pdf,
    tsa: {
      url: config.tsaUrl,
      ...(config.headers ? { headers: config.headers } : {}),
      ...(config.timeoutMs !== undefined ? { timeout: config.timeoutMs } : {}),
    },
    reason: config.reason,
    location: config.location,
  });

  return {
    pdf: result.pdf,
    timestamped: true,
    icpBrasilConformant: config.icpBrasilConformant ?? false,
  };
}
