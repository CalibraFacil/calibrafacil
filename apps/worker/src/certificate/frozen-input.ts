/**
 * Reads the frozen `certificate_input` of a job (ISO/IEC 17025 §7.8: the
 * certificate reflects the approved record).
 *
 * The approval transaction writes it (apps/api `approveJob`); this is the only
 * thing the worker renders a certificate from when it exists. Three outcomes:
 *
 *   - `none`: the job was approved before migration 0120, or never through the
 *     approval command. The caller renders through the LEGACY live-read path
 *     and says so;
 *   - `ok`: a document whose stored SHA-256 matches the hash of what was read;
 *   - `corrupt`: a document that does not read back as what was frozen (an
 *     unknown schema version, a different shape, a hash that no longer matches).
 *     Rendering from it would put something the lab never approved on a
 *     certificate, and retrying cannot fix it: a permanent failure.
 */

import {
  certificateInputSha256,
  CERTIFICATE_INPUT_SCHEMA_VERSION,
  isCertificateInput,
  type CertificateInput,
  type CertificateJobData,
} from "@calibra-facil/certificate-data";

/** The one thing this module needs from a `pg` client. */
export type RowQuery = {
  query(
    text: string,
    values: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
};

type FrozenCertificateInput =
  | { status: "none" }
  | { status: "ok"; input: CertificateInput; sha256: string }
  | { status: "corrupt"; reason: string };

async function fetchFrozenCertificateInput(
  client: RowQuery,
  params: { jobId: number; organizationId: string },
): Promise<FrozenCertificateInput> {
  const result = await client.query(
    `SELECT schema_version, input, sha256
       FROM certificate_input
      WHERE job_id = $1 AND organization_id = $2`,
    [params.jobId, params.organizationId],
  );
  const row = result.rows[0];
  if (!row) return { status: "none" };

  if (row.schema_version !== CERTIFICATE_INPUT_SCHEMA_VERSION) {
    return {
      status: "corrupt",
      reason: `unsupported schema version ${String(row.schema_version)}`,
    };
  }
  const document: unknown = row.input;
  if (!isCertificateInput(document)) {
    return {
      status: "corrupt",
      reason: "the document has an unexpected shape",
    };
  }
  const sha256 = certificateInputSha256(document);
  if (sha256 !== row.sha256) {
    return {
      status: "corrupt",
      reason: `sha256 mismatch (stored ${String(row.sha256)}, computed ${sha256})`,
    };
  }
  return { status: "ok", input: document, sha256 };
}

/** What a certificate is rendered from, and which path produced it. */
export type CertificateRenderSource =
  | { status: "ok"; input: CertificateInput; sha256: string }
  | { status: "corrupt"; reason: string }
  /** No frozen input: the LEGACY live read. `job` is null when the job is gone. */
  | { status: "legacy"; job: CertificateJobData | null };

/**
 * The frozen input when there is one; otherwise, and only then, `loadLegacy`
 * (the live read of the lab, signatory, customer and standards).
 */
export async function loadCertificateRenderSource(
  client: RowQuery,
  params: { jobId: number; organizationId: string | null },
  loadLegacy: () => Promise<CertificateJobData | null>,
): Promise<CertificateRenderSource> {
  if (params.organizationId) {
    const frozen = await fetchFrozenCertificateInput(client, {
      jobId: params.jobId,
      organizationId: params.organizationId,
    });
    if (frozen.status !== "none") return frozen;
  }
  return { status: "legacy", job: await loadLegacy() };
}
