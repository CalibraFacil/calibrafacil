import { Client } from "pg";
import { appendCertificateStatusEvent } from "@calibra-facil/db/certificate-status-events";
import {
  appendJobEvent,
  type SignatureAudit,
} from "@calibra-facil/db/job-events";
import { deriveCertificateLifecycle } from "@calibra-facil/schemas/certificate-lifecycle";
import {
  requireTargetOf,
  targetOf,
} from "@calibra-facil/schemas/job-transitions";
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
import {
  notifyCertificateAmended,
  notifyCertificateReady,
  notifySigningCertificateLapsed,
} from "@calibra-facil/notifications";
import { formatInstant } from "@calibra-facil/shared/format";
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

/**
 * The unit's signing policy: #644 `require_signature` and, since Q51, the
 * recorded reason of its explicit "emitir sem assinatura digital" setting
 * (null = the unit did not choose to issue unsigned).
 */
async function fetchUnitSigningPolicy(
  client: Client,
  organizationId: string,
  unitId: number,
): Promise<{
  requireSignature: boolean;
  unsignedIssuanceReason: string | null;
}> {
  const result = await client.query(
    `
        SELECT require_signature, unsigned_issuance_reason
        FROM organization_unit
        WHERE id = $1 AND organization_id = $2
        LIMIT 1
        `,
    [unitId, organizationId],
  );
  const reason: unknown = result.rows[0]?.unsigned_issuance_reason;
  return {
    requireSignature: result.rows[0]?.require_signature === true,
    unsignedIssuanceReason:
      typeof reason === "string" && reason.trim() ? reason : null,
  };
}

/**
 * Whether the unit has EVER had a signing certificate (P0-8): any row, expired,
 * revoked and deactivated ones included, and the state of the newest one, for the
 * reason a blocked issuance reports. `fetchSigningCertificate` only sees a valid
 * default certificate, so without this an expired A1 looks like "never had one".
 */
async function fetchSigningCertificateHistory(
  client: Client,
  organizationId: string,
  unitId: number,
): Promise<{ hadCertificate: boolean; lapse: string | undefined }> {
  const result = await client.query<{
    valid_until: Date;
    is_active: boolean;
    is_default: boolean;
    revoked_at: Date | null;
    expired: boolean;
  }>(
    `
        SELECT valid_until, is_active, is_default, revoked_at,
               valid_until <= NOW() AS expired
        FROM organization_signing_certificate
        WHERE organization_id = $1
          AND unit_id = $2
        ORDER BY valid_until DESC, id DESC
        LIMIT 1
        `,
    [organizationId, unitId],
  );
  const latest = result.rows[0];
  if (!latest) return { hadCertificate: false, lapse: undefined };
  if (latest.revoked_at || !latest.is_active) {
    return { hadCertificate: true, lapse: "o último certificado foi revogado" };
  }
  if (latest.expired) {
    return {
      hadCertificate: true,
      lapse: `o último certificado expirou em ${formatInstant(latest.valid_until, "date")}`,
    };
  }
  return {
    hadCertificate: true,
    lapse: "nenhum certificado de assinatura está definido como padrão",
  };
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
  | {
      outcome: "issued";
      /**
       * Set when this issuance replaced an earlier certificate (an amendment):
       * the original job, superseded in the SAME transaction, and the written
       * reason of the amendment. The caller tells the customer once it commits.
       */
      supersession?: { originalJobId: number; reason: string | null };
    }
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
  options: {
    preserveSignatureMetadata?: boolean;
    /** Q51: the reason the unit recorded for issuing unsigned; written on the audit event. */
    unsignedByPolicy?: string;
  } = {},
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
  const updated = await client.query<{
    id: number;
    organization_id: string;
    job_id: string;
    supersedes_id: number | null;
    amendment_reason: string | null;
  }>(
    `
    UPDATE calibration_job
    SET
      status = $8,
      certificate_url = $2,
      signature_metadata = CASE WHEN $5 THEN signature_metadata ELSE $3::jsonb END,
      signature_verdict = CASE WHEN $6 THEN $7::jsonb ELSE signature_verdict END,
      updated_at = $4
    WHERE id = $1 AND status = $9
    RETURNING id, organization_id, job_id, supersedes_id, amendment_reason
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
    : options.unsignedByPolicy
      ? { signed: false, unsignedByPolicy: options.unsignedByPolicy }
      : { signed: false };
  const organizationId = jobOrganizationOf(updated.rows, jobId);
  const actor = workerJobActor(userId);

  // The amendment's certificate is issued: the original stops being the valid
  // one in THIS transaction, never before (ISO/IEC 17025 §7.8.8). It takes the
  // original's row lock, so it runs BEFORE this transaction's first audit row:
  // an audit insert holds the organization's hash-chain lock until COMMIT
  // (migration 0131), and a row lock taken after it can deadlock against a
  // transaction (a withdrawal, an amendment) that holds that row and then audits.
  const replaced = updated.rows[0];
  let supersession: { originalJobId: number; reason: string | null } | null =
    null;
  if (!isSuperseded && replaced?.supersedes_id) {
    await supersedeOriginalOnIssuance(client, {
      organizationId,
      originalJobId: replaced.supersedes_id,
      replacementJobId: jobId,
      replacementNumber: replaced.job_id,
      reason: replaced.amendment_reason,
      userId,
      now,
    });
    supersession = {
      originalJobId: replaced.supersedes_id,
      reason: replaced.amendment_reason,
    };
  }

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

  if (isSuperseded) return { outcome: "watermarked" };
  return supersession
    ? { outcome: "issued", supersession }
    : { outcome: "issued" };
}

/**
 * Records the ISSUED event of the certificate `jobId` just got (migration 0132),
 * once: a re-drain or a replay of an interrupted issuance finds it and adds
 * nothing. Runs on the issuance transaction, after the snapshot row exists.
 */
export async function recordCertificateIssued(
  client: Client,
  params: { organizationId: string; jobId: number; userId: string; at: Date },
): Promise<void> {
  const snapshot = await client.query<{ id: number }>(
    `SELECT id FROM issued_certificate_snapshot WHERE job_id = $1 LIMIT 1`,
    [params.jobId],
  );
  const certificateId = snapshot.rows[0]?.id;
  if (certificateId === undefined) return;
  const existing = await client.query(
    `SELECT 1 FROM issued_certificate_status_event
      WHERE certificate_id = $1 AND event = 'ISSUED' LIMIT 1`,
    [certificateId],
  );
  if (existing.rows.length > 0) return;
  await appendCertificateStatusEvent(jobEventTransaction(client), {
    organizationId: params.organizationId,
    certificateId,
    jobId: params.jobId,
    event: "ISSUED",
    source: "worker",
    actorUserId: params.userId,
    occurredAt: params.at,
  });
}

/**
 * The original of an amendment becomes SUPERSEDED, in the transaction that
 * issues the replacement (roadmap 2 B3): compare-and-set APPROVED -> SUPERSEDED
 * under the original's row lock, its `supersede` audit row and its SUPERSEDED
 * status event. Until this runs the original stays APPROVED and valid, so a
 * cancelled or rejected amendment, or a render that failed, leaves it untouched.
 *
 * An original an earlier release already superseded at creation time (an
 * amendment opened before 0132 and still in flight) is linked to this job
 * already: only its event is added. Anything else is an inconsistency that must
 * not issue a second "current" certificate: it throws and the issuance rolls back.
 *
 * A certificate WITHDRAWN in the meantime stays withdrawn: the job is linked to
 * its replacement, but no SUPERSEDED event is appended, because the latest event
 * is what the verification page shows and "do not rely on it" outranks
 * "replaced".
 */
async function supersedeOriginalOnIssuance(
  client: Client,
  params: {
    organizationId: string;
    originalJobId: number;
    replacementJobId: number;
    replacementNumber: string;
    reason: string | null;
    userId: string;
    now: Date;
  },
): Promise<void> {
  const original = await client.query<{
    status: string;
    superseded_by_id: number | null;
  }>(
    `SELECT status, superseded_by_id FROM calibration_job
      WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
    [params.originalJobId, params.organizationId],
  );
  const row = original.rows[0];
  if (!row) {
    throw new Error(
      `Amendment ${params.replacementJobId}: the original job ${params.originalJobId} was not found`,
    );
  }
  const supersededStatus = requireTargetOf("APPROVED", "amend");

  if (row.status === "APPROVED" && row.superseded_by_id === null) {
    const updated = await client.query(
      `UPDATE calibration_job
          SET status = $3,
              superseded_by_id = $4,
              superseded_at = $5,
              amendment_reason = $6
        WHERE id = $1 AND organization_id = $2
          AND status = 'APPROVED' AND superseded_by_id IS NULL`,
      [
        params.originalJobId,
        params.organizationId,
        supersededStatus,
        params.replacementJobId,
        params.now,
        params.reason,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new Error(
        `Amendment ${params.replacementJobId}: the original job ${params.originalJobId} changed under the issuance`,
      );
    }
    await appendJobEvent(jobEventTransaction(client), {
      action: "supersede",
      organizationId: params.organizationId,
      jobId: params.originalJobId,
      actor: workerJobActor(params.userId),
      performedAt: params.now,
      changes: {
        status: { old: row.status, new: supersededStatus },
        supersededById: params.replacementJobId,
      },
      reason: `Certificado retificado. Novo: ${params.replacementNumber}. Motivo: ${params.reason ?? "nao informado"}`,
    });
  } else if (
    !(
      row.status === supersededStatus &&
      row.superseded_by_id === params.replacementJobId
    )
  ) {
    throw new Error(
      `Amendment ${params.replacementJobId}: the original job ${params.originalJobId} is ${row.status} (superseded by ${row.superseded_by_id ?? "nobody"}) and cannot be superseded by it`,
    );
  }

  const certificate = await client.query<{ id: number }>(
    `SELECT id FROM issued_certificate_snapshot
      WHERE job_id = $1 AND organization_id = $2 LIMIT 1`,
    [params.originalJobId, params.organizationId],
  );
  const certificateId = certificate.rows[0]?.id;
  if (certificateId === undefined) return;
  const events = await client.query<{
    id: number;
    event: "ISSUED" | "SUPERSEDED" | "WITHDRAWN" | "REINSTATED";
    reason: string | null;
    occurred_at: Date;
  }>(
    `SELECT id, event, reason, occurred_at FROM issued_certificate_status_event
      WHERE certificate_id = $1 ORDER BY id`,
    [certificateId],
  );
  const lifecycle = deriveCertificateLifecycle(
    events.rows.map((event) => ({
      id: event.id,
      event: event.event,
      reason: event.reason,
      occurredAt: event.occurred_at,
    })),
    null,
  );
  if (lifecycle.status === "WITHDRAWN" || lifecycle.status === "SUPERSEDED") {
    return;
  }
  await appendCertificateStatusEvent(jobEventTransaction(client), {
    organizationId: params.organizationId,
    certificateId,
    jobId: params.originalJobId,
    event: "SUPERSEDED",
    supersededByJobId: params.replacementJobId,
    reason: params.reason,
    source: "worker",
    actorUserId: params.userId,
    occurredAt: params.now,
  });
}

/**
 * Customer-facing "certificate amended" notice: sent only once the replacement is
 * issued and the original superseded (after the issuance COMMITs), never when the
 * amendment is merely opened. Best effort, like the "ready" mail.
 */
export async function notifyCertificateSuperseded(
  originalJobId: number,
  replacementJobId: number,
  reason: string | null,
): Promise<void> {
  try {
    await notifyCertificateAmended(
      originalJobId,
      replacementJobId,
      reason ?? "Retificacao do certificado",
    );
  } catch (error) {
    console.error(
      `[JOB ${replacementJobId}] Failed to send the amendment notification for ${originalJobId}:`,
      error,
    );
  }
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
  /** Q51: set when the unit issues unsigned on purpose; the reason it recorded. */
  unsignedByPolicy?: string;
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
  const { requireSignature, unsignedIssuanceReason } =
    organizationId && unitId
      ? await withOrgDbClient(env, organizationId, (client) =>
          fetchUnitSigningPolicy(client, organizationId, unitId),
        )
      : { requireSignature: false, unsignedIssuanceReason: null };

  const signingCert =
    env.SIGNING_MASTER_KEY && organizationId && unitId
      ? await withOrgDbClient(env, organizationId, (client) =>
          fetchSigningCertificate(client, organizationId, unitId),
        )
      : null;

  // P0-8: a unit that has ever had a signing certificate and has no valid one
  // now fails closed (never an unsigned PDF). Not read for a certificate that
  // is valid: the history only matters when there is nothing to sign with.
  const history =
    signingCert === null && organizationId && unitId
      ? await withOrgDbClient(env, organizationId, (client) =>
          fetchSigningCertificateHistory(client, organizationId, unitId),
        )
      : { hadCertificate: false, lapse: undefined };

  const policy = resolveSigningPolicy({
    hasMasterKey: Boolean(env.SIGNING_MASTER_KEY),
    hasCertificate: signingCert !== null,
    hadCertificate: history.hadCertificate,
    ...(history.lapse ? { lapse: history.lapse } : {}),
    unsignedIssuanceReason,
    requireSignature,
  });
  if (policy.action === "FAIL") {
    if (policy.code === "SIGNING_CERTIFICATE_LAPSED") {
      // The job is rejected by the caller with this reason (the existing
      // render-failure path, which writes its audit event); the lab's admins
      // are told here, best effort — a notification failure must not change
      // the outcome, the issuance is already refused.
      console.error(`[JOB ${jobId}] ${policy.reason}`);
      try {
        await notifySigningCertificateLapsed(jobId, policy.reason);
      } catch (notifyError) {
        console.error(
          `[JOB ${jobId}] Failed to notify the lab about the lapsed signing certificate:`,
          notifyError,
        );
      }
    }
    throw new SigningPolicyError(policy.reason);
  }
  if (policy.action === "EMIT_UNSIGNED" || !signingCert) {
    // Visible, not silent: signature_metadata stays NULL, so the portal and
    // the public verification page render the UNSIGNED verdict.
    console.warn(
      `[JOB ${jobId}] ${policy.action === "EMIT_UNSIGNED" ? policy.warning : "No signing certificate available"}`,
    );
    // Q51: when the unit chose to issue unsigned, the issued certificate records
    // that it was unsigned BY POLICY, with the reason, next to the plain UNSIGNED.
    return {
      pdfBuffer,
      ...(policy.action === "EMIT_UNSIGNED" && policy.unsignedByPolicy
        ? { unsignedByPolicy: policy.unsignedByPolicy }
        : {}),
    };
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
