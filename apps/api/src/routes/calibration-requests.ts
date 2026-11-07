import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { alias } from "drizzle-orm/pg-core";
import type { OrgDb } from "@calibra-facil/db/for-org";
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
import {
  ApproveCalibrationRequestSchema,
  ConvertCalibrationRequestSchema,
  ListCalibrationRequestsQuerySchema,
  RejectCalibrationRequestSchema,
  ReviewCalibrationRequestSchema,
} from "@calibra-facil/schemas";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  sql,
} from "drizzle-orm";
import { CALIBRATION_REQUEST_MACHINE } from "@calibra-facil/schemas/machines";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { createCalibrationJob, jobCreationClientErrors } from "../lib/jobs";
import {
  notifyCalibrationRequestApproved,
  notifyCalibrationRequestConverted,
  notifyCalibrationRequestRejected,
  notifyCalibrationRequestUnderReview,
  notifyJobAssigned,
  notifyVisitScheduled,
  notifyVisitConfirmed,
} from "@calibra-facil/notifications";
import { buildUnitScopeCondition } from "../lib/units";
import { formatOnsiteAddressText } from "../lib/onsite-address";
import { isAssignableTechnician } from "../lib/tenant-refs";
import { orgDb } from "../lib/org-db";
import { withOrg } from "../lib/org-context";
import { requestActor } from "../middleware/request-actor";
import { requireRouteId } from "../lib/route-id";
import { requireLockedLabRequest } from "../lib/calibration-request-access";
import { conflict, invalid, notFound } from "../lib/domain-errors";

const submitterUser = alias(user, "calibrationRequestSubmitter");
const reviewerUser = alias(user, "calibrationRequestReviewer");
const approverUser = alias(user, "calibrationRequestApprover");
const rejecterUser = alias(user, "calibrationRequestRejecter");
const converterUser = alias(user, "calibrationRequestConverter");

type ConvertedRequestJob = {
  requestItemId: number;
  jobId: number;
  jobCode: string;
  status: string;
  technicianId: string | null;
};

/** The conditional write matched no row: another user moved the request first. */
function requestChangedByAnother() {
  return conflict(
    "status_transition_conflict",
    "Solicitacao foi atualizada por outro usuario",
  );
}

async function getRequestItems(
  requestIds: number[],
  organizationId: string,
  // The caller's org-bound transaction (row-level security).
  o: Pick<OrgDb, "select">,
) {
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
      assetTypeId: asset.assetTypeId,
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
    .where(
      and(
        inArray(calibrationRequestItem.requestId, requestIds),
        eq(calibrationRequestItem.organizationId, organizationId),
      ),
    )
    .orderBy(calibrationRequestItem.id);
}

async function getRequestDetail(
  requestId: number,
  organizationId: string,
  unitCondition: ReturnType<typeof and>,
  o: Pick<OrgDb, "select">,
) {
  const [request] = await o
    .select({
      id: calibrationRequest.id,
      status: calibrationRequest.status,
      observations: calibrationRequest.observations,
      internalNotes: calibrationRequest.internalNotes,
      requestedDueDate: calibrationRequest.requestedDueDate,
      deliveryMethod: calibrationRequest.deliveryMethod,
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
      submittedBy: calibrationRequest.submittedBy,
      submittedByName: submitterUser.name,
      reviewedBy: calibrationRequest.reviewedBy,
      reviewedByName: reviewerUser.name,
      approvedBy: calibrationRequest.approvedBy,
      approvedByName: approverUser.name,
      rejectedBy: calibrationRequest.rejectedBy,
      rejectedByName: rejecterUser.name,
      convertedBy: calibrationRequest.convertedBy,
      convertedByName: converterUser.name,
    })
    .from(calibrationRequest)
    .innerJoin(customer, eq(calibrationRequest.customerId, customer.id))
    .leftJoin(
      submitterUser,
      eq(calibrationRequest.submittedBy, submitterUser.id),
    )
    .leftJoin(reviewerUser, eq(calibrationRequest.reviewedBy, reviewerUser.id))
    .leftJoin(approverUser, eq(calibrationRequest.approvedBy, approverUser.id))
    .leftJoin(rejecterUser, eq(calibrationRequest.rejectedBy, rejecterUser.id))
    .leftJoin(
      converterUser,
      eq(calibrationRequest.convertedBy, converterUser.id),
    )
    .where(
      and(
        eq(calibrationRequest.id, requestId),
        eq(calibrationRequest.organizationId, organizationId),
        unitCondition,
      ),
    )
    .limit(1);

  if (!request) {
    return null;
  }

  const items = await getRequestItems([request.id], organizationId, o);

  return {
    ...request,
    items: items.map(({ requestId: _requestId, ...item }) => item),
  };
}

export const calibrationRequestsRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .get(
    "/",
    ...withLabPermission({ request: ["read"] }),
    zValidator("query", ListCalibrationRequestsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { page, limit, query, status, customerId, dateFrom, dateTo } =
        c.req.valid("query");
      const offset = (page - 1) * limit;

      const conditions = [
        eq(calibrationRequest.organizationId, member.organizationId),
        buildUnitScopeCondition(calibrationRequest.unitId, member),
      ];

      if (query) {
        conditions.push(
          sql`(
            ${calibrationRequest.id}::text ilike ${`%${query}%`}
            or coalesce(${calibrationRequest.observations}, '') ilike ${`%${query}%`}
          )`,
        );
      }

      if (status) {
        conditions.push(eq(calibrationRequest.status, status));
      }

      if (customerId) {
        conditions.push(eq(calibrationRequest.customerId, customerId));
      }

      if (dateFrom) {
        conditions.push(
          gte(calibrationRequest.submittedAt, new Date(dateFrom)),
        );
      }

      if (dateTo) {
        const nextDay = new Date(dateTo);
        nextDay.setHours(0, 0, 0, 0);
        nextDay.setDate(nextDay.getDate() + 1);

        conditions.push(lt(calibrationRequest.submittedAt, nextDay));
      }

      const whereCondition = and(...conditions);

      return await orgDb(member.organizationId).transaction(async (o) => {
        const [countResult] = await o
          .select({ total: count() })
          .from(calibrationRequest)
          .where(whereCondition);

        const requests = await o
          .select({
            id: calibrationRequest.id,
            status: calibrationRequest.status,
            observations: calibrationRequest.observations,
            requestedDueDate: calibrationRequest.requestedDueDate,
            submittedAt: calibrationRequest.submittedAt,
            reviewedAt: calibrationRequest.reviewedAt,
            approvedAt: calibrationRequest.approvedAt,
            rejectedAt: calibrationRequest.rejectedAt,
            convertedAt: calibrationRequest.convertedAt,
            customerId: calibrationRequest.customerId,
            customerName: customer.name,
            submittedByName: submitterUser.name,
          })
          .from(calibrationRequest)
          .innerJoin(customer, eq(calibrationRequest.customerId, customer.id))
          .leftJoin(
            submitterUser,
            eq(calibrationRequest.submittedBy, submitterUser.id),
          )
          .where(whereCondition)
          .orderBy(desc(calibrationRequest.submittedAt))
          .limit(limit)
          .offset(offset);

        const items = await getRequestItems(
          requests.map((request) => request.id),
          member.organizationId,
          o,
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
      });
    },
  )
  .get("/:id", ...withLabPermission({ request: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = requireRouteId(c.req.param("id"));

    const request = await orgDb(member.organizationId).transaction((o) =>
      getRequestDetail(
        id,
        member.organizationId,
        buildUnitScopeCondition(calibrationRequest.unitId, member),
        o,
      ),
    );

    if (!request) {
      throw notFound("request_not_found", "Solicitacao nao encontrada");
    }

    return c.json(request);
  })
  .post(
    "/:id/review",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", ReviewCalibrationRequestSchema),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));
      const input = c.req.valid("json");

      await withOrg(member.organizationId, requestActor(c), async (ctx) => {
        const existing = await requireLockedLabRequest(id, member, ctx.o);

        if (
          !CALIBRATION_REQUEST_MACHINE.canTransition(existing.status, "review")
        ) {
          throw invalid(
            "request_status_invalid",
            "Somente solicitacoes pendentes podem entrar em revisao",
          );
        }

        const now = new Date();

        const [updated] = await ctx.o
          .update(calibrationRequest)
          .set({
            status: CALIBRATION_REQUEST_MACHINE.requireTargetOf(
              existing.status,
              "review",
            ),
            internalNotes: input.internalNotes || null,
            reviewedBy:
              existing.status === "UNDER_REVIEW"
                ? (existing.reviewedBy ?? ctx.actor.userId)
                : ctx.actor.userId,
            reviewedAt:
              existing.status === "UNDER_REVIEW"
                ? (existing.reviewedAt ?? now)
                : now,
          })
          .where(
            and(
              eq(calibrationRequest.id, id),
              eq(calibrationRequest.status, existing.status),
            ),
          )
          .returning();

        if (!updated) throw requestChangedByAnother();

        await ctx.audit("calibrationRequest", id, {
          action: "review",
          changes: {
            status: {
              old: existing.status,
              new: "UNDER_REVIEW",
            },
            internalNotes: input.internalNotes || null,
          },
        });

        if (existing.status === "PENDING") {
          ctx.afterCommit(() =>
            notifyCalibrationRequestUnderReview(id, ctx.actor.userId),
          );
        }
      });

      return c.json({ success: true });
    },
  )
  .post(
    "/:id/approve",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", ApproveCalibrationRequestSchema),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));
      const input = c.req.valid("json");

      await withOrg(member.organizationId, requestActor(c), async (ctx) => {
        const existing = await requireLockedLabRequest(id, member, ctx.o);

        if (
          !CALIBRATION_REQUEST_MACHINE.canTransition(existing.status, "approve")
        ) {
          throw invalid(
            "request_status_invalid",
            "Somente solicitacoes pendentes podem ser aprovadas",
          );
        }

        const now = new Date();

        const [updated] = await ctx.o
          .update(calibrationRequest)
          .set({
            status: CALIBRATION_REQUEST_MACHINE.requireTargetOf(
              existing.status,
              "approve",
            ),
            internalNotes: input.internalNotes || null,
            reviewedBy: existing.reviewedBy ?? ctx.actor.userId,
            reviewedAt: existing.reviewedAt ?? now,
            approvedBy: ctx.actor.userId,
            approvedAt: now,
            rejectedBy: null,
            rejectedAt: null,
            rejectionReason: null,
          })
          .where(
            and(
              eq(calibrationRequest.id, id),
              eq(calibrationRequest.status, existing.status),
            ),
          )
          .returning();

        if (!updated) throw requestChangedByAnother();

        await ctx.audit("calibrationRequest", id, {
          action: "approve",
          changes: {
            status: {
              old: existing.status,
              new: "APPROVED",
            },
            internalNotes: input.internalNotes || null,
          },
        });

        ctx.afterCommit(() =>
          notifyCalibrationRequestApproved(id, ctx.actor.userId),
        );
      });

      return c.json({ success: true });
    },
  )
  .post(
    "/:id/reject",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", RejectCalibrationRequestSchema),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));
      const input = c.req.valid("json");

      await withOrg(member.organizationId, requestActor(c), async (ctx) => {
        const existing = await requireLockedLabRequest(id, member, ctx.o);

        if (existing.status === "REJECTED") {
          throw invalid(
            "request_status_invalid",
            "Solicitacao ja foi rejeitada",
          );
        }

        if (existing.status === "CONVERTED") {
          throw invalid(
            "request_status_invalid",
            "Solicitacoes convertidas nao podem ser rejeitadas",
          );
        }
        // Every other status rejects (CALIBRATION_REQUEST_MACHINE `reject`).
        CALIBRATION_REQUEST_MACHINE.requireTargetOf(existing.status, "reject");

        const now = new Date();

        const [updated] = await ctx.o
          .update(calibrationRequest)
          .set({
            status: CALIBRATION_REQUEST_MACHINE.requireTargetOf(
              existing.status,
              "reject",
            ),
            internalNotes: input.internalNotes || null,
            reviewedBy: existing.reviewedBy ?? ctx.actor.userId,
            reviewedAt: existing.reviewedAt ?? now,
            rejectedBy: ctx.actor.userId,
            rejectedAt: now,
            rejectionReason: input.reason,
            approvedBy: null,
            approvedAt: null,
          })
          .where(
            and(
              eq(calibrationRequest.id, id),
              eq(calibrationRequest.status, existing.status),
            ),
          )
          .returning();

        if (!updated) throw requestChangedByAnother();

        await ctx.audit("calibrationRequest", id, {
          action: "reject",
          changes: {
            status: {
              old: existing.status,
              new: "REJECTED",
            },
            internalNotes: input.internalNotes || null,
          },
          reason: input.reason,
        });

        ctx.afterCommit(() =>
          notifyCalibrationRequestRejected(id, ctx.actor.userId, input.reason),
        );
      });

      return c.json({ success: true });
    },
  )
  .post(
    "/:id/convert",
    ...withLabPermission({
      request: ["convert"],
      calibration: ["create"],
    }),
    zValidator("json", ConvertCalibrationRequestSchema),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));
      const input = c.req.valid("json");

      const createdJobs = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const request = await requireLockedLabRequest(id, member, ctx.o);

          if (
            !CALIBRATION_REQUEST_MACHINE.canTransition(
              request.status,
              "convert",
            )
          ) {
            throw invalid(
              "request_status_invalid",
              "Somente solicitacoes aprovadas podem ser convertidas",
            );
          }

          const requestItems = await ctx.o
            .select({
              id: calibrationRequestItem.id,
              assetId: calibrationRequestItem.assetId,
              convertedJobId: calibrationRequestItem.convertedJobId,
            })
            .from(calibrationRequestItem)
            .where(
              and(
                eq(calibrationRequestItem.requestId, request.id),
                eq(
                  calibrationRequestItem.organizationId,
                  member.organizationId,
                ),
              ),
            )
            .orderBy(calibrationRequestItem.id);

          if (requestItems.some((item) => item.convertedJobId)) {
            throw invalid(
              "request_status_invalid",
              "Esta solicitacao ja possui itens convertidos",
            );
          }

          if (requestItems.length !== input.items.length) {
            throw invalid(
              "invalid_request",
              "Informe exatamente um mapeamento para cada item da solicitacao",
            );
          }

          const requestItemIds = new Set(requestItems.map((item) => item.id));
          if (!input.items.every((item) => requestItemIds.has(item.itemId))) {
            throw invalid(
              "invalid_request",
              "Um ou mais itens informados nao pertencem a esta solicitacao",
            );
          }

          const requestItemById = new Map(
            requestItems.map((item) => [item.id, item] as const),
          );
          const createdJobs: ConvertedRequestJob[] = [];

          // On-site requests pre-freeze each job's calibration location to the
          // customer's site so the technician doesn't re-enter it on execution.
          const onsiteLocation =
            request.deliveryMethod === "onsite"
              ? {
                  addressText: formatOnsiteAddressText(request.onsiteAddress),
                }
              : null;

          // On-site: create one visit for the whole conversion (the trip). The
          // lab can schedule it now (date + technician → CONFIRMED) or leave it
          // PROPOSED to schedule from the visits view later. Jobs link via visit_id.
          let visitId: number | null = null;
          let visitConfirmed = false;
          if (request.deliveryMethod === "onsite") {
            const scheduledAt = input.visit?.scheduledAt
              ? new Date(input.visit.scheduledAt)
              : null;
            const visitTechnicianId = input.visit?.technicianId ?? null;
            // The visit technician is a body-supplied user id: it must be a
            // member of this organization, assignable in the request's unit.
            if (
              visitTechnicianId &&
              !(await isAssignableTechnician(
                {
                  organizationId: member.organizationId,
                  userId: visitTechnicianId,
                  unitId: request.unitId,
                },
                ctx.o,
              ))
            ) {
              throw invalid(
                "technician_not_found",
                "Tecnico nao encontrado ou sem permissao",
              );
            }
            const scheduled = Boolean(scheduledAt && visitTechnicianId);
            const [visit] = await ctx.o
              .insert(calibrationVisit)
              .values({
                organizationId: member.organizationId,
                unitId: request.unitId,
                customerId: request.customerId,
                sourceRequestId: request.id,
                technicianId: visitTechnicianId,
                status: scheduled ? "CONFIRMED" : "PROPOSED",
                scheduledAt,
                address: request.onsiteAddress ?? null,
                createdBy: ctx.actor.userId,
                confirmedBy: scheduled ? ctx.actor.userId : null,
                confirmedAt: scheduled ? new Date() : null,
              })
              .returning();
            visitId = visit?.id ?? null;
            visitConfirmed = scheduled;
          }

          for (const item of input.items) {
            const requestItem = requestItemById.get(item.itemId);

            if (!requestItem) {
              throw invalid("invalid_request", "Item de solicitacao invalido");
            }

            let newJob;
            try {
              newJob = await createCalibrationJob({
                organizationId: member.organizationId,
                unitId: request.unitId,
                createdBy: ctx.actor.userId,
                assetId: requestItem.assetId,
                serviceId: item.serviceId,
                technicianId: item.technicianId,
                dueDate: item.dueDate,
                ipAddress: ctx.actor.ipAddress,
                sourceRequestId: request.id,
                sourceRequestItemId: requestItem.id,
                executor: ctx.tx,
                onsiteLocation,
                visitId,
              });
            } catch (error) {
              if (
                error instanceof Error &&
                jobCreationClientErrors.has(error.message)
              ) {
                throw invalid("invalid_request", error.message);
              }

              throw error;
            }

            createdJobs.push({
              requestItemId: requestItem.id,
              jobId: newJob.id,
              jobCode: newJob.jobId,
              status: newJob.status,
              technicianId: newJob.technicianId,
            });

            await ctx.o
              .update(calibrationRequestItem)
              .set({ convertedJobId: newJob.id })
              .where(
                and(
                  eq(calibrationRequestItem.id, requestItem.id),
                  eq(
                    calibrationRequestItem.organizationId,
                    member.organizationId,
                  ),
                ),
              );
          }

          await ctx.o
            .update(calibrationRequest)
            .set({
              status: CALIBRATION_REQUEST_MACHINE.requireTargetOf(
                request.status,
                "convert",
              ),
              convertedBy: ctx.actor.userId,
              convertedAt: new Date(),
            })
            // The row is locked (FOR UPDATE above); the status predicate
            // repeats the check the lock made safe.
            .where(
              and(
                eq(calibrationRequest.id, request.id),
                eq(calibrationRequest.status, request.status),
              ),
            );

          await ctx.audit("calibrationRequest", request.id, {
            action: "convert",
            changes: {
              jobs: createdJobs.map(
                ({ technicianId: _technicianId, ...job }) => job,
              ),
            },
          });

          for (const job of createdJobs) {
            const technicianId = job.technicianId;
            if (technicianId) {
              ctx.afterCommit(() =>
                notifyJobAssigned(job.jobId, technicianId, ctx.actor.userId),
              );
            }
          }
          ctx.afterCommit(() =>
            notifyCalibrationRequestConverted(
              id,
              ctx.actor.userId,
              createdJobs.map((job) => job.jobCode),
            ),
          );
          if (visitId !== null) {
            const convertedVisitId = visitId;
            ctx.afterCommit(async () => {
              await notifyVisitScheduled(convertedVisitId, ctx.actor.userId);
              if (visitConfirmed) {
                await notifyVisitConfirmed(convertedVisitId, ctx.actor.userId);
              }
            });
          }

          return createdJobs;
        },
      );

      return c.json({
        success: true,
        jobs: createdJobs.map(({ technicianId: _technicianId, ...job }) => job),
      });
    },
  );
