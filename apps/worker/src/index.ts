import puppeteer from "@cloudflare/puppeteer";
import { Client } from "pg";
import { renderToString } from "react-dom/server";
import { CertificateHtml, type JobData } from "@calibra-facil/documents";
import React from "react";

interface Env {
    BROWSER: Fetcher;
    CERTIFICATES_BUCKET: R2Bucket;
    HYPERDRIVE: Hyperdrive;
}

interface QueueMessage {
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
    jobId: number
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
      -- Organization (Lab) info
      o.name as lab_name,
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
      u.name as approver_name
    FROM calibration_job cj
    LEFT JOIN organization o ON cj.organization_id = o.id
    LEFT JOIN customer c ON cj.customer_id = c.id
    LEFT JOIN asset a ON cj.asset_id = a.id
    LEFT JOIN "user" u ON cj.approved_by = u.id
    WHERE cj.id = $1
    `,
        [jobId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];

    return {
        jobId: row.job_id,
        performedAt: row.performed_at,
        approvedAt: row.approved_at,
        lab: {
            name: row.lab_name || "Laboratório de Calibração",
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
    };
}


async function updateJobWithCertificate(
    client: Client,
    jobId: number,
    certificateUrl: string,
    userId: string
): Promise<void> {
    const now = new Date();

    // Only update status and certificate_url - approved_by/approved_at are already set by API
    await client.query(
        `
    UPDATE calibration_job
    SET 
      status = 'APPROVED',
      certificate_url = $2,
      updated_at = $3
    WHERE id = $1
    `,
        [jobId, certificateUrl, now]
    );

    await client.query(
        `
    INSERT INTO job_audit_log (job_id, action, changes, performed_by, performed_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
        [
            jobId,
            "certificate_generated",
            JSON.stringify({
                status: { old: "GENERATING_PDF", new: "APPROVED" },
                certificateUrl: { old: null, new: certificateUrl },
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

export default {
    async queue(
        batch: MessageBatch<QueueMessage>,
        env: Env,
        _ctx: ExecutionContext
    ): Promise<void> {
        for (const msg of batch.messages) {
            const { jobId, userId } = msg.body;
            const totalStart = performance.now();
            console.log(`[START] Processing certificate for job ${jobId}`);

            try {
                // 1. Fetch job data (fresh connection)
                const dbFetchStart = performance.now();
                const job = await withDbClient(env, (client) => fetchJobData(client, jobId));
                console.log(`[TIMING] fetchJobData: ${Math.round(performance.now() - dbFetchStart)}ms`);

                if (!job) {
                    console.error(`Job ${jobId} not found`);
                    msg.ack();
                    continue;
                }

                // 2. Render HTML
                const renderStart = performance.now();
                const html = renderToString(React.createElement(CertificateHtml, { job }));
                const fullHtml = `<!DOCTYPE html>${html}`;
                console.log(`[TIMING] renderToString: ${Math.round(performance.now() - renderStart)}ms (${fullHtml.length} bytes)`);

                // 3. Generate PDF with Puppeteer (slow operation - no DB connection held)
                const browserStart = performance.now();
                const browser = await puppeteer.launch(env.BROWSER);
                console.log(`[TIMING] puppeteer.launch: ${Math.round(performance.now() - browserStart)}ms`);

                const pageStart = performance.now();
                const page = await browser.newPage();
                console.log(`[TIMING] browser.newPage: ${Math.round(performance.now() - pageStart)}ms`);

                // Block all external network requests for maximum speed
                await page.setRequestInterception(true);
                page.on('request', (req) => {
                    const url = req.url();
                    // Allow data: URLs (inline resources) and about:blank
                    if (url.startsWith('data:') || url.startsWith('about:')) {
                        req.continue();
                    } else {
                        // Log and block anything else
                        console.log(`[BLOCKED] ${req.resourceType()}: ${url}`);
                        req.abort();
                    }
                });

                // Set viewport for A4 at 96dpi
                await page.setViewport({ width: 794, height: 1123 });

                // Emulate print media BEFORE loading content (avoids re-render)
                await page.emulateMediaType('print');

                // Load HTML - use domcontentloaded, NOT networkidle0!
                // networkidle0 was causing 15+ minute waits
                const contentStart = performance.now();
                await page.setContent(fullHtml, { waitUntil: "domcontentloaded" });
                console.log(`[TIMING] page.setContent: ${Math.round(performance.now() - contentStart)}ms`);

                const pdfStart = performance.now();
                const pdfBuffer = await page.pdf({
                    format: "A4",
                    printBackground: true,
                    preferCSSPageSize: false,
                    margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
                });
                console.log(`[TIMING] page.pdf: ${Math.round(performance.now() - pdfStart)}ms (${pdfBuffer.length} bytes)`);

                await browser.close();

                // 4. Upload to R2
                const r2Start = performance.now();
                const filename = `cert-${job.jobId}.pdf`;
                await env.CERTIFICATES_BUCKET.put(filename, pdfBuffer, {
                    httpMetadata: { contentType: "application/pdf" },
                });
                console.log(`[TIMING] R2 upload: ${Math.round(performance.now() - r2Start)}ms`);

                // 5. Build public URL (adjust domain as needed)
                const certificateUrl = `https://certificates.calibrafacil.com/${filename}`;

                // 6. Update DB (fresh connection after slow operations)
                const dbUpdateStart = performance.now();
                await withDbClient(env, (client) =>
                    updateJobWithCertificate(client, jobId, certificateUrl, userId)
                );
                console.log(`[TIMING] updateDB: ${Math.round(performance.now() - dbUpdateStart)}ms`);

                const totalMs = Math.round(performance.now() - totalStart);
                console.log(`[DONE] Certificate generated for job ${jobId} in ${totalMs}ms: ${certificateUrl}`);
                msg.ack();
            } catch (error) {
                console.error(`Error processing job ${jobId}:`, error);
                // Record error with fresh connection
                await withDbClient(env, (client) =>
                    setJobError(
                        client,
                        jobId,
                        error instanceof Error ? error.message : String(error),
                        userId
                    )
                ).catch((dbError) => {
                    console.error(`Failed to record error for job ${jobId}:`, dbError);
                });
                msg.ack(); // Ack to not retry indefinitely
            }
        }
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
};
