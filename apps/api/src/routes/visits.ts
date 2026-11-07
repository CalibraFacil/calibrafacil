import { createRouter } from "../server/router";
import { zValidator } from "@hono/zod-validator";
import { alias } from "drizzle-orm/pg-core";
import {
  and,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  VISIT_MACHINE,
  VISIT_RESCHEDULE_REQUEST_MACHINE,
  isVisitTerminal,
} from "@calibra-facil/schemas/machines";
import { conflict, invalid, notFound } from "../lib/domain-errors";
import {
  asset,
  calibrationJob,
  calibrationVisit,
  customer,
  user,
  visitRescheduleRequest,
} from "@calibra-facil/db/schema";
import {
  AcceptVisitRescheduleRequestSchema,
  AddVisitJobSchema,
  AssignVisitTechnicianSchema,
  CancelVisitSchema,
  ConfirmVisitSchema,
  DeclineVisitRescheduleRequestSchema,
  ListVisitsQuerySchema,
  RescheduleVisitSchema,
} from "@calibra-facil/schemas";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { buildUnitScopeCondition } from "../lib/units";
import { orgDb } from "../lib/org-db";
import { withOrg } from "../lib/org-context";
import { requestActor } from "../middleware/request-actor";
import { requireRouteId } from "../lib/route-id";
import { requireScopedVisit } from "../lib/visit-access";
import { isAssignableTechnician } from "../lib/tenant-refs";
import {
  notifyVisitCancelled,
  notifyVisitConfirmed,
  notifyVisitRescheduleDeclined,
  notifyVisitRescheduled,
  notifyVisitScheduled,
} from "@calibra-facil/notifications";
import { cancelJob } from "../modules/jobs/cancel-job";
import { createCalibrationJob, jobCreationClientErrors } from "../lib/jobs";
import { formatOnsiteAddressText } from "../lib/onsite-address";
import { jobStatusConflict } from "../modules/jobs/job-status-transitions";
import {
  assertAssetBelongsToVisitCustomer,
  assertGuard,
  canAddJobToVisit,
  resolveVisitJobRemoval,
} from "../lib/visit-jobs";

const technicianUser = alias(user, "calibrationVisitTechnician");

/**
 * On-site (calibração in loco) visits — one scheduled technician trip covering
 * many instruments. The customer proposes a date on the request; the lab
 * confirms + assigns a technician here. Technicians read their own trips via the
 * `mine` filter ("Minhas visitas"); the actual calibration uses the existing job
 * execute flow (each job links back via visit_id, location pre-frozen).
 */

/** A visit the lab can no longer edit (VISIT_MACHINE: no `edit` from it). */
const isTerminal = isVisitTerminal;

/** A compare-and-set on the visit's status matched no row: it moved under the caller. */
const VISIT_STATUS_CHANGED =
  "A visita mudou durante a operacao. Recarregue e tente novamente.";

/**
 * The technician named in the body must be a member of the caller's
 * organization who can work in the visit's unit (same rule as
 * `POST /jobs/:id/assign`). One generic answer for "does not exist" and "belongs
 * to another tenant" so the response is not an existence oracle for user ids.
 */
const TECHNICIAN_REFUSED = "Tecnico nao encontrado ou sem permissao";

/** The visit can still be edited: VISIT_MACHINE has no `edit` from a terminal one. */
function assertVisitOpen(status: string) {
  if (isTerminal(status)) {
    throw conflict("visit_closed", "Visita ja finalizada ou cancelada");
  }
}

/**
 * #739: reset of the customer's acknowledgement when the visit date moves —
 * the customer confirmed a *specific* date, so a new date needs a new
 * confirmation. Spread into the caller's `.set()`.
 */
const RESET_CUSTOMER_CONFIRMATION = {
  customerConfirmedBy: null,
  customerConfirmedAt: null,
};

/**
 * #739: a lab-driven date change supersedes any PENDING customer reschedule
 * request — in the caller's transaction, so a lab reschedule can never race a
 * pending request into a stale state.
 */
async function supersedePendingRescheduleRequests(
  tx: Pick<OrgDb, "update">,
  visitId: number,
  actorUserId: string,
) {
  await tx
    .update(visitRescheduleRequest)
    .set({
      status: "SUPERSEDED",
      resolvedBy: actorUserId,
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(visitRescheduleRequest.visitId, visitId),
        inArray(
          visitRescheduleRequest.status,
          VISIT_RESCHEDULE_REQUEST_MACHINE.allowedFrom("supersede"),
        ),
      ),
    );
}

export const visitsRouter = createRouter<{ Variables: AuthVariables }>()
  // ===========================================================================
  // GET / — list visits (status / technician / date filters; `mine` for técnico)
  // ===========================================================================
  .get(
    "/",
    ...withLabPermission({ request: ["read"] }),
    zValidator("query", ListVisitsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const {
        page,
        limit,
        status,
        technicianId,
        dateFrom,
        dateTo,
        mine,
        rescheduleRequested,
      } = c.req.valid("query");
      const offset = (page - 1) * limit;

      return await orgDb(member.organizationId).transaction(async (o) => {
        const conditions = [
          eq(calibrationVisit.organizationId, member.organizationId),
          buildUnitScopeCondition(calibrationVisit.unitId, member),
        ];
        if (status) conditions.push(eq(calibrationVisit.status, status));
        if (mine) {
          conditions.push(eq(calibrationVisit.technicianId, session.user.id));
        } else if (technicianId) {
          conditions.push(eq(calibrationVisit.technicianId, technicianId));
        }
        if (dateFrom) {
          conditions.push(
            gte(calibrationVisit.scheduledAt, new Date(dateFrom)),
          );
        }
        if (dateTo) {
          conditions.push(lte(calibrationVisit.scheduledAt, new Date(dateTo)));
        }
        if (rescheduleRequested) {
          conditions.push(
            exists(
              o
                .select({ one: sql`1` })
                .from(visitRescheduleRequest)
                .where(
                  and(
                    eq(visitRescheduleRequest.visitId, calibrationVisit.id),
                    eq(visitRescheduleRequest.status, "PENDING"),
                  ),
                ),
            ),
          );
        }
        const where = and(...conditions);

        const [countResult] = await o
          .select({ total: count() })
          .from(calibrationVisit)
          .where(where);

        const visits = await o
          .select({
            id: calibrationVisit.id,
            status: calibrationVisit.status,
            scheduledAt: calibrationVisit.scheduledAt,
            address: calibrationVisit.address,
            customerId: calibrationVisit.customerId,
            customerName: customer.name,
            technicianId: calibrationVisit.technicianId,
            technicianName: technicianUser.name,
            sourceRequestId: calibrationVisit.sourceRequestId,
            createdAt: calibrationVisit.createdAt,
            customerConfirmedAt: calibrationVisit.customerConfirmedAt,
          })
          .from(calibrationVisit)
          .innerJoin(customer, eq(calibrationVisit.customerId, customer.id))
          .leftJoin(
            technicianUser,
            eq(calibrationVisit.technicianId, technicianUser.id),
          )
          .where(where)
          .orderBy(
            desc(calibrationVisit.scheduledAt),
            desc(calibrationVisit.id),
          )
          .limit(limit)
          .offset(offset);

        // Asset count per visit (one job per asset).
        const visitIds = visits.map((visit) => visit.id);
        const jobCounts =
          visitIds.length > 0
            ? await o
                .select({
                  visitId: calibrationJob.visitId,
                  total: count(),
                })
                .from(calibrationJob)
                .where(inArray(calibrationJob.visitId, visitIds))
                .groupBy(calibrationJob.visitId)
            : [];
        const assetCountByVisit = new Map(
          jobCounts.map((row) => [row.visitId, row.total] as const),
        );

        // #739: badge visits with a pending customer reschedule request.
        const pendingReschedules =
          visitIds.length > 0
            ? await o
                .select({ visitId: visitRescheduleRequest.visitId })
                .from(visitRescheduleRequest)
                .where(
                  and(
                    inArray(visitRescheduleRequest.visitId, visitIds),
                    eq(visitRescheduleRequest.status, "PENDING"),
                  ),
                )
            : [];
        const pendingRescheduleVisitIds = new Set(
          pendingReschedules.map((row) => row.visitId),
        );

        return c.json({
          data: visits.map((visit) => ({
            ...visit,
            assetCount: assetCountByVisit.get(visit.id) ?? 0,
            rescheduleRequested: pendingRescheduleVisitIds.has(visit.id),
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
  // ===========================================================================
  // GET /:id — one visit with its linked jobs/assets
  // ===========================================================================
  .get("/:id", ...withLabPermission({ request: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = requireRouteId(c.req.param("id"));

    return await orgDb(member.organizationId).transaction(async (o) => {
      const [visit] = await o
        .select({
          id: calibrationVisit.id,
          status: calibrationVisit.status,
          scheduledAt: calibrationVisit.scheduledAt,
          scheduledEndAt: calibrationVisit.scheduledEndAt,
          address: calibrationVisit.address,
          notes: calibrationVisit.notes,
          customerId: calibrationVisit.customerId,
          customerName: customer.name,
          technicianId: calibrationVisit.technicianId,
          technicianName: technicianUser.name,
          sourceRequestId: calibrationVisit.sourceRequestId,
          createdAt: calibrationVisit.createdAt,
          confirmedAt: calibrationVisit.confirmedAt,
          cancelledAt: calibrationVisit.cancelledAt,
          cancelReason: calibrationVisit.cancelReason,
          customerConfirmedAt: calibrationVisit.customerConfirmedAt,
        })
        .from(calibrationVisit)
        .innerJoin(customer, eq(calibrationVisit.customerId, customer.id))
        .leftJoin(
          technicianUser,
          eq(calibrationVisit.technicianId, technicianUser.id),
        )
        .where(
          and(
            eq(calibrationVisit.id, id),
            eq(calibrationVisit.organizationId, member.organizationId),
            buildUnitScopeCondition(calibrationVisit.unitId, member),
          ),
        )
        .limit(1);

      if (!visit) throw notFound("visit_not_found", "Visita nao encontrada");

      const jobs = await o
        .select({
          jobId: calibrationJob.id,
          jobCode: calibrationJob.jobId,
          status: calibrationJob.status,
          assetName: asset.name,
          assetTag: asset.tag,
        })
        .from(calibrationJob)
        .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
        .where(eq(calibrationJob.visitId, id))
        .orderBy(calibrationJob.id);

      // #739: pending customer reschedule request (feeds the detail banner).
      const [pendingReschedule] = await o
        .select({
          id: visitRescheduleRequest.id,
          reason: visitRescheduleRequest.reason,
          preferredWindows: visitRescheduleRequest.preferredWindows,
          createdAt: visitRescheduleRequest.createdAt,
          requestedByName: user.name,
        })
        .from(visitRescheduleRequest)
        .leftJoin(user, eq(visitRescheduleRequest.requestedBy, user.id))
        .where(
          and(
            eq(visitRescheduleRequest.visitId, id),
            eq(visitRescheduleRequest.status, "PENDING"),
          ),
        )
        .limit(1);

      return c.json({
        ...visit,
        jobs,
        pendingRescheduleRequest: pendingReschedule ?? null,
      });
    });
  })
  // ===========================================================================
  // POST /:id/assign — assign / reassign the technician
  // ===========================================================================
  .post(
    "/:id/assign",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", AssignVisitTechnicianSchema),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));
      const { technicianId } = c.req.valid("json");

      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const visit = await requireScopedVisit(id, member, ctx.o);
          assertVisitOpen(visit.status);
          if (
            technicianId !== visit.technicianId &&
            !(await isAssignableTechnician(
              {
                organizationId: member.organizationId,
                userId: technicianId,
                unitId: visit.unitId,
              },
              ctx.o,
            ))
          ) {
            throw invalid("technician_not_found", TECHNICIAN_REFUSED);
          }

          const [updated] = await ctx.o
            .update(calibrationVisit)
            .set({ technicianId })
            .where(
              and(
                eq(calibrationVisit.id, id),
                eq(calibrationVisit.status, visit.status),
              ),
            )
            .returning();
          if (!updated) {
            throw conflict("status_transition_conflict", VISIT_STATUS_CHANGED);
          }

          if (technicianId !== visit.technicianId) {
            ctx.afterCommit(() => notifyVisitScheduled(id, ctx.actor.userId));
          }
          return updated;
        },
      );

      return c.json(updated);
    },
  )
  // ===========================================================================
  // POST /:id/confirm — confirm the visit (optionally set date/technician)
  // ===========================================================================
  .post(
    "/:id/confirm",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", ConfirmVisitSchema),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));
      const input = c.req.valid("json");

      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const visit = await requireScopedVisit(id, member, ctx.o);
          assertVisitOpen(visit.status);

          const scheduledAt = input.scheduledAt
            ? new Date(input.scheduledAt)
            : visit.scheduledAt;
          const technicianId = input.technicianId ?? visit.technicianId;
          if (!scheduledAt || !technicianId) {
            throw invalid(
              "invalid_request",
              "Defina a data e o técnico para confirmar a visita",
            );
          }
          if (
            technicianId !== visit.technicianId &&
            !(await isAssignableTechnician(
              {
                organizationId: member.organizationId,
                userId: technicianId,
                unitId: visit.unitId,
              },
              ctx.o,
            ))
          ) {
            throw invalid("technician_not_found", TECHNICIAN_REFUSED);
          }

          const confirmDateChanged =
            scheduledAt.getTime() !== visit.scheduledAt?.getTime();

          const [updated] = await ctx.o
            .update(calibrationVisit)
            .set({
              // `confirm`: a proposed visit becomes CONFIRMED; a confirmed or
              // started one keeps its status (only the date/technician change).
              status: VISIT_MACHINE.requireTargetOf(visit.status, "confirm"),
              scheduledAt,
              technicianId,
              confirmedBy: ctx.actor.userId,
              confirmedAt: new Date(),
              ...(confirmDateChanged ? RESET_CUSTOMER_CONFIRMATION : {}),
            })
            .where(
              and(
                eq(calibrationVisit.id, id),
                eq(calibrationVisit.status, visit.status),
              ),
            )
            .returning();
          if (!updated) {
            throw conflict("status_transition_conflict", VISIT_STATUS_CHANGED);
          }

          if (confirmDateChanged) {
            await supersedePendingRescheduleRequests(
              ctx.o,
              id,
              ctx.actor.userId,
            );
          }

          ctx.afterCommit(async () => {
            await notifyVisitConfirmed(id, ctx.actor.userId);
            if (technicianId !== visit.technicianId) {
              await notifyVisitScheduled(id, ctx.actor.userId);
            }
          });
          return updated;
        },
      );

      return c.json(updated);
    },
  )
  // ===========================================================================
  // PATCH /:id — reschedule date / address / notes
  // ===========================================================================
  .patch(
    "/:id",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", RescheduleVisitSchema),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));
      const input = c.req.valid("json");

      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const visit = await requireScopedVisit(id, member, ctx.o);
          assertVisitOpen(visit.status);

          const nextScheduledAt = input.scheduledAt
            ? new Date(input.scheduledAt)
            : visit.scheduledAt;
          const dateChanged =
            nextScheduledAt?.getTime() !== visit.scheduledAt?.getTime();

          const [updated] = await ctx.o
            .update(calibrationVisit)
            .set({
              scheduledAt: nextScheduledAt,
              scheduledEndAt: input.scheduledEndAt
                ? new Date(input.scheduledEndAt)
                : visit.scheduledEndAt,
              address: input.address ?? visit.address,
              notes: input.notes ?? visit.notes,
              ...(dateChanged ? RESET_CUSTOMER_CONFIRMATION : {}),
            })
            .where(
              and(
                eq(calibrationVisit.id, id),
                eq(calibrationVisit.status, visit.status),
              ),
            )
            .returning();
          if (!updated) {
            throw conflict("status_transition_conflict", VISIT_STATUS_CHANGED);
          }

          if (dateChanged) {
            await supersedePendingRescheduleRequests(
              ctx.o,
              id,
              ctx.actor.userId,
            );
            ctx.afterCommit(() => notifyVisitRescheduled(id, ctx.actor.userId));
          }
          return updated;
        },
      );

      return c.json(updated);
    },
  )
  // ===========================================================================
  // POST /:id/cancel — cancel the visit
  // ===========================================================================
  .post(
    "/:id/cancel",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", CancelVisitSchema),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));
      const { reason } = c.req.valid("json");

      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const visit = await requireScopedVisit(id, member, ctx.o);
          assertVisitOpen(visit.status);

          const [updated] = await ctx.o
            .update(calibrationVisit)
            .set({
              status: VISIT_MACHINE.requireTargetOf(visit.status, "cancel"),
              cancelledBy: ctx.actor.userId,
              cancelledAt: new Date(),
              cancelReason: reason ?? null,
            })
            .where(
              and(
                eq(calibrationVisit.id, id),
                eq(calibrationVisit.status, visit.status),
              ),
            )
            .returning();
          if (!updated) {
            throw conflict("status_transition_conflict", VISIT_STATUS_CHANGED);
          }
          // A cancelled trip has no date to move: its pending customer request
          // is superseded with it.
          await supersedePendingRescheduleRequests(ctx.o, id, ctx.actor.userId);

          ctx.afterCommit(() =>
            notifyVisitCancelled(id, ctx.actor.userId, reason ?? undefined),
          );
          return updated;
        },
      );

      return c.json(updated);
    },
  )
  // ===========================================================================
  // POST /:id/complete — mark the trip done (operator closes it out)
  // ===========================================================================
  .post(
    "/:id/complete",
    ...withLabPermission({ request: ["update"] }),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));

      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const visit = await requireScopedVisit(id, member, ctx.o);
          assertVisitOpen(visit.status);
          if (!VISIT_MACHINE.canTransition(visit.status, "complete")) {
            throw conflict(
              "status_transition_conflict",
              "Confirme a visita antes de concluí-la",
            );
          }

          const [updated] = await ctx.o
            .update(calibrationVisit)
            .set({
              status: VISIT_MACHINE.requireTargetOf(visit.status, "complete"),
            })
            .where(
              and(
                eq(calibrationVisit.id, id),
                eq(calibrationVisit.status, visit.status),
              ),
            )
            .returning();
          if (!updated) {
            throw conflict("status_transition_conflict", VISIT_STATUS_CHANGED);
          }
          await supersedePendingRescheduleRequests(ctx.o, id, ctx.actor.userId);
          return updated;
        },
      );

      return c.json(updated);
    },
  );

/**
 * Visit-jobs sub-router — mounted separately to avoid Hono type chain length
 * limits (TS7056) on the main visitsRouter.
 *
 * REQ-VISITJOB-001,002,003,004,005,006,007,008,009,010
 */
export const visitJobsRouter = createRouter<{ Variables: AuthVariables }>()
  // ===========================================================================
  // POST /:id/jobs — add an instrument (calibration job) to a PROPOSED visit
  // ===========================================================================
  .post(
    "/:id/jobs",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", AddVisitJobSchema),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));
      const { assetId, serviceId } = c.req.valid("json");

      // One organization-named transaction: the visit and asset guards, and
      // the job it creates, commit together. Job creation still takes a
      // Drizzle executor with `execute` (the numbering locks), hence `ctx.tx`.
      const newJob = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          // REQ-VISITJOB-005: scope via requireScopedVisit (org+unit scoped)
          const visit = await requireScopedVisit(id, member, ctx.o);

          // REQ-VISITJOB-003: visit must be PROPOSED
          assertGuard(canAddJobToVisit(visit));

          // REQ-VISITJOB-004: asset must belong to visit's customer (scope via customer.labOrganizationId)
          const [foundAsset] = await ctx.o
            .select({ id: asset.id, customerId: asset.customerId })
            .from(asset)
            .innerJoin(customer, eq(asset.customerId, customer.id))
            .where(
              and(
                eq(asset.id, assetId),
                eq(customer.labOrganizationId, member.organizationId),
              ),
            )
            .limit(1);

          if (!foundAsset) {
            throw invalid("asset_not_found", "Ativo nao encontrado");
          }

          assertGuard(assertAssetBelongsToVisitCustomer(foundAsset, visit));

          // REQ-VISITJOB-001,002: create job via createCalibrationJob with onsiteLocation
          try {
            return await createCalibrationJob({
              organizationId: member.organizationId,
              unitId: visit.unitId,
              createdBy: ctx.actor.userId,
              assetId,
              serviceId,
              onsiteLocation: {
                addressText: formatOnsiteAddressText(visit.address),
              },
              visitId: id,
              executor: ctx.tx,
            });
          } catch (error) {
            if (
              error instanceof Error &&
              jobCreationClientErrors.has(error.message)
            ) {
              // Thrown out of the door: nothing of the refused job stays.
              throw invalid("invalid_request", error.message);
            }
            throw error;
          }
        },
      );

      return c.json(newJob, 201);
    },
  )
  // ===========================================================================
  // DELETE /:id/jobs/:jobId — remove (soft-cancel) a DRAFT job from a PROPOSED visit
  // ===========================================================================
  .delete(
    "/:id/jobs/:jobId",
    ...withLabPermission({ request: ["update"] }),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));
      const jobId = requireRouteId(c.req.param("jobId"));

      const job = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          // REQ-VISITJOB-005: scope via requireScopedVisit
          const visit = await requireScopedVisit(id, member, ctx.o);

          // Load the job scoped to org
          const [foundJob] = await ctx.o
            .select({
              id: calibrationJob.id,
              status: calibrationJob.status,
              visitId: calibrationJob.visitId,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.id, jobId),
                eq(calibrationJob.organizationId, member.organizationId),
              ),
            )
            .limit(1);

          // REQ-VISITJOB-006,007,008,009: run all guards
          assertGuard(
            resolveVisitJobRemoval({
              visitStatus: visit.status,
              job: foundJob ?? null,
              visitId: id,
            }),
          );
          // The guard already rejects a missing job with 404; narrow for TS.
          if (!foundJob) {
            throw notFound("job_not_found", "Job nao encontrado nesta visita");
          }

          // REQ-VISITJOB-006: soft-cancel (CANCELED with single L per JobStatus
          // enum). The guards above allow DRAFT only; `cancelJob` keeps the
          // transition table as the final word, pins the status the guards
          // validated (a job that moved meanwhile is a 409) and commits the audit
          // row (append-only ISO 17025 trail, parity with the main job-cancel
          // route) with the write.
          // The command reads and writes on the door's transaction; its
          // compare-and-set keeps guarding the status.
          const result = await cancelJob(ctx, {
            actor: {
              kind: "user",
              userId: ctx.actor.userId,
              ipAddress: ctx.actor.ipAddress,
            },
            jobId,
            organizationId: member.organizationId,
            // The visit was scoped above (requireScopedVisit) and the removal
            // guard checked that the job belongs to it.
            unitScope: null,
            reason: `Instrumento removido da visita #${id}`,
            expectedStatus: foundJob.status,
          });
          switch (result.status) {
            case "not_found":
              throw notFound(
                "job_not_found",
                "Job nao encontrado nesta visita",
              );
            case "illegal_transition":
              throw conflict(
                "job_not_cancelable",
                "Apenas jobs com status DRAFT podem ser removidos da visita",
              );
            case "concurrent_update":
              throw await jobStatusConflict(jobId, ctx.o);
            case "ok":
              return result.job;
          }
        },
      );

      return c.json(job);
    },
  );

/** Load a reschedule request that belongs to the given visit (any status). */
async function requireVisitRescheduleRequest(
  requestId: number,
  visitId: number,
  o: Pick<OrgDb, "select">,
) {
  const [request] = await o
    .select()
    .from(visitRescheduleRequest)
    .where(
      and(
        eq(visitRescheduleRequest.id, requestId),
        eq(visitRescheduleRequest.visitId, visitId),
      ),
    )
    .limit(1);
  if (!request) {
    throw notFound(
      "visit_reschedule_request_not_found",
      "Solicitacao nao encontrada",
    );
  }
  return request;
}

const RESCHEDULE_REQUEST_RESOLVED = "Solicitacao ja resolvida";

/**
 * #739: lab resolution of customer reschedule requests. Mounted separately
 * (like visitJobsRouter) to keep the main visitsRouter under Hono's type
 * chain limits (TS7056).
 */
export const visitRescheduleRequestsRouter = createRouter<{
  Variables: AuthVariables;
}>()
  // ===========================================================================
  // POST /:id/reschedule-requests/:requestId/accept — move the visit to the
  // agreed date and close the request. Fires the existing reschedule
  // notification toward technician + customer.
  // ===========================================================================
  .post(
    "/:id/reschedule-requests/:requestId/accept",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", AcceptVisitRescheduleRequestSchema),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));
      const requestId = requireRouteId(c.req.param("requestId"));
      const input = c.req.valid("json");

      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const visit = await requireScopedVisit(id, member, ctx.o);
          assertVisitOpen(visit.status);

          const request = await requireVisitRescheduleRequest(
            requestId,
            id,
            ctx.o,
          );
          if (
            !VISIT_RESCHEDULE_REQUEST_MACHINE.canTransition(
              request.status,
              "accept",
            )
          ) {
            throw conflict(
              "status_transition_conflict",
              RESCHEDULE_REQUEST_RESOLVED,
            );
          }

          const nextScheduledAt = new Date(input.scheduledAt);
          const [row] = await ctx.o
            .update(calibrationVisit)
            .set({
              scheduledAt: nextScheduledAt,
              scheduledEndAt: input.scheduledEndAt
                ? new Date(input.scheduledEndAt)
                : null,
              ...RESET_CUSTOMER_CONFIRMATION,
            })
            .where(
              and(
                eq(calibrationVisit.id, id),
                eq(calibrationVisit.status, visit.status),
              ),
            )
            .returning();
          if (!row) {
            throw conflict("status_transition_conflict", VISIT_STATUS_CHANGED);
          }

          const [accepted] = await ctx.o
            .update(visitRescheduleRequest)
            .set({
              status: VISIT_RESCHEDULE_REQUEST_MACHINE.requireTargetOf(
                request.status,
                "accept",
              ),
              resolvedBy: ctx.actor.userId,
              resolvedAt: new Date(),
              resolutionNote: input.resolutionNote ?? null,
            })
            .where(
              and(
                eq(visitRescheduleRequest.id, requestId),
                eq(visitRescheduleRequest.status, request.status),
              ),
            )
            .returning({ id: visitRescheduleRequest.id });
          // The request was resolved under the caller: throwing rolls the
          // visit's new date back too.
          if (!accepted) {
            throw conflict(
              "status_transition_conflict",
              RESCHEDULE_REQUEST_RESOLVED,
            );
          }

          await ctx.audit("visit", id, {
            action: "reschedule_request_accept",
            changes: {
              rescheduleRequestId: requestId,
              scheduledAt: { old: visit.scheduledAt, new: nextScheduledAt },
            },
            reason: input.resolutionNote ?? null,
          });

          ctx.afterCommit(() => notifyVisitRescheduled(id, ctx.actor.userId));
          return row;
        },
      );

      return c.json(updated);
    },
  )
  // ===========================================================================
  // POST /:id/reschedule-requests/:requestId/decline — keep the visit as is;
  // the reason goes back to the customer.
  // ===========================================================================
  .post(
    "/:id/reschedule-requests/:requestId/decline",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", DeclineVisitRescheduleRequestSchema),
    async (c) => {
      const member = c.get("member");
      const id = requireRouteId(c.req.param("id"));
      const requestId = requireRouteId(c.req.param("requestId"));
      const input = c.req.valid("json");

      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          await requireScopedVisit(id, member, ctx.o);

          const request = await requireVisitRescheduleRequest(
            requestId,
            id,
            ctx.o,
          );
          if (
            !VISIT_RESCHEDULE_REQUEST_MACHINE.canTransition(
              request.status,
              "decline",
            )
          ) {
            throw conflict(
              "status_transition_conflict",
              RESCHEDULE_REQUEST_RESOLVED,
            );
          }

          const rows = await ctx.o
            .update(visitRescheduleRequest)
            .set({
              status: VISIT_RESCHEDULE_REQUEST_MACHINE.requireTargetOf(
                request.status,
                "decline",
              ),
              resolvedBy: ctx.actor.userId,
              resolvedAt: new Date(),
              resolutionNote: input.resolutionNote ?? null,
            })
            .where(
              and(
                eq(visitRescheduleRequest.id, requestId),
                eq(visitRescheduleRequest.status, request.status),
              ),
            )
            .returning();
          if (rows.length === 0) {
            throw conflict(
              "status_transition_conflict",
              RESCHEDULE_REQUEST_RESOLVED,
            );
          }

          await ctx.audit("visit", id, {
            action: "reschedule_request_decline",
            changes: { rescheduleRequestId: requestId },
            reason: input.resolutionNote ?? null,
          });

          ctx.afterCommit(() =>
            notifyVisitRescheduleDeclined(
              id,
              ctx.actor.userId,
              input.resolutionNote ?? undefined,
            ),
          );
          return rows;
        },
      );

      return c.json(updated);
    },
  );
