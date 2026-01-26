import puppeteer, { type Browser, type Page } from "@cloudflare/puppeteer";
import { Client } from "pg";
import { renderToString } from "react-dom/server";
import { CertificateHtml, type JobData, LabelHtml, type LabelData } from "@calibra-facil/documents";
import React from "react";
import QRCode from "qrcode";
import { processScheduledNotifications } from "./scheduled.js";
import { signPdf, decryptPassword, type SignatureMetadata } from "@calibra-facil/signing";

interface Env {
    BROWSER: Fetcher;
    CERTIFICATES_BUCKET: R2Bucket;
    HYPERDRIVE: Hyperdrive;
    SIGNING_MASTER_KEY?: string; // Optional - if not set, PDFs won't be signed
}

// Discriminated union for queue messages - supports both certificate and label generation
// type field is optional for backwards compatibility (defaults to CERTIFICATE)
interface QueueMessage {
    type?: "CERTIFICATE" | "LABEL";
    jobId: number;
    userId: string;
}

interface MessageBatch<T> {
    messages: {
        body: T;
        ack: () => void;
        retry: () => void;
    }[];
}

async function fetchJobData(
    client: Client,
    jobId: number,
    env: Env
): Promise<JobData | null> {
    const result = await client.query(
        `
    SELECT
      cj.job_id,
      cj.performed_at,
      cj.approved_at,
      cj.method_snapshot,
      cj.standards_snapshot,
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
      original.approved_at as original_approved_at
    FROM calibration_job cj
    LEFT JOIN organization o ON cj.organization_id = o.id
    LEFT JOIN customer c ON cj.customer_id = c.id
    LEFT JOIN asset a ON cj.asset_id = a.id
    LEFT JOIN "user" u ON cj.approved_by = u.id
    LEFT JOIN calibration_job original ON cj.supersedes_id = original.id
    WHERE cj.id = $1
    `,
        [jobId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];

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
            [row.approved_by, row.organization_id]
        );

        if (sigResult.rows.length > 0) {
            const sigRow = sigResult.rows[0];
            // Fetch signature from R2 and convert to base64 data URL
            try {
                const signatureObject = await env.CERTIFICATES_BUCKET.get(sigRow.r2_key);
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
        standardsSnapshot: row.standards_snapshot,
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
        binary += String.fromCharCode(bytes[i]);
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
    organizationId: string
): Promise<SigningCertificateData | null> {
    const result = await client.query(
        `
        SELECT encrypted_p12, encrypted_password, password_iv, subject_cn
        FROM organization_signing_certificate
        WHERE organization_id = $1
          AND is_active = true
          AND is_default = true
          AND valid_until > NOW()
        LIMIT 1
        `,
        [organizationId]
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
    signatureMetadata?: SignatureMetadata
): Promise<void> {
    const now = new Date();

    // Check if job is SUPERSEDED (being regenerated with watermark)
    const statusResult = await client.query(
        `SELECT status FROM calibration_job WHERE id = $1`,
        [jobId]
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
        [jobId, certificateUrl, signatureMetadata ? JSON.stringify(signatureMetadata) : null, now]
    );

    // Log appropriate action based on whether this is a watermark regeneration
    const action = isSuperseded ? "certificate_watermarked" : "certificate_generated";
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
                signatureMetadata: signatureMetadata ? { signed: true, signerName: signatureMetadata.signerName } : { signed: false },
            }),
            userId,
            now,
        ]
    );
}

async function setJobError(
    client: Client,
    jobId: number,
    error: string,
    userId: string
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
        [jobId, `Erro ao gerar certificado: ${error}`, userId, now]
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
        ]
    );
}

// =============================================================================
// LABEL GENERATION FUNCTIONS
// =============================================================================

async function fetchLabelData(
    client: Client,
    jobId: number
): Promise<{ label: LabelData; verificationToken: string } | null> {
    const result = await client.query(
        `
    SELECT
      cj.job_id,
      cj.performed_at,
      cj.verification_token,
      o.name as lab_name,
      a.tag as asset_tag
    FROM calibration_job cj
    LEFT JOIN organization o ON cj.organization_id = o.id
    LEFT JOIN asset a ON cj.asset_id = a.id
    WHERE cj.id = $1
    `,
        [jobId]
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
    };
}

async function updateJobWithLabel(
    client: Client,
    jobId: number,
    labelUrl: string,
    userId: string
): Promise<void> {
    const now = new Date();

    await client.query(
        `
    UPDATE calibration_job
    SET label_url = $2, updated_at = $3
    WHERE id = $1
    `,
        [jobId, labelUrl, now]
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
        ]
    );
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
    userId: string
): Promise<{ success: boolean; labelUrl?: string; error?: string }> {
    const totalStart = performance.now();
    console.log(`[LABEL ${jobId}] Starting`);

    try {
        // 1. Fetch label data
        const dbFetchStart = performance.now();
        const data = await withDbClient(env, (client) => fetchLabelData(client, jobId));
        console.log(`[LABEL ${jobId}] fetchLabelData: ${Math.round(performance.now() - dbFetchStart)}ms`);

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
        console.log(`[LABEL ${jobId}] QR generation: ${Math.round(performance.now() - qrStart)}ms`);

        // 3. Render HTML
        const renderStart = performance.now();
        const labelData: LabelData = {
            ...data.label,
            qrCodeDataUrl,
        };
        const html = renderToString(React.createElement(LabelHtml, { label: labelData }));
        console.log(`[LABEL ${jobId}] renderToString: ${Math.round(performance.now() - renderStart)}ms`);

        // 4. Generate PDF
        const pdfStart = performance.now();
        const pdfBuffer = await generateLabelPdf(page, html);
        console.log(`[LABEL ${jobId}] generatePdf: ${Math.round(performance.now() - pdfStart)}ms (${pdfBuffer.length} bytes)`);

        // 5. Upload to R2
        const r2Start = performance.now();
        const filename = `label-${data.label.jobId}.pdf`;
        await env.CERTIFICATES_BUCKET.put(filename, pdfBuffer, {
            httpMetadata: { contentType: "application/pdf" },
        });
        console.log(`[LABEL ${jobId}] R2 upload: ${Math.round(performance.now() - r2Start)}ms`);

        // 6. Build public URL
        const labelUrl = `https://certificates.calibrafacil.com/${filename}`;

        // 7. Update DB
        const dbUpdateStart = performance.now();
        await withDbClient(env, (client) =>
            updateJobWithLabel(client, jobId, labelUrl, userId)
        );
        console.log(`[LABEL ${jobId}] updateDB: ${Math.round(performance.now() - dbUpdateStart)}ms`);

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
    operation: (client: Client) => Promise<T>
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
    page.on('request', (req) => {
        const url = req.url();
        // Allow data: URLs (inline resources) and about:blank
        if (url.startsWith('data:') || url.startsWith('about:')) {
            req.continue();
        } else {
            req.abort();
        }
    });

    // Set viewport for A4 at 96dpi
    await page.setViewport({ width: 794, height: 1123 });

    // Emulate print media BEFORE loading content (avoids re-render)
    await page.emulateMediaType('print');
}

/**
 * Generates a PDF from HTML content using an existing page
 */
async function generatePdfFromHtml(page: Page, html: string): Promise<Uint8Array> {
    const fullHtml = `<!DOCTYPE html>${html}`;

    // Load HTML - use domcontentloaded, NOT networkidle0!
    await page.setContent(fullHtml, { waitUntil: "domcontentloaded" });

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
    userId: string
): Promise<{ success: boolean; certificateUrl?: string; error?: string }> {
    const totalStart = performance.now();
    console.log(`[JOB ${jobId}] Starting`);

    try {
        // 1. Fetch job data
        const dbFetchStart = performance.now();
        const job = await withDbClient(env, (client) => fetchJobData(client, jobId, env));
        console.log(`[JOB ${jobId}] fetchJobData: ${Math.round(performance.now() - dbFetchStart)}ms`);

        if (!job) {
            return { success: false, error: "Job not found" };
        }

        // 2. Render HTML
        const renderStart = performance.now();
        const html = renderToString(React.createElement(CertificateHtml, { job }));
        console.log(`[JOB ${jobId}] renderToString: ${Math.round(performance.now() - renderStart)}ms`);

        // 3. Generate PDF (reusing existing page)
        const pdfStart = performance.now();
        let pdfBuffer = await generatePdfFromHtml(page, html);
        console.log(`[JOB ${jobId}] generatePdf: ${Math.round(performance.now() - pdfStart)}ms (${pdfBuffer.length} bytes)`);

        // 4. Sign PDF with ICP-Brasil certificate (if available)
        let signatureMetadata: SignatureMetadata | undefined;
        if (env.SIGNING_MASTER_KEY) {
            const signStart = performance.now();
            const signingCert = await withDbClient(env, async (client) => {
                // First get the organization_id from the job
                const orgResult = await client.query(
                    `SELECT organization_id FROM calibration_job WHERE id = $1`,
                    [jobId]
                );
                if (orgResult.rows.length === 0) return null;
                const organizationId = orgResult.rows[0].organization_id;

                // Then fetch the signing certificate
                return fetchSigningCertificate(client, organizationId);
            });

            if (signingCert) {
                try {
                    // Decrypt password
                    const password = decryptPassword(
                        signingCert.encryptedPassword,
                        signingCert.passwordIv,
                        env.SIGNING_MASTER_KEY
                    );

                    // Sign the PDF
                    const result = await signPdf(pdfBuffer, {
                        p12Buffer: Buffer.from(signingCert.encryptedP12, 'base64'),
                        password,
                        reason: 'Certificado de Calibracao - CalibraFacil',
                        location: 'Brasil',
                        enableLtv: false,
                    });

                    pdfBuffer = result.signedPdf;
                    signatureMetadata = result.metadata;
                    console.log(`[JOB ${jobId}] signPdf: ${Math.round(performance.now() - signStart)}ms (signed by ${signingCert.subjectCn})`);
                } catch (signError) {
                    console.error(`[JOB ${jobId}] PDF signing failed (continuing without signature):`, signError);
                    // Continue without signature - don't fail the job
                }
            } else {
                console.log(`[JOB ${jobId}] No signing certificate available`);
            }
        }

        // 5. Upload to R2
        const r2Start = performance.now();
        const filename = `cert-${job.jobId}.pdf`;
        await env.CERTIFICATES_BUCKET.put(filename, pdfBuffer, {
            httpMetadata: { contentType: "application/pdf" },
        });
        console.log(`[JOB ${jobId}] R2 upload: ${Math.round(performance.now() - r2Start)}ms`);

        // 6. Build public URL
        const certificateUrl = `https://certificates.calibrafacil.com/${filename}`;

        // 7. Update DB with certificate URL and signature metadata
        const dbUpdateStart = performance.now();
        await withDbClient(env, (client) =>
            updateJobWithCertificate(client, jobId, certificateUrl, userId, signatureMetadata)
        );
        console.log(`[JOB ${jobId}] updateDB: ${Math.round(performance.now() - dbUpdateStart)}ms`);

        const totalMs = Math.round(performance.now() - totalStart);
        console.log(`[JOB ${jobId}] DONE in ${totalMs}ms: ${certificateUrl}`);

        return { success: true, certificateUrl };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[JOB ${jobId}] Error:`, errorMsg);
        return { success: false, error: errorMsg };
    }
}

export default {
    async queue(
        batch: MessageBatch<QueueMessage>,
        env: Env,
        _ctx: ExecutionContext
    ): Promise<void> {
        const batchSize = batch.messages.length;
        console.log(`[BATCH] Processing ${batchSize} job(s)`);
        const batchStart = performance.now();

        // Launch browser ONCE for the entire batch
        const browserStart = performance.now();
        const browser = await puppeteer.launch(env.BROWSER);
        console.log(`[BATCH] puppeteer.launch: ${Math.round(performance.now() - browserStart)}ms`);

        // Create page ONCE and reuse
        const pageStart = performance.now();
        const page = await browser.newPage();
        await configurePage(page);
        console.log(`[BATCH] browser.newPage + configure: ${Math.round(performance.now() - pageStart)}ms`);

        try {
            // Process each job with the shared browser/page
            for (const msg of batch.messages) {
                const { jobId, userId, type } = msg.body;

                // Default to CERTIFICATE for backwards compatibility
                const messageType = type || "CERTIFICATE";

                let result: { success: boolean; error?: string };

                if (messageType === "LABEL") {
                    result = await processLabelJob(env, page, jobId, userId);
                    // Label failures don't change job status - just log the error
                    if (!result.success) {
                        console.error(`[LABEL ${jobId}] Failed:`, result.error);
                    }
                } else {
                    result = await processJob(env, page, jobId, userId);
                    // Certificate failures set job to REJECTED
                    if (!result.success) {
                        await withDbClient(env, (client) =>
                            setJobError(client, jobId, result.error || "Unknown error", userId)
                        ).catch((dbError) => {
                            console.error(`[JOB ${jobId}] Failed to record error:`, dbError);
                        });
                    }
                }

                msg.ack();
            }
        } finally {
            // Always close browser at the end
            await browser.close().catch((e) => {
                console.error("[BATCH] browser.close failed:", e);
            });
        }

        const batchMs = Math.round(performance.now() - batchStart);
        console.log(`[BATCH] Completed ${batchSize} job(s) in ${batchMs}ms (avg: ${Math.round(batchMs / batchSize)}ms/job)`);
    },

    // Health check endpoint
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
            return new Response(JSON.stringify({ status: "ok", worker: "calibra-facil-worker" }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({
            name: "Calibra Fácil - Certificate Worker",
            description: "Queue consumer for PDF certificate generation",
            endpoints: {
                "/health": "Health check",
            },
            note: "This worker processes queue messages. Queue testing requires deployment.",
        }), {
            headers: { "Content-Type": "application/json" },
        });
    },

    // Scheduled handler for compliance notifications (runs daily at 08:00 UTC)
    async scheduled(
        _event: ScheduledEvent,
        env: Env,
        ctx: ExecutionContext
    ): Promise<void> {
        console.log("[Scheduled] Starting daily compliance notification check");
        const start = performance.now();

        try {
            const result = await processScheduledNotifications(env);
            const duration = Math.round(performance.now() - start);

            console.log(
                `[Scheduled] Completed in ${duration}ms: ` +
                `${result.assetsProcessed} assets, ` +
                `${result.standardsProcessed} standards, ` +
                `${result.jobsProcessed} jobs`
            );
        } catch (error) {
            console.error("[Scheduled] Error processing notifications:", error);
            throw error;
        }
    },
};
