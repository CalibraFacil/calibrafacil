import { Client } from "pg";
import { appendJobEvent } from "@calibra-facil/db/job-events";
import { renderToString } from "react-dom/server";
import { LabelHtml, type LabelData } from "@calibra-facil/documents";
import React from "react";
import QRCode from "qrcode";
import { getYear, jobLabelKey } from "@calibra-facil/shared/storage-keys";
import {
  certificateVerificationUrl,
  storedObjectUrl,
} from "@calibra-facil/shared/public-urls";
import {
  jobEventTransaction,
  jobOrganizationOf,
  workerJobActor,
} from "./job-events.js";
import { type Env } from "./runtime-types.js";
import { gotenbergHtmlToPdf, withDbClient } from "./pdf-render.js";
import { bucketBinding, fetchOrgRefById } from "./storage-helpers.js";

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

  const updated = await client.query<{ organization_id: string }>(
    `
    UPDATE calibration_job
    SET label_url = $2, updated_at = $3
    WHERE id = $1
    RETURNING organization_id
    `,
    [jobId, labelUrl, now],
  );

  await appendJobEvent(jobEventTransaction(client), {
    action: "label_generated",
    organizationId: jobOrganizationOf(updated.rows, jobId),
    jobId,
    actor: workerJobActor(userId),
    performedAt: now,
    changes: { labelUrl: { old: null, new: labelUrl } },
  });
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
export async function processLabelJob(
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
    const verificationUrl = certificateVerificationUrl(data.verificationToken);
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
    const labelUrl = storedObjectUrl(key);

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
