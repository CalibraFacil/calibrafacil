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
      c.name as customer_name,
      c.address as customer_address,
      a.name as asset_name,
      a.serial_number,
      a.tag,
      a.model,
      a.manufacturer,
      u.name as approver_name
    FROM calibration_job cj
    LEFT JOIN customer c ON cj.customer_id = c.id
    LEFT JOIN asset a ON cj.asset_id = a.id
    LEFT JOIN "user" u ON cj.approved_by = u.id
    WHERE cj.id = $1
    `,
        [jobId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const data = row.data as Record<string, unknown> | null;

    return {
        jobId: row.job_id,
        performedAt: row.performed_at,
        approvedAt: row.approved_at,
        customer: {
            name: row.customer_name,
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
        results: row.results,
        environment: data
            ? {
                temperature: data.temperature as number | undefined,
                humidity: data.humidity as number | undefined,
            }
            : undefined,
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

    await client.query(
        `
    UPDATE calibration_job
    SET 
      status = 'APPROVED',
      certificate_url = $2,
      approved_at = $3,
      approved_by = $4,
      updated_at = $3
    WHERE id = $1
    `,
        [jobId, certificateUrl, now, userId]
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

export default {
    async queue(
        batch: MessageBatch<QueueMessage>,
        env: Env,
        ctx: ExecutionContext
    ): Promise<void> {
        const client = new Client({
            connectionString: env.HYPERDRIVE.connectionString,
        });
        await client.connect();

        try {
            for (const msg of batch.messages) {
                const { jobId, userId } = msg.body;
                console.log(`Processing certificate for job ${jobId}`);

                try {
                    // 1. Fetch job data
                    const job = await fetchJobData(client, jobId);
                    if (!job) {
                        console.error(`Job ${jobId} not found`);
                        msg.ack();
                        continue;
                    }

                    // 2. Render HTML
                    const html = renderToString(React.createElement(CertificateHtml, { job }));
                    const fullHtml = `<!DOCTYPE html>${html}`;

                    // 3. Generate PDF with Puppeteer
                    const browser = await puppeteer.launch(env.BROWSER);
                    const page = await browser.newPage();
                    await page.setContent(fullHtml, { waitUntil: "networkidle0" });
                    const pdfBuffer = await page.pdf({
                        format: "A4",
                        printBackground: true,
                        margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
                    });
                    await browser.close();

                    // 4. Upload to R2
                    const filename = `cert-${job.jobId}.pdf`;
                    await env.CERTIFICATES_BUCKET.put(filename, pdfBuffer, {
                        httpMetadata: { contentType: "application/pdf" },
                    });

                    // 5. Build public URL (adjust domain as needed)
                    const certificateUrl = `https://certificates.calibra.com/${filename}`;

                    // 6. Update DB
                    await updateJobWithCertificate(client, jobId, certificateUrl, userId);

                    console.log(`Certificate generated for job ${jobId}: ${certificateUrl}`);
                    msg.ack();
                } catch (error) {
                    console.error(`Error processing job ${jobId}:`, error);
                    await setJobError(
                        client,
                        jobId,
                        error instanceof Error ? error.message : String(error),
                        userId
                    );
                    msg.ack(); // Ack to not retry indefinitely
                }
            }
        } finally {
            ctx.waitUntil(client.end());
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
