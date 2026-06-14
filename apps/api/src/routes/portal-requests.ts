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
import { notifyCalibrationRequestSubmitted } from "@calibra-facil/notifications";
import { and, count, desc, eq, inArray, isNull, ilike, sql } from "drizzle-orm";
import {
  requirePermission,
  requirePortalProtected,
  type AuthVariables,
} from "../middleware/permission";
import { resolveLabOrganizationIdByPortalHostname } from "../lib/portal-domains";
import { resolvePortalCustomerScope } from "../lib/portal-customer-scope";

function getPortalHostOrigin(c: {
  req: { header: (name: string) => string | undefined };
}) {
  return c.req.header("origin") ?? c.req.header("referer") ?? null;
}

async function getPortalLabScope(c: {
  req: { header: (name: string) => string | undefined };
}) {
  const origin = getPortalHostOrigin(c);
  if (!origin) return null;

  try {
    const url = new URL(origin);
    return resolveLabOrganizationIdByPortalHostname(url.hostname);
  } catch {
    return null;
  }
}

async function getPortalCustomer(
  authOrganizationId: string,
  portalLabScope?: string | null,
) {
  const [linkedCustomer] = await db
    .select({
      id: customer.id,
      name: customer.name,
      labOrganizationId: customer.labOrganizationId,
    })
    .from(customer)
    .where(
      and(
        eq(customer.authOrganizationId, authOrganizationId),
        portalLabScope
          ? eq(customer.labOrganizationId, portalLabScope)
          : undefined,
      ),
    )
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
      const portalLabScope = await getPortalLabScope(c);
      const { page, limit, status, query } = c.req.valid("query");
      const offset = (page - 1) * limit;

      const scope = await resolvePortalCustomerScope({
        activeOrgId: member.organizationId,
        labScope: portalLabScope,
      });

      if (!scope || scope.customerIds.length === 0) {
        return c.json({
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        });
      }

      // Scope by customerId alone: in group mode requests carry the branch
      // authOrg, not the active (group) org.
      const conditions = [
        inArray(calibrationRequest.customerId, scope.customerIds),
      ];

      if (status) {
        conditions.push(eq(calibrationRequest.status, status));
      }

      if (query?.trim()) {
        conditions.push(
          sql`(
            ${calibrationRequest.id}::text ilike ${`%${query}%`}
            or coalesce(${calibrationRequest.observations}, '') ilike ${`%${query}%`}
          )`,
        );
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
      const portalLabScope = await getPortalLabScope(c);
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const scope = await resolvePortalCustomerScope({
        activeOrgId: member.organizationId,
        labScope: portalLabScope,
      });

      if (!scope || scope.customerIds.length === 0) {
        return c.json({ error: "Solicitacao nao encontrada" }, 404);
      }

      const [request] = await db
        .select({
          id: calibrationRequest.id,
          status: calibrationRequest.status,
          observations: calibrationRequest.observations,
          requestedDueDate: calibrationRequest.requestedDueDate,
          deliveryMethod: calibrationRequest.deliveryMethod,
          invoiceRemittanceNumber: calibrationRequest.invoiceRemittanceNumber,
          invoiceRemittanceKey: calibrationRequest.invoiceRemittanceKey,
          invoiceRemittanceIssuedAt:
            calibrationRequest.invoiceRemittanceIssuedAt,
          carrierName: calibrationRequest.carrierName,
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
            inArray(calibrationRequest.customerId, scope.customerIds),
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
      const portalLabScope = await getPortalLabScope(c);
      const input = c.req.valid("json");
      const ipAddress =
        c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null;

      const linkedCustomer = await getPortalCustomer(
        member.organizationId,
        portalLabScope,
      );

      if (!linkedCustomer) {
        return c.json({ error: "Cliente vinculado nao encontrado" }, 404);
      }

      const assets = await db
        .select({
          id: asset.id,
          unitId: asset.unitId,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .where(
          and(
            inArray(asset.id, input.assetIds),
            eq(customer.id, linkedCustomer.id),
            eq(customer.authOrganizationId, member.organizationId),
            eq(asset.status, "ACTIVE"),
            isNull(asset.deletedAt),
          ),
        );

      if (assets.length !== input.assetIds.length) {
        return c.json(
          { error: "Um ou mais ativos selecionados nao pertencem ao cliente" },
          400,
        );
      }

      const unitIds = [...new Set(assets.map((item) => item.unitId))];
      if (unitIds.length !== 1) {
        return c.json(
          {
            error:
              "Selecione ativos da mesma unidade para enviar a solicitacao",
          },
          400,
        );
      }

      const requestedDueDate = input.requestedDueDate
        ? new Date(input.requestedDueDate)
        : null;

      // Remittance details only apply when shipping via a carrier; drop them
      // otherwise so a later toggle to drop-off can't leave stale invoice data.
      const isCarrier = input.deliveryMethod === "carrier";
      const invoiceRemittanceIssuedAt =
        isCarrier && input.invoiceRemittanceIssuedAt
          ? new Date(input.invoiceRemittanceIssuedAt)
          : null;

      const request = await db.transaction(async (tx) => {
        const lockAssetIds = [...input.assetIds].sort(
          (left, right) => left - right,
        );

        for (const assetId of lockAssetIds) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(${linkedCustomer.id}, ${assetId})`,
          );
        }

        const existingItems = await tx
          .select({
            assetId: calibrationRequestItem.assetId,
          })
          .from(calibrationRequestItem)
          .innerJoin(
            calibrationRequest,
            eq(calibrationRequestItem.requestId, calibrationRequest.id),
          )
          .where(
            and(
              inArray(calibrationRequestItem.assetId, input.assetIds),
              eq(calibrationRequest.customerId, linkedCustomer.id),
              inArray(calibrationRequest.status, [
                "PENDING",
                "UNDER_REVIEW",
                "APPROVED",
              ]),
            ),
          );

        if (existingItems.length > 0) {
          return null;
        }

        const [createdRequest] = await tx
          .insert(calibrationRequest)
          .values({
            organizationId: linkedCustomer.labOrganizationId,
            unitId: unitIds[0]!,
            customerId: linkedCustomer.id,
            authOrganizationId: member.organizationId,
            observations: input.observations || null,
            requestedDueDate,
            deliveryMethod: input.deliveryMethod,
            invoiceRemittanceNumber: isCarrier
              ? input.invoiceRemittanceNumber || null
              : null,
            invoiceRemittanceKey: isCarrier
              ? input.invoiceRemittanceKey || null
              : null,
            invoiceRemittanceIssuedAt,
            carrierName: isCarrier ? input.carrierName || null : null,
            submittedBy: session.user.id,
          })
          .returning();

        if (!createdRequest) {
          throw new Error("Erro ao criar solicitacao");
        }

        await tx.insert(calibrationRequestItem).values(
          input.assetIds.map((assetId) => ({
            requestId: createdRequest.id,
            assetId,
          })),
        );

        await tx.insert(calibrationRequestAuditLog).values({
          requestId: createdRequest.id,
          action: "create",
          changes: {
            initial: {
              assetIds: input.assetIds,
              observations: input.observations || null,
              requestedDueDate: requestedDueDate?.toISOString() ?? null,
            },
          },
          performedBy: session.user.id,
          ipAddress,
        });

        return createdRequest;
      });

      if (!request) {
        return c.json(
          { error: "Um ou mais ativos ja possuem uma solicitacao ativa" },
          400,
        );
      }

      try {
        await notifyCalibrationRequestSubmitted(request.id);
      } catch (error) {
        console.error(
          "[Portal Requests] Failed to send request submission notification:",
          error,
        );
      }

      return c.json(
        {
          id: request.id,
          status: request.status,
        },
        201,
      );
    },
  );
