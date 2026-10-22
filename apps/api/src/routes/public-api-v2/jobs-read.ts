import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  customer,
  organizationUnit,
  service,
  user,
} from "@calibra-facil/db/schema";
import { JobStatusSchema } from "@calibra-facil/schemas";
import { and, count, desc, eq, ilike } from "drizzle-orm";
import {
  buildListMeta,
  buildPublicApiError,
  getResourceExternalId,
  getResourceExternalIdMap,
} from "../../lib/public-api";
import { requireApiScope } from "../../middleware/api-key-auth";
import { type PublicApiV2Env } from "./env";
import { ListQuerySchema } from "./schemas";
import {
  resolveAssetId,
  resolveCustomerId,
  resolveExternalResourceId,
} from "./resolvers";

export const jobReadRoutes = new Hono<PublicApiV2Env>()
  .get(
    "/jobs",
    requireApiScope("jobs:read"),
    zValidator(
      "query",
      ListQuerySchema.extend({
        status: z.string().optional(),
        customerId: z.coerce.number().optional(),
        customerExternalId: z.string().trim().optional(),
        assetExternalId: z.string().trim().optional(),
        assetId: z.coerce.number().optional(),
        serviceId: z.coerce.number().optional(),
      }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const {
        page,
        limit,
        query,
        status,
        unitId,
        customerId,
        customerExternalId,
        assetId,
        assetExternalId,
        serviceId,
      } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const resolvedCustomerId = await resolveCustomerId({
        organizationId: apiKey.organizationId,
        customerId,
        customerExternalId,
      });
      const resolvedAssetId = await resolveAssetId({
        organizationId: apiKey.organizationId,
        assetId,
        assetExternalId,
      });
      const conditions = [
        eq(calibrationJob.organizationId, apiKey.organizationId),
        unitId ? eq(calibrationJob.unitId, unitId) : undefined,
        JobStatusSchema.safeParse(status).success
          ? eq(calibrationJob.status, JobStatusSchema.parse(status))
          : undefined,
        resolvedCustomerId
          ? eq(calibrationJob.customerId, resolvedCustomerId)
          : undefined,
        resolvedAssetId
          ? eq(calibrationJob.assetId, resolvedAssetId)
          : undefined,
        serviceId ? eq(calibrationJob.serviceId, serviceId) : undefined,
        query ? ilike(calibrationJob.jobId, `%${query}%`) : undefined,
      ];

      const [countResult, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(calibrationJob)
          .where(and(...conditions)),
        db
          .select({
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            status: calibrationJob.status,
            dueDate: calibrationJob.dueDate,
            performedAt: calibrationJob.performedAt,
            approvedAt: calibrationJob.approvedAt,
            customerId: calibrationJob.customerId,
            customerName: customer.name,
            unitId: calibrationJob.unitId,
            unitName: organizationUnit.name,
            assetId: calibrationJob.assetId,
            assetName: asset.name,
            serviceId: calibrationJob.serviceId,
            serviceName: service.name,
            technicianId: calibrationJob.technicianId,
            createdAt: calibrationJob.createdAt,
            updatedAt: calibrationJob.updatedAt,
          })
          .from(calibrationJob)
          .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
          .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
          .innerJoin(service, eq(calibrationJob.serviceId, service.id))
          .leftJoin(
            organizationUnit,
            eq(calibrationJob.unitId, organizationUnit.id),
          )
          .where(and(...conditions))
          .orderBy(desc(calibrationJob.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      const externalIds = await getResourceExternalIdMap({
        organizationId: apiKey.organizationId,
        resourceType: "job",
        resourceIds: rows.map((row) => row.id),
      });

      return c.json({
        data: rows.map((row) => ({
          ...row,
          externalId: externalIds.get(String(row.id)) ?? null,
          unit: row.unitId
            ? { id: row.unitId, name: row.unitName ?? "Unidade removida" }
            : null,
        })),
        meta: buildListMeta({
          page,
          limit,
          total: countResult[0]?.total ?? 0,
          filters: {
            query: query ?? null,
            status: status ?? null,
            unitId: unitId ?? null,
            customerId: resolvedCustomerId ?? null,
            assetId: resolvedAssetId ?? null,
            serviceId: serviceId ?? null,
          },
        }),
      });
    },
  )
  .get("/jobs/:id", requireApiScope("jobs:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await resolveExternalResourceId({
      organizationId: apiKey.organizationId,
      resourceType: "job",
      value: c.req.param("id"),
    });

    if (!resolvedId) {
      return c.json(
        buildPublicApiError({
          code: "job_not_found",
          message: "OS não encontrada",
        }),
        404,
      );
    }

    const [job] = await db
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        organizationId: calibrationJob.organizationId,
        status: calibrationJob.status,
        dueDate: calibrationJob.dueDate,
        performedAt: calibrationJob.performedAt,
        data: calibrationJob.data,
        results: calibrationJob.results,
        standardsSnapshot: calibrationJob.standardsSnapshot,
        environmentalSnapshot: calibrationJob.environmentalSnapshot,
        certificateUrl: calibrationJob.certificateUrl,
        labelUrl: calibrationJob.labelUrl,
        methodSnapshot: calibrationJob.methodSnapshot,
        createdAt: calibrationJob.createdAt,
        updatedAt: calibrationJob.updatedAt,
        approvedAt: calibrationJob.approvedAt,
        rejectedAt: calibrationJob.rejectedAt,
        rejectionReason: calibrationJob.rejectionReason,
        customerId: calibrationJob.customerId,
        customerName: customer.name,
        unitId: calibrationJob.unitId,
        unitName: organizationUnit.name,
        assetId: calibrationJob.assetId,
        assetName: asset.name,
        assetTag: asset.tag,
        serviceId: calibrationJob.serviceId,
        serviceName: service.name,
        technicianId: calibrationJob.technicianId,
        technicianName: user.name,
      })
      .from(calibrationJob)
      .leftJoin(customer, eq(calibrationJob.customerId, customer.id))
      .leftJoin(
        organizationUnit,
        eq(calibrationJob.unitId, organizationUnit.id),
      )
      .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
      .leftJoin(service, eq(calibrationJob.serviceId, service.id))
      .leftJoin(user, eq(calibrationJob.technicianId, user.id))
      .where(
        and(
          eq(calibrationJob.id, resolvedId),
          eq(calibrationJob.organizationId, apiKey.organizationId),
        ),
      )
      .limit(1);

    if (!job) {
      return c.json(
        buildPublicApiError({
          code: "job_not_found",
          message: "OS não encontrada",
        }),
        404,
      );
    }

    return c.json({
      data: {
        ...job,
        externalId: await getResourceExternalId({
          organizationId: apiKey.organizationId,
          resourceType: "job",
          resourceId: job.id,
        }),
        unit: job.unitId
          ? { id: job.unitId, name: job.unitName ?? "Unidade removida" }
          : null,
      },
    });
  });
