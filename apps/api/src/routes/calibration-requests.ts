import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { alias } from "drizzle-orm/pg-core";
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
  user,
} from "@calibra-facil/db/schema";
import {
  ApproveCalibrationRequestSchema,
  ConvertCalibrationRequestSchema,
  ListCalibrationRequestsQuerySchema,
  RejectCalibrationRequestSchema,
  ReviewCalibrationRequestSchema,
} from "@calibra-facil/schemas";
import { and, count, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { requirePlanLimit } from "../middleware/tier-guard";
import { createCalibrationJob, jobCreationClientErrors } from "../lib/jobs";
import { notifyJobAssigned } from "@calibra-facil/notifications";

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

type ApprovalRequestResult =
  | {
      success: true;
    }
  | {
      error: {
        status: 400 | 404 | 409;
        body: string;
      };
    };

type ReviewRequestResult =
  | {
      success: true;
    }
  | {
      error: {
        status: 400 | 404 | 409;
        body: string;
      };
    };

type RejectRequestResult =
  | {
      success: true;
    }
  | {
      error: {
        status: 400 | 404 | 409;
        body: string;
      };
    };

type ConvertRequestResult =
  | {
      createdJobs: ConvertedRequestJob[];
    }
  | {
      error: {
        status: 400 | 404;
        body: string;
      };
    };

class RequestTransitionError extends Error {
  status: 400 | 404 | 409;

  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
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
    .where(inArray(calibrationRequestItem.requestId, requestIds))
    .orderBy(calibrationRequestItem.id);
}

async function getRequestDetail(requestId: number, organizationId: string) {
  const [request] = await db
    .select({
      id: calibrationRequest.id,
      status: calibrationRequest.status,
      observations: calibrationRequest.observations,
      internalNotes: calibrationRequest.internalNotes,
      requestedDueDate: calibrationRequest.requestedDueDate,
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
      ),
    )
    .limit(1);

  if (!request) {
    return null;
  }

  const items = await getRequestItems([request.id]);

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
        conditions.push(lte(calibrationRequest.submittedAt, new Date(dateTo)));
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
  .get("/:id", ...withLabPermission({ request: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      return c.json({ error: "ID invalido" }, 400);
    }

    const request = await getRequestDetail(id, member.organizationId);

    if (!request) {
      return c.json({ error: "Solicitacao nao encontrada" }, 404);
    }

    return c.json(request);
  })
  .post(
    "/:id/review",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", ReviewCalibrationRequestSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const result: ReviewRequestResult = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            id: calibrationRequest.id,
            status: calibrationRequest.status,
          })
          .from(calibrationRequest)
          .where(
            and(
              eq(calibrationRequest.id, id),
              eq(calibrationRequest.organizationId, member.organizationId),
            ),
          )
          .limit(1)
          .for("update");

        if (!existing) {
          return {
            error: {
              status: 404 as const,
              body: "Solicitacao nao encontrada",
            },
          };
        }

        if (!["PENDING", "UNDER_REVIEW"].includes(existing.status)) {
          return {
            error: {
              status: 400 as const,
              body: "Somente solicitacoes pendentes podem entrar em revisao",
            },
          };
        }

        const [updated] = await tx
          .update(calibrationRequest)
          .set({
            status: "UNDER_REVIEW",
            internalNotes: input.internalNotes || null,
            reviewedBy: session.user.id,
            reviewedAt: new Date(),
          })
          .where(
            and(
              eq(calibrationRequest.id, id),
              eq(calibrationRequest.status, existing.status),
            ),
          )
          .returning();

        if (!updated) {
          return {
            error: {
              status: 409 as const,
              body: "Solicitacao foi atualizada por outro usuario",
            },
          };
        }

        await tx.insert(calibrationRequestAuditLog).values({
          requestId: id,
          action: "review",
          changes: {
            status: {
              old: existing.status,
              new: "UNDER_REVIEW",
            },
            internalNotes: input.internalNotes || null,
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") ?? null,
        });

        return { success: true };
      });

      if ("error" in result) {
        return c.json({ error: result.error.body }, result.error.status);
      }

      return c.json({ success: true });
    },
  )
  .post(
    "/:id/approve",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", ApproveCalibrationRequestSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const result: ApprovalRequestResult = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            id: calibrationRequest.id,
            status: calibrationRequest.status,
            reviewedBy: calibrationRequest.reviewedBy,
            reviewedAt: calibrationRequest.reviewedAt,
          })
          .from(calibrationRequest)
          .where(
            and(
              eq(calibrationRequest.id, id),
              eq(calibrationRequest.organizationId, member.organizationId),
            ),
          )
          .limit(1)
          .for("update");

        if (!existing) {
          return {
            error: {
              status: 404 as const,
              body: "Solicitacao nao encontrada",
            },
          };
        }

        if (!["PENDING", "UNDER_REVIEW"].includes(existing.status)) {
          return {
            error: {
              status: 400 as const,
              body: "Somente solicitacoes pendentes podem ser aprovadas",
            },
          };
        }

        const now = new Date();

        const [updated] = await tx
          .update(calibrationRequest)
          .set({
            status: "APPROVED",
            internalNotes: input.internalNotes || null,
            reviewedBy: existing.reviewedBy ?? session.user.id,
            reviewedAt: existing.reviewedAt ?? now,
            approvedBy: session.user.id,
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

        if (!updated) {
          return {
            error: {
              status: 409 as const,
              body: "Solicitacao foi atualizada por outro usuario",
            },
          };
        }

        await tx.insert(calibrationRequestAuditLog).values({
          requestId: id,
          action: "approve",
          changes: {
            status: {
              old: existing.status,
              new: "APPROVED",
            },
            internalNotes: input.internalNotes || null,
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") ?? null,
        });

        return { success: true };
      });

      if ("error" in result) {
        return c.json({ error: result.error.body }, result.error.status);
      }

      return c.json({ success: true });
    },
  )
  .post(
    "/:id/reject",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", RejectCalibrationRequestSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const result: RejectRequestResult = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            id: calibrationRequest.id,
            status: calibrationRequest.status,
            reviewedBy: calibrationRequest.reviewedBy,
            reviewedAt: calibrationRequest.reviewedAt,
          })
          .from(calibrationRequest)
          .where(
            and(
              eq(calibrationRequest.id, id),
              eq(calibrationRequest.organizationId, member.organizationId),
            ),
          )
          .limit(1)
          .for("update");

        if (!existing) {
          return {
            error: {
              status: 404 as const,
              body: "Solicitacao nao encontrada",
            },
          };
        }

        if (existing.status === "REJECTED") {
          return {
            error: {
              status: 400 as const,
              body: "Solicitacao ja foi rejeitada",
            },
          };
        }

        if (existing.status === "CONVERTED") {
          return {
            error: {
              status: 400 as const,
              body: "Solicitacoes convertidas nao podem ser rejeitadas",
            },
          };
        }

        const now = new Date();

        const [updated] = await tx
          .update(calibrationRequest)
          .set({
            status: "REJECTED",
            internalNotes: input.internalNotes || null,
            reviewedBy: existing.reviewedBy ?? session.user.id,
            reviewedAt: existing.reviewedAt ?? now,
            rejectedBy: session.user.id,
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

        if (!updated) {
          return {
            error: {
              status: 409 as const,
              body: "Solicitacao foi atualizada por outro usuario",
            },
          };
        }

        await tx.insert(calibrationRequestAuditLog).values({
          requestId: id,
          action: "reject",
          changes: {
            status: {
              old: existing.status,
              new: "REJECTED",
            },
            internalNotes: input.internalNotes || null,
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") ?? null,
          reason: input.reason,
        });

        return { success: true };
      });

      if ("error" in result) {
        return c.json({ error: result.error.body }, result.error.status);
      }

      return c.json({ success: true });
    },
  )
  .post(
    "/:id/convert",
    ...withLabPermission({
      request: ["convert"],
      calibration: ["create"],
    }),
    requirePlanLimit("certificates"),
    zValidator("json", ConvertCalibrationRequestSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");
      const ipAddress = c.req.header("x-forwarded-for") ?? null;

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      let result: ConvertRequestResult;
      try {
        result = await db.transaction(async (tx) => {
          const [request] = await tx
            .select({
              id: calibrationRequest.id,
              status: calibrationRequest.status,
              customerId: calibrationRequest.customerId,
            })
            .from(calibrationRequest)
            .where(
              and(
                eq(calibrationRequest.id, id),
                eq(calibrationRequest.organizationId, member.organizationId),
              ),
            )
            .limit(1)
            .for("update");

          if (!request) {
            return {
              error: {
                status: 404 as const,
                body: "Solicitacao nao encontrada",
              },
            };
          }

          if (request.status !== "APPROVED") {
            return {
              error: {
                status: 400 as const,
                body: "Somente solicitacoes aprovadas podem ser convertidas",
              },
            };
          }

          const requestItems = await tx
            .select({
              id: calibrationRequestItem.id,
              assetId: calibrationRequestItem.assetId,
              convertedJobId: calibrationRequestItem.convertedJobId,
            })
            .from(calibrationRequestItem)
            .where(eq(calibrationRequestItem.requestId, request.id))
            .orderBy(calibrationRequestItem.id);

          if (requestItems.some((item) => item.convertedJobId)) {
            return {
              error: {
                status: 400 as const,
                body: "Esta solicitacao ja possui itens convertidos",
              },
            };
          }

          if (requestItems.length !== input.items.length) {
            return {
              error: {
                status: 400 as const,
                body: "Informe exatamente um mapeamento para cada item da solicitacao",
              },
            };
          }

          const requestItemIds = new Set(requestItems.map((item) => item.id));
          if (!input.items.every((item) => requestItemIds.has(item.itemId))) {
            return {
              error: {
                status: 400 as const,
                body: "Um ou mais itens informados nao pertencem a esta solicitacao",
              },
            };
          }

          const requestItemById = new Map(
            requestItems.map((item) => [item.id, item] as const),
          );
          const createdJobs: ConvertedRequestJob[] = [];

          for (const item of input.items) {
            const requestItem = requestItemById.get(item.itemId);

            if (!requestItem) {
              throw new RequestTransitionError(400, "Item de solicitacao invalido");
            }

            let newJob;
            try {
              newJob = await createCalibrationJob({
                organizationId: member.organizationId,
                createdBy: session.user.id,
                assetId: requestItem.assetId,
                serviceId: item.serviceId,
                technicianId: item.technicianId,
                dueDate: item.dueDate,
                ipAddress,
                sourceRequestId: request.id,
                sourceRequestItemId: requestItem.id,
                executor: tx,
                notifyOnAssignment: false,
              });
            } catch (error) {
              if (
                error instanceof Error &&
                jobCreationClientErrors.has(error.message)
              ) {
                throw new RequestTransitionError(400, error.message);
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

            await tx
              .update(calibrationRequestItem)
              .set({ convertedJobId: newJob.id })
              .where(eq(calibrationRequestItem.id, requestItem.id));
          }

          await tx
            .update(calibrationRequest)
            .set({
              status: "CONVERTED",
              convertedBy: session.user.id,
              convertedAt: new Date(),
            })
            .where(eq(calibrationRequest.id, request.id));

          await tx.insert(calibrationRequestAuditLog).values({
            requestId: request.id,
            action: "convert",
            changes: {
              jobs: createdJobs.map(({ technicianId: _technicianId, ...job }) => job),
            },
            performedBy: session.user.id,
            ipAddress,
          });

          return { createdJobs };
        });
      } catch (error) {
        if (error instanceof RequestTransitionError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }

      if ("error" in result) {
        return c.json({ error: result.error.body }, result.error.status);
      }

      for (const job of result.createdJobs) {
        if (!job.technicianId) continue;

        try {
          await notifyJobAssigned(job.jobId, job.technicianId, session.user.id);
        } catch (error) {
          console.error("[Calibration Requests] Failed to send assignment notification:", error);
        }
      }

      return c.json({
        success: true,
        jobs: result.createdJobs.map(({ technicianId: _technicianId, ...job }) => job),
      });
    },
  );
