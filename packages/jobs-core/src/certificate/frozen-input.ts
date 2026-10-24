/**
 * Reads the frozen `certificate_input` of a job (ISO/IEC 17025 §7.8: the
 * certificate reflects the approved record).
 *
 * The approval transaction writes it (apps/api `approveJob`); this is the only
 * thing the worker renders a certificate from when it exists. Three outcomes:
 *
 *   - `none`: the job's approval recorded no frozen input (it was approved
 *     before migration 0120). The caller renders through the LEGACY live-read
 *     path and says so. Only that: an approval that DID record one, whose row is
 *     missing, is `corrupt`;
 *   - `ok`: a document whose stored SHA-256 matches the hash of what was read;
 *   - `corrupt`: a document that does not read back as what was frozen (an
 *     unknown schema version, a different shape, a hash that no longer matches
 *     the stored one or the one the approval recorded), or no document at all
 *     for an approval that recorded one.
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
  // What the LATEST approval of the job recorded (`changes.certificateInputSha256`,
  // written in the same transaction as the document): absent on approvals made
  // before migration 0120.
  const approval = await client.query(
    `SELECT changes ->> 'certificateInputSha256' AS sha256
       FROM job_audit_log
      WHERE job_id = $1 AND organization_id = $2 AND action = 'approve'
      ORDER BY id DESC
      LIMIT 1`,
    [params.jobId, params.organizationId],
  );
  const recorded = approval.rows[0]?.sha256;
  const recordedSha256 = typeof recorded === "string" ? recorded : null;

  const result = await client.query(
    `SELECT schema_version, input, sha256
       FROM certificate_input
      WHERE job_id = $1 AND organization_id = $2`,
    [params.jobId, params.organizationId],
  );
  const row = result.rows[0];
  if (!row) {
    if (recordedSha256) {
      return {
        status: "corrupt",
        reason: `certificate_input missing for a post-0120 approval (it recorded sha256 ${recordedSha256})`,
      };
    }
    return { status: "none" };
  }

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
  if (recordedSha256 && recordedSha256 !== sha256) {
    return {
      status: "corrupt",
      reason: `sha256 differs from the one the approval recorded (recorded ${recordedSha256}, found ${sha256})`,
    };
  }
  return { status: "ok", input: document, sha256 };
}

/**
 * What a certificate is rendered from, and which path produced it. `L` is what
 * the legacy loader returns: the assembled job by default, or the rows read in a
 * transaction when the caller resolves the images after it (see
 * `readCertificateJobRows`).
 */
export type CertificateRenderSource<L = CertificateJobData | null> =
  | { status: "ok"; input: CertificateInput; sha256: string }
  | { status: "corrupt"; reason: string }
  /** No frozen input: the LEGACY live read. `job` is null when the job is gone. */
  | { status: "legacy"; job: L };

/**
 * The frozen input when there is one; otherwise, and only then, `loadLegacy`
 * (the live read of the lab, signatory, customer and standards).
 */
export async function loadCertificateRenderSource<
  L = CertificateJobData | null,
>(
  client: RowQuery,
  params: { jobId: number; organizationId: string | null },
  loadLegacy: () => Promise<L>,
): Promise<CertificateRenderSource<L>> {
  if (params.organizationId) {
    const frozen = await fetchFrozenCertificateInput(client, {
      jobId: params.jobId,
      organizationId: params.organizationId,
    });
    if (frozen.status !== "none") return frozen;
  }
  return { status: "legacy", job: await loadLegacy() };
}
