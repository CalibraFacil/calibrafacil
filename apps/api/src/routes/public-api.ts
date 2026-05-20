import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  customer,
  service,
} from "@calibra-facil/db/schema";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import {
  createR2Client,
  extractKeyFromUrl,
  generatePresignedUrl,
  type R2Env,
} from "../lib/storage";
import {
  type ApiKeyAuthVariables,
  requireApiKeyAuth,
  requireApiScope,
} from "../middleware/api-key-auth";

const ListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  query: z.string().trim().optional(),
});

export const publicApiRouter = new Hono<{ Variables: ApiKeyAuthVariables }>()
  .use("*", requireApiKeyAuth)
  .get(
    "/customers",
    requireApiScope("customers:read"),
    zValidator("query", ListQuerySchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const { page, limit, query } = c.req.valid("query");
      const offset = (page - 1) * limit;

      const filters = [eq(customer.labOrganizationId, apiKey.organizationId)];

      if (query) {
        filters.push(ilike(customer.name, `%${query}%`));
      }

      const data = await db
        .select({
          id: customer.id,
          name: customer.name,
          taxId: customer.taxId,
          email: customer.email,
          phone: customer.phone,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
        })
        .from(customer)
        .where(and(...filters))
        .orderBy(customer.name)
        .limit(limit)
        .offset(offset);

      return c.json({ data, page, limit });
    },
  )
  .get(
    "/assets",
    requireApiScope("assets:read"),
    zValidator("query", ListQuerySchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const { page, limit, query } = c.req.valid("query");
      const offset = (page - 1) * limit;

      const data = await db
        .select({
          id: asset.id,
          customerId: asset.customerId,
          customerName: customer.name,
          name: asset.name,
          tag: asset.tag,
          serialNumber: asset.serialNumber,
          manufacturer: asset.manufacturer,
          model: asset.model,
          status: asset.status,
          nextCalibrationDate: asset.nextCalibrationDate,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .where(
          and(
            eq(customer.labOrganizationId, apiKey.organizationId),
            query
              ? or(
                  ilike(asset.name, `%${query}%`),
                  ilike(asset.tag, `%${query}%`),
                  ilike(asset.serialNumber, `%${query}%`),
                )
              : undefined,
          ),
        )
        .orderBy(asset.name)
        .limit(limit)
        .offset(offset);

      return c.json({ data, page, limit });
    },
  )
  .get(
    "/jobs",
    requireApiScope("jobs:read"),
    zValidator("query", ListQuerySchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const { page, limit, query } = c.req.valid("query");
      const offset = (page - 1) * limit;

      const filters = [
        eq(calibrationJob.organizationId, apiKey.organizationId),
      ];

      if (query) {
        filters.push(ilike(calibrationJob.jobId, `%${query}%`));
      }

      const data = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          status: calibrationJob.status,
          customerName: customer.name,
          assetName: asset.name,
          serviceName: service.name,
          performedAt: calibrationJob.performedAt,
          approvedAt: calibrationJob.approvedAt,
          createdAt: calibrationJob.createdAt,
        })
        .from(calibrationJob)
        .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
        .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
        .innerJoin(service, eq(calibrationJob.serviceId, service.id))
        .where(and(...filters))
        .orderBy(desc(calibrationJob.createdAt))
        .limit(limit)
        .offset(offset);

      return c.json({ data, page, limit });
    },
  )
  .get("/jobs/:jobId", requireApiScope("jobs:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const jobId = c.req.param("jobId");

    const data = await db
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        status: calibrationJob.status,
        customerName: customer.name,
        assetName: asset.name,
        assetTag: asset.tag,
        serviceName: service.name,
        performedAt: calibrationJob.performedAt,
        approvedAt: calibrationJob.approvedAt,
        createdAt: calibrationJob.createdAt,
        updatedAt: calibrationJob.updatedAt,
        results: calibrationJob.results,
      })
      .from(calibrationJob)
      .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
      .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
      .innerJoin(service, eq(calibrationJob.serviceId, service.id))
      .where(
        and(
          eq(calibrationJob.organizationId, apiKey.organizationId),
          eq(calibrationJob.jobId, jobId),
        ),
      )
      .limit(1);

    if (!data[0]) {
      return c.json({ error: "Ordem de serviço não encontrada" }, 404);
    }

    return c.json({ data: data[0] });
  })
  .get(
    "/certificates",
    requireApiScope("certificates:read"),
    zValidator("query", ListQuerySchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const { page, limit, query } = c.req.valid("query");
      const offset = (page - 1) * limit;

      const filters = [
        eq(calibrationJob.organizationId, apiKey.organizationId),
        inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
      ];

      if (query) {
        filters.push(ilike(calibrationJob.jobId, `%${query}%`));
      }

      const data = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          status: calibrationJob.status,
          approvedAt: calibrationJob.approvedAt,
          verificationToken: calibrationJob.verificationToken,
          assetName: asset.name,
          customerName: customer.name,
        })
        .from(calibrationJob)
        .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
        .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
        .where(and(...filters))
        .orderBy(desc(calibrationJob.approvedAt))
        .limit(limit)
        .offset(offset);

      return c.json({ data, page, limit });
    },
  )
  .get(
    "/certificates/:jobId/download",
    requireApiScope("certificates:read"),
    async (c) => {
      const apiKey = c.get("apiKey");
      const jobId = c.req.param("jobId");

      const [job] = await db
        .select({
          certificateUrl: calibrationJob.certificateUrl,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.organizationId, apiKey.organizationId),
            eq(calibrationJob.jobId, jobId),
            inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Certificado não encontrado" }, 404);
      }

      if (!job.certificateUrl) {
        return c.json({ error: "Documento ainda não disponível" }, 400);
      }

      const env = c.env as R2Env;
      const client = createR2Client(env);
      const key = extractKeyFromUrl(job.certificateUrl);
      const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

      return c.json({ url });
    },
  );
