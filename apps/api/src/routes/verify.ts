import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  customer,
  asset,
  service,
  organization,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import {
  createR2Client,
  generatePresignedUrl,
  extractKeyFromUrl,
  type R2Env,
} from "../lib/storage";

/**
 * Public Verification Router - NO AUTH REQUIRED
 *
 * Allows auditors and clients to verify certificate authenticity
 * using an unguessable UUID token.
 *
 * URL: https://verify.calibrafacil.com/v/{verificationToken}
 */
export const verifyRouter = new Hono()
  // =========================================================================
  // GET /:token - Get certificate verification info
  // =========================================================================
  .get("/:token", async (c) => {
    const token = c.req.param("token");

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(token)) {
      return c.json({ error: "Token invalido" }, 400);
    }

    const [job] = await db
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        status: calibrationJob.status,
        certificateUrl: calibrationJob.certificateUrl,
        performedAt: calibrationJob.performedAt,
        approvedAt: calibrationJob.approvedAt,
        customerName: customer.name,
        assetName: asset.name,
        assetTag: asset.tag,
        serviceName: service.name,
        labName: organization.name,
      })
      .from(calibrationJob)
      .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
      .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
      .innerJoin(service, eq(calibrationJob.serviceId, service.id))
      .innerJoin(organization, eq(calibrationJob.organizationId, organization.id))
      .where(eq(calibrationJob.verificationToken, token))
      .limit(1);

    if (!job) {
      return c.json(
        {
          valid: false,
          error: "Certificado nao encontrado",
        },
        404,
      );
    }

    return c.json({
      valid: true,
      jobId: job.jobId,
      status: job.status,
      hasDocument: !!job.certificateUrl,
      lab: job.labName,
      customer: job.customerName,
      asset: {
        name: job.assetName,
        tag: job.assetTag,
      },
      service: job.serviceName,
      performedAt: job.performedAt,
      approvedAt: job.approvedAt,
    });
  })

  // =========================================================================
  // GET /:token/download - Download certificate (public)
  // =========================================================================
  .get("/:token/download", async (c) => {
    const token = c.req.param("token");

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(token)) {
      return c.json({ error: "Token invalido" }, 400);
    }

    const [job] = await db
      .select({ certificateUrl: calibrationJob.certificateUrl })
      .from(calibrationJob)
      .where(eq(calibrationJob.verificationToken, token))
      .limit(1);

    if (!job) {
      return c.json({ error: "Certificado nao encontrado" }, 404);
    }

    if (!job.certificateUrl) {
      return c.json({ error: "Documento ainda nao disponivel" }, 400);
    }

    const env = c.env as R2Env;
    const key = extractKeyFromUrl(job.certificateUrl);
    const client = createR2Client(env);
    const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

    return c.json({ url });
  });
