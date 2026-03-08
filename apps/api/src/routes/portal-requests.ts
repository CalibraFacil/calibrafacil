import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  calibrationRequest,
  calibrationRequestAuditLog,
  calibrationRequestItem,
  customer,
  service,
} from "@calibra-facil/db/schema";
import {
  CreateCalibrationRequestSchema,
  ListCalibrationRequestsQuerySchema,
} from "@calibra-facil/schemas";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  requirePermission,
  requirePortalProtected,
  type AuthVariables,
} from "../middleware/permission";

async function getPortalCustomer(authOrganizationId: string) {
  const [linkedCustomer] = await db
    .select({
      id: customer.id,
      name: customer.name,
      labOrganizationId: customer.labOrganizationId,
    })
    .from(customer)
    .where(eq(customer.authOrganizationId, authOrganizationId))
    .limit(1);

  return linkedCustomer ?? null;
}

async function getRequestItems(requestIds: number[]) {
  if (requestIds.length === 0) return [];

  return db
    .select({
      requestId: calibrationRequestItem.requestId,
      id: calibrationRequestItem.id,
      assetId: asset.id,
      assetName: asset.name,
      assetTag: asset.tag,
      assetSerialNumber: asset.serialNumber,
      assetManufacturer: asset.manufacturer,
      assetModel: asset.model,
      assetTypeName: assetType.name,
      convertedJobId: calibrationRequestItem.convertedJobId,
      convertedJobCode: calibrationJob.jobId,
      convertedJobStatus: calibrationJob.status,
      convertedServiceName: service.name,
    })
    .from(calibrationRequestItem)
    .innerJoin(asset, eq(calibrationRequestItem.assetId, asset.id))
    .leftJoin(assetType, eq(asset.assetTypeId, assetType.id))
    .leftJoin(
      calibrationJob,
      eq(calibrationRequestItem.convertedJobId, calibrationJob.id),
    )
    .leftJoin(service, eq(calibrationJob.serviceId, service.id))
    .where(inArray(calibrationRequestItem.requestId, requestIds))
    .orderBy(calibrationRequestItem.id);
}

export const portalRequestsRouter = new Hono<{ Variables: AuthVariables }>()
  .get(
    "/",
    ...requirePortalProtected,
    requirePermission({ request: ["read"] }),
    zValidator("query", ListCalibrationRequestsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { page, limit, status } = c.req.valid("query");
      const offset = (page - 1) * limit;

      const linkedCustomer = await getPortalCustomer(member.organizationId);

      if (!linkedCustomer) {
        return c.json({
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        });
      }

      const conditions = [
        eq(calibrationRequest.authOrganizationId, member.organizationId),
        eq(calibrationRequest.customerId, linkedCustomer.id),
      ];

      if (status) {
        conditions.push(eq(calibrationRequest.status, status));
      }

      const whereCondition = and(...conditions);

      const [countResult] = await db
        .select({ total: count() })
        .from(calibrationRequest)
        .where(whereCondition);

      const requests = await db
        .select({
          id: calibrationRequest.id,
          status: calibrationRequest.status,
          observations: calibrationRequest.observations,
          requestedDueDate: calibrationRequest.requestedDueDate,
          submittedAt: calibrationRequest.submittedAt,
          reviewedAt: calibrationRequest.reviewedAt,
          approvedAt: calibrationRequest.approvedAt,
          convertedAt: calibrationRequest.convertedAt,
          customerName: customer.name,
        })
        .from(calibrationRequest)
        .innerJoin(customer, eq(calibrationRequest.customerId, customer.id))
        .where(whereCondition)
        .orderBy(desc(calibrationRequest.submittedAt))
        .limit(limit)
        .offset(offset);

      const items = await getRequestItems(
        requests.map((request) => request.id),
      );
      const itemCountByRequestId = new Map<number, number>();

      for (const item of items) {
        itemCountByRequestId.set(
          item.requestId,
          (itemCountByRequestId.get(item.requestId) ?? 0) + 1,
        );
      }

      return c.json({
        data: requests.map((request) => ({
          ...request,
          itemCount: itemCountByRequestId.get(request.id) ?? 0,
        })),
        pagination: {
          page,
          limit,
          total: countResult?.total ?? 0,
          totalPages: Math.ceil((countResult?.total ?? 0) / limit),
        },
      });
    },
  )
  .get(
    "/:id",
    ...requirePortalProtected,
    requirePermission({ request: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const linkedCustomer = await getPortalCustomer(member.organizationId);

      if (!linkedCustomer) {
        return c.json({ error: "Solicitacao nao encontrada" }, 404);
      }

      const [request] = await db
        .select({
          id: calibrationRequest.id,
          status: calibrationRequest.status,
          observations: calibrationRequest.observations,
          requestedDueDate: calibrationRequest.requestedDueDate,
          submittedAt: calibrationRequest.submittedAt,
          reviewedAt: calibrationRequest.reviewedAt,
          approvedAt: calibrationRequest.approvedAt,
          rejectedAt: calibrationRequest.rejectedAt,
          rejectionReason: calibrationRequest.rejectionReason,
          convertedAt: calibrationRequest.convertedAt,
          customerId: calibrationRequest.customerId,
          customerName: customer.name,
        })
        .from(calibrationRequest)
        .innerJoin(customer, eq(calibrationRequest.customerId, customer.id))
        .where(
          and(
            eq(calibrationRequest.id, id),
            eq(calibrationRequest.authOrganizationId, member.organizationId),
            eq(calibrationRequest.customerId, linkedCustomer.id),
          ),
        )
        .limit(1);

      if (!request) {
        return c.json({ error: "Solicitacao nao encontrada" }, 404);
      }

      const items = await getRequestItems([request.id]);

      return c.json({
        ...request,
        items: items.map(({ requestId: _requestId, ...item }) => item),
      });
    },
  )
  .post(
    "/",
    ...requirePortalProtected,
    requirePermission({ request: ["create"] }),
    zValidator("json", CreateCalibrationRequestSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const linkedCustomer = await getPortalCustomer(member.organizationId);

      if (!linkedCustomer) {
        return c.json({ error: "Cliente vinculado nao encontrado" }, 404);
      }

      const assets = await db
        .select({
          id: asset.id,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .where(
          and(
            inArray(asset.id, input.assetIds),
            eq(customer.id, linkedCustomer.id),
            eq(customer.authOrganizationId, member.organizationId),
            isNull(asset.deletedAt),
          ),
        );

      if (assets.length !== input.assetIds.length) {
        return c.json(
          { error: "Um ou mais ativos selecionados nao pertencem ao cliente" },
          400,
        );
      }

      const requestedDueDate = input.requestedDueDate
        ? new Date(input.requestedDueDate)
        : null;

      const [request] = await db
        .insert(calibrationRequest)
        .values({
          organizationId: linkedCustomer.labOrganizationId,
          customerId: linkedCustomer.id,
          authOrganizationId: member.organizationId,
          observations: input.observations || null,
          requestedDueDate,
          submittedBy: session.user.id,
        })
        .returning();

      if (!request) {
        return c.json({ error: "Erro ao criar solicitacao" }, 500);
      }

      await db.insert(calibrationRequestItem).values(
        input.assetIds.map((assetId) => ({
          requestId: request.id,
          assetId,
        })),
      );

      await db.insert(calibrationRequestAuditLog).values({
        requestId: request.id,
        action: "create",
        changes: {
          initial: {
            assetIds: input.assetIds,
            observations: input.observations || null,
            requestedDueDate: requestedDueDate?.toISOString() ?? null,
          },
        },
        performedBy: session.user.id,
        ipAddress:
          c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null,
      });

      return c.json(
        {
          id: request.id,
          status: request.status,
        },
        201,
      );
    },
  );
