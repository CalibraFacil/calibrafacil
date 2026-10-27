import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asset, calibrationJob, customer } from "@calibra-facil/db/schema";
import { and, count, desc, eq, ilike, inArray } from "drizzle-orm";
import { buildListMeta, buildPublicApiError } from "../../lib/public-api";
import {
  createR2Client,
  extractKeyFromUrl,
  generatePresignedUrl,
} from "../../lib/storage";
import { requireApiScope } from "../../middleware/api-key-auth";
import { type PublicApiV2Env } from "./env";
import { ListQuerySchema } from "./schemas";
import { orgDb } from "../../lib/org-db";
import {
  loadCertificateLifecycles,
  withdrawalOf,
} from "../../lib/certificate-lifecycle";

export const certificateRoutes = new Hono<PublicApiV2Env>()
  .get(
    "/certificates",
    requireApiScope("certificates:read"),
    zValidator(
      "query",
      ListQuerySchema.extend({ unitId: z.coerce.number().optional() }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const { page, limit, query, unitId } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const conditions = [
        eq(calibrationJob.organizationId, apiKey.organizationId),
        inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
        unitId ? eq(calibrationJob.unitId, unitId) : undefined,
        query ? ilike(calibrationJob.jobId, `%${query}%`) : undefined,
      ];

      const [countResult, rows, lifecycles] = await orgDb(
        apiKey.organizationId,
      ).transaction(async (o) => {
        const [total, pageRows] = await Promise.all([
          o
            .select({ total: count() })
            .from(calibrationJob)
            .where(and(...conditions)),
          o
            .select({
              id: calibrationJob.id,
              jobId: calibrationJob.jobId,
              certificateName: calibrationJob.certificateName,
              status: calibrationJob.status,
              approvedAt: calibrationJob.approvedAt,
              verificationToken: calibrationJob.verificationToken,
              certificateUrl: calibrationJob.certificateUrl,
              unitId: calibrationJob.unitId,
              supersededById: calibrationJob.supersededById,
              assetName: asset.name,
              customerName: customer.name,
            })
            .from(calibrationJob)
            .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
            .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
            .where(and(...conditions))
            .orderBy(desc(calibrationJob.approvedAt))
            .limit(limit)
            .offset(offset),
        ]);
        return [
          total,
          pageRows,
          await loadCertificateLifecycles(o, pageRows),
        ] as const;
      });

      return c.json({
        data: rows.map(({ supersededById: _supersededById, ...row }) => ({
          ...row,
          // ISSUED, SUPERSEDED once an amendment was issued, WITHDRAWN (§7.10):
          // a withdrawn certificate must not be relied on.
          certificateStatus: lifecycles.get(row.id)?.status ?? "ISSUED",
          withdrawnAt:
            withdrawalOf(lifecycles.get(row.id))?.withdrawnAt ?? null,
        })),
        meta: buildListMeta({
          page,
          limit,
          total: countResult[0]?.total ?? 0,
          filters: { query: query ?? null, unitId: unitId ?? null },
        }),
      });
    },
  )
  .get(
    "/certificates/:jobId",
    requireApiScope("certificates:read"),
    async (c) => {
      const apiKey = c.get("apiKey");
      const jobId = c.req.param("jobId");
      const [job] = await orgDb(apiKey.organizationId).transaction((o) =>
        o
          .select({
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            certificateName: calibrationJob.certificateName,
            status: calibrationJob.status,
            approvedAt: calibrationJob.approvedAt,
            verificationToken: calibrationJob.verificationToken,
            certificateUrl: calibrationJob.certificateUrl,
            unitId: calibrationJob.unitId,
            assetId: calibrationJob.assetId,
            assetName: asset.name,
            customerId: calibrationJob.customerId,
            customerName: customer.name,
            supersededById: calibrationJob.supersededById,
          })
          .from(calibrationJob)
          .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
          .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              eq(calibrationJob.jobId, jobId),
              inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
            ),
          )
          .limit(1),
      );
      const lifecycle = job
        ? (
            await orgDb(apiKey.organizationId).transaction((o) =>
              loadCertificateLifecycles(o, [job]),
            )
          ).get(job.id)
        : undefined;

      if (!job) {
        return c.json(
          buildPublicApiError({
            code: "certificate_not_found",
            message: "Certificado não encontrado",
          }),
          404,
        );
      }

      const { supersededById: _supersededById, ...data } = job;
      return c.json({
        data: {
          ...data,
          // ISSUED, SUPERSEDED once an amendment was issued, WITHDRAWN (§7.10).
          certificateStatus: lifecycle?.status ?? "ISSUED",
          withdrawnAt: withdrawalOf(lifecycle)?.withdrawnAt ?? null,
        },
      });
    },
  )
  .get(
    "/certificates/:jobId/download",
    requireApiScope("certificates:read"),
    async (c) => {
      const apiKey = c.get("apiKey");
      const jobId = c.req.param("jobId");
      const [job] = await orgDb(apiKey.organizationId).transaction((o) =>
        o
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
          .limit(1),
      );

      if (!job?.certificateUrl) {
        return c.json(
          buildPublicApiError({
            code: "certificate_not_found",
            message: "Certificado não encontrado",
          }),
          404,
        );
      }

      const r2 = createR2Client(c.env);
      const key = extractKeyFromUrl(job.certificateUrl);
      if (!key) {
        return c.json(
          buildPublicApiError({
            code: "certificate_not_ready",
            message: "Documento ainda não disponível",
          }),
          400,
        );
      }

      const downloadUrl = await generatePresignedUrl(
        r2,
        c.env.R2_BUCKET_NAME,
        key,
        300,
      );
      return c.redirect(downloadUrl, 302);
    },
  );
