import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  customer,
  asset,
  service,
  organization,
} from "@calibra-facil/db/schema";
import { and, eq, inArray } from "drizzle-orm";
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
        certificateName: calibrationJob.certificateName,
        status: calibrationJob.status,
        certificateUrl: calibrationJob.certificateUrl,
        performedAt: calibrationJob.performedAt,
        approvedAt: calibrationJob.approvedAt,
        // Digital signature metadata - ISO 17025 Clause 7.8.2.1(q)
        signatureMetadata: calibrationJob.signatureMetadata,
        // Amendment fields - ISO 17025 Clause 7.8.4.1
        supersedesId: calibrationJob.supersedesId,
        supersededById: calibrationJob.supersededById,
        amendmentNumber: calibrationJob.amendmentNumber,
        amendmentReason: calibrationJob.amendmentReason,
        supersededAt: calibrationJob.supersededAt,
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
      .innerJoin(
        organization,
        eq(calibrationJob.organizationId, organization.id),
      )
      .where(
        and(
          eq(calibrationJob.verificationToken, token),
          inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
        ),
      )
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

    // If superseded, get the replacement job info
    let supersededByInfo = null;
    if (job.supersededById) {
      const [replacement] = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          verificationToken: calibrationJob.verificationToken,
        })
        .from(calibrationJob)
        .where(eq(calibrationJob.id, job.supersededById))
        .limit(1);

      if (replacement) {
        supersededByInfo = {
          id: replacement.id,
          jobId: replacement.jobId,
          verificationToken: replacement.verificationToken,
        };
      }
    }

    // If this is an amendment, get the original job info
    let supersedesInfo = null;
    if (job.supersedesId) {
      const [original] = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          verificationToken: calibrationJob.verificationToken,
        })
        .from(calibrationJob)
        .where(eq(calibrationJob.id, job.supersedesId))
        .limit(1);

      if (original) {
        supersedesInfo = {
          id: original.id,
          jobId: original.jobId,
          verificationToken: original.verificationToken,
        };
      }
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
      // Digital signature - ISO 17025 Clause 7.8.2.1(q)
      digitalSignature: job.signatureMetadata
        ? {
            signed: true,
            signedAt: job.signatureMetadata.signedAt,
            signerName: job.signatureMetadata.signerName,
            signerCpfCnpj: job.signatureMetadata.signerCpfCnpj,
            certificateSerial: job.signatureMetadata.signerCertificateSerial,
            pdfHash: job.signatureMetadata.pdfHash,
            ltvEnabled: job.signatureMetadata.ltvEnabled,
          }
        : { signed: false },
      // Amendment information - ISO 17025 Clause 7.8.4.1
      isSuperseded: !!job.supersededById,
      isAmendment: !!job.supersedesId,
      amendmentNumber: job.amendmentNumber,
      amendmentReason: job.amendmentReason,
      supersededAt: job.supersededAt,
      supersededBy: supersededByInfo,
      supersedes: supersedesInfo,
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
      .where(
        and(
          eq(calibrationJob.verificationToken, token),
          inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
        ),
      )
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
