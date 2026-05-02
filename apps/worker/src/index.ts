import type { Browser, Page } from "puppeteer-core";
import { Client } from "pg";
import { renderToString } from "react-dom/server";
import {
  CertificateHtml,
  type JobData,
  LabelHtml,
  type LabelData,
  ServiceOrderDeliveryReceiptHtml,
  ServiceOrderIntakeDocumentHtml,
  ServiceOrderQuoteHtml,
  ServiceOrderTagHtml,
  type ServiceOrderDeliveryReceiptData,
  type ServiceOrderDocumentData,
  type ServiceOrderQuoteData,
  type ServiceOrderTagData,
} from "@calibra-facil/documents";
import React from "react";
import QRCode from "qrcode";
import { processScheduledNotifications } from "./scheduled.js";
import {
  signPdf,
  decryptPassword,
  decryptBinary,
  type SignatureMetadata,
} from "@calibra-facil/signing";
import { DEFAULT_CERTIFICATE_TEMPLATE_CONFIG } from "@calibra-facil/shared";
import {
  processIntegrationSync,
  processScheduledIntegrationSyncs,
  type IntegrationSyncQueueMessage,
} from "./integrations.js";
import {
  type BackgroundJobMessage,
  type DocumentBackgroundJobMessage,
} from "@calibra-facil/shared";

export interface Env {
  CERTIFICATES_BUCKET: {
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    put(
      key: string,
      body: Buffer | Uint8Array | ArrayBuffer,
      options?: { httpMetadata?: { contentType?: string } },
    ): Promise<void>;
  };
  HYPERDRIVE: { connectionString: string };
  CHROME_EXECUTABLE_PATH?: string;
  CHROMIUM_PACK_URL?: string;
  SIGNING_MASTER_KEY?: string; // Optional - if not set, PDFs won't be signed
  INTEGRATIONS_MASTER_KEY?: string;
}

export type QueueMessage = BackgroundJobMessage;

export interface MessageBatch<T> {
  messages: {
    body: T;
    ack: () => void;
    retry: () => void;
  }[];
}

type Dateish = Date | string | null | undefined;

function encodeKeyPart(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`R2 key part "${label}" is empty`);
  }
  return encodeURIComponent(trimmed);
}

function getYearFromDateish(value: Dateish, label: string): number {
  if (!value) {
    throw new Error(`Missing ${label} for R2 key year`);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${label} for R2 key year`);
    }
    return value.getUTCFullYear();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`Invalid ${label} for R2 key year`);
    }
    const normalized = trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid ${label} for R2 key year`);
    }
    return parsed.getUTCFullYear();
  }
  throw new Error(`Invalid ${label} for R2 key year`);
}

function buildR2Key(params: {
  orgId: string;
  jobId: string;
  year: number;
  type: "CERTIFICATE" | "LABEL";
}): string {
  const orgId = encodeKeyPart("orgId", params.orgId);
  const jobId = encodeKeyPart("jobId", params.jobId);
  const filename = params.type === "CERTIFICATE" ? "cert.pdf" : "label.pdf";
  return `org/${orgId}/${params.year}/jobs/${jobId}/${filename}`;
}

function buildServiceOrderR2Key(params: {
  orgId: string;
  serviceOrderNumber: string;
  year: number;
  type: "INTAKE" | "TAG" | "QUOTE" | "DELIVERY";
  version?: number;
  tagNumber?: string;
  quoteNumber?: string;
}) {
  const orgId = encodeKeyPart("orgId", params.orgId);
  const serviceOrderNumber = encodeKeyPart(
    "serviceOrderNumber",
    params.serviceOrderNumber,
  );
  if (params.type === "INTAKE") {
    return `org/${orgId}/${params.year}/service-orders/${serviceOrderNumber}/intake-v${params.version ?? 1}.pdf`;
  }
  if (params.type === "DELIVERY") {
    return `org/${orgId}/${params.year}/service-orders/${serviceOrderNumber}/delivery-v${params.version ?? 1}.pdf`;
  }
  if (params.type === "TAG") {
    const tag = encodeKeyPart("tagNumber", params.tagNumber ?? "tag");
    return `org/${orgId}/${params.year}/service-orders/${serviceOrderNumber}/tag-${tag}.pdf`;
  }
  const quote = encodeKeyPart("quoteNumber", params.quoteNumber ?? "quote");
  return `org/${orgId}/${params.year}/service-orders/${serviceOrderNumber}/quotes/${quote}-v${params.version ?? 1}.pdf`;
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
      cj.certificate_template_id,
      cj.certificate_template_snapshot,
      cj.results,
      cj.data,
      cj.organization_id,
      cj.approved_by,
      -- Amendment fields - ISO 17025 Clause 7.8.4.1
      cj.supersedes_id,
      cj.superseded_by_id,
      cj.amendment_number,
      cj.amendment_reason,
      -- Organization (Lab) info
      o.name as lab_name,
      o.cnpj as lab_cnpj,
      o.accreditation_number as lab_accreditation_number,
      o.accreditation_body as lab_accreditation_body,
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
      service_order_link.inmetro_repair_seal_number
    FROM calibration_job cj
    LEFT JOIN organization o ON cj.organization_id = o.id
    LEFT JOIN customer c ON cj.customer_id = c.id
    LEFT JOIN asset a ON cj.asset_id = a.id
    LEFT JOIN "user" u ON cj.approved_by = u.id
    LEFT JOIN calibration_job original ON cj.supersedes_id = original.id
    LEFT JOIN LATERAL (
      SELECT so.inmetro_repair_seal_number
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
            SELECT id, name, slug, version, config
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
          config: templateRow.config,
        }
      : {
          id: null,
          name: "Padrão do Sistema",
          slug: "padrao-sistema",
          version: 1,
          config: DEFAULT_CERTIFICATE_TEMPLATE_CONFIG,
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
        const signatureObject = await env.CERTIFICATES_BUCKET.get(
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
    certificateName: row.certificate_name,
    organizationId: row.organization_id,
    unitId: row.unit_id,
    performedAt: row.performed_at,
    approvedAt: row.approved_at,
    lab: {
      name: row.lab_name || "Laboratório de Calibração",
      cnpj: row.lab_cnpj,
      accreditationNumber: row.lab_accreditation_number,
      accreditationBody: row.lab_accreditation_body,
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
    methodSnapshot: row.method_snapshot,
    assetSnapshot: row.asset_snapshot,
    standardsSnapshot: row.standards_snapshot,
    serviceOrder: {
      inmetroRepairSealNumber: row.inmetro_repair_seal_number,
    },
    environmentalSnapshot: row.environmental_snapshot,
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
): Promise<void> {
  const now = new Date();

  // Check if job is SUPERSEDED (being regenerated with watermark)
  const statusResult = await client.query(
    `SELECT status FROM calibration_job WHERE id = $1`,
    [jobId],
  );
  const currentStatus = statusResult.rows[0]?.status;
  const isSuperseded = currentStatus === "SUPERSEDED";

  // Only update status to APPROVED if not already SUPERSEDED
  // SUPERSEDED jobs are being regenerated with watermark and should keep their status
  await client.query(
    `
    UPDATE calibration_job
    SET
      status = CASE WHEN status = 'SUPERSEDED' THEN 'SUPERSEDED' ELSE 'APPROVED' END,
      certificate_url = $2,
      signature_metadata = $3,
      updated_at = $4
    WHERE id = $1
    `,
    [
      jobId,
      certificateUrl,
      signatureMetadata ? JSON.stringify(signatureMetadata) : null,
      now,
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
        signatureMetadata: signatureMetadata
          ? { signed: true, signerName: signatureMetadata.signerName }
          : { signed: false },
      }),
      userId,
      now,
    ],
  );
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
    parts.neighbourhood,
    parts.city,
    parts.state,
    parts.cep,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(", ");
}

async function fetchServiceOrderDocumentData(
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
      so.opened_at,
      so.claimed_defect,
      so.intake_condition,
      so.accessories,
      so.invoice_remittance_number,
      so.invoice_remittance_key,
      so.carrier_name,
      so.third_party_name,
      so.old_seal_number,
      so.new_seal_number,
      so.inmetro_repair_seal_number,
      so.client_visible_notes,
      so.internal_notes,
      o.name as lab_name,
      o.cnpj as lab_cnpj,
      o.phone as lab_phone,
      o.email as lab_email,
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
      snap.capacity,
      snap.resolution,
      snap.observed_identification,
      settings.default_intake_terms
    FROM service_order so
    LEFT JOIN organization o ON so.organization_id = o.id
    LEFT JOIN organization_unit ou ON so.unit_id = ou.id
    LEFT JOIN customer c ON so.customer_id = c.id
    LEFT JOIN service_order_asset_snapshot snap ON snap.service_order_id = so.id
    LEFT JOIN service_order_settings settings ON settings.organization_id = so.organization_id
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

  return {
    serviceOrderNumber: row.service_order_number,
    openedAt: row.opened_at,
    requestedServices:
      row.priority === "warranty"
        ? ["Garantia"]
        : ["Orçamento", "Manutenção corretiva"],
    lab: {
      name: row.lab_name ?? "Laboratório",
      cnpj: row.lab_cnpj,
      phone: row.lab_phone,
      email: row.lab_email,
      address: null,
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
      capacity: row.capacity,
      resolution: row.resolution,
      observedIdentification: row.observed_identification,
    },
    intake: {
      claimedDefect: row.claimed_defect,
      intakeCondition: row.intake_condition,
      accessories: row.accessories,
      invoiceRemittanceNumber: row.invoice_remittance_number,
      invoiceRemittanceKey: row.invoice_remittance_key,
      carrierName: row.carrier_name,
      thirdPartyName: row.third_party_name,
      oldSealNumber: row.old_seal_number,
      newSealNumber: row.new_seal_number,
      inmetroRepairSealNumber: row.inmetro_repair_seal_number,
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
  page: Page,
  serviceOrderId: number,
  documentId: number | undefined,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await withDbClient(env, (client) =>
      fetchServiceOrderDocumentData(client, serviceOrderId),
    );
    if (!data) return { success: false, error: "Service order not found" };
    const html = renderToString(
      React.createElement(ServiceOrderIntakeDocumentHtml, { data }),
    );
    const pdfBuffer = await generatePdfFromHtml(page, html);
    const year = getYearFromDateish(data.openedAt, "openedAt");
    const key = buildServiceOrderR2Key({
      orgId: (await withDbClient(env, async (client) => {
        const result = await client.query(
          `SELECT organization_id FROM service_order WHERE id = $1`,
          [serviceOrderId],
        );
        return result.rows[0]?.organization_id;
      })) as string,
      serviceOrderNumber: data.serviceOrderNumber,
      year,
      type: "INTAKE",
      version: 1,
    });
    await env.CERTIFICATES_BUCKET.put(key, pdfBuffer, {
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

async function processServiceOrderTag(
  env: Env,
  page: Page,
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
    const pdfBuffer = await generatePdfFromHtml(page, html);
    const year = getYearFromDateish(data.opened_at, "openedAt");
    const tagNumber =
      data.tag_number ?? `${data.service_order_number}-TAG-${serviceOrderId}`;
    const key = buildServiceOrderR2Key({
      orgId: data.organization_id,
      serviceOrderNumber: data.service_order_number,
      year,
      type: "TAG",
      tagNumber,
    });
    await env.CERTIFICATES_BUCKET.put(key, pdfBuffer, {
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
  page: Page,
  serviceOrderId: number,
  quoteId: number | undefined,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!quoteId) return { success: false, error: "Missing quoteId" };
    const base = await withDbClient(env, (client) =>
      fetchServiceOrderDocumentData(client, serviceOrderId),
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
    const pdfBuffer = await generatePdfFromHtml(page, html);
    const year = getYearFromDateish(base.openedAt, "openedAt");
    const orgId = await withDbClient(env, async (client) => {
      const result = await client.query(
        `SELECT organization_id FROM service_order WHERE id = $1`,
        [serviceOrderId],
      );
      return result.rows[0]?.organization_id as string;
    });
    const key = buildServiceOrderR2Key({
      orgId,
      serviceOrderNumber: base.serviceOrderNumber,
      year,
      type: "QUOTE",
      quoteNumber: quote.row.quote_number,
      version: quote.row.version,
    });
    await env.CERTIFICATES_BUCKET.put(key, pdfBuffer, {
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
  page: Page,
  serviceOrderId: number,
  documentId: number | undefined,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const base = await withDbClient(env, (client) =>
      fetchServiceOrderDocumentData(client, serviceOrderId),
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
          inmetro_repair_seal_number, inmetro_repair_seal_issued_at
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
        inmetroRepairSealNumber: payload.order.inmetro_repair_seal_number,
        inmetroRepairSealIssuedAt: payload.order.inmetro_repair_seal_issued_at,
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
    const pdfBuffer = await generatePdfFromHtml(page, html);
    const year = getYearFromDateish(base.openedAt, "openedAt");
    const key = buildServiceOrderR2Key({
      orgId: payload.order.organization_id,
      serviceOrderNumber: base.serviceOrderNumber,
      year,
      type: "DELIVERY",
      version: payload.document.version,
    });
    await env.CERTIFICATES_BUCKET.put(key, pdfBuffer, {
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
 * Generates a small PDF for thermal printer labels
 */
async function generateLabelPdf(page: Page, html: string): Promise<Uint8Array> {
  const fullHtml = `<!DOCTYPE html>${html}`;

  await page.setContent(fullHtml, { waitUntil: "domcontentloaded" });

  return await page.pdf({
    width: "50mm",
    height: "30mm",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "0", bottom: "0", left: "0", right: "0" },
  });
}

/**
 * Process a label generation job
 */
async function processLabelJob(
  env: Env,
  page: Page,
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
    const pdfBuffer = await generateLabelPdf(page, html);
    console.log(
      `[LABEL ${jobId}] generatePdf: ${Math.round(performance.now() - pdfStart)}ms (${pdfBuffer.length} bytes)`,
    );

    // 5. Upload to R2
    const r2Start = performance.now();
    const orgId = data.organizationId;
    if (!orgId) {
      throw new Error("Missing organization_id for label generation");
    }
    const year = getYearFromDateish(
      data.approvedAt ?? data.label.calibrationDate,
      "approvedAt/performedAt",
    );
    const key = buildR2Key({
      orgId,
      jobId: data.label.jobId,
      year,
      type: "LABEL",
    });
    await env.CERTIFICATES_BUCKET.put(key, pdfBuffer, {
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
    connectionString: env.HYPERDRIVE.connectionString,
  });
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

/**
 * Configures a page for optimal PDF generation
 */
async function configurePage(page: Page): Promise<void> {
  // Block all external network requests for maximum speed
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    // Allow data: URLs (inline resources) and about:blank
    if (url.startsWith("data:") || url.startsWith("about:")) {
      req.continue();
    } else {
      req.abort();
    }
  });

  // Set viewport for A4 at 96dpi
  await page.setViewport({ width: 794, height: 1123 });

  // Emulate print media BEFORE loading content (avoids re-render)
  await page.emulateMediaType("print");
}

async function launchBrowser(env: Env): Promise<Browser> {
  const puppeteerCore = await import("puppeteer-core");

  if (env.CHROME_EXECUTABLE_PATH) {
    return puppeteerCore.default.launch({
      executablePath: env.CHROME_EXECUTABLE_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    }) as Promise<Browser>;
  }

  if (process.env.VERCEL) {
    if (!env.CHROMIUM_PACK_URL) {
      throw new Error("CHROMIUM_PACK_URL is required for Vercel PDF generation");
    }

    const chromium = await import("@sparticuz/chromium-min");
    const executablePath = await chromium.default.executablePath(
      env.CHROMIUM_PACK_URL,
    );

    return puppeteerCore.default.launch({
      executablePath,
      headless: "shell",
      args: [
        ...chromium.default.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    }) as Promise<Browser>;
  }

  throw new Error(
    "CHROME_EXECUTABLE_PATH is required for local PDF generation",
  );
}

/**
 * Generates a PDF from HTML content using an existing page
 */
async function generatePdfFromHtml(
  page: Page,
  html: string,
): Promise<Uint8Array> {
  const fullHtml = `<!DOCTYPE html>${html}`;
  const isFullPageCertificate = html.includes('data-pdf-layout="full-page"');

  // Load HTML - use domcontentloaded, NOT networkidle0!
  await page.setContent(fullHtml, { waitUntil: "domcontentloaded" });

  if (isFullPageCertificate) {
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
  }

  return await page.pdf({
    format: "A4",
    printBackground: true,
    preferCSSPageSize: false,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `
            <div style="width: 100%; font-size: 9px; text-align: center; color: #666;">
                Página <span class="pageNumber"></span> de <span class="totalPages"></span>
            </div>
        `,
    margin: { top: "10mm", bottom: "15mm", left: "10mm", right: "10mm" },
  });
}

/**
 * Process a single job with an existing browser/page
 */
async function processJob(
  env: Env,
  page: Page,
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

    // 2. Render HTML
    const renderStart = performance.now();
    const html = renderToString(React.createElement(CertificateHtml, { job }));
    console.log(
      `[JOB ${jobId}] renderToString: ${Math.round(performance.now() - renderStart)}ms`,
    );

    // 3. Generate PDF (reusing existing page)
    const pdfStart = performance.now();
    let pdfBuffer = await generatePdfFromHtml(page, html);
    console.log(
      `[JOB ${jobId}] generatePdf: ${Math.round(performance.now() - pdfStart)}ms (${pdfBuffer.length} bytes)`,
    );

    // 4. Sign PDF with ICP-Brasil certificate (if available)
    let signatureMetadata: SignatureMetadata | undefined;
    if (env.SIGNING_MASTER_KEY) {
      const signStart = performance.now();
      const organizationId = job.organizationId;
      const unitId = job.unitId;
      if (!organizationId) {
        console.warn(`[JOB ${jobId}] Missing organization_id for signing`);
      }
      if (!unitId) {
        console.warn(`[JOB ${jobId}] Missing unit_id for signing`);
      }
      const signingCert =
        organizationId && unitId
          ? await withDbClient(env, (client) =>
              fetchSigningCertificate(client, organizationId, unitId),
            )
          : null;

      if (signingCert) {
        try {
          // Decrypt password
          const password = decryptPassword(
            signingCert.encryptedPassword,
            signingCert.passwordIv,
            env.SIGNING_MASTER_KEY,
          );
          const p12Buffer = decryptBinary(
            signingCert.encryptedP12,
            env.SIGNING_MASTER_KEY,
          );

          // Sign the PDF
          const result = await signPdf(pdfBuffer, {
            p12Buffer,
            password,
            reason: "Certificado de Calibracao - CalibraFacil",
            location: "Brasil",
            enableLtv: false,
          });

          pdfBuffer = result.signedPdf;
          signatureMetadata = result.metadata;
          console.log(
            `[JOB ${jobId}] signPdf: ${Math.round(performance.now() - signStart)}ms (signed by ${signingCert.subjectCn})`,
          );
        } catch (signError) {
          console.error(
            `[JOB ${jobId}] PDF signing failed (continuing without signature):`,
            signError,
          );
          // Continue without signature - don't fail the job
        }
      } else {
        console.log(`[JOB ${jobId}] No signing certificate available`);
      }
    }

    // 5. Upload to R2
    const r2Start = performance.now();
    const orgId = job.organizationId;
    if (!orgId) {
      throw new Error("Missing organization_id for certificate generation");
    }
    const year = getYearFromDateish(
      job.approvedAt ?? job.performedAt,
      "approvedAt/performedAt",
    );
    const key = buildR2Key({
      orgId,
      jobId: job.jobId,
      year,
      type: "CERTIFICATE",
    });
    await env.CERTIFICATES_BUCKET.put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    console.log(
      `[JOB ${jobId}] R2 upload: ${Math.round(performance.now() - r2Start)}ms`,
    );

    // 6. Build public URL
    const certificateUrl = `https://certificates.calibrafacil.com/${key}`;

    // 7. Update DB with certificate URL and signature metadata
    const dbUpdateStart = performance.now();
    await withDbClient(env, (client) =>
      updateJobWithCertificate(
        client,
        jobId,
        certificateUrl,
        userId,
        signatureMetadata,
      ),
    );
    console.log(
      `[JOB ${jobId}] updateDB: ${Math.round(performance.now() - dbUpdateStart)}ms`,
    );

    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[JOB ${jobId}] DONE in ${totalMs}ms: ${certificateUrl}`);

    return { success: true, certificateUrl };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[JOB ${jobId}] Error:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

function isDocumentMessage(
  message: BackgroundJobMessage,
): message is DocumentBackgroundJobMessage {
  return (
    message.type !== "INTEGRATION_SYNC" &&
    message.type !== "SCHEDULED_NOTIFICATIONS"
  );
}

async function processDocumentMessage(
  env: Env,
  page: Page,
  body: DocumentBackgroundJobMessage,
) {
  if (
    body.type === "SERVICE_ORDER_INTAKE_DOCUMENT" ||
    body.type === "SERVICE_ORDER_TAG" ||
    body.type === "SERVICE_ORDER_QUOTE" ||
    body.type === "SERVICE_ORDER_DELIVERY_RECEIPT"
  ) {
    let result: { success: boolean; error?: string };
    if (body.type === "SERVICE_ORDER_INTAKE_DOCUMENT") {
      result = await processServiceOrderIntakeDocument(
        env,
        page,
        body.serviceOrderId,
        body.documentId,
        body.userId,
      );
    } else if (body.type === "SERVICE_ORDER_TAG") {
      result = await processServiceOrderTag(
        env,
        page,
        body.serviceOrderId,
        body.tagId,
        body.userId,
      );
    } else if (body.type === "SERVICE_ORDER_QUOTE") {
      result = await processServiceOrderQuote(
        env,
        page,
        body.serviceOrderId,
        body.quoteId,
      );
    } else {
      result = await processServiceOrderDeliveryReceipt(
        env,
        page,
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

  const calibrationBody = body as {
    type?: "CERTIFICATE" | "LABEL";
    jobId: number;
    userId: string;
  };
  const messageType = calibrationBody.type || "CERTIFICATE";
  const result =
    messageType === "LABEL"
      ? await processLabelJob(
          env,
          page,
          calibrationBody.jobId,
          calibrationBody.userId,
        )
      : await processJob(
          env,
          page,
          calibrationBody.jobId,
          calibrationBody.userId,
        );

  if (!result.success && messageType !== "LABEL") {
    await withDbClient(env, (client) =>
      setJobError(
        client,
        calibrationBody.jobId,
        result.error || "Unknown error",
        calibrationBody.userId,
      ),
    ).catch((dbError) => {
      console.error(
        `[JOB ${calibrationBody.jobId}] Failed to record error:`,
        dbError,
      );
    });
  }

  if (!result.success) {
    throw new Error(result.error ?? `${messageType} generation failed`);
  }
}

export async function processBackgroundJob(
  env: Env,
  message: BackgroundJobMessage,
) {
  if (message.type === "INTEGRATION_SYNC") {
    await processIntegrationSync(env, message as IntegrationSyncQueueMessage);
    return;
  }

  if (message.type === "SCHEDULED_NOTIFICATIONS") {
    await processScheduledNotifications(env);
    return;
  }

  const browserStart = performance.now();
  const browser = await launchBrowser(env);
  console.log(
    `[JOB] puppeteer.launch: ${Math.round(performance.now() - browserStart)}ms`,
  );

  try {
    const pageStart = performance.now();
    const page = await browser.newPage();
    await configurePage(page);
    console.log(
      `[JOB] browser.newPage + configure: ${Math.round(performance.now() - pageStart)}ms`,
    );
    await processDocumentMessage(env, page, message);
  } finally {
    await browser.close().catch((e) => {
      console.error("[JOB] browser.close failed:", e);
    });
  }
}

export async function processBackgroundJobBatch(
  env: Env,
  messages: BackgroundJobMessage[],
) {
  const integrationMessages = messages.filter(
    (message) => message.type === "INTEGRATION_SYNC",
  );
  const scheduledNotificationMessages = messages.filter(
    (message) => message.type === "SCHEDULED_NOTIFICATIONS",
  );
  const documentMessages = messages.filter(isDocumentMessage);

  for (const message of integrationMessages) {
    await processIntegrationSync(env, message as IntegrationSyncQueueMessage);
  }

  for (const _message of scheduledNotificationMessages) {
    await processScheduledNotifications(env);
  }

  if (documentMessages.length === 0) return;

  const browserStart = performance.now();
  const browser = await launchBrowser(env);
  console.log(
    `[BATCH] puppeteer.launch: ${Math.round(performance.now() - browserStart)}ms`,
  );

  try {
    const pageStart = performance.now();
    const page = await browser.newPage();
    await configurePage(page);
    console.log(
      `[BATCH] browser.newPage + configure: ${Math.round(performance.now() - pageStart)}ms`,
    );

    for (const message of documentMessages) {
      await processDocumentMessage(env, page, message);
    }
  } finally {
    await browser.close().catch((e) => {
      console.error("[BATCH] browser.close failed:", e);
    });
  }
}

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
        msg.retry();
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
          `${result.jobsProcessed} jobs`,
      );
    } catch (error) {
      console.error("[Scheduled] Error processing notifications:", error);
      throw error;
    }
  },
};
