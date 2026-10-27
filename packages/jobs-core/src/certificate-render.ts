import { createHash, randomUUID } from "node:crypto";
import { renderToString } from "react-dom/server";
import { canTransition } from "@calibra-facil/schemas/job-transitions";
import React from "react";
import QRCode from "qrcode";
import { SigningPolicyError } from "./signing-policy.js";
import {
  CalibrationCertificateHtml,
  certificateFooterHtml,
  certificateHeaderHtml,
} from "@calibra-facil/documents";
import {
  canonicalJson,
  CERTIFICATE_LAYOUT_KEY,
  CERTIFICATE_LAYOUT_VERSION,
  certificateContentRulesFor,
  type CertificateJobData,
} from "@calibra-facil/certificate-data";
import { buildCertificateLayoutData } from "./certificate/layout-data.js";
import {
  readCertificateJobRows,
  resolveCertificateJobData,
  type FetchJobDataDeps,
} from "./certificate/fetch-job-data.js";
import { loadCertificateRenderSource } from "./certificate/frozen-input.js";
import { formatAccreditationNumber } from "@calibra-facil/shared";
import {
  getYear,
  issuedCertificatePdfKey,
} from "@calibra-facil/shared/storage-keys";
import {
  certificateVerificationUrl,
  storedObjectUrl,
} from "@calibra-facil/shared/public-urls";
import { type Env } from "./runtime-types.js";
import {
  findJobOrganization,
  generatePdfFromHtml,
  getErrorMessage,
  withDbClient,
  withOrgDbClient,
} from "./pdf-render.js";
import { inOrganizationTransaction } from "./job-events.js";
import {
  CertificateIssuanceSkipped,
  lockJobStatus,
  notifyCertificateIssued,
  notifyCertificateSuperseded,
  parseSignatureMetadata,
  recordCertificateIssued,
  signPdfWithUnitCertificate,
  updateJobWithCertificate,
} from "./certificate-issuance.js";
import {
  arrayBufferToBase64,
  bucketBinding,
  getStoredObject,
  resolveOrganizationLogoDataUrl,
  sha256Hex,
} from "./storage-helpers.js";

/**
 * Identifies the worker build that rendered a certificate, alongside the layout
 * version. Two different worker builds can render the same layout differently
 * (a Gotenberg bump, a font change), so reproducing a PDF needs both.
 */
const WORKER_RENDERER_VERSION = "worker/1";

/**
 * Renders, signs, stores and records one calibration certificate.
 *
 * The write-once contract (REQ-REL-PDF-002): the snapshot insert is
 * `on conflict (job_id) do nothing`, and the certificate URL always comes from
 * whichever row is actually in the table. A re-drain of the same queue message
 * therefore re-uses the stored PDF instead of minting a second certificate
 * number, however many times it runs.
 */
/**
 * Whether a certificate was already issued for the job: an issued snapshot, or
 * the `certificate_generated` / `certificate_watermarked` event of an issuance
 * whose snapshot is gone.
 */
async function certificateAlreadyIssued(
  client: Parameters<typeof loadCertificateRenderSource>[0],
  jobId: number,
  organizationId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT (
       EXISTS (SELECT 1 FROM issued_certificate_snapshot
                WHERE job_id = $1 AND organization_id = $2)
       OR EXISTS (SELECT 1 FROM job_audit_log
                   WHERE job_id = $1 AND organization_id = $2
                     AND action IN ('certificate_generated', 'certificate_watermarked'))
     ) AS issued`,
    [jobId, organizationId],
  );
  return result.rows[0]?.issued === true;
}

export async function processJob(
  env: Env,
  jobId: number,
  userId: string,
): Promise<{
  success: boolean;
  certificateUrl?: string;
  error?: string;
  /** Set when the message was acknowledged without issuing anything. */
  skipped?: string;
  /**
   * Set on a failure that retrying cannot fix (missing data, a method that
   * cannot be laid out, a signing policy refusal): the job is REJECTED right
   * away instead of waiting for the final delivery.
   */
  permanent?: boolean;
}> {
  // Idempotency, checked before any work. Only a job still in the state this
  // worker is allowed to act on (GENERATING_PDF, or SUPERSEDED for the
  // watermark refresh) proceeds. Anything else was changed since the message was
  // enqueued: an APPROVED job is already issued (redelivery is a no-op, no
  // second audit entry or notification), and a cancelled/rejected one must never
  // be brought back to life by a late message.
  // The message names a job, not its laboratory: learn the laboratory on the
  // system path, then run everything per job in transactions that name it.
  const organizationId = await findJobOrganization(env, jobId);
  const existing = organizationId
    ? await withOrgDbClient(env, organizationId, async (client) => {
        const result = await client.query<{
          status: string;
          organization_id: string;
          certificate_url: string | null;
          pdf_r2_key: string | null;
          signature_metadata: unknown;
        }>(
          `
        select cj.status, cj.organization_id, cj.certificate_url, ics.pdf_r2_key, cj.signature_metadata
        from calibration_job cj
        left join issued_certificate_snapshot ics on ics.job_id = cj.id
        where cj.id = $1
        limit 1
      `,
          [jobId],
        );
        return result.rows[0] ?? null;
      })
    : null;

  if (existing && existing.status === "APPROVED") {
    console.log(`[JOB ${jobId}] Already APPROVED; redelivery is a no-op`);
    return {
      success: true,
      skipped: "APPROVED",
      certificateUrl:
        existing.certificate_url ??
        (existing.pdf_r2_key
          ? storedObjectUrl(existing.pdf_r2_key)
          : undefined),
    };
  }
  if (existing && !canTransition(existing.status, "complete_render")) {
    console.warn(
      `[JOB ${jobId}] Not issuing a certificate: job status is ${existing.status}`,
    );
    return { success: true, skipped: existing.status };
  }

  // The transition is replayed (not skipped) for a job that still has its
  // snapshot but never reached APPROVED: the crash may have happened between
  // the snapshot insert and the job update.
  if (existing?.pdf_r2_key) {
    const snapshotKey = existing.pdf_r2_key;
    const certificateUrl = storedObjectUrl(snapshotKey);
    try {
      const transition = await withDbClient(env, (client) =>
        inOrganizationTransaction(
          client,
          existing.organization_id,
          async () => {
            const result = await updateJobWithCertificate(
              client,
              jobId,
              certificateUrl,
              userId,
              parseSignatureMetadata(existing.signature_metadata),
              undefined,
              { preserveSignatureMetadata: true },
            );
            if (result.outcome === "skipped") {
              throw new CertificateIssuanceSkipped(result.currentStatus);
            }
            if (result.outcome === "issued") {
              await recordCertificateIssued(client, {
                organizationId: existing.organization_id,
                jobId,
                userId,
                at: new Date(),
              });
            }
            return result;
          },
        ),
      );
      if (transition.outcome === "issued") {
        await notifyCertificateIssued(jobId);
        if (transition.supersession) {
          await notifyCertificateSuperseded(
            transition.supersession.originalJobId,
            jobId,
            transition.supersession.reason,
          );
        }
      }
    } catch (error) {
      if (error instanceof CertificateIssuanceSkipped) {
        console.warn(
          `[JOB ${jobId}] Not issuing a certificate: job status is ${error.currentStatus}`,
        );
        return { success: true, skipped: error.currentStatus ?? "unknown" };
      }
      throw error;
    }
    return { success: true, certificateUrl };
  }

  try {
    // ISO/IEC 17025 §7.8: the certificate reflects the APPROVED record. When the
    // approval froze a certificate_input, that document is the only source of
    // what is printed; the lab, signatory, customer, asset and standards rows
    // are not read again. Jobs approved before it existed render through the
    // legacy live-read path, flagged as such in the log and on the snapshot.
    // The frozen input (or, for a job approved before it existed, the rows of
    // the legacy live read) is read in ONE transaction that names the
    // laboratory. The images the legacy path embeds are read from storage after
    // it has ended: no transaction is held across storage I/O.
    const legacyDeps: FetchJobDataDeps = {
      resolveLogoDataUrl: (logo) =>
        resolveOrganizationLogoDataUrl(env, logo, jobId),
      resolveSignatureDataUrl: async (r2Key, contentType) => {
        const object = await getStoredObject(env, "media", r2Key);
        if (!object) return null;
        const base64 = arrayBufferToBase64(await object.arrayBuffer());
        return `data:${contentType};base64,${base64}`;
      },
    };
    const read = organizationId
      ? await withOrgDbClient(env, organizationId, async (client) => ({
          source: await loadCertificateRenderSource(
            client,
            { jobId, organizationId: existing?.organization_id ?? null },
            () => readCertificateJobRows(client, jobId),
          ),
          // Roadmap 2 C2: has a certificate for this job ALREADY been issued?
          // Only then may its old statements be reproduced as they were. A
          // first issuance never asserts what was not verified.
          alreadyIssued: await certificateAlreadyIssued(
            client,
            jobId,
            organizationId,
          ),
        }))
      : {
          source: { status: "legacy", job: null } as const,
          alreadyIssued: false,
        };
    const loaded = read.source;
    const firstIssuance = !read.alreadyIssued;
    const source =
      loaded.status === "legacy"
        ? ({
            status: "legacy",
            job: loaded.job
              ? await resolveCertificateJobData(loaded.job, jobId, legacyDeps)
              : null,
          } as const)
        : loaded;
    if (source.status === "corrupt") {
      console.error(
        `[JOB ${jobId}] The frozen certificate input cannot be trusted: ${source.reason}`,
      );
      return {
        success: false,
        error: `Entrada congelada do certificado inválida: ${source.reason}`,
        permanent: true,
      };
    }
    const job: CertificateJobData | null =
      source.status === "ok" ? source.input.job : source.job;
    if (!job)
      return { success: false, error: "Job not found", permanent: true };
    if (!job.organizationId) {
      return {
        success: false,
        error: "Missing organization_id",
        permanent: true,
      };
    }
    // Roadmap 2 C1/C2: an input frozen under an earlier layout RE-renders a
    // certificate that was already issued under the statement rules it was
    // issued with (byte-identical); so does the live legacy read (approved
    // before the input existed). A FIRST issuance, even of such an input, takes
    // the verified statements: the old free-text SI-traceability sentence is
    // never asserted for the first time, and no title is borrowed from the lab
    // profile (the layout applies `firstIssuance`).
    const contentRules =
      source.status === "ok"
        ? certificateContentRulesFor(source.input.layout.version)
        : "legacy";
    const renderedLayoutVersion =
      contentRules === "current" || firstIssuance
        ? CERTIFICATE_LAYOUT_VERSION
        : "1.0.0";
    const certificateInputSource =
      source.status === "ok"
        ? { source: "frozen", sha256: source.sha256 }
        : { source: "legacy_live" };
    if (source.status === "ok") {
      console.log(
        `[JOB ${jobId}] Rendering from the frozen certificate input (sha256 ${source.sha256})`,
      );
      if (source.input.layout.key !== CERTIFICATE_LAYOUT_KEY) {
        console.warn(
          `[JOB ${jobId}] The input was frozen for layout ${source.input.layout.key}@${source.input.layout.version}; rendering with ${CERTIFICATE_LAYOUT_KEY}@${renderedLayoutVersion}`,
        );
      }
    } else {
      console.warn(
        `[JOB ${jobId}] LEGACY render path: no frozen certificate_input (approved before migration 0120); reading the lab, signatory, customer and standards live`,
      );
    }

    // The layout refuses to guess: if the method does not declare enough to
    // build a correct results table, issuance stops here with the reasons
    // rather than producing a document that merely looks right.
    const verificationUrl =
      source.status === "ok"
        ? source.input.verificationUrl
        : certificateVerificationUrl(job.verificationToken);
    const layout = buildCertificateLayoutData(job, {
      contentRules,
      firstIssuance,
      qrCodeDataUrl: await QRCode.toDataURL(verificationUrl, {
        margin: 0,
        width: 240,
      }),
      ...(source.status === "ok"
        ? {
            accredited: source.input.seal.accredited,
            verificationUrl: source.input.verificationUrl,
          }
        : {}),
    });
    if (!layout.ok) {
      return {
        success: false,
        error: `Certificado não pode ser emitido: ${layout.reasons.join(" ")}`,
        permanent: true,
      };
    }

    const html = renderToString(
      React.createElement(CalibrationCertificateHtml, { data: layout.data }),
    );
    const rendered = await generatePdfFromHtml(env, html, {
      headerHtml: certificateHeaderHtml({
        certificateNumber: layout.data.certificateNumber,
        accreditationNumberText: layout.data.accredited
          ? formatAccreditationNumber(layout.data.lab.accreditationNumber)
          : null,
      }),
      footerHtml: certificateFooterHtml(),
    });

    // Signing FAILS the emission when a certificate is configured and cannot
    // sign (#644 REQ-CMP-SIGN-001/002) — nothing below this line runs.
    const signed = await signPdfWithUnitCertificate(
      env,
      jobId,
      job.organizationId,
      job.unitId,
      Buffer.from(rendered),
    );
    const pdfBuffer = signed.pdfBuffer;

    const year = getYear(
      job.approvedAt ?? job.performedAt,
      "approvedAt/performedAt",
    );
    const pdf = issuedCertificatePdfKey({
      org: { id: job.organizationId, slug: job.organizationSlug ?? "" },
      jobId: job.jobId,
      issuedId: randomUUID(),
      certNumber: job.certificateName ?? job.jobId,
      year,
      companyName: job.customer.name,
      assetTag: job.asset.tag,
      brand: job.asset.manufacturer,
    });
    await bucketBinding(env, pdf.bucket).put(pdf.key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const renderPolicy = {
      converter: "gotenberg-chromium",
      layoutKey: CERTIFICATE_LAYOUT_KEY,
      layoutVersion: renderedLayoutVersion,
    };
    const renderMetadata = {
      signature: signed.signatureMetadata
        ? {
            signed: true,
            signing: "signed",
            signerName: signed.signatureMetadata.signerName,
          }
        : signed.unsignedByPolicy
          ? {
              // Q51: the unit chose to issue unsigned, with this recorded reason.
              signed: false,
              signing: "unsigned_by_policy",
              unsignedByPolicy: signed.unsignedByPolicy,
            }
          : { signed: false, signing: "unsigned" },
      // Where the certificate's content came from, and a hash of exactly what
      // the template was handed: the same frozen input and layout version give
      // the same hash on any later render (the PDF bytes may differ, they embed
      // timestamps and the signature).
      certificateInput: {
        ...certificateInputSource,
        layoutDataSha256: createHash("sha256")
          .update(canonicalJson(layout.data))
          .digest("hex"),
      },
      renderedAt: new Date().toISOString(),
    };

    // The snapshot insert and the status write commit together or not at all,
    // under a lock on the job row. If the job left GENERATING_PDF while the PDF
    // rendered (cancelled, rejected...), nothing is persisted: no snapshot row
    // that would make the job look issued, and no APPROVED status.
    const issuingOrganizationId = job.organizationId;
    const issued = await withDbClient(env, (client) =>
      inOrganizationTransaction(client, issuingOrganizationId, async () => {
        const lockedStatus = await lockJobStatus(client, jobId);
        if (!canTransition(lockedStatus, "complete_render")) {
          throw new CertificateIssuanceSkipped(lockedStatus);
        }
        const insertResult = await client.query<{ pdf_r2_key: string }>(
          `
          insert into issued_certificate_snapshot (
            organization_id,
            job_id,
            certificate_number,
            render_pipeline,
            pdf_r2_key,
            pdf_sha256,
            layout_key,
            layout_version,
            renderer_version,
            render_policy,
            render_metadata,
            input_data_snapshot,
            status,
            issued_by
          )
          values ($1, $2, $3, 'FIXED_LAYOUT', $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, 'ISSUED', $12)
          on conflict (job_id) do nothing
          returning pdf_r2_key
        `,
          [
            job.organizationId,
            jobId,
            job.jobId,
            pdf.key,
            sha256Hex(pdfBuffer),
            CERTIFICATE_LAYOUT_KEY,
            renderedLayoutVersion,
            WORKER_RENDERER_VERSION,
            JSON.stringify(renderPolicy),
            JSON.stringify(renderMetadata),
            JSON.stringify(layout.data),
            userId,
          ],
        );

        // Lost the race, or a re-drain: whatever is stored wins. Minting a second
        // number here is the one failure this whole path must not have.
        const insertedPdfR2Key = insertResult.rows[0]?.pdf_r2_key;
        const stored = insertedPdfR2Key
          ? null
          : (
              await client.query<{
                pdf_r2_key: string;
                signature_metadata: unknown;
              }>(
                `
                select ics.pdf_r2_key, cj.signature_metadata
                from issued_certificate_snapshot ics
                join calibration_job cj on cj.id = ics.job_id
                where ics.job_id = $1
                limit 1
              `,
                [jobId],
              )
            ).rows[0];

        const snapshotPdfR2Key = insertedPdfR2Key ?? stored?.pdf_r2_key;
        if (!snapshotPdfR2Key) {
          throw new Error("Issued certificate snapshot was not persisted");
        }

        const transition = await updateJobWithCertificate(
          client,
          jobId,
          storedObjectUrl(snapshotPdfR2Key),
          userId,
          insertedPdfR2Key
            ? signed.signatureMetadata
            : parseSignatureMetadata(stored?.signature_metadata),
          insertedPdfR2Key ? signed.signatureVerdict : undefined,
          {
            preserveSignatureMetadata: !insertedPdfR2Key,
            ...(insertedPdfR2Key && signed.unsignedByPolicy
              ? { unsignedByPolicy: signed.unsignedByPolicy }
              : {}),
          },
        );
        if (transition.outcome === "skipped") {
          throw new CertificateIssuanceSkipped(transition.currentStatus);
        }
        // The certificate's first lifecycle event, in the same transaction as
        // its snapshot and its APPROVED status (idempotent on a re-drain).
        if (transition.outcome === "issued") {
          await recordCertificateIssued(client, {
            organizationId: issuingOrganizationId,
            jobId,
            userId,
            at: new Date(),
          });
        }
        return {
          key: snapshotPdfR2Key,
          outcome: transition.outcome,
          supersession:
            transition.outcome === "issued"
              ? transition.supersession
              : undefined,
        };
      }),
    );

    if (issued.outcome === "issued") {
      await notifyCertificateIssued(jobId);
      if (issued.supersession) {
        await notifyCertificateSuperseded(
          issued.supersession.originalJobId,
          jobId,
          issued.supersession.reason,
        );
      }
    }

    return {
      success: true,
      certificateUrl: storedObjectUrl(issued.key),
    };
  } catch (error) {
    if (error instanceof CertificateIssuanceSkipped) {
      // The job changed under the render (e.g. cancelled). The transaction
      // rolled back, so no snapshot or status write survives. The PDF object
      // already uploaded is unreferenced (its key carries a fresh UUID).
      console.warn(
        `[JOB ${jobId}] Not issuing a certificate: job status is ${error.currentStatus}`,
      );
      return { success: true, skipped: error.currentStatus ?? "unknown" };
    }
    return {
      success: false,
      error: getErrorMessage(error),
      permanent: error instanceof SigningPolicyError && error.permanent,
    };
  }
}
