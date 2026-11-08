import { createRouter } from "../../../server/router";
import { requirePortalLabScope } from "../portal-lab-scope";
import { portalRequestEndpoints } from "@calibra-facil/contracts";
import { zValidator } from "@hono/zod-validator";
import {
  asset,
  assetType,
  calibrationJob,
  calibrationRequest,
  calibrationRequestItem,
  calibrationVisit,
  customer,
  service,
  user,
} from "@calibra-facil/db/schema";
import { CreateCalibrationRequestSchema } from "@calibra-facil/schemas";
import { AWAITING_CONVERSION_CALIBRATION_REQUEST_STATUSES } from "@calibra-facil/schemas/machines";
import { notifyCalibrationRequestSubmitted } from "@calibra-facil/notifications";
import { invalid, notFound } from "../../../lib/domain-errors";
import { and, count, desc, eq, inArray, isNull, ilike, sql } from "drizzle-orm";
import {
  requirePermission,
  requirePortalProtected,
  type AuthVariables,
} from "../../../middleware/permission";
import {
  resolvePortalCustomerScope,
  resolvePortalLinkedCustomer,
} from "../portal-customer-scope";
import { orgDb } from "../../../lib/org-db";
import type { OrgDb } from "@calibra-facil/db/for-org";
import { mount } from "../../../lib/endpoint-mount";
import { withOrg } from "../../../lib/org-context";
import { submitCalibrationRequest } from "../../visits";
import { requestActor } from "../../../middleware/request-actor";
import { requireRouteId } from "../../../lib/route-id";

function requestAlreadyActive() {
  return invalid(
    "request_already_active",
    "Um ou mais ativos ja possuem uma solicitacao ativa",
  );
}

async function getRequestItems(o: OrgDb, requestIds: number[]) {
  if (requestIds.length === 0) return [];

  return o
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

const PREFIX = "/api/portal/requests";

export const portalRequestsRouter = createRouter<{
  Variables: AuthVariables;
}>();

mount(
  portalRequestsRouter,
  PREFIX,
  portalRequestEndpoints.list,
  [...requirePortalProtected, requirePermission({ request: ["read"] })],
  async (c, { query: filters }) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);
    const { page, limit, status, query } = filters;
    const offset = (page - 1) * limit;

    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!scope || scope.customerIds.length === 0) {
      return {
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      };
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

    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const [countResult] = await o
        .select({ total: count() })
        .from(calibrationRequest)
        .where(whereCondition);

      const requests = await o
        .select({
          id: calibrationRequest.id,
          organizationId: calibrationRequest.organizationId,
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
        o,
        requests.map((request) => request.id),
      );
      const itemCountByRequestId = new Map<number, number>();

      for (const item of items) {
        itemCountByRequestId.set(
          item.requestId,
          (itemCountByRequestId.get(item.requestId) ?? 0) + 1,
        );
      }

      return {
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
      };
    });
  },
);

mount(
  portalRequestsRouter,
  PREFIX,
  portalRequestEndpoints.get,
  [...requirePortalProtected, requirePermission({ request: ["read"] })],
  async (c, { params }) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);
    const id = requireRouteId(params.id);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!scope || scope.customerIds.length === 0) {
      throw notFound("request_not_found", "Solicitacao nao encontrada");
    }

    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const [request] = await o
        .select({
          id: calibrationRequest.id,
          organizationId: calibrationRequest.organizationId,
          status: calibrationRequest.status,
          observations: calibrationRequest.observations,
          requestedDueDate: calibrationRequest.requestedDueDate,
          deliveryMethod: calibrationRequest.deliveryMethod,
          invoiceRemittanceNumber: calibrationRequest.invoiceRemittanceNumber,
          invoiceRemittanceKey: calibrationRequest.invoiceRemittanceKey,
          invoiceRemittanceIssuedAt:
            calibrationRequest.invoiceRemittanceIssuedAt,
          carrierName: calibrationRequest.carrierName,
          onsiteAddress: calibrationRequest.onsiteAddress,
          preferredVisitDate: calibrationRequest.preferredVisitDate,
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
        throw notFound("request_not_found", "Solicitacao nao encontrada");
      }

      const items = await getRequestItems(o, [request.id]);

      // On-site: the visit scheduled when the lab converted this request (if any).
      const [visit] = await o
        .select({
          status: calibrationVisit.status,
          scheduledAt: calibrationVisit.scheduledAt,
          technicianName: user.name,
        })
        .from(calibrationVisit)
        .leftJoin(user, eq(calibrationVisit.technicianId, user.id))
        .where(eq(calibrationVisit.sourceRequestId, request.id))
        .orderBy(desc(calibrationVisit.id))
        .limit(1);

      return {
        ...request,
        visit: visit ?? null,
        items: items.map(({ requestId: _requestId, ...item }) => item),
      };
    });
  },
);

portalRequestsRouter.post(
  "/",
  ...requirePortalProtected,
  requirePermission({ request: ["create"] }),
  zValidator("json", CreateCalibrationRequestSchema),
  async (c) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);
    const input = c.req.valid("json");

    const linkedCustomer = await resolvePortalLinkedCustomer({
      authOrganizationId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!linkedCustomer) {
      throw notFound("customer_not_found", "Cliente vinculado nao encontrado");
    }

    const lab = orgDb(linkedCustomer.labOrganizationId);
    const assets = await lab.transaction((o) =>
      o
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
        ),
    );

    if (assets.length !== input.assetIds.length) {
      throw invalid(
        "invalid_assets",
        "Um ou mais ativos selecionados nao pertencem ao cliente",
      );
    }

    const unitIds = [...new Set(assets.map((item) => item.unitId))];
    if (unitIds.length !== 1) {
      throw invalid(
        "multi_unit_request_not_allowed",
        "Selecione ativos da mesma unidade para enviar a solicitacao",
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

    // On-site visit fields only apply to "onsite"; default the address to the
    // customer's registered address when the form didn't override it.
    const isOnsite = input.deliveryMethod === "onsite";
    const onsiteAddress = isOnsite
      ? (input.onsiteAddress ?? linkedCustomer.address ?? null)
      : null;
    const preferredVisitDate =
      isOnsite && input.preferredVisitDate
        ? new Date(input.preferredVisitDate)
        : null;

    const request = await withOrg(
      linkedCustomer.labOrganizationId,
      requestActor(c),
      async (ctx) => {
        const lockAssetIds = [...input.assetIds].sort(
          (left, right) => left - right,
        );

        for (const assetId of lockAssetIds) {
          await ctx.o.advisoryXactLock(linkedCustomer.id, assetId);
        }

        const existingItems = await ctx.o
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
              inArray(
                calibrationRequest.status,
                AWAITING_CONVERSION_CALIBRATION_REQUEST_STATUSES,
              ),
            ),
          );

        if (existingItems.length > 0) throw requestAlreadyActive();

        const createdRequest = await submitCalibrationRequest(ctx, {
          unitId: unitIds[0]!,
          customerId: linkedCustomer.id,
          authOrganizationId: member.organizationId,
          assetIds: input.assetIds,
          observations: input.observations,
          requestedDueDate,
          fields: {
            deliveryMethod: input.deliveryMethod,
            invoiceRemittanceNumber: isCarrier
              ? input.invoiceRemittanceNumber || null
              : null,
            invoiceRemittanceKey: isCarrier
              ? input.invoiceRemittanceKey || null
              : null,
            invoiceRemittanceIssuedAt,
            carrierName: isCarrier ? input.carrierName || null : null,
            onsiteAddress,
            preferredVisitDate,
          },
        });

        ctx.afterCommit(() =>
          notifyCalibrationRequestSubmitted(createdRequest.id),
        );

        return createdRequest;
      },
    );

    return c.json(
      {
        id: request.id,
        status: request.status,
      },
      201,
    );
  },
);

// =========================================================================
// POST /batch - Consolidated (cross-unit) recall
// =========================================================================
// Accepts a selection that may span several branch customers and/or lab
// units (the group cockpit) and atomically splits it into one calibration
// request per (branch customer, lab unit) — the existing single-request
// invariant. Each request carries the BRANCH's authOrganizationId, so the
// lab side handles them exactly like a per-unit request. All-or-nothing.
// =========================================================================
mount(
  portalRequestsRouter,
  PREFIX,
  portalRequestEndpoints.createBatch,
  [...requirePortalProtected, requirePermission({ request: ["create"] })],
  async (c, { body }) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);
    const input = body;

    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });
    if (!scope || scope.customerIds.length === 0) {
      throw notFound("customer_not_found", "Cliente vinculado nao encontrado");
    }

    const lab = orgDb(scope.labOrganizationId);
    const assets = await lab.transaction((o) =>
      o
        .select({
          id: asset.id,
          unitId: asset.unitId,
          customerId: asset.customerId,
          authOrganizationId: customer.authOrganizationId,
          labOrganizationId: customer.labOrganizationId,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .where(
          and(
            inArray(asset.id, input.assetIds),
            inArray(asset.customerId, scope.customerIds),
            eq(asset.status, "ACTIVE"),
            isNull(asset.deletedAt),
          ),
        ),
    );

    if (assets.length !== input.assetIds.length) {
      throw invalid(
        "invalid_assets",
        "Um ou mais ativos selecionados nao pertencem a este acesso",
      );
    }

    // Group by (branch customer, lab unit).
    type RequestGroup = {
      customerId: number;
      unitId: number;
      authOrganizationId: string;
      labOrganizationId: string;
      assetIds: number[];
    };
    const groups = new Map<string, RequestGroup>();
    for (const item of assets) {
      const key = `${item.customerId}:${item.unitId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.assetIds.push(item.id);
      } else {
        groups.set(key, {
          customerId: item.customerId,
          unitId: item.unitId,
          authOrganizationId: item.authOrganizationId,
          labOrganizationId: item.labOrganizationId,
          assetIds: [item.id],
        });
      }
    }

    const requestedDueDate = input.requestedDueDate
      ? new Date(input.requestedDueDate)
      : null;
    const isCarrier = input.deliveryMethod === "carrier";
    const invoiceRemittanceIssuedAt =
      isCarrier && input.invoiceRemittanceIssuedAt
        ? new Date(input.invoiceRemittanceIssuedAt)
        : null;
    // On-site visit fields only apply to "onsite". A batch carries a single
    // visit address from the form (one trip), applied to each group's request.
    const isOnsite = input.deliveryMethod === "onsite";
    const onsiteAddress = isOnsite ? (input.onsiteAddress ?? null) : null;
    const preferredVisitDate =
      isOnsite && input.preferredVisitDate
        ? new Date(input.preferredVisitDate)
        : null;

    const created = await withOrg(
      scope.labOrganizationId,
      requestActor(c),
      async (ctx) => {
        // Lock every (customer, asset) pair, globally ordered for deadlock safety.
        const lockPairs = assets
          .map((item) => ({ customerId: item.customerId, assetId: item.id }))
          .sort(
            (left, right) =>
              left.customerId - right.customerId ||
              left.assetId - right.assetId,
          );
        for (const pair of lockPairs) {
          await ctx.o.advisoryXactLock(pair.customerId, pair.assetId);
        }

        // All-or-nothing dedup across the whole batch.
        const existingItems = await ctx.o
          .select({ assetId: calibrationRequestItem.assetId })
          .from(calibrationRequestItem)
          .innerJoin(
            calibrationRequest,
            eq(calibrationRequestItem.requestId, calibrationRequest.id),
          )
          .where(
            and(
              inArray(calibrationRequestItem.assetId, input.assetIds),
              inArray(calibrationRequest.customerId, scope.customerIds),
              inArray(
                calibrationRequest.status,
                AWAITING_CONVERSION_CALIBRATION_REQUEST_STATUSES,
              ),
            ),
          );

        if (existingItems.length > 0) throw requestAlreadyActive();

        const results: Array<{
          id: number;
          status: typeof calibrationRequest.$inferSelect.status;
          customerId: number;
          unitId: number;
          itemCount: number;
        }> = [];

        for (const group of groups.values()) {
          const createdRequest = await submitCalibrationRequest(ctx, {
            unitId: group.unitId,
            customerId: group.customerId,
            authOrganizationId: group.authOrganizationId,
            assetIds: group.assetIds,
            observations: input.observations,
            requestedDueDate,
            fields: {
              deliveryMethod: input.deliveryMethod,
              invoiceRemittanceNumber: isCarrier
                ? input.invoiceRemittanceNumber || null
                : null,
              invoiceRemittanceKey: isCarrier
                ? input.invoiceRemittanceKey || null
                : null,
              invoiceRemittanceIssuedAt,
              carrierName: isCarrier ? input.carrierName || null : null,
              onsiteAddress,
              preferredVisitDate,
            },
          });
          ctx.afterCommit(() =>
            notifyCalibrationRequestSubmitted(createdRequest.id),
          );

          results.push({
            id: createdRequest.id,
            status: createdRequest.status,
            customerId: group.customerId,
            unitId: group.unitId,
            itemCount: group.assetIds.length,
          });
        }

        return results;
      },
    );

    return { created };
  },
);
