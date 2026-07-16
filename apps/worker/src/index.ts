import { createHash, randomUUID } from "node:crypto";
import { flushWorkerErrorReporter, reportWorkerError } from "./observability";
import { processSpcRecompute } from "./spc-recompute";
import { processEmailDomainHealth } from "./email-domain-health";
import { Client } from "pg";
import { renderToString } from "react-dom/server";
import {
  AccreditationSealSvg,
  LabelHtml,
  type LabelData,
  OotNotificationHtml,
  type OotNotificationDocumentData,
  ServiceOrderDeliveryReceiptHtml,
  ServiceOrderIntakeDocumentHtml,
  ServiceOrderQuoteHtml,
  ServiceOrderTagHtml,
  type ServiceOrderDeliveryReceiptData,
  type ServiceOrderDocumentData,
  type ServiceOrderQuoteData,
  type ServiceOrderTagData,
  renderFleetStatusReportHtml,
  classifyFleetDueStatus,
  FLEET_DUE_SOON_DAYS,
  type FleetStatusAsset,
} from "@calibra-facil/documents";
import { zipSync, strToU8, type Zippable } from "fflate";
import { Workbook } from "@cj-tech-master/excelts";
import React from "react";
import QRCode from "qrcode";
import {
  createConfiguredXlsxToPdfConverter,
  ExcelTsCertificateWorkbookEngine,
  fillCertificateWorkbook,
  renderCertificateWorkbook,
  validateCertificateXlsxBindingManifest,
  type CertificateJobData,
} from "@calibra-facil/certificate-xlsx-template";
import {
  processMarketingContactSync,
  processPortalDigest,
  processScheduledNotifications,
} from "./scheduled.js";
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

/** At-issue signature-integrity verdict persisted to calibration_job.signature_verdict. */
type StoredSignatureVerdict = VerifyPdfResult & { computedAt: string };
import {
  processIntegrationSync,
  processScheduledIntegrationSyncs,
} from "./integrations.js";
import {
  formatSpecificationsForDisplay,
  type AuditPackBackgroundJobMessage,
  type BackgroundJobMessage,
  type CertificateXlsxPreviewBackgroundJobMessage,
  type DocumentBackgroundJobMessage,
} from "@calibra-facil/shared";
import {
  getLogoKeyFromUrl,
  getYear,
  getYearMonth,
  issuedCertificatePdfKey,
  issuedCertificateXlsxKey,
  jobLabelKey,
  ootNotificationKey,
  portalAuditPackKey,
  serviceOrderDocKey,
  templatePreviewKey,
  type OrgRef,
  type StorageBucket,
} from "@calibra-facil/shared/storage-keys";
import {
  notifyAuditPackReady,
  notifyCertificateReady,
} from "@calibra-facil/notifications";

export interface R2BucketBinding {
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
  put(
    key: string,
    body: Buffer | Uint8Array | ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void>;
}

export interface Env {
  CERTIFICATES_BUCKET: R2BucketBinding;
  MEDIA_BUCKET: R2BucketBinding;
  DATABASE_URL: string;
  // HTML/XLSX -> PDF conversion runs on the hosted Gotenberg service
  // (services/gotenberg on Cloudflare Containers); no in-function Chromium.
  GOTENBERG_URL?: string;
  GOTENBERG_TOKEN?: string;
  SIGNING_MASTER_KEY?: string; // Optional - if not set, PDFs won't be signed
  // RFC 3161 TSA (#646 / CMP-03, PAdES-T). Unset => plain AD-RB signing.
  SIGNING_TSA_URL?: string;
  SIGNING_TSA_AUTH?: string; // Full Authorization header value for a contracted ACT (secret)
  SIGNING_TSA_ICP_CONFORMANT?: string; // "true" ONLY for a credentialed ICP-Brasil ACT
  INTEGRATIONS_MASTER_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  // Marketing-audience sync (Resend Contacts) — operator-set, optional.
  RESEND_AUDIENCE_ID?: string;
  RESEND_TOPIC_NOVIDADES_ID?: string;
  RESEND_TOPIC_DICAS_ID?: string;
  MARKETING_CONTACT_SYNC_ENABLED?: string;
  EMAIL_FROM?: string;
  EMAIL_LOGO_URL?: string;
  WEB_URL?: string;
  APP_URL?: string;
}

// The certificate job snapshot shape (and everything derived from it) is
// owned by @calibra-facil/certificate-xlsx-template; the worker only fetches
// and persists it.
type JobData = CertificateJobData;

const CERTIFICATE_XLSX_TEMPLATE_REQUIRED_MESSAGE =
  "Certificate generation requires a published XLSX certificate template assignment";

export type QueueMessage = BackgroundJobMessage;

export interface MessageBatch<T> {
  messages: {
    body: T;
    ack: () => void;
    // Optional error (REQ-REL-OBS-002): the DB-queue runtime records it as the
    // job's real last_error. Cloudflare's native retry ignores extra args, so
    // this stays compatible if the handler is ever bound to a real CF queue.
    retry: (error?: unknown) => void;
  }[];
}

/** Pick the concrete R2 binding for a logical storage bucket. */
function bucketBinding(env: Env, bucket: StorageBucket): R2BucketBinding {
  return bucket === "media" ? env.MEDIA_BUCKET : env.CERTIFICATES_BUCKET;
}

/**
 * Read an object whose key is stored in the DB. The stored key tells us the key
 * but not which bucket the object physically lives in: during/after the bucket
 * split, newly written objects live in `preferred` while not-yet-backfilled
 * ones may still be in the other bucket. Try the preferred binding, then fall
 * back to the other so reads keep working across the migration window.
 */
async function getStoredObject(
  env: Env,
  preferred: StorageBucket,
  key: string,
) {
  const primary = await bucketBinding(env, preferred).get(key);
  if (primary) return primary;
  const fallback: StorageBucket = preferred === "media" ? "documents" : "media";
  return bucketBinding(env, fallback).get(key);
}

/** Look up the stable org id + readable slug for org-scoped key building. */
async function fetchOrgRefById(
  client: Client,
  organizationId: string,
): Promise<OrgRef> {
  const result = await client.query<{ id: string; slug: string | null }>(
    `SELECT id, slug FROM organization WHERE id = $1`,
    [organizationId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Organization not found: ${organizationId}`);
  }
  return { id: row.id, slug: row.slug ?? "" };
}

function sha256Hex(bytes: Uint8Array | ArrayBuffer): string {
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function prepareXlsxWorkbookForRender(input: Uint8Array): Uint8Array {
  return input;
}

function parseSignatureMetadata(value: unknown): SignatureMetadata | undefined {
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

function escapeSvgText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchJobData(
  client: Client,
  jobId: number,
  env: Env,
): Promise<JobData | null> {
  const result = await client.query(
    `
    SELECT
      cj.job_id,
      cj.certificate_name,
      cj.unit_id,
      cj.performed_at,
      cj.approved_at,
      cj.method_snapshot,
      cj.asset_snapshot,
      cj.standards_snapshot,
      cj.environmental_snapshot,
      cj.calibration_location_snapshot,
      cj.calibration_phase_snapshot,
      cj.certificate_template_id,
      cj.certificate_template_snapshot,
      cj.results,
      cj.data,
      cj.organization_id,
      cj.approved_by,
      cj.verification_token,
      -- Amendment fields - ISO 17025 Clause 7.8.4.1
      cj.supersedes_id,
      cj.superseded_by_id,
      cj.amendment_number,
      cj.amendment_reason,
      -- #427 Phase 1: non-null = issuance downgraded to non-accredited
      cj.scope_override_justification,
      -- Organization (Lab) info
      o.name as lab_name,
      o.cnpj as lab_cnpj,
      o.accreditation_number as lab_accreditation_number,
      o.accreditation_body as lab_accreditation_body,
      o.accreditation_active as lab_accreditation_active,
      o.accreditation_valid_from as lab_accreditation_valid_from,
      o.accreditation_valid_until as lab_accreditation_valid_until,
      o.street as lab_street,
      o.number as lab_number,
      o.complement as lab_complement,
      o.neighbourhood as lab_neighbourhood,
      o.city as lab_city,
      o.state as lab_state,
      o.cep as lab_cep,
      o.phone as lab_phone,
      o.email as lab_email,
      o.website as lab_website,
      o.logo as lab_logo,
      o.slug as organization_slug,
      o.technical_manager_name as lab_technical_manager_name,
      o.technical_manager_title as lab_technical_manager_title,
      -- Customer info (complete)
      c.name as customer_name,
      c.tax_id as customer_tax_id,
      c.phone as customer_phone,
      c.email as customer_email,
      c.address as customer_address,
      -- Asset info
      a.name as asset_name,
      a.serial_number,
      a.tag,
      a.model,
      a.manufacturer,
      -- Approver
      u.name as approver_name,
      -- Original job info (if this is an amendment)
      original.job_id as original_job_id,
      original.approved_at as original_approved_at,
      service_order_link.inmetro_repair_mark_number,
      snapshot_method.accredited_scope as method_accredited_scope_current
    FROM calibration_job cj
    LEFT JOIN organization o ON cj.organization_id = o.id
    LEFT JOIN calibration_method snapshot_method
      ON snapshot_method.id = NULLIF(cj.method_snapshot->>'methodId', '')::int
      AND snapshot_method.organization_id = cj.organization_id
    LEFT JOIN customer c ON cj.customer_id = c.id
    LEFT JOIN asset a ON cj.asset_id = a.id
    LEFT JOIN "user" u ON cj.approved_by = u.id
    LEFT JOIN calibration_job original ON cj.supersedes_id = original.id
    LEFT JOIN LATERAL (
      SELECT so.inmetro_repair_mark_number
      FROM service_order_certificate_link socl
      INNER JOIN service_order so ON so.id = socl.service_order_id
      WHERE socl.certificate_job_id = cj.id
      ORDER BY socl.linked_at DESC
      LIMIT 1
    ) service_order_link ON true
    WHERE cj.id = $1
    `,
    [jobId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  let certificateTemplateSnapshot = row.certificate_template_snapshot;
  let certificateTemplateId = row.certificate_template_id;

  if (!certificateTemplateSnapshot) {
    const templateResult = await client.query(
      `
            SELECT id, name, slug, version
            FROM certificate_template
            WHERE organization_id = $1
              AND is_default = true
              AND status = 'ACTIVE'
            LIMIT 1
            `,
      [row.organization_id],
    );

    const templateRow = templateResult.rows[0];
    certificateTemplateSnapshot = templateRow
      ? {
          id: templateRow.id,
          name: templateRow.name,
          slug: templateRow.slug,
          version: templateRow.version,
        }
      : {
          id: null,
          name: "Padrão do Sistema",
          slug: "padrao-sistema",
          version: 1,
        };

    certificateTemplateId = templateRow?.id ?? null;

    await client.query(
      `
            UPDATE calibration_job
            SET certificate_template_id = $2,
                certificate_template_snapshot = $3::jsonb
            WHERE id = $1
            `,
      [
        jobId,
        certificateTemplateId,
        JSON.stringify(certificateTemplateSnapshot),
      ],
    );
  }

  const labLogoUrl = await resolveOrganizationLogoDataUrl(
    env,
    row.lab_logo,
    jobId,
  );

  // Fetch approver's visual signature if exists
  let approverSignatureUrl: string | null = null;
  if (row.approved_by && row.organization_id) {
    const sigResult = await client.query(
      `
            SELECT mvs.r2_key, mvs.content_type
            FROM member_visual_signature mvs
            INNER JOIN member m ON mvs.member_id = m.id
            WHERE m.user_id = $1 AND mvs.organization_id = $2
            `,
      [row.approved_by, row.organization_id],
    );

    if (sigResult.rows.length > 0) {
      const sigRow = sigResult.rows[0];
      // Fetch signature from R2 and convert to base64 data URL
      try {
        const signatureObject = await getStoredObject(
          env,
          "media",
          sigRow.r2_key,
        );
        if (signatureObject) {
          const signatureBuffer = await signatureObject.arrayBuffer();
          const base64 = arrayBufferToBase64(signatureBuffer);
          approverSignatureUrl = `data:${sigRow.content_type};base64,${base64}`;
        }
      } catch (err) {
        console.warn(`[JOB ${jobId}] Failed to fetch approver signature:`, err);
      }
    }
  }

  return {
    jobId: row.job_id,
    verificationToken: row.verification_token,
    certificateName: row.certificate_name,
    organizationId: row.organization_id,
    organizationSlug: row.organization_slug,
    unitId: row.unit_id,
    performedAt: row.performed_at,
    approvedAt: row.approved_at,
    lab: {
      name: row.lab_name || "Laboratório de Calibração",
      cnpj: row.lab_cnpj,
      accreditationNumber: row.lab_accreditation_number,
      accreditationBody: row.lab_accreditation_body,
      accreditationActive: row.lab_accreditation_active,
      accreditationValidFrom: row.lab_accreditation_valid_from,
      accreditationValidUntil: row.lab_accreditation_valid_until,
      street: row.lab_street,
      number: row.lab_number,
      complement: row.lab_complement,
      neighbourhood: row.lab_neighbourhood,
      city: row.lab_city,
      state: row.lab_state,
      cep: row.lab_cep,
      phone: row.lab_phone,
      email: row.lab_email,
      website: row.lab_website,
      logo: labLogoUrl,
      technicalManagerName: row.lab_technical_manager_name,
      technicalManagerTitle: row.lab_technical_manager_title,
    },
    customer: {
      name: row.customer_name,
      taxId: row.customer_tax_id,
      phone: row.customer_phone,
      email: row.customer_email,
      address: row.customer_address,
    },
    asset: {
      name: row.asset_name,
      serialNumber: row.serial_number,
      tag: row.tag,
      model: row.model,
      manufacturer: row.manufacturer,
    },
    // Legacy/offline snapshots may predate the accredited-scope flag; fall
    // back to the method's current flag so older jobs still seal correctly.
    methodSnapshot: row.method_snapshot
      ? {
          ...row.method_snapshot,
          accreditedScope:
            row.method_snapshot.accreditedScope ??
            row.method_accredited_scope_current ??
            false,
        }
      : row.method_snapshot,
    assetSnapshot: row.asset_snapshot,
    // #427 Phase 1: a documented override downgrades the issuance to
    // non-accredited; certificate-data suppresses the seal when set.
    scopeOverrideJustification: row.scope_override_justification,
    standardsSnapshot: row.standards_snapshot,
    serviceOrder: {
      inmetroRepairMarkNumber: row.inmetro_repair_mark_number,
    },
    environmentalSnapshot: row.environmental_snapshot,
    calibrationLocationSnapshot: row.calibration_location_snapshot,
    calibrationPhaseSnapshot: row.calibration_phase_snapshot,
    certificateTemplateSnapshot,
    data: row.data,
    results: row.results,
    approverName: row.approver_name,
    approverSignatureUrl, // Visual signature as base64 data URL
    // Amendment fields - ISO 17025 Clause 7.8.4.1
    supersedesId: row.supersedes_id,
    supersededById: row.superseded_by_id,
    amendmentNumber: row.amendment_number,
    amendmentReason: row.amendment_reason,
    originalJobId: row.original_job_id,
    originalApprovedAt: row.original_approved_at,
  };
}

type XlsxTemplateSelection = {
  templateId: number;
  templateVersionId: number;
  xlsxR2Key: string;
  bindingManifest: unknown;
  bindingManifestSha256: string;
  renderPolicy: unknown;
};

async function fetchXlsxTemplateSelectionForJob(
  client: Client,
  jobId: number,
): Promise<XlsxTemplateSelection | null> {
  const result = await client.query<{
    template_id: number;
    template_version_id: number;
    xlsx_r2_key: string;
    binding_manifest: unknown;
    binding_manifest_sha256: string;
    render_policy: unknown;
  }>(
    `
      select
        a.template_id,
        a.template_version_id,
        v.xlsx_r2_key,
        v.binding_manifest,
        v.binding_manifest_sha256,
        v.render_policy
      from calibration_job cj
      left join service s on s.id = cj.service_id
      inner join certificate_template_assignment a
        on a.organization_id = cj.organization_id
       and a.status = 'ACTIVE'
       and a.certificate_type = 'calibration'
       and (a.unit_id is null or a.unit_id = cj.unit_id)
       and (a.service_id is null or a.service_id = cj.service_id)
       and (a.method_id is null or a.method_id = s.method_id)
      inner join certificate_template_version v
        on v.id = a.template_version_id
       and v.status = 'PUBLISHED'
      inner join certificate_template t
        on t.id = a.template_id
       and t.status = 'ACTIVE'
      where cj.id = $1
      order by a.priority desc, a.created_at desc
      limit 1
    `,
    [jobId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    templateId: row.template_id,
    templateVersionId: row.template_version_id,
    xlsxR2Key: row.xlsx_r2_key,
    bindingManifest: row.binding_manifest,
    bindingManifestSha256: row.binding_manifest_sha256,
    renderPolicy: row.render_policy,
  };
}

function inferImageContentType(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  const textStart = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 256))
    .trimStart();
  if (textStart.startsWith("<svg") || textStart.startsWith("<?xml")) {
    return "image/svg+xml";
  }

  return "application/octet-stream";
}

async function resolveOrganizationLogoDataUrl(
  env: Env,
  logoUrl: string | null | undefined,
  jobId: number,
) {
  const key = getLogoKeyFromUrl(logoUrl);
  if (!key) return logoUrl ?? null;

  try {
    const logoObject = await getStoredObject(env, "media", key);
    if (!logoObject) return logoUrl ?? null;

    const logoBuffer = await logoObject.arrayBuffer();
    const contentType =
      logoObject.httpMetadata?.contentType ?? inferImageContentType(logoBuffer);
    const base64 = arrayBufferToBase64(logoBuffer);
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.warn(`[JOB ${jobId}] Failed to fetch organization logo:`, err);
    return logoUrl ?? null;
  }
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/**
 * Signing certificate data fetched from database
 */
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

async function updateJobWithCertificate(
  client: Client,
  jobId: number,
  certificateUrl: string,
  userId: string,
  signatureMetadata?: SignatureMetadata,
  signatureVerdict?: StoredSignatureVerdict,
  options: { preserveSignatureMetadata?: boolean } = {},
): Promise<void> {
  const now = new Date();

  // Check if job is SUPERSEDED (being regenerated with watermark)
  const statusResult = await client.query<{
    status: string;
    signature_metadata: unknown;
  }>(`SELECT status, signature_metadata FROM calibration_job WHERE id = $1`, [
    jobId,
  ]);
  const currentStatus = statusResult.rows[0]?.status;
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

  // Only update status to APPROVED if not already SUPERSEDED
  // SUPERSEDED jobs are being regenerated with watermark and should keep their status
  await client.query(
    `
    UPDATE calibration_job
    SET
      status = CASE WHEN status = 'SUPERSEDED' THEN 'SUPERSEDED' ELSE 'APPROVED' END,
      certificate_url = $2,
      signature_metadata = CASE WHEN $5 THEN signature_metadata ELSE $3::jsonb END,
      signature_verdict = CASE WHEN $6 THEN $7::jsonb ELSE signature_verdict END,
      updated_at = $4
    WHERE id = $1
    `,
    [
      jobId,
      certificateUrl,
      signatureMetadata ? JSON.stringify(signatureMetadata) : null,
      now,
      shouldPreserveSignatureMetadata,
      writeSignatureVerdict,
      signatureVerdict ? JSON.stringify(signatureVerdict) : null,
    ],
  );

  // Log appropriate action based on whether this is a watermark regeneration
  const action = isSuperseded
    ? "certificate_watermarked"
    : "certificate_generated";
  const statusChange = isSuperseded
    ? { status: "SUPERSEDED (watermark added)" }
    : { status: { old: "GENERATING_PDF", new: "APPROVED" } };

  await client.query(
    `
    INSERT INTO job_audit_log (job_id, action, changes, performed_by, performed_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [
      jobId,
      action,
      JSON.stringify({
        ...statusChange,
        certificateUrl: { old: null, new: certificateUrl },
        signatureMetadata: auditSignatureMetadata
          ? { signed: true, signerName: auditSignatureMetadata.signerName }
          : { signed: false },
      }),
      userId,
      now,
    ],
  );

  if (!isSuperseded) {
    try {
      await notifyCertificateReady(jobId);
    } catch (error) {
      console.error(
        `[JOB ${jobId}] Failed to send certificate ready notification:`,
        error,
      );
    }
  }
}

async function signPdfWithUnitCertificate(
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
      ? await withDbClient(env, (client) =>
          fetchUnitRequireSignature(client, organizationId, unitId),
        )
      : false;

  const signingCert =
    env.SIGNING_MASTER_KEY && organizationId && unitId
      ? await withDbClient(env, (client) =>
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
    throw new SigningPolicyError(
      `Falha na assinatura digital do certificado: ${detail}`,
    );
  }
}

async function setJobError(
  client: Client,
  jobId: number,
  error: string,
  userId: string,
): Promise<void> {
  const now = new Date();

  await client.query(
    `
    UPDATE calibration_job
    SET 
      status = 'REJECTED',
      rejection_reason = $2,
      rejected_by = $3,
      rejected_at = $4,
      updated_at = $4
    WHERE id = $1
    `,
    [jobId, `Erro ao gerar certificado: ${error}`, userId, now],
  );

  await client.query(
    `
    INSERT INTO job_audit_log (job_id, action, changes, performed_by, performed_at, reason)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      jobId,
      "certificate_error",
      JSON.stringify({ status: { old: "GENERATING_PDF", new: "REJECTED" } }),
      userId,
      now,
      error,
    ],
  );
}

// =============================================================================
// LABEL GENERATION FUNCTIONS
// =============================================================================

async function fetchLabelData(
  client: Client,
  jobId: number,
): Promise<{
  label: LabelData;
  verificationToken: string;
  organizationId: string | null;
  approvedAt: Date | string | null;
} | null> {
  const result = await client.query(
    `
    SELECT
      cj.job_id,
      cj.performed_at,
      cj.approved_at,
      cj.organization_id,
      cj.verification_token,
      o.name as lab_name,
      a.tag as asset_tag
    FROM calibration_job cj
    LEFT JOIN organization o ON cj.organization_id = o.id
    LEFT JOIN asset a ON cj.asset_id = a.id
    WHERE cj.id = $1
    `,
    [jobId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  return {
    label: {
      jobId: row.job_id,
      labName: row.lab_name || "Laboratório",
      assetTag: row.asset_tag || "-",
      calibrationDate: row.performed_at,
      qrCodeDataUrl: "", // Will be filled after QR generation
    },
    verificationToken: row.verification_token,
    organizationId: row.organization_id,
    approvedAt: row.approved_at,
  };
}

async function updateJobWithLabel(
  client: Client,
  jobId: number,
  labelUrl: string,
  userId: string,
): Promise<void> {
  const now = new Date();

  await client.query(
    `
    UPDATE calibration_job
    SET label_url = $2, updated_at = $3
    WHERE id = $1
    `,
    [jobId, labelUrl, now],
  );

  await client.query(
    `
    INSERT INTO job_audit_log (job_id, action, changes, performed_by, performed_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [
      jobId,
      "label_generated",
      JSON.stringify({ labelUrl: { old: null, new: labelUrl } }),
      userId,
      now,
    ],
  );
}

function formatAddress(parts: Record<string, unknown> | null | undefined) {
  if (!parts || typeof parts !== "object") return null;
  return [
    parts.street,
    parts.number,
    parts.complement,
    parts.neighbourhood,
    parts.city,
    parts.state,
    parts.cep,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(", ");
}

/**
 * Composes the permissionária authorization for documents as "<number>/<UF>".
 * Returns the number alone when the UF is absent, or null when no number is set.
 */
function composePermissionariaAuthorization(
  authorizationNumber: string | null | undefined,
  state: string | null | undefined,
): string | null {
  const number = authorizationNumber?.trim();
  if (!number) return null;
  const uf = state?.trim();
  return uf ? `${number}/${uf}` : number;
}

async function fetchServiceOrderDocumentData(
  env: Env,
  client: Client,
  serviceOrderId: number,
): Promise<ServiceOrderDocumentData | null> {
  const result = await client.query(
    `
    SELECT
      so.id,
      so.organization_id,
      so.unit_id,
      so.service_order_number,
      so.priority,
      so.intake_type,
      so.is_external_service,
      so.opened_at,
      so.service_started_at,
      so.claimed_defect,
      so.intake_condition,
      so.accessories,
      so.invoice_remittance_number,
      so.invoice_remittance_key,
      so.carrier_name,
      so.third_party_name,
      so.removed_sealing_mark_number,
      so.affixed_sealing_mark_number,
      so.inmetro_repair_mark_number,
      so.client_visible_notes,
      so.internal_notes,
      src.service_order_number as previous_so_number,
      tech.name as previous_technician_name,
      o.name as lab_name,
      o.cnpj as lab_cnpj,
      o.phone as lab_phone,
      o.email as lab_email,
      o.logo as lab_logo,
      o.permissionaria_authorization_number as lab_permissionaria_number,
      o.permissionaria_authorization_state as lab_permissionaria_state,
      ou.name as unit_name,
      c.name as customer_name,
      c.tax_id as customer_tax_id,
      c.phone as customer_phone,
      c.email as customer_email,
      c.address as customer_address,
      snap.asset_name,
      snap.asset_type,
      snap.manufacturer,
      snap.model,
      snap.serial_number,
      snap.patrimony_number,
      snap.observed_identification,
      snap.display_specs,
      snap.specifications,
      atype.definition as asset_type_definition,
      a.metrology_regime,
      settings.default_intake_terms
    FROM service_order so
    LEFT JOIN organization o ON so.organization_id = o.id
    LEFT JOIN organization_unit ou ON so.unit_id = ou.id
    LEFT JOIN customer c ON so.customer_id = c.id
    LEFT JOIN service_order_asset_snapshot snap ON snap.service_order_id = so.id
    LEFT JOIN asset a ON a.id = snap.asset_id
    LEFT JOIN asset_type atype ON atype.id = a.asset_type_id
    LEFT JOIN service_order_settings settings ON settings.organization_id = so.organization_id
    LEFT JOIN service_order src ON src.id = so.source_service_order_id
    LEFT JOIN "user" tech ON tech.id = src.responsible_technician_id
    WHERE so.id = $1
    `,
    [serviceOrderId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const qrSvg = await QRCode.toString(
    `https://portal.calibrafacil.com/service-orders/${row.id}`,
    {
      type: "svg",
      width: 200,
      margin: 1,
      errorCorrectionLevel: "M",
    },
  );

  const labLogoUrl = await resolveOrganizationLogoDataUrl(
    env,
    row.lab_logo,
    serviceOrderId,
  );

  // Blueprint-driven instrument specs: use the list frozen at intake; for snapshots
  // created before migration 0056 (display_specs NULL), fall back to formatting from
  // the live asset-type blueprint + the frozen specifications values.
  const assetSpecs =
    Array.isArray(row.display_specs) && row.display_specs.length > 0
      ? row.display_specs
      : formatSpecificationsForDisplay(
          row.asset_type_definition,
          row.specifications,
        );

  return {
    serviceOrderNumber: row.service_order_number,
    openedAt: row.opened_at,
    intakeType: row.intake_type,
    isExternalService: row.is_external_service ?? false,
    serviceStartedAt: row.service_started_at,
    requestedServices:
      row.priority === "warranty"
        ? ["Garantia"]
        : ["Orçamento", "Manutenção corretiva"],
    previousServiceOrderNumber: row.previous_so_number,
    previousTechnicianName: row.previous_technician_name,
    lab: {
      name: row.lab_name ?? "Laboratório",
      cnpj: row.lab_cnpj,
      phone: row.lab_phone,
      email: row.lab_email,
      address: null,
      logoUrl: labLogoUrl,
      authorizationNumber: composePermissionariaAuthorization(
        row.lab_permissionaria_number,
        row.lab_permissionaria_state,
      ),
    },
    unit: { name: row.unit_name },
    customer: {
      name: row.customer_name ?? "Cliente",
      taxId: row.customer_tax_id,
      phone: row.customer_phone,
      email: row.customer_email,
      address: formatAddress(row.customer_address),
    },
    asset: {
      name: row.asset_name ?? "Instrumento",
      type: row.asset_type,
      manufacturer: row.manufacturer,
      model: row.model,
      serialNumber: row.serial_number,
      patrimonyNumber: row.patrimony_number,
      observedIdentification: row.observed_identification,
      specs: assetSpecs,
      metrologyRegime: row.metrology_regime ?? "INDUSTRIAL",
    },
    intake: {
      claimedDefect: row.claimed_defect,
      intakeCondition: row.intake_condition,
      accessories: row.accessories,
      invoiceRemittanceNumber: row.invoice_remittance_number,
      invoiceRemittanceKey: row.invoice_remittance_key,
      carrierName: row.carrier_name,
      thirdPartyName: row.third_party_name,
      removedSealingMarkNumber: row.removed_sealing_mark_number,
      affixedSealingMarkNumber: row.affixed_sealing_mark_number,
      inmetroRepairMarkNumber: row.inmetro_repair_mark_number,
      clientVisibleNotes: row.client_visible_notes,
      internalNotes: row.internal_notes,
      terms: row.default_intake_terms,
    },
    qrCodeDataUrl: `data:image/svg+xml;base64,${btoa(qrSvg)}`,
    publicUrl: `https://portal.calibrafacil.com/service-orders/${row.id}`,
  };
}

async function processServiceOrderIntakeDocument(
  env: Env,
  serviceOrderId: number,
  documentId: number | undefined,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await withDbClient(env, (client) =>
      fetchServiceOrderDocumentData(env, client, serviceOrderId),
    );
    if (!data) return { success: false, error: "Service order not found" };
    const html = renderToString(
      React.createElement(ServiceOrderIntakeDocumentHtml, { data }),
    );
    const pdfBuffer = await generatePdfFromHtml(env, html);
    const { year, month } = getYearMonth(data.openedAt, "openedAt");
    const org = await withDbClient(env, (client) =>
      fetchServiceOrderOrg(client, serviceOrderId),
    );
    const { bucket, key } = serviceOrderDocKey({
      org,
      serviceOrderNumber: data.serviceOrderNumber,
      year,
      month,
      type: "INTAKE",
      version: 1,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await withDbClient(env, async (client) => {
      if (documentId) {
        await client.query(
          `UPDATE service_order_intake_document SET pdf_r2_key = $2, issued_at = COALESCE(issued_at, now()), issued_by_user_id = COALESCE(issued_by_user_id, $3) WHERE id = $1`,
          [documentId, key, userId],
        );
      } else {
        await client.query(
          `INSERT INTO service_order_intake_document (service_order_id, document_number, version, type, pdf_r2_key, issued_at, issued_by_user_id)
           VALUES ($1, $2, 1, 'combined', $3, now(), $4)
           ON CONFLICT DO NOTHING`,
          [serviceOrderId, `${data.serviceOrderNumber}/REC`, key, userId],
        );
      }
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchServiceOrderOrg(
  client: Client,
  serviceOrderId: number,
): Promise<OrgRef> {
  const result = await client.query<{ id: string; slug: string | null }>(
    `SELECT o.id, o.slug
     FROM service_order so
     INNER JOIN organization o ON o.id = so.organization_id
     WHERE so.id = $1`,
    [serviceOrderId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Service order organization not found");
  }
  return { id: row.id, slug: row.slug ?? "" };
}

async function processServiceOrderTag(
  env: Env,
  serviceOrderId: number,
  tagId: number | undefined,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await withDbClient(env, async (client) => {
      const result = await client.query(
        `
        SELECT so.organization_id, so.service_order_number, so.opened_at,
          c.name AS customer_name, snap.asset_name, snap.serial_number, snap.patrimony_number,
          tag.id AS tag_id, tag.tag_number
        FROM service_order so
        LEFT JOIN customer c ON so.customer_id = c.id
        LEFT JOIN service_order_asset_snapshot snap ON snap.service_order_id = so.id
        LEFT JOIN service_order_tag tag ON tag.service_order_id = so.id
        WHERE so.id = $1
        ORDER BY tag.id DESC
        LIMIT 1
        `,
        [serviceOrderId],
      );
      return result.rows[0];
    });
    if (!data) return { success: false, error: "Service order not found" };
    const qrSvg = await QRCode.toString(
      `https://calibrafacil.com/dashboard/service-orders/${serviceOrderId}`,
      { type: "svg", width: 200, margin: 1, errorCorrectionLevel: "M" },
    );
    const tag: ServiceOrderTagData = {
      serviceOrderNumber: data.service_order_number,
      customerName: data.customer_name ?? "Cliente",
      assetName: data.asset_name ?? "Instrumento",
      serialNumber: data.serial_number,
      patrimonyNumber: data.patrimony_number,
      openedAt: data.opened_at,
      qrCodeDataUrl: `data:image/svg+xml;base64,${btoa(qrSvg)}`,
    };
    const html = renderToString(
      React.createElement(ServiceOrderTagHtml, { tag }),
    );
    const pdfBuffer = await generatePdfFromHtml(env, html);
    const { year, month } = getYearMonth(data.opened_at, "openedAt");
    const tagNumber =
      data.tag_number ?? `${data.service_order_number}-TAG-${serviceOrderId}`;
    const org = await withDbClient(env, (client) =>
      fetchServiceOrderOrg(client, serviceOrderId),
    );
    const { bucket, key } = serviceOrderDocKey({
      org,
      serviceOrderNumber: data.service_order_number,
      year,
      month,
      type: "TAG",
      tagNumber,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await withDbClient(env, async (client) => {
      if (tagId ?? data.tag_id) {
        await client.query(
          `UPDATE service_order_tag SET pdf_r2_key = $2, printed_at = COALESCE(printed_at, now()), printed_by_user_id = COALESCE(printed_by_user_id, $3) WHERE id = $1`,
          [tagId ?? data.tag_id, key, userId],
        );
      } else {
        await client.query(
          `INSERT INTO service_order_tag (service_order_id, tag_number, pdf_r2_key, printed_at, printed_by_user_id)
           VALUES ($1, $2, $3, now(), $4)`,
          [serviceOrderId, tagNumber, key, userId],
        );
      }
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function processServiceOrderQuote(
  env: Env,
  serviceOrderId: number,
  quoteId: number | undefined,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!quoteId) return { success: false, error: "Missing quoteId" };
    const base = await withDbClient(env, (client) =>
      fetchServiceOrderDocumentData(env, client, serviceOrderId),
    );
    if (!base) return { success: false, error: "Service order not found" };
    const quote = await withDbClient(env, async (client) => {
      const quoteResult = await client.query(
        `SELECT * FROM service_order_quote WHERE id = $1`,
        [quoteId],
      );
      const itemsResult = await client.query(
        `SELECT description, quantity, unit, unit_price_cents, total_price_cents, type
         FROM service_order_quote_item WHERE quote_id = $1 ORDER BY sort_order, id`,
        [quoteId],
      );
      return { row: quoteResult.rows[0], items: itemsResult.rows };
    });
    if (!quote.row) return { success: false, error: "Quote not found" };
    const data: ServiceOrderQuoteData = {
      ...base,
      quote: {
        quoteNumber: quote.row.quote_number,
        version: quote.row.version,
        validUntil: quote.row.valid_until,
        paymentTerms: quote.row.payment_terms,
        deliveryEstimate: quote.row.delivery_estimate,
        warrantyTerms: quote.row.warranty_terms,
        clientMessage: quote.row.client_message,
        items: quote.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unit_price_cents,
          totalPriceCents: item.total_price_cents,
          type: item.type,
        })),
        subtotalServicesCents: quote.row.subtotal_services_cents,
        subtotalPartsCents: quote.row.subtotal_parts_cents,
        discountCents: quote.row.discount_cents,
        freightCents: quote.row.freight_cents,
        totalCents: quote.row.total_cents,
      },
    };
    const html = renderToString(
      React.createElement(ServiceOrderQuoteHtml, { data }),
    );
    const pdfBuffer = await generatePdfFromHtml(env, html);
    const { year, month } = getYearMonth(base.openedAt, "openedAt");
    const org = await withDbClient(env, (client) =>
      fetchServiceOrderOrg(client, serviceOrderId),
    );
    const { bucket, key } = serviceOrderDocKey({
      org,
      serviceOrderNumber: base.serviceOrderNumber,
      year,
      month,
      type: "QUOTE",
      quoteNumber: quote.row.quote_number,
      version: quote.row.version,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await withDbClient(env, (client) =>
      client.query(
        `UPDATE service_order_quote SET pdf_r2_key = $2 WHERE id = $1`,
        [quoteId, key],
      ),
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function processServiceOrderDeliveryReceipt(
  env: Env,
  serviceOrderId: number,
  documentId: number | undefined,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const base = await withDbClient(env, (client) =>
      fetchServiceOrderDocumentData(env, client, serviceOrderId),
    );
    if (!base) return { success: false, error: "Service order not found" };

    const payload = await withDbClient(env, async (client) => {
      const documentResult = await client.query(
        `
        SELECT *
        FROM service_order_delivery_document
        WHERE service_order_id = $1
          AND ($2::integer IS NULL OR id = $2)
        ORDER BY version DESC
        LIMIT 1
        `,
        [serviceOrderId, documentId ?? null],
      );
      const orderResult = await client.query(
        `
        SELECT organization_id, service_order_number, opened_at, delivered_at,
          delivered_to_name, delivered_to_document, delivery_method, delivery_notes,
          inmetro_repair_mark_number, inmetro_repair_mark_issued_at
        FROM service_order
        WHERE id = $1
        `,
        [serviceOrderId],
      );
      const executionResult = await client.query(
        `
        SELECT *
        FROM service_order_execution
        WHERE service_order_id = $1
        LIMIT 1
        `,
        [serviceOrderId],
      );
      const execution = executionResult.rows[0];
      const itemsResult = execution
        ? await client.query(
            `
            SELECT description, quantity, unit, unit_price_cents, total_price_cents, type
            FROM service_order_execution_item
            WHERE execution_id = $1
            ORDER BY sort_order, id
            `,
            [execution.id],
          )
        : { rows: [] };
      return {
        document: documentResult.rows[0],
        order: orderResult.rows[0],
        execution,
        items: itemsResult.rows,
      };
    });

    if (!payload.document) {
      return { success: false, error: "Delivery document not found" };
    }
    if (!payload.order)
      return { success: false, error: "Service order not found" };

    const items = payload.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceCents: item.unit_price_cents,
      totalPriceCents: item.total_price_cents,
      type: item.type,
    }));
    const subtotalPartsCents = items
      .filter((item) => item.type === "part")
      .reduce((total, item) => total + item.totalPriceCents, 0);
    const subtotalServicesCents = items
      .filter((item) => item.type !== "part")
      .reduce((total, item) => total + item.totalPriceCents, 0);
    const totalCents = items.reduce(
      (total, item) => total + item.totalPriceCents,
      0,
    );

    const data: ServiceOrderDeliveryReceiptData = {
      ...base,
      delivery: {
        documentNumber: payload.document.document_number,
        version: payload.document.version,
        issuedAt: payload.document.issued_at,
        deliveredAt: payload.order.delivered_at,
        deliveredToName: payload.order.delivered_to_name,
        deliveredToDocument: payload.order.delivered_to_document,
        deliveryMethod: payload.order.delivery_method,
        deliveryNotes: payload.order.delivery_notes,
        inmetroRepairMarkNumber: payload.order.inmetro_repair_mark_number,
        inmetroRepairMarkIssuedAt: payload.order.inmetro_repair_mark_issued_at,
        technicianSignature: payload.document.technician_signature_data,
        clientSignature: payload.document.client_signature_data,
      },
      execution: {
        servicePerformed: payload.execution?.service_performed,
        partsUsedSummary: payload.execution?.parts_used_summary,
        technicalNotes: payload.execution?.technical_notes,
        result: payload.execution?.result,
        finishedAt: payload.execution?.finished_at,
        items,
        subtotalServicesCents,
        subtotalPartsCents,
        totalCents,
      },
    };

    const html = renderToString(
      React.createElement(ServiceOrderDeliveryReceiptHtml, { data }),
    );
    const pdfBuffer = await generatePdfFromHtml(env, html);
    const { year, month } = getYearMonth(base.openedAt, "openedAt");
    const org = await withDbClient(env, (client) =>
      fetchOrgRefById(client, payload.order.organization_id),
    );
    const { bucket, key } = serviceOrderDocKey({
      org,
      serviceOrderNumber: base.serviceOrderNumber,
      year,
      month,
      type: "DELIVERY",
      version: payload.document.version,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await withDbClient(env, (client) =>
      client.query(
        `UPDATE service_order_delivery_document
         SET pdf_r2_key = $2, issued_at = COALESCE(issued_at, now()), issued_by_user_id = COALESCE(issued_by_user_id, $3)
         WHERE id = $1`,
        [payload.document.id, key, userId],
      ),
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generates a small PDF for thermal printer labels (50mm x 30mm) via Gotenberg.
 */
async function generateLabelPdf(env: Env, html: string): Promise<Uint8Array> {
  return gotenbergHtmlToPdf(env, html, {
    paperWidth: "1.9685", // 50mm
    paperHeight: "1.1811", // 30mm
    printBackground: "true",
    preferCssPageSize: "true",
    marginTop: "0",
    marginBottom: "0",
    marginLeft: "0",
    marginRight: "0",
  });
}

/**
 * Process a label generation job
 */
async function processLabelJob(
  env: Env,
  jobId: number,
  userId: string,
): Promise<{ success: boolean; labelUrl?: string; error?: string }> {
  const totalStart = performance.now();
  console.log(`[LABEL ${jobId}] Starting`);

  try {
    // 1. Fetch label data
    const dbFetchStart = performance.now();
    const data = await withDbClient(env, (client) =>
      fetchLabelData(client, jobId),
    );
    console.log(
      `[LABEL ${jobId}] fetchLabelData: ${Math.round(performance.now() - dbFetchStart)}ms`,
    );

    if (!data) {
      return { success: false, error: "Job not found" };
    }

    // 2. Generate QR code as SVG (canvas not available in Workers)
    const qrStart = performance.now();
    const verificationUrl = `https://verify.calibrafacil.com/v/${data.verificationToken}`;
    const qrSvg = await QRCode.toString(verificationUrl, {
      type: "svg",
      width: 200,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
    // Convert SVG to data URL for embedding in HTML
    const qrCodeDataUrl = `data:image/svg+xml;base64,${btoa(qrSvg)}`;
    console.log(
      `[LABEL ${jobId}] QR generation: ${Math.round(performance.now() - qrStart)}ms`,
    );

    // 3. Render HTML
    const renderStart = performance.now();
    const labelData: LabelData = {
      ...data.label,
      qrCodeDataUrl,
    };
    const html = renderToString(
      React.createElement(LabelHtml, { label: labelData }),
    );
    console.log(
      `[LABEL ${jobId}] renderToString: ${Math.round(performance.now() - renderStart)}ms`,
    );

    // 4. Generate PDF
    const pdfStart = performance.now();
    const pdfBuffer = await generateLabelPdf(env, html);
    console.log(
      `[LABEL ${jobId}] generatePdf: ${Math.round(performance.now() - pdfStart)}ms (${pdfBuffer.length} bytes)`,
    );

    // 5. Upload to R2
    const r2Start = performance.now();
    const orgId = data.organizationId;
    if (!orgId) {
      throw new Error("Missing organization_id for label generation");
    }
    const year = getYear(
      data.approvedAt ?? data.label.calibrationDate,
      "approvedAt/performedAt",
    );
    const org = await withDbClient(env, (client) =>
      fetchOrgRefById(client, orgId),
    );
    const { bucket, key } = jobLabelKey({
      org,
      jobId: data.label.jobId,
      year,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    console.log(
      `[LABEL ${jobId}] R2 upload: ${Math.round(performance.now() - r2Start)}ms`,
    );

    // 6. Build public URL
    const labelUrl = `https://certificates.calibrafacil.com/${key}`;

    // 7. Update DB
    const dbUpdateStart = performance.now();
    await withDbClient(env, (client) =>
      updateJobWithLabel(client, jobId, labelUrl, userId),
    );
    console.log(
      `[LABEL ${jobId}] updateDB: ${Math.round(performance.now() - dbUpdateStart)}ms`,
    );

    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[LABEL ${jobId}] DONE in ${totalMs}ms: ${labelUrl}`);

    return { success: true, labelUrl };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[LABEL ${jobId}] Error:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

// Helper to run a database operation with a fresh connection
async function withDbClient<T>(
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Render HTML to PDF via the Gotenberg Chromium engine (services/gotenberg),
 * replacing the previous in-function headless Chromium so the Vercel worker no
 * longer bundles puppeteer or downloads a Chromium pack.
 */
function requireGotenbergUrl(env: Env): string {
  if (!env.GOTENBERG_URL) {
    throw new Error("GOTENBERG_URL is required for HTML to PDF conversion.");
  }
  return env.GOTENBERG_URL.replace(/\/$/, "");
}

async function gotenbergHtmlToPdf(
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
        `Gotenberg HTML conversion failed with ${response.status} ${response.statusText}`,
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
 * Generates an A4 PDF from HTML. Full-page certificate layouts honor their CSS
 * @page size with zero margins; other documents get A4 margins + a
 * "Página X de Y" footer (matching the previous puppeteer output).
 */
async function generatePdfFromHtml(
  env: Env,
  html: string,
): Promise<Uint8Array> {
  if (html.includes('data-pdf-layout="full-page"')) {
    return gotenbergHtmlToPdf(env, html, {
      preferCssPageSize: "true",
      printBackground: "true",
      marginTop: "0",
      marginBottom: "0",
      marginLeft: "0",
      marginRight: "0",
    });
  }

  return gotenbergHtmlToPdf(
    env,
    html,
    {
      ...A4_PAPER,
      printBackground: "true",
      marginTop: "0.3937", // 10mm
      marginBottom: "0.5906", // 15mm — room for the footer
      marginLeft: "0.3937",
      marginRight: "0.3937",
    },
    { "footer.html": DOC_PAGE_FOOTER_HTML },
  );
}

/**
 * Process a single calibration-certificate job
 */
async function processJob(
  env: Env,
  jobId: number,
  userId: string,
): Promise<{ success: boolean; certificateUrl?: string; error?: string }> {
  const totalStart = performance.now();
  console.log(`[JOB ${jobId}] Starting`);

  try {
    // 1. Fetch job data
    const dbFetchStart = performance.now();
    const job = await withDbClient(env, (client) =>
      fetchJobData(client, jobId, env),
    );
    console.log(
      `[JOB ${jobId}] fetchJobData: ${Math.round(performance.now() - dbFetchStart)}ms`,
    );

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    const xlsxSelection = await withDbClient(env, (client) =>
      fetchXlsxTemplateSelectionForJob(client, jobId),
    );
    if (xlsxSelection) {
      return processXlsxIssuedCertificate(
        env,
        jobId,
        job,
        userId,
        xlsxSelection,
      );
    }

    const totalMs = Math.round(performance.now() - totalStart);
    console.warn(
      `[JOB ${jobId}] ${CERTIFICATE_XLSX_TEMPLATE_REQUIRED_MESSAGE} (${totalMs}ms)`,
    );
    return {
      success: false,
      error: CERTIFICATE_XLSX_TEMPLATE_REQUIRED_MESSAGE,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[JOB ${jobId}] Error:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

// =============================================================================
// §7.10 OUT-OF-TOLERANCE CUSTOMER NOTIFICATION (#426 Phase 0)
// =============================================================================

type OotNotificationRow = {
  id: number;
  organization_id: string;
  nc_id: number;
  job_id: number;
  certificate_number: string | null;
  recipient_name: string | null;
  affected_scope: string | null;
  nc_number: string;
  nc_description: string;
  performed_at: Date | string | null;
  approved_at: Date | string | null;
  asset_id: number;
  as_found_margins: unknown;
  lab_name: string | null;
  lab_cnpj: string | null;
  lab_phone: string | null;
  lab_email: string | null;
  lab_logo: string | null;
  org_slug: string | null;
  customer_name: string | null;
  customer_email: string | null;
  asset_name: string | null;
  asset_tag: string | null;
  asset_serial: string | null;
  // #426 Phase 1: set when the notification belongs to a standard recall —
  // switches the letter to the recall variant.
  recall_id: number | null;
  std_name: string | null;
  std_serial: string | null;
  std_certificate: string | null;
  std_calibration_date: Date | string | null;
};

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

async function processOotNotification(
  env: Env,
  notificationId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const row = await withDbClient(env, async (client) => {
      const result = await client.query<OotNotificationRow>(
        `
        SELECT
          n.id,
          n.organization_id,
          n.nc_id,
          n.job_id,
          n.certificate_number,
          n.recipient_name,
          n.affected_scope,
          nc.nc_number,
          nc.description as nc_description,
          j.performed_at,
          j.approved_at,
          j.asset_id,
          j.as_found_margins,
          o.name as lab_name,
          o.cnpj as lab_cnpj,
          o.phone as lab_phone,
          o.email as lab_email,
          o.logo as lab_logo,
          o.slug as org_slug,
          c.name as customer_name,
          c.email as customer_email,
          a.name as asset_name,
          a.tag as asset_tag,
          a.serial_number as asset_serial,
          n.recall_id,
          rs.name as std_name,
          rs.serial_number as std_serial,
          rs.certificate_number as std_certificate,
          rs.calibration_date as std_calibration_date
        FROM oot_notification n
        INNER JOIN non_conformance nc ON nc.id = n.nc_id
        INNER JOIN calibration_job j ON j.id = n.job_id
        INNER JOIN organization o ON o.id = n.organization_id
        INNER JOIN customer c ON c.id = j.customer_id
        INNER JOIN asset a ON a.id = j.asset_id
        LEFT JOIN standard_recall sr ON sr.id = n.recall_id
        LEFT JOIN reference_standard rs ON rs.id = sr.standard_id
        WHERE n.id = $1
        `,
        [notificationId],
      );
      return result.rows[0] ?? null;
    });

    if (!row) return { success: false, error: "OOT notification not found" };

    // Start of the potentially affected period: the previous approved
    // calibration of the same asset (the last known-good state).
    const previousCalibration = await withDbClient(env, async (client) => {
      const result = await client.query<{ performed_at: Date | string | null }>(
        `
        SELECT j2.performed_at
        FROM calibration_job j2
        WHERE j2.asset_id = $1
          AND j2.id <> $2
          AND j2.status IN ('APPROVED', 'SUPERSEDED')
          AND j2.approved_at < COALESCE($3, now())
        ORDER BY j2.approved_at DESC
        LIMIT 1
        `,
        [row.asset_id, row.job_id, toDateOrNull(row.approved_at)],
      );
      return toDateOrNull(result.rows[0]?.performed_at);
    });

    const labLogoUrl = await resolveOrganizationLogoDataUrl(
      env,
      row.lab_logo,
      row.job_id,
    );

    const margins = toNumberArray(row.as_found_margins);
    const isStandardRecall = row.recall_id !== null && row.std_name !== null;
    const data: OotNotificationDocumentData = {
      kind: isStandardRecall ? "standard_recall" : "as_found",
      standard: isStandardRecall
        ? {
            name: row.std_name ?? "Padrão de referência",
            serialNumber: row.std_serial,
            certificateNumber: row.std_certificate,
            calibrationDate: toDateOrNull(row.std_calibration_date),
          }
        : null,
      ncNumber: row.nc_number,
      issuedAt: new Date(),
      lab: {
        name: row.lab_name ?? "Laboratório",
        taxId: row.lab_cnpj,
        address: null,
        email: row.lab_email,
        phone: row.lab_phone,
        logoUrl: labLogoUrl,
      },
      customer: {
        name: row.recipient_name ?? row.customer_name ?? "Cliente",
        email: row.customer_email,
      },
      instrument: {
        description: row.asset_name ?? "Instrumento",
        tag: row.asset_tag,
        serialNumber: row.asset_serial,
      },
      certificateNumber: row.certificate_number,
      calibrationDate: toDateOrNull(row.performed_at),
      previousCalibrationDate: previousCalibration,
      asFound: {
        pointsTotal: margins.length,
        pointsWithin: margins.filter((margin) => margin >= 0).length,
        worstMargin: margins.length > 0 ? Math.min(...margins) : null,
      },
      affectedScope: row.affected_scope,
      description: row.nc_description,
    };

    const html = renderToString(
      React.createElement(OotNotificationHtml, { data }),
    );
    const pdfBuffer = await generatePdfFromHtml(env, html);

    const { bucket, key } = ootNotificationKey({
      org: { id: row.organization_id, slug: row.org_slug ?? "" },
      notificationId: row.id,
      ncNumber: row.nc_number,
      year: (toDateOrNull(row.approved_at) ?? new Date()).getUTCFullYear(),
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });

    // Record the artifact. Only PENDING advances to GENERATED — a re-render
    // must never regress a notification already SENT/ACKNOWLEDGED.
    await withDbClient(env, (client) =>
      client.query(
        `
        UPDATE oot_notification
        SET pdf_r2_key = $2,
            pdf_sha256 = $3,
            status = CASE WHEN status = 'PENDING' THEN 'GENERATED' ELSE status END,
            updated_at = now()
        WHERE id = $1
        `,
        [row.id, key, sha256Hex(pdfBuffer)],
      ),
    );

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isDocumentMessage(
  message: BackgroundJobMessage,
): message is DocumentBackgroundJobMessage {
  return (
    message.type !== "INTEGRATION_SYNC" &&
    message.type !== "SCHEDULED_NOTIFICATIONS" &&
    message.type !== "PORTAL_DIGEST" &&
    message.type !== "MARKETING_CONTACT_SYNC" &&
    message.type !== "CERTIFICATE_XLSX_PREVIEW"
  );
}

function isServiceOrderDocumentMessage(
  message: DocumentBackgroundJobMessage,
): message is Extract<
  DocumentBackgroundJobMessage,
  {
    type:
      | "SERVICE_ORDER_INTAKE_DOCUMENT"
      | "SERVICE_ORDER_TAG"
      | "SERVICE_ORDER_QUOTE"
      | "SERVICE_ORDER_DELIVERY_RECEIPT";
  }
> {
  return (
    message.type === "SERVICE_ORDER_INTAKE_DOCUMENT" ||
    message.type === "SERVICE_ORDER_TAG" ||
    message.type === "SERVICE_ORDER_QUOTE" ||
    message.type === "SERVICE_ORDER_DELIVERY_RECEIPT"
  );
}

function isCalibrationCertificateMessage(
  message: BackgroundJobMessage,
): message is DocumentBackgroundJobMessage & {
  type?: "CERTIFICATE";
  jobId: number;
  userId: string;
} {
  if (!isDocumentMessage(message)) return false;
  if (isServiceOrderDocumentMessage(message)) return false;

  return (
    (message.type === undefined || message.type === "CERTIFICATE") &&
    typeof message.jobId === "number" &&
    typeof message.userId === "string"
  );
}

async function processDocumentMessage(
  env: Env,
  body: DocumentBackgroundJobMessage,
) {
  if (isServiceOrderDocumentMessage(body)) {
    let result: { success: boolean; error?: string };
    if (body.type === "SERVICE_ORDER_INTAKE_DOCUMENT") {
      result = await processServiceOrderIntakeDocument(
        env,
        body.serviceOrderId,
        body.documentId,
        body.userId,
      );
    } else if (body.type === "SERVICE_ORDER_TAG") {
      result = await processServiceOrderTag(
        env,
        body.serviceOrderId,
        body.tagId,
        body.userId,
      );
    } else if (body.type === "SERVICE_ORDER_QUOTE") {
      result = await processServiceOrderQuote(
        env,
        body.serviceOrderId,
        body.quoteId,
      );
    } else {
      result = await processServiceOrderDeliveryReceipt(
        env,
        body.serviceOrderId,
        body.documentId,
        body.userId,
      );
    }

    if (!result.success) {
      throw new Error(result.error ?? `${body.type} failed`);
    }
    return;
  }

  if (body.type === "OOT_NOTIFICATION") {
    const result = await processOotNotification(env, body.notificationId);
    if (!result.success) {
      throw new Error(result.error ?? "OOT_NOTIFICATION failed");
    }
    return;
  }

  const messageType = body.type || "CERTIFICATE";
  const result =
    messageType === "LABEL"
      ? await processLabelJob(env, body.jobId, body.userId)
      : await processJob(env, body.jobId, body.userId);

  if (!result.success && messageType !== "LABEL") {
    await withDbClient(env, (client) =>
      setJobError(
        client,
        body.jobId,
        result.error || "Unknown error",
        body.userId,
      ),
    ).catch((dbError) => {
      console.error(`[JOB ${body.jobId}] Failed to record error:`, dbError);
    });
  }

  if (!result.success) {
    throw new Error(result.error ?? `${messageType} generation failed`);
  }
}

async function processXlsxCertificateMessageIfSelected(
  env: Env,
  message: BackgroundJobMessage,
): Promise<boolean> {
  if (!isCalibrationCertificateMessage(message)) {
    return false;
  }

  const job = await withDbClient(env, (client) =>
    fetchJobData(client, message.jobId, env),
  );

  if (!job) {
    await withDbClient(env, (client) =>
      setJobError(client, message.jobId, "Job not found", message.userId),
    );
    throw new Error("Job not found");
  }

  const xlsxSelection = await withDbClient(env, (client) =>
    fetchXlsxTemplateSelectionForJob(client, message.jobId),
  );

  if (!xlsxSelection) {
    return false;
  }

  const result = await processXlsxIssuedCertificate(
    env,
    message.jobId,
    job,
    message.userId,
    xlsxSelection,
  );

  if (!result.success) {
    await withDbClient(env, (client) =>
      setJobError(
        client,
        message.jobId,
        result.error || "Unknown error",
        message.userId,
      ),
    ).catch((dbError) => {
      console.error(
        `[JOB ${message.jobId}] Failed to record XLSX error:`,
        dbError,
      );
    });
    throw new Error(result.error ?? "XLSX certificate generation failed");
  }

  return true;
}

async function processXlsxPreviewJob(
  env: Env,
  message: CertificateXlsxPreviewBackgroundJobMessage,
) {
  const totalStart = performance.now();
  console.log(`[XLSX PREVIEW ${message.previewId}] Starting`);

  try {
    const preview = await withDbClient(env, async (client) => {
      const result = await client.query<{
        id: number;
        organization_id: string;
        organization_slug: string | null;
        sample_data: Record<string, unknown> | null;
        xlsx_r2_key: string;
        xlsx_sha256: string;
        binding_manifest: unknown;
        binding_manifest_sha256: string;
      }>(
        `
          select
            p.id,
            p.organization_id,
            o.slug as organization_slug,
            p.sample_data,
            v.xlsx_r2_key,
            v.xlsx_sha256,
            v.binding_manifest,
            v.binding_manifest_sha256
          from certificate_template_preview p
          inner join certificate_template_version v
            on v.id = p.template_version_id
          inner join organization o
            on o.id = p.organization_id
          where p.id = $1
            and p.template_version_id = $2
        `,
        [message.previewId, message.templateVersionId],
      );
      return result.rows[0] ?? null;
    });

    if (!preview) {
      throw new Error("XLSX preview not found");
    }

    const sourceObject = await getStoredObject(
      env,
      "media",
      preview.xlsx_r2_key,
    );
    if (!sourceObject) {
      throw new Error(`Template XLSX not found: ${preview.xlsx_r2_key}`);
    }

    const manifest = validateCertificateXlsxBindingManifest(
      preview.binding_manifest,
    );
    const source = prepareXlsxWorkbookForRender(
      new Uint8Array(await sourceObject.arrayBuffer()),
    );
    const engine = new ExcelTsCertificateWorkbookEngine();
    const filled = await fillCertificateWorkbook(
      engine,
      source,
      manifest,
      preview.sample_data ?? {},
    );
    const converter = createConfiguredXlsxToPdfConverter(env);
    const converted = await converter.convert(filled.workbook, {
      fileName: `preview-${message.previewId}.xlsx`,
      singlePageSheets: false,
    });

    const previewOrg: OrgRef = {
      id: preview.organization_id,
      slug: preview.organization_slug ?? "",
    };
    const filledXlsx = templatePreviewKey({
      org: previewOrg,
      previewId: preview.id,
      extension: "xlsx",
    });
    const pdfPreview = templatePreviewKey({
      org: previewOrg,
      previewId: preview.id,
      extension: "pdf",
    });
    const filledXlsxR2Key = filledXlsx.key;
    const pdfR2Key = pdfPreview.key;

    await bucketBinding(env, filledXlsx.bucket).put(
      filledXlsxR2Key,
      filled.workbook,
      {
        httpMetadata: {
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      },
    );
    await bucketBinding(env, pdfPreview.bucket).put(pdfR2Key, converted.bytes, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const renderMetadata = {
      converter: converted.metadata,
      xlsxSha256: preview.xlsx_sha256,
      bindingManifestSha256: preview.binding_manifest_sha256,
      workbookWarnings: filled.warnings,
      durationMs: Math.round(performance.now() - totalStart),
    };

    await withDbClient(env, (client) =>
      client.query(
        `
          update certificate_template_preview
          set status = 'RENDERED',
              filled_xlsx_r2_key = $1,
              pdf_r2_key = $2,
              pdf_sha256 = $3,
              render_metadata = $4::jsonb,
              error = null,
              updated_at = now()
          where id = $5
        `,
        [
          filledXlsxR2Key,
          pdfR2Key,
          sha256Hex(converted.bytes),
          JSON.stringify(renderMetadata),
          preview.id,
        ],
      ),
    );

    console.log(
      `[XLSX PREVIEW ${message.previewId}] DONE in ${renderMetadata.durationMs}ms`,
    );
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    await withDbClient(env, (client) =>
      client.query(
        `
          update certificate_template_preview
          set status = 'FAILED',
              error = $1,
              updated_at = now()
          where id = $2
        `,
        [errorMessage, message.previewId],
      ),
    ).catch((dbError) => {
      console.error(
        `[XLSX PREVIEW ${message.previewId}] Failed to record error:`,
        dbError,
      );
    });
    throw error;
  }
}

function renderAccreditationSealDataUrl(
  accreditationNumber: string | null | undefined,
): string {
  const svg = renderToString(
    React.createElement(AccreditationSealSvg, { accreditationNumber }),
  );
  // workbookImageFromDataUrl rasterizes SVG data URLs to PNG via Resvg.
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}

async function processXlsxIssuedCertificate(
  env: Env,
  jobId: number,
  job: JobData,
  userId: string,
  selection: XlsxTemplateSelection,
): Promise<{ success: boolean; certificateUrl?: string; error?: string }> {
  const existingSnapshot = await withDbClient(env, async (client) => {
    const result = await client.query<{
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
    );
    return result.rows[0] ?? null;
  });

  if (existingSnapshot) {
    const certificateUrl = `https://certificates.calibrafacil.com/${existingSnapshot.pdf_r2_key}`;
    await withDbClient(env, (client) =>
      updateJobWithCertificate(
        client,
        jobId,
        certificateUrl,
        userId,
        parseSignatureMetadata(existingSnapshot.signature_metadata),
        undefined,
        { preserveSignatureMetadata: true },
      ),
    );
    return { success: true, certificateUrl };
  }

  if (!job.organizationId) {
    return { success: false, error: "Missing organization_id" };
  }

  try {
    const sourceObject = await getStoredObject(
      env,
      "media",
      selection.xlsxR2Key,
    );
    if (!sourceObject) {
      throw new Error(`Template XLSX not found: ${selection.xlsxR2Key}`);
    }

    const manifest = validateCertificateXlsxBindingManifest(
      selection.bindingManifest,
    );
    const source = prepareXlsxWorkbookForRender(
      new Uint8Array(await sourceObject.arrayBuffer()),
    );
    const engine = new ExcelTsCertificateWorkbookEngine();
    const filled = await renderCertificateWorkbook(
      engine,
      source,
      manifest,
      job,
      { renderAccreditationSeal: renderAccreditationSealDataUrl },
    );
    const inputDataSnapshot = filled.data;
    const converter = createConfiguredXlsxToPdfConverter(env);
    const converted = await converter.convert(filled.workbook, {
      fileName: `${job.jobId}.xlsx`,
      singlePageSheets: false,
    });
    const signed = await signPdfWithUnitCertificate(
      env,
      jobId,
      job.organizationId,
      job.unitId,
      Buffer.from(converted.bytes),
    );
    const pdfBuffer = signed.pdfBuffer;

    const year = getYear(
      job.approvedAt ?? job.performedAt,
      "approvedAt/performedAt",
    );
    const issuedObjectId = randomUUID();
    const certDescriptor = {
      org: {
        id: job.organizationId,
        slug: job.organizationSlug ?? "",
      },
      jobId: job.jobId,
      issuedId: issuedObjectId,
      certNumber: job.certificateName ?? job.jobId,
      year,
      companyName: job.customer.name,
      assetTag: job.asset.tag,
      brand: job.asset.manufacturer,
    };
    const pdf = issuedCertificatePdfKey(certDescriptor);
    const filledXlsx = issuedCertificateXlsxKey(certDescriptor);
    const pdfR2Key = pdf.key;
    const filledXlsxR2Key = filledXlsx.key;

    await bucketBinding(env, filledXlsx.bucket).put(
      filledXlsxR2Key,
      filled.workbook,
      {
        httpMetadata: {
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      },
    );
    await bucketBinding(env, pdf.bucket).put(pdfR2Key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const renderMetadata = {
      converter: converted.metadata,
      workbookWarnings: filled.warnings,
      signature: signed.signatureMetadata
        ? { signed: true, signerName: signed.signatureMetadata.signerName }
        : { signed: false },
      renderedAt: new Date().toISOString(),
    };

    const issuedPdfR2Key = await withDbClient(env, async (client) => {
      const insertResult = await client.query<{ pdf_r2_key: string }>(
        `
          insert into issued_certificate_snapshot (
            organization_id,
            job_id,
            template_id,
            template_version_id,
            certificate_number,
            filled_xlsx_r2_key,
            filled_xlsx_sha256,
            pdf_r2_key,
            pdf_sha256,
            binding_manifest_sha256,
            render_policy,
            render_metadata,
            input_data_snapshot,
            status,
            issued_by
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, 'ISSUED', $14)
          on conflict (job_id) do nothing
          returning pdf_r2_key
        `,
        [
          job.organizationId,
          jobId,
          selection.templateId,
          selection.templateVersionId,
          job.jobId,
          filledXlsxR2Key,
          sha256Hex(filled.workbook),
          pdfR2Key,
          sha256Hex(pdfBuffer),
          selection.bindingManifestSha256,
          JSON.stringify(selection.renderPolicy),
          JSON.stringify(renderMetadata),
          JSON.stringify(inputDataSnapshot),
          userId,
        ],
      );

      const insertedSnapshotPdfR2Key = insertResult.rows[0]?.pdf_r2_key;
      const existingSnapshotAfterConflict = insertedSnapshotPdfR2Key
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
      const snapshotPdfR2Key =
        insertedSnapshotPdfR2Key ?? existingSnapshotAfterConflict?.pdf_r2_key;

      if (!snapshotPdfR2Key) {
        throw new Error("Issued certificate snapshot was not persisted");
      }

      const snapshotCertificateUrl = `https://certificates.calibrafacil.com/${snapshotPdfR2Key}`;
      await updateJobWithCertificate(
        client,
        jobId,
        snapshotCertificateUrl,
        userId,
        insertedSnapshotPdfR2Key
          ? signed.signatureMetadata
          : parseSignatureMetadata(
              existingSnapshotAfterConflict?.signature_metadata,
            ),
        insertedSnapshotPdfR2Key ? signed.signatureVerdict : undefined,
        { preserveSignatureMetadata: !insertedSnapshotPdfR2Key },
      );
      return snapshotPdfR2Key;
    });

    const certificateUrl = `https://certificates.calibrafacil.com/${issuedPdfR2Key}`;
    return { success: true, certificateUrl };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

// =============================================================================
// AUDIT PACK (#738) — customer-requested bulk export of released certificates
// + fleet-status report + verification-links index, zipped and uploaded to R2.
// =============================================================================

// Mirror the API-side enqueue caps (apps/api/src/routes/portal.ts). Both are
// re-checked here because the certificate set is re-derived at generation time.
const AUDIT_PACK_MAX_CERTIFICATES = 500;
const AUDIT_PACK_MAX_TOTAL_BYTES = 512 * 1024 * 1024; // 512 MB
const AUDIT_PACK_EXPIRY_DAYS = 7;

type AuditPackParams = {
  dateFrom: string;
  dateTo: string;
  unitId: number | null;
  include: {
    certificates: boolean;
    fleetReport: boolean;
    verificationIndex: boolean;
  };
  customerIds: number[];
};

/** Defensive parse of the portal_export_job.params jsonb column. */
function parseAuditPackParams(value: unknown): AuditPackParams {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid audit pack params");
  }
  const record = Object.fromEntries(Object.entries(value));
  const include =
    record.include && typeof record.include === "object"
      ? Object.fromEntries(Object.entries(record.include))
      : {};
  const customerIds = Array.isArray(record.customerIds)
    ? record.customerIds.filter(
        (id): id is number => typeof id === "number" && Number.isInteger(id),
      )
    : [];
  if (
    typeof record.dateFrom !== "string" ||
    typeof record.dateTo !== "string" ||
    customerIds.length === 0
  ) {
    throw new Error("Invalid audit pack params");
  }
  return {
    dateFrom: record.dateFrom,
    dateTo: record.dateTo,
    unitId: typeof record.unitId === "number" ? record.unitId : null,
    include: {
      certificates: include.certificates === true,
      fleetReport: include.fleetReport === true,
      verificationIndex: include.verificationIndex === true,
    },
    customerIds,
  };
}

function portalBaseUrl(): string {
  return (
    process.env.PORTAL_APP_URL ??
    process.env.PORTAL_URL ??
    "https://portal.calibrafacil.com"
  ).replace(/\/$/, "");
}

/** Sanitize a ZIP entry filename segment (keeps readable pt-BR-ish names). */
function auditPackFileName(value: string): string {
  const sanitized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "")
    .slice(0, 120);
  return sanitized || "certificado";
}

type AuditPackCertificateRow = {
  id: number;
  job_id: string;
  certificate_name: string | null;
  certificate_url: string;
  verification_token: string;
  approved_date: string;
  asset_tag: string;
  asset_name: string;
  serial_number: string | null;
  customer_name: string;
};

function formatBrDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}/${month}/${year}` : isoDate;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Verification-links index: one row per certificate pointing at the PUBLIC
 * verification page (`/v/{token}`), so an auditor can independently confirm
 * authenticity and signature without a portal login.
 */
function renderAuditPackIndexHtml(params: {
  labName: string;
  customerName: string;
  dateFrom: string;
  dateTo: string;
  generatedAtIso: string;
  certificates: AuditPackCertificateRow[];
  verificationBaseUrl: string;
  showUnit: boolean;
}): string {
  const rows = params.certificates
    .map((cert) => {
      const url = `${params.verificationBaseUrl}/v/${encodeURIComponent(cert.verification_token)}`;
      return `<tr>
        <td>${escapeHtml(cert.certificate_name ?? cert.job_id)}</td>
        ${params.showUnit ? `<td>${escapeHtml(cert.customer_name)}</td>` : ""}
        <td>${escapeHtml(cert.asset_name)}<div class="sub">${escapeHtml(cert.asset_tag)}${cert.serial_number ? ` · NS ${escapeHtml(cert.serial_number)}` : ""}</div></td>
        <td class="num">${escapeHtml(formatBrDate(cert.approved_date))}</td>
        <td><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Índice de verificação — Pacote de auditoria</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 32px; }
  .wrap { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .eyebrow { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #64748b; }
  p.note { font-size: 13px; color: #334155; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { text-align: left; padding: 6px 8px 6px 0; border-bottom: 1px solid #e2e8f0; font-size: 12px; vertical-align: top; }
  th { color: #475569; font-weight: 500; }
  td.num { font-family: ui-monospace, monospace; }
  .sub { color: #64748b; font-size: 11px; }
  a { color: #1d4ed8; word-break: break-all; }
</style>
</head>
<body>
  <div class="wrap">
    <p class="eyebrow">${escapeHtml(params.labName)} · Pacote de auditoria</p>
    <h1>Índice de certificados e links de verificação</h1>
    <p class="eyebrow">${escapeHtml(params.customerName)} · ${escapeHtml(formatBrDate(params.dateFrom))} a ${escapeHtml(formatBrDate(params.dateTo))}</p>
    <p class="note">
      Cada link abre a página pública de verificação do certificado, onde o
      auditor pode confirmar a autenticidade e a assinatura digital do
      documento de forma independente. Este pacote inclui apenas a versão
      vigente de cada certificado (emendas substituem o original).
    </p>
    <table>
      <thead>
        <tr>
          <th>Certificado</th>
          ${params.showUnit ? "<th>Unidade</th>" : ""}
          <th>Instrumento</th>
          <th>Data</th>
          <th>Verificação</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <p class="note">Gerado em ${escapeHtml(new Date(params.generatedAtIso).toISOString())} · ${params.certificates.length} certificado(s).</p>
  </div>
</body>
</html>`;
}

function buildAuditPackReadme(params: {
  labName: string;
  customerName: string;
  dateFrom: string;
  dateTo: string;
  generatedAtIso: string;
  certificateCount: number;
  missingCount: number;
  include: AuditPackParams["include"];
}): string {
  const lines = [
    "PACOTE DE AUDITORIA",
    "===================",
    "",
    `Laboratório: ${params.labName}`,
    `Cliente: ${params.customerName}`,
    `Período (data de aprovação): ${formatBrDate(params.dateFrom)} a ${formatBrDate(params.dateTo)}`,
    `Gerado em: ${params.generatedAtIso}`,
    "",
    "Conteúdo:",
  ];
  if (params.include.certificates) {
    lines.push(
      `  - certificados/ — ${params.certificateCount} certificado(s) de calibração em PDF (apenas a versão vigente de cada certificado).`,
    );
  }
  if (params.include.fleetReport) {
    lines.push(
      "  - relatorio-frota.pdf / relatorio-frota.xlsx — situação da frota de instrumentos na data de geração.",
    );
  }
  if (params.include.verificationIndex) {
    lines.push(
      "  - indice.html — índice dos certificados com links públicos de verificação de autenticidade.",
    );
  }
  if (params.missingCount > 0) {
    lines.push(
      "",
      `Atenção: ${params.missingCount} certificado(s) do período não puderam ser incluídos (arquivo indisponível no momento da geração).`,
    );
  }
  lines.push(
    "",
    "AVISO: o relatório de situação da frota e o índice são documentos",
    "informativos e NÃO são certificados de calibração. A periodicidade de",
    "calibração é definida pelo cliente (NBR ISO/IEC 17025 §7.8.4.3).",
    "",
    "Gerado via CalibraFácil.",
    "",
  );
  return lines.join("\n");
}

async function processAuditPackJob(
  env: Env,
  message: AuditPackBackgroundJobMessage,
) {
  const totalStart = performance.now();
  const exportId = message.exportId;
  console.log(`[AUDIT PACK ${exportId}] Starting`);

  try {
    const exportRow = await withDbClient(env, async (client) => {
      const result = await client.query<{
        id: number;
        lab_organization_id: string;
        auth_organization_id: string;
        auth_organization_name: string;
        organization_slug: string | null;
        lab_organization_name: string;
        params: unknown;
      }>(
        `
          update portal_export_job pe
          set status = 'PROCESSING', updated_at = now()
          from organization lab, organization auth
          where pe.id = $1
            and lab.id = pe.lab_organization_id
            and auth.id = pe.auth_organization_id
            and pe.status in ('PENDING', 'PROCESSING')
          returning
            pe.id,
            pe.lab_organization_id,
            pe.auth_organization_id,
            auth.name as auth_organization_name,
            lab.slug as organization_slug,
            lab.name as lab_organization_name,
            pe.params
        `,
        [exportId],
      );
      return result.rows[0] ?? null;
    });

    if (!exportRow) {
      throw new Error("Audit pack export not found");
    }

    const params = parseAuditPackParams(exportRow.params);
    const generatedAtIso = new Date().toISOString();
    const labName = exportRow.lab_organization_name;
    const customerName = exportRow.auth_organization_name;
    const showUnit = params.customerIds.length > 1;

    // Certificates are needed for both the PDF folder and the index.
    const wantsCertificateRows =
      params.include.certificates || params.include.verificationIndex;

    const certificates = wantsCertificateRows
      ? await withDbClient(env, async (client) => {
          // Same window semantics as the portal /certificates list: approval
          // date in America/Sao_Paulo, latest (non-superseded) version only.
          const candidates = await client.query<AuditPackCertificateRow>(
            `
              select
                cj.id,
                cj.job_id,
                cj.certificate_name,
                cj.certificate_url,
                cj.verification_token,
                to_char((cj.approved_at at time zone 'utc' at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as approved_date,
                a.tag as asset_tag,
                a.name as asset_name,
                a.serial_number,
                c.name as customer_name
              from calibration_job cj
              inner join asset a on a.id = cj.asset_id
              inner join customer c on c.id = cj.customer_id
              where cj.customer_id = any($1::int[])
                and cj.status = 'APPROVED'
                and cj.superseded_by_id is null
                and cj.certificate_url is not null
                and (cj.approved_at at time zone 'utc' at time zone 'America/Sao_Paulo')::date >= $2::date
                and (cj.approved_at at time zone 'utc' at time zone 'America/Sao_Paulo')::date <= $3::date
              order by cj.approved_at asc
            `,
            [params.customerIds, params.dateFrom, params.dateTo],
          );

          if (candidates.rows.length === 0) return [];

          // RELEASE GATE (hard requirement, #738): re-evaluated here at
          // generation time — a certificate held for billing/payment must
          // never reach the ZIP, even if it was released at enqueue time.
          const releases = await client.query<{
            calibration_job_id: number;
            status: string;
          }>(
            `
              select calibration_job_id, status
              from certificate_release
              where calibration_job_id = any($1::int[])
                and organization_id = $2
            `,
            [
              candidates.rows.map((row) => row.id),
              exportRow.lab_organization_id,
            ],
          );
          const held = new Set(
            releases.rows
              .filter(
                (row) =>
                  row.status === "HELD_FOR_BILLING" ||
                  row.status === "HELD_FOR_PAYMENT",
              )
              .map((row) => row.calibration_job_id),
          );
          return candidates.rows.filter((row) => !held.has(row.id));
        })
      : [];

    if (certificates.length > AUDIT_PACK_MAX_CERTIFICATES) {
      throw new Error(
        `O período selecionado tem mais de ${AUDIT_PACK_MAX_CERTIFICATES} certificados. Reduza o período e gere pacotes menores.`,
      );
    }

    const zipEntries: Zippable = {};
    let totalBytes = 0;
    let missingCount = 0;
    const includedJobIds: number[] = [];

    if (params.include.certificates) {
      const usedNames = new Set<string>();
      for (const cert of certificates) {
        const key = new URL(cert.certificate_url).pathname.slice(1);
        // oxlint-disable-next-line eslint/no-await-in-loop -- sequential downloads keep peak memory bounded to one PDF + the accumulated zip entries.
        const object = await getStoredObject(env, "documents", key);
        if (!object) {
          missingCount += 1;
          console.error(
            `[AUDIT PACK ${exportId}] Certificate PDF missing in R2, skipping`,
            { jobId: cert.job_id, key },
          );
          continue;
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
        const bytes = new Uint8Array(await object.arrayBuffer());
        totalBytes += bytes.byteLength;
        if (totalBytes > AUDIT_PACK_MAX_TOTAL_BYTES) {
          throw new Error(
            "O pacote excede o tamanho máximo suportado. Reduza o período e gere pacotes menores.",
          );
        }
        const base = auditPackFileName(
          `${cert.certificate_name ?? cert.job_id} - ${cert.asset_tag}`,
        );
        let name = `certificados/${base}.pdf`;
        for (let n = 2; usedNames.has(name); n += 1) {
          name = `certificados/${base}-${n}.pdf`;
        }
        usedNames.add(name);
        // PDFs are already compressed — store them instead of re-deflating.
        zipEntries[name] = [bytes, { level: 0 }];
        includedJobIds.push(cert.id);
      }
    } else {
      includedJobIds.push(...certificates.map((cert) => cert.id));
    }

    if (params.include.fleetReport) {
      const assets = await withDbClient(env, async (client) => {
        const result = await client.query<{
          tag: string;
          name: string;
          serial_number: string | null;
          manufacturer: string | null;
          model: string | null;
          customer_name: string;
          last_calibration_date: Date | null;
          next_calibration_date: Date | null;
          calibration_interval_months: number | null;
          metrology_regime: string;
          next_legal_verification_date: Date | null;
        }>(
          `
            select
              a.tag,
              a.name,
              a.serial_number,
              a.manufacturer,
              a.model,
              c.name as customer_name,
              a.last_calibration_date,
              a.next_calibration_date,
              a.calibration_interval_months,
              a.metrology_regime,
              a.next_legal_verification_date
            from asset a
            inner join customer c on c.id = a.customer_id
            where a.customer_id = any($1::int[])
              and a.status = 'ACTIVE'
              and a.deleted_at is null
            order by c.name asc, a.tag asc
          `,
          [params.customerIds],
        );
        return result.rows;
      });

      const fleetAssets: FleetStatusAsset[] = assets.map((asset) => ({
        name: asset.name,
        tag: asset.tag,
        serialNumber: asset.serial_number,
        manufacturer: asset.manufacturer,
        model: asset.model,
        unitName: showUnit ? asset.customer_name : null,
        lastCalibrationDate: asset.last_calibration_date?.toISOString() ?? null,
        nextCalibrationDate: asset.next_calibration_date?.toISOString() ?? null,
        calibrationIntervalMonths: asset.calibration_interval_months,
        metrologyRegime: asset.metrology_regime,
        nextLegalVerificationDate:
          asset.next_legal_verification_date?.toISOString() ?? null,
      }));

      const fleetHtml = renderFleetStatusReportHtml({
        labName,
        customerName,
        generatedAtIso,
        dueSoonDays: FLEET_DUE_SOON_DAYS,
        assets: fleetAssets,
      });
      const fleetPdf = await generatePdfFromHtml(env, fleetHtml);
      zipEntries["relatorio-frota.pdf"] = [fleetPdf, { level: 0 }];

      const workbook = new Workbook();
      const sheet = workbook.addWorksheet("Situação da frota");
      const now = new Date(generatedAtIso);
      const header = [
        ...(showUnit ? ["Unidade"] : []),
        "Tag",
        "Instrumento",
        "Fabricante",
        "Modelo",
        "Nº de série",
        "Última calibração",
        "Próxima calibração",
        "Periodicidade (meses)",
        "Regime metrológico",
        "Próxima verificação legal",
        "Situação",
      ];
      sheet.addRow(header);
      for (const asset of fleetAssets) {
        const due = classifyFleetDueStatus(
          asset.nextCalibrationDate
            ? new Date(asset.nextCalibrationDate)
            : null,
          now,
          FLEET_DUE_SOON_DAYS,
        );
        sheet.addRow([
          ...(showUnit ? [asset.unitName ?? ""] : []),
          asset.tag,
          asset.name,
          asset.manufacturer ?? "",
          asset.model ?? "",
          asset.serialNumber ?? "",
          asset.lastCalibrationDate?.slice(0, 10) ?? "",
          asset.nextCalibrationDate?.slice(0, 10) ?? "",
          asset.calibrationIntervalMonths ?? "",
          asset.metrologyRegime,
          asset.nextLegalVerificationDate?.slice(0, 10) ?? "",
          due.label,
        ]);
      }
      const xlsxBytes = new Uint8Array(
        await workbook.xlsx.writeBuffer({ validate: false }),
      );
      zipEntries["relatorio-frota.xlsx"] = [xlsxBytes, { level: 0 }];
    }

    if (params.include.verificationIndex) {
      zipEntries["indice.html"] = strToU8(
        renderAuditPackIndexHtml({
          labName,
          customerName,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          generatedAtIso,
          certificates,
          verificationBaseUrl: portalBaseUrl(),
          showUnit,
        }),
      );
    }

    zipEntries["README.txt"] = strToU8(
      buildAuditPackReadme({
        labName,
        customerName,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        generatedAtIso,
        certificateCount: includedJobIds.length,
        missingCount,
        include: params.include,
      }),
    );

    const zipBytes = zipSync(zipEntries, { level: 6 });

    const storage = portalAuditPackKey({
      org: {
        id: exportRow.lab_organization_id,
        slug: exportRow.organization_slug ?? "",
      },
      exportId,
      generatedAt: new Date(generatedAtIso),
    });
    await bucketBinding(env, storage.bucket).put(storage.key, zipBytes, {
      httpMetadata: { contentType: "application/zip" },
    });

    await withDbClient(env, (client) =>
      client.query(
        `
          update portal_export_job
          set status = 'COMPLETED',
              certificate_count = $1,
              included_job_ids = $2::jsonb,
              r2_key = $3,
              file_size_bytes = $4,
              failure_reason = null,
              expires_at = now() + ($5 || ' days')::interval,
              completed_at = now(),
              updated_at = now()
          where id = $6
        `,
        [
          includedJobIds.length,
          JSON.stringify(includedJobIds),
          storage.key,
          zipBytes.byteLength,
          String(AUDIT_PACK_EXPIRY_DAYS),
          exportId,
        ],
      ),
    );

    // Non-fatal: the pack is ready even if the notification fails.
    try {
      await notifyAuditPackReady(exportId);
    } catch (notifyError) {
      console.error(
        `[AUDIT PACK ${exportId}] Failed to send ready notification:`,
        notifyError,
      );
    }

    const totalMs = Math.round(performance.now() - totalStart);
    console.log(
      `[AUDIT PACK ${exportId}] DONE in ${totalMs}ms (${includedJobIds.length} certificates, ${zipBytes.byteLength} bytes)`,
    );
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    await withDbClient(env, (client) =>
      client.query(
        `
          update portal_export_job
          set status = 'FAILED', failure_reason = $1, updated_at = now()
          where id = $2
        `,
        [errorMessage, exportId],
      ),
    ).catch((dbError) => {
      console.error(
        `[AUDIT PACK ${exportId}] Failed to record error:`,
        dbError,
      );
    });
    throw error;
  }
}

// one capture site covering every run mode (Vercel Queue
// consumer, container drain, local poller, inline/local dev): a failing job is
// reported with structural tags before the error continues into the caller's
// retry path. Flush is bounded so a serverless caller doesn't freeze with the
// event still in flight.
export async function processBackgroundJob(
  env: Env,
  message: BackgroundJobMessage,
) {
  try {
    await processBackgroundJobUnreported(env, message);
  } catch (error) {
    reportWorkerError(error, { jobType: message.type ?? "CERTIFICATE" });
    await flushWorkerErrorReporter();
    throw error;
  }
}

async function processBackgroundJobUnreported(
  env: Env,
  message: BackgroundJobMessage,
) {
  if (message.type === "CERTIFICATE_XLSX_PREVIEW") {
    await processXlsxPreviewJob(env, message);
    return;
  }

  if (message.type === "AUDIT_PACK") {
    await processAuditPackJob(env, message);
    return;
  }

  if (message.type === "INTEGRATION_SYNC") {
    await processIntegrationSync(env, message);
    return;
  }

  if (message.type === "SCHEDULED_NOTIFICATIONS") {
    await processScheduledNotifications(env);
    return;
  }

  if (message.type === "PORTAL_DIGEST") {
    await processPortalDigest();
    return;
  }

  if (message.type === "MARKETING_CONTACT_SYNC") {
    await processMarketingContactSync(env);
    return;
  }

  if (message.type === "SPC_RECOMPUTE") {
    await processSpcRecompute(env);
    return;
  }

  if (message.type === "EMAIL_DOMAIN_HEALTH") {
    await processEmailDomainHealth();
    return;
  }

  if (await processXlsxCertificateMessageIfSelected(env, message)) {
    return;
  }

  if (isCalibrationCertificateMessage(message)) {
    await withDbClient(env, (client) =>
      setJobError(
        client,
        message.jobId,
        CERTIFICATE_XLSX_TEMPLATE_REQUIRED_MESSAGE,
        message.userId,
      ),
    ).catch((dbError) => {
      console.error(
        `[JOB ${message.jobId}] Failed to record missing XLSX template error:`,
        dbError,
      );
    });
    throw new Error(CERTIFICATE_XLSX_TEMPLATE_REQUIRED_MESSAGE);
  }

  // HTML/label documents render through the hosted Gotenberg service
  // (services/gotenberg) — no in-function Chromium to launch.
  await processDocumentMessage(env, message);
}

// One message dispatcher only: every run mode routes through
// processBackgroundJob above. The old processBackgroundJobBatch re-implemented
// the same routing as a parallel filter-chain with no callers — and had
// already diverged (an unselected calibration-certificate message fell through
// to the HTML-document path instead of failing with the template-required
// error). Batch callers iterate messages and call processBackgroundJob.
export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const batchSize = batch.messages.length;
    console.log(`[BATCH] Processing ${batchSize} job(s)`);
    const batchStart = performance.now();

    for (const msg of batch.messages) {
      try {
        await processBackgroundJob(env, msg.body);
        msg.ack();
      } catch (error) {
        console.error("[BATCH] Failed to process message:", {
          error,
          body: msg.body,
        });
        // Forward the real error so the DB-queue runtime records it as the job's
        // last_error (REQ-REL-OBS-002) instead of a generic placeholder.
        msg.retry(error);
      }
    }

    const batchMs = Math.round(performance.now() - batchStart);
    console.log(
      `[BATCH] Completed ${batchSize} job(s) in ${batchMs}ms (avg: ${Math.round(batchMs / batchSize)}ms/job)`,
    );
  },

  // Health check endpoint
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", worker: "calibra-facil-worker" }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        name: "Calibra Fácil - Certificate Worker",
        description: "Queue consumer for PDF certificate generation",
        endpoints: {
          "/health": "Health check",
        },
        note: "This worker processes queue messages. Queue testing requires deployment.",
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  },

  // Scheduled handlers for compliance notifications and integration syncs
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    if (event.cron === "*/30 * * * *") {
      console.log("[Scheduled] Starting integration scheduler");
      const start = performance.now();

      try {
        const result = await processScheduledIntegrationSyncs(env);
        const duration = Math.round(performance.now() - start);
        console.log(
          `[Scheduled] Integration scheduler completed in ${duration}ms: ` +
            `${result.scheduledRuns} run(s) dispatched`,
        );
      } catch (error) {
        console.error("[Scheduled] Error processing integrations:", error);
        throw error;
      }

      return;
    }

    console.log("[Scheduled] Starting daily compliance notification check");
    const start = performance.now();

    try {
      const result = await processScheduledNotifications(env);
      const duration = Math.round(performance.now() - start);

      console.log(
        `[Scheduled] Completed in ${duration}ms: ` +
          `${result.assetsProcessed} assets, ` +
          `${result.standardsProcessed} standards, ` +
          `${result.jobsProcessed} jobs, ` +
          `${result.visitsProcessed} visits, ` +
          `${result.signingCertsProcessed} signing certs`,
      );
    } catch (error) {
      console.error("[Scheduled] Error processing notifications:", error);
      throw error;
    }
  },
};
