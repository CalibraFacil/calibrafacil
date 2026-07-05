/**
 * PAdES-T orchestration (issue #646 / CMP-03): sign, then (when a TSA is
 * configured) embed an RFC 3161 timestamp — the AD-RT building block of
 * DOC-ICP-15.03. Legal basis for the signature itself: MP 2.200-2 (ICP-Brasil)
 * + ABNT NBR ISO/IEC 17025:2017 §7.8 (signatory identification).
 *
 * Fail-closed by design (REQ-CMP-LTV-003): if a TSA is configured and the
 * stamp cannot be obtained, this throws SigningError("TIMESTAMP_FAILED") so
 * callers treat it as a signing failure — a certificate is never silently
 * emitted without the configured carimbo do tempo. Without a TSA config the
 * behavior is byte-identical to plain signPdf (AD-RB, the pre-#646 baseline).
 *
 * The returned metadata.pdfHash always describes the FINAL artifact (the
 * timestamped bytes when stamping ran) — it is what gets persisted and what
 * the public verification page checks the stored object against.
 */
import { createHash } from "node:crypto";

import { signPdf } from "./signer.js";
import { addRfc3161Timestamp } from "./timestamp.js";
import type { TimestampConfig } from "./timestamp.js";
import { SigningError } from "./types.js";
import type { SigningOptions, SigningResult } from "./types.js";

export interface SignAndTimestampOptions extends SigningOptions {
  /** RFC 3161 TSA configuration. Absent/empty URL => plain AD-RB signing. */
  timestamp?: TimestampConfig | null;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function signAndTimestampPdf(
  pdf: Buffer,
  options: SignAndTimestampOptions,
): Promise<SigningResult> {
  const { timestamp, ...signOptions } = options;
  const signed = await signPdf(pdf, signOptions);

  if (!timestamp?.tsaUrl) {
    return signed;
  }

  let outcome;
  try {
    outcome = await addRfc3161Timestamp(signed.signedPdf, timestamp);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SigningError(
      `Falha ao obter carimbo do tempo RFC 3161 da TSA configurada: ${detail}`,
      "TIMESTAMP_FAILED",
    );
  }

  if (!outcome.timestamped) {
    // A configured TSA must actually stamp; a silent no-op would violate the
    // fail-closed contract.
    throw new SigningError(
      "TSA configurada mas nenhum carimbo do tempo foi embutido.",
      "TIMESTAMP_FAILED",
    );
  }

  return {
    signedPdf: outcome.pdf,
    metadata: {
      ...signed.metadata,
      pdfHash: sha256Hex(outcome.pdf),
      timestamped: true,
      timestampIcpBrasilConformant: outcome.icpBrasilConformant,
    },
  };
}
