import { Client } from "pg";
import {
  appendJobEvent,
  type SignatureAudit,
} from "@calibra-facil/db/job-events";
import { targetOf } from "@calibra-facil/schemas/job-transitions";
import {
  signAndTimestampPdf,
  verifyPdf,
  getIcpBrasilTrustAnchors,
  decryptPassword,
  decryptBinary,
  type SignatureMetadata,
  type VerifyPdfResult,
  createCrlFetcher,
} from "@calibra-facil/signing";
import { resolveTsaConfig } from "./tsa-config.js";
import { resolveSigningPolicy, SigningPolicyError } from "./signing-policy.js";
import { notifyCertificateReady } from "@calibra-facil/notifications";
import {
  jobEventTransaction,
  jobOrganizationOf,
  workerJobActor,
} from "./job-events.js";
import { type Env } from "./runtime-types.js";
import { withOrgDbClient } from "./pdf-render.js";

/** At-issue signature-integrity verdict persisted to calibration_job.signature_verdict. */
type StoredSignatureVerdict = VerifyPdfResult & { computedAt: string };

/**
 * Signing certificate data fetched from database
 */
// =============================================================================
// CERTIFICATE SIGNING AND ISSUANCE TRANSITION (#865 Phase 3)
//
// Restored from 45571b97, unchanged. None of it was layout-specific: it signs
// whatever PDF bytes it is handed and moves the job to APPROVED. It came out
// with the XLSX renderer only because issuance was the sole caller.
// =============================================================================

/** Narrows a jsonb column to a plain record without an `as` assertion. */
function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

export function parseSignatureMetadata(
  value: unknown,
): SignatureMetadata | undefined {
  if (value == null) return undefined;

  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parseSignatureMetadata(parsed);
    } catch {
      return undefined;
    }
  }

  const metadata = recordFromUnknown(value);
  const signedAt = metadata.signedAt;
  const signerCertificateSerial = metadata.signerCertificateSerial;
  const signerName = metadata.signerName;
  const signerCpfCnpj = metadata.signerCpfCnpj;
  const pdfHash = metadata.pdfHash;
  const ltvEnabled = metadata.ltvEnabled;
  if (
    typeof signedAt !== "string" ||
    typeof signerCertificateSerial !== "string" ||
    typeof signerName !== "string" ||
    (signerCpfCnpj !== null && typeof signerCpfCnpj !== "string") ||
    typeof pdfHash !== "string" ||
    typeof ltvEnabled !== "boolean"
  ) {
    return undefined;
  }

  return {
    signedAt,
    signerCertificateSerial,
    signerName,
    signerCpfCnpj,
    pdfHash,
    ltvEnabled,
  };
}

interface SigningCertificateData {
  encryptedP12: string;
  encryptedPassword: string;
  passwordIv: string;
  subjectCn: string;
}

/** #644: the unit's signing-policy flag (organization_unit.require_signature). */
async function fetchUnitRequireSignature(
  client: Client,
  organizationId: string,
  unitId: number,
): Promise<boolean> {
  const result = await client.query(
    `
        SELECT require_signature
        FROM organization_unit
        WHERE id = $1 AND organization_id = $2
        LIMIT 1
        `,
    [unitId, organizationId],
  );
  return result.rows[0]?.require_signature === true;
}

/**
 * Fetch organization's default signing certificate
 */
async function fetchSigningCertificate(
  client: Client,
  organizationId: string,
  unitId: number,
): Promise<SigningCertificateData | null> {
  const result = await client.query(
    `
        SELECT encrypted_p12, encrypted_password, password_iv, subject_cn
        FROM organization_signing_certificate
        WHERE organization_id = $1
          AND unit_id = $2
          AND is_active = true
          AND is_default = true
          AND valid_until > NOW()
        LIMIT 1
        `,
    [organizationId, unitId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    encryptedP12: row.encrypted_p12,
    encryptedPassword: row.encrypted_password,
    passwordIv: row.password_iv,
    subjectCn: row.subject_cn,
  };
}

/**
 * Outcome of the certificate-issuance status write.
 *
 * - `issued`: GENERATING_PDF -> APPROVED, audited.
 * - `watermarked`: a SUPERSEDED job keeps its status; only the stored
 *   certificate is refreshed.
 * - `skipped`: the job is in no state that may be issued (cancelled, rejected,
 *   already approved...). NOTHING was written; the caller must roll back
 *   whatever it created for this issuance.
 */
export type CertificateTransitionResult =
  | { outcome: "issued" }
  | { outcome: "watermarked" }
  | { outcome: "skipped"; currentStatus: string | null };

/** Thrown inside the issuance transaction to roll back a skipped issuance. */
export class CertificateIssuanceSkipped extends Error {
  constructor(readonly currentStatus: string | null) {
    super(`Certificate issuance skipped: job status is ${currentStatus}`);
    this.name = "CertificateIssuanceSkipped";
  }
}

/**
 * Locks the job row and returns its status. Held until the surrounding
 * transaction ends, so a concurrent cancel/reject/amend (compare-and-set on the
 * prior status) waits and then sees the post-issuance status.
 */
export async function lockJobStatus(
  client: Client,
  jobId: number,
): Promise<string | null> {
  const result = await client.query<{ status: string }>(
    `SELECT status FROM calibration_job WHERE id = $1 FOR UPDATE`,
    [jobId],
  );
  return result.rows[0]?.status ?? null;
}

/**
 * The issuance status write. Must run inside a transaction together with
 * whatever the caller created for this issuance (the issued snapshot row).
 *
 * Every write is compare-and-set on the status the worker expects:
 * `GENERATING_PDF` (approval in progress) or `SUPERSEDED` (watermark refresh).
 * Anything else (a job cancelled or rejected while the PDF rendered, or one that
 * is already APPROVED) writes nothing and is reported as `skipped`.
 */
export async function updateJobWithCertificate(
  client: Client,
  jobId: number,
  certificateUrl: string,
  userId: string,
  signatureMetadata?: SignatureMetadata,
  signatureVerdict?: StoredSignatureVerdict,
  options: { preserveSignatureMetadata?: boolean } = {},
): Promise<CertificateTransitionResult> {
  const now = new Date();

  const statusResult = await client.query<{
    status: string;
    signature_metadata: unknown;
  }>(
    `SELECT status, signature_metadata FROM calibration_job WHERE id = $1 FOR UPDATE`,
    [jobId],
  );
  const currentStatus = statusResult.rows[0]?.status ?? null;
  const renderedStatus = targetOf(currentStatus, "complete_render");
  if (renderedStatus === null) {
    return { outcome: "skipped", currentStatus };
  }
  // A SUPERSEDED job keeps its status: only its PDF is regenerated (watermark).
  const isSuperseded = currentStatus === "SUPERSEDED";
  const shouldPreserveSignatureMetadata =
    options.preserveSignatureMetadata === true &&
    signatureMetadata === undefined;
  const auditSignatureMetadata =
    signatureMetadata ??
    (shouldPreserveSignatureMetadata
      ? parseSignatureMetadata(statusResult.rows[0]?.signature_metadata)
      : undefined);

  // The verdict travels with the signature: write it only when a fresh one is
  // supplied, otherwise keep whatever is stored (regeneration / watermark paths
  // pass no verdict and must not wipe it).
  const writeSignatureVerdict = signatureVerdict !== undefined;

  // Compare-and-set: SUPERSEDED jobs are being regenerated with watermark and
  // keep their status; GENERATING_PDF becomes APPROVED. A job that left the
  // expected status since the read above matches zero rows.
  const updated = await client.query<{ id: number; organization_id: string }>(
    `
    UPDATE calibration_job
    SET
      status = $8,
      certificate_url = $2,
      signature_metadata = CASE WHEN $5 THEN signature_metadata ELSE $3::jsonb END,
      signature_verdict = CASE WHEN $6 THEN $7::jsonb ELSE signature_verdict END,
      updated_at = $4
    WHERE id = $1 AND status = $9
    RETURNING id, organization_id
    `,
    [
      jobId,
      certificateUrl,
      signatureMetadata ? JSON.stringify(signatureMetadata) : null,
      now,
      shouldPreserveSignatureMetadata,
      writeSignatureVerdict,
      signatureVerdict ? JSON.stringify(signatureVerdict) : null,
      renderedStatus,
      currentStatus,
    ],
  );
  if (updated.rows.length === 0) {
    return { outcome: "skipped", currentStatus };
  }

  // Watermark regeneration of a SUPERSEDED job vs. the first issuance.
  const signatureAudit: SignatureAudit = auditSignatureMetadata
    ? { signed: true, signerName: auditSignatureMetadata.signerName }
    : { signed: false };
  const organizationId = jobOrganizationOf(updated.rows, jobId);
  const actor = workerJobActor(userId);
  await appendJobEvent(
    jobEventTransaction(client),
    isSuperseded
      ? {
          action: "certificate_watermarked",
          organizationId,
          jobId,
          actor,
          performedAt: now,
          changes: {
            status: "SUPERSEDED (watermark added)",
            certificateUrl: { old: null, new: certificateUrl },
            signatureMetadata: signatureAudit,
          },
        }
      : {
          action: "certificate_generated",
          organizationId,
          jobId,
          actor,
          performedAt: now,
          changes: {
            status: { old: currentStatus, new: renderedStatus },
            certificateUrl: { old: null, new: certificateUrl },
            signatureMetadata: signatureAudit,
          },
        },
  );

  return { outcome: isSuperseded ? "watermarked" : "issued" };
}

/** Customer-facing "certificate ready" mail; only after the issuance COMMITs. */
export async function notifyCertificateIssued(jobId: number): Promise<void> {
  try {
    await notifyCertificateReady(jobId);
  } catch (error) {
    console.error(
      `[JOB ${jobId}] Failed to send certificate ready notification:`,
      error,
    );
  }
}

export async function signPdfWithUnitCertificate(
  env: Env,
  jobId: number,
  organizationId: string | null | undefined,
  unitId: number | null | undefined,
  pdfBuffer: Buffer,
): Promise<{
  pdfBuffer: Buffer;
  signatureMetadata?: SignatureMetadata;
  signatureVerdict?: StoredSignatureVerdict;
}> {
  const signStart = performance.now();
  if (!organizationId) {
    console.warn(`[JOB ${jobId}] Missing organization_id for signing`);
  }
  if (!unitId) {
    console.warn(`[JOB ${jobId}] Missing unit_id for signing`);
  }

  // #644 (CMP-01): the unit's signing policy governs the missing-cert /
  // missing-master-key paths. Unresolvable flag (legacy job without unit)
  // keeps the pre-#644 permissive behavior.
  const requireSignature =
    organizationId && unitId
      ? await withOrgDbClient(env, organizationId, (client) =>
          fetchUnitRequireSignature(client, organizationId, unitId),
        )
      : false;

  const signingCert =
    env.SIGNING_MASTER_KEY && organizationId && unitId
      ? await withOrgDbClient(env, organizationId, (client) =>
          fetchSigningCertificate(client, organizationId, unitId),
        )
      : null;

  const policy = resolveSigningPolicy({
    hasMasterKey: Boolean(env.SIGNING_MASTER_KEY),
    hasCertificate: signingCert !== null,
    requireSignature,
  });
  if (policy.action === "FAIL") {
    throw new SigningPolicyError(policy.reason);
  }
  if (policy.action === "EMIT_UNSIGNED" || !signingCert) {
    // Visible, not silent: signature_metadata stays NULL, so the portal and
    // the public verification page render the UNSIGNED verdict.
    console.warn(
      `[JOB ${jobId}] ${policy.action === "EMIT_UNSIGNED" ? policy.warning : "No signing certificate available"}`,
    );
    return { pdfBuffer };
  }

  // Narrowing only: the certificate fetch above is gated on the master key,
  // so a non-null signingCert implies the key is present.
  const masterKey = env.SIGNING_MASTER_KEY;
  if (!masterKey) {
    return { pdfBuffer };
  }

  try {
    const password = decryptPassword(
      signingCert.encryptedPassword,
      signingCert.passwordIv,
      masterKey,
    );
    const p12Buffer = decryptBinary(signingCert.encryptedP12, masterKey);
    // #646 / CMP-03: with a TSA configured this embeds an RFC 3161 carimbo do
    // tempo (PAdES-T / AD-RT) and FAILS CLOSED on TSA errors; without one it is
    // byte-identical to the pre-#646 AD-RB signature.
    const result = await signAndTimestampPdf(pdfBuffer, {
      p12Buffer,
      password,
      reason: "Certificado de Calibracao - CalibraFacil",
      location: "Brasil",
      enableLtv: false,
      timestamp: resolveTsaConfig(env),
    });

    console.log(
      `[JOB ${jobId}] signPdf: ${Math.round(performance.now() - signStart)}ms (signed by ${signingCert.subjectCn})`,
    );

    // Precompute the at-issue signature-integrity verdict so the public
    // verification page can serve it without re-downloading + re-verifying the
    // PDF on every hit. Best-effort — verifyPdf never throws, but a verdict
    // failure must never block issuance.
    let signatureVerdict: StoredSignatureVerdict | undefined;
    try {
      const verdict = await verifyPdf(result.signedPdf, {
        expectedSha256: result.metadata.pdfHash,
        trustAnchors: getIcpBrasilTrustAnchors(),
        // #646 fase b: best-effort revocation at issue time (verdict degrades
        // to revocationChecked=false on network trouble; never blocks issuance
        // since this whole precompute is already best-effort).
        fetchCrl: createCrlFetcher(),
        checkDate: new Date(result.metadata.signedAt),
      });
      signatureVerdict = { ...verdict, computedAt: result.metadata.signedAt };
      console.log(`[JOB ${jobId}] verifyPdf: overall=${verdict.overall}`);
    } catch (verifyError) {
      console.error(`[JOB ${jobId}] verifyPdf failed:`, verifyError);
    }

    return {
      pdfBuffer: Buffer.from(result.signedPdf),
      signatureMetadata: result.metadata,
      signatureVerdict,
    };
  } catch (signError) {
    // #644 (REQ-CMP-SIGN-001/002): a configured certificate that fails to sign
    // ALWAYS fails the emission — the job goes REJECTED with a named reason and
    // neither the R2 upload, the APPROVED transition nor notifyCertificateReady
    // (all downstream of this call) can run. Includes #646's TIMESTAMP_FAILED.
    console.error(`[JOB ${jobId}] PDF signing failed:`, signError);
    if (signError instanceof SigningPolicyError) {
      throw signError;
    }
    const detail =
      signError instanceof Error ? signError.message : String(signError);
    // Not permanent: the failure may be a TSA/network outage, so earlier
    // deliveries retry it; the final one still REJECTS the job.
    throw new SigningPolicyError(
      `Falha na assinatura digital do certificado: ${detail}`,
      { permanent: false },
    );
  }
}
