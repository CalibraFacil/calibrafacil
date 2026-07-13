import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { alias } from "drizzle-orm/pg-core";
import { and, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  calibrationVisit,
  customer,
  jobAuditLog,
  user,
} from "@calibra-facil/db/schema";
import {
  AddVisitJobSchema,
  AssignVisitTechnicianSchema,
  CancelVisitSchema,
  ConfirmVisitSchema,
  ListVisitsQuerySchema,
  RescheduleVisitSchema,
} from "@calibra-facil/schemas";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { buildUnitScopeCondition } from "../lib/units";
import {
  notifyVisitCancelled,
  notifyVisitConfirmed,
  notifyVisitRescheduled,
  notifyVisitScheduled,
} from "@calibra-facil/notifications";
import { createCalibrationJob, jobCreationClientErrors } from "../lib/jobs";
import { formatOnsiteAddressText } from "../lib/onsite-address";
import {
  assertAssetBelongsToVisitCustomer,
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

const VISIT_TERMINAL = new Set(["COMPLETED", "CANCELLED"]);

/** Load one visit scoped to the org + unit, or null. */
async function getScopedVisit(id: number, member: AuthVariables["member"]) {
  const [visit] = await db
    .select()
    .from(calibrationVisit)
    .where(
      and(
        eq(calibrationVisit.id, id),
        eq(calibrationVisit.organizationId, member.organizationId),
        buildUnitScopeCondition(calibrationVisit.unitId, member),
      ),
    )
    .limit(1);
  return visit ?? null;
}

export const visitsRouter = new Hono<{ Variables: AuthVariables }>()
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
      const { page, limit, status, technicianId, dateFrom, dateTo, mine } =
        c.req.valid("query");
      const offset = (page - 1) * limit;

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
        conditions.push(gte(calibrationVisit.scheduledAt, new Date(dateFrom)));
      }
      if (dateTo) {
        conditions.push(lte(calibrationVisit.scheduledAt, new Date(dateTo)));
      }
      const where = and(...conditions);

      const [countResult] = await db
        .select({ total: count() })
        .from(calibrationVisit)
        .where(where);

      const visits = await db
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
        })
        .from(calibrationVisit)
        .innerJoin(customer, eq(calibrationVisit.customerId, customer.id))
        .leftJoin(
          technicianUser,
          eq(calibrationVisit.technicianId, technicianUser.id),
        )
        .where(where)
        .orderBy(desc(calibrationVisit.scheduledAt), desc(calibrationVisit.id))
        .limit(limit)
        .offset(offset);

      // Asset count per visit (one job per asset).
      const visitIds = visits.map((visit) => visit.id);
      const jobCounts =
        visitIds.length > 0
          ? await db
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

      return c.json({
        data: visits.map((visit) => ({
          ...visit,
          assetCount: assetCountByVisit.get(visit.id) ?? 0,
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
  // ===========================================================================
  // GET /:id — one visit with its linked jobs/assets
  // ===========================================================================
  .get("/:id", ...withLabPermission({ request: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return c.json({ error: "ID invalido" }, 400);

    const [visit] = await db
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

    if (!visit) return c.json({ error: "Visita nao encontrada" }, 404);

    const jobs = await db
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

    return c.json({ ...visit, jobs });
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
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "ID invalido" }, 400);
      const { technicianId } = c.req.valid("json");

      const visit = await getScopedVisit(id, member);
      if (!visit) return c.json({ error: "Visita nao encontrada" }, 404);
      if (VISIT_TERMINAL.has(visit.status)) {
        return c.json({ error: "Visita ja finalizada ou cancelada" }, 409);
      }

      const [updated] = await db
        .update(calibrationVisit)
        .set({ technicianId })
        .where(eq(calibrationVisit.id, id))
        .returning();

      if (technicianId !== visit.technicianId) {
        try {
          await notifyVisitScheduled(id, session.user.id);
        } catch (error) {
          console.error("[Visits] Failed to notify technician:", error);
        }
      }

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
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "ID invalido" }, 400);
      const input = c.req.valid("json");

      const visit = await getScopedVisit(id, member);
      if (!visit) return c.json({ error: "Visita nao encontrada" }, 404);
      if (VISIT_TERMINAL.has(visit.status)) {
        return c.json({ error: "Visita ja finalizada ou cancelada" }, 409);
      }

      const scheduledAt = input.scheduledAt
        ? new Date(input.scheduledAt)
        : visit.scheduledAt;
      const technicianId = input.technicianId ?? visit.technicianId;
      if (!scheduledAt || !technicianId) {
        return c.json(
          { error: "Defina a data e o técnico para confirmar a visita" },
          400,
        );
      }

      const [updated] = await db
        .update(calibrationVisit)
        .set({
          status: "CONFIRMED",
          scheduledAt,
          technicianId,
          confirmedBy: session.user.id,
          confirmedAt: new Date(),
        })
        .where(eq(calibrationVisit.id, id))
        .returning();

      try {
        await notifyVisitConfirmed(id, session.user.id);
        if (technicianId !== visit.technicianId) {
          await notifyVisitScheduled(id, session.user.id);
        }
      } catch (error) {
        console.error("[Visits] Failed to send confirm notifications:", error);
      }

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
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "ID invalido" }, 400);
      const input = c.req.valid("json");

      const visit = await getScopedVisit(id, member);
      if (!visit) return c.json({ error: "Visita nao encontrada" }, 404);
      if (VISIT_TERMINAL.has(visit.status)) {
        return c.json({ error: "Visita ja finalizada ou cancelada" }, 409);
      }

      const nextScheduledAt = input.scheduledAt
        ? new Date(input.scheduledAt)
        : visit.scheduledAt;
      const dateChanged =
        nextScheduledAt?.getTime() !== visit.scheduledAt?.getTime();

      const [updated] = await db
        .update(calibrationVisit)
        .set({
          scheduledAt: nextScheduledAt,
          scheduledEndAt: input.scheduledEndAt
            ? new Date(input.scheduledEndAt)
            : visit.scheduledEndAt,
          address: input.address ?? visit.address,
          notes: input.notes ?? visit.notes,
        })
        .where(eq(calibrationVisit.id, id))
        .returning();

      if (dateChanged) {
        try {
          await notifyVisitRescheduled(id, session.user.id);
        } catch (error) {
          console.error("[Visits] Failed to notify reschedule:", error);
        }
      }

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
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "ID invalido" }, 400);
      const { reason } = c.req.valid("json");

      const visit = await getScopedVisit(id, member);
      if (!visit) return c.json({ error: "Visita nao encontrada" }, 404);
      if (VISIT_TERMINAL.has(visit.status)) {
        return c.json({ error: "Visita ja finalizada ou cancelada" }, 409);
      }

      const [updated] = await db
        .update(calibrationVisit)
        .set({
          status: "CANCELLED",
          cancelledBy: session.user.id,
          cancelledAt: new Date(),
          cancelReason: reason ?? null,
        })
        .where(eq(calibrationVisit.id, id))
        .returning();

      try {
        await notifyVisitCancelled(id, session.user.id, reason ?? undefined);
      } catch (error) {
        console.error("[Visits] Failed to notify cancellation:", error);
      }

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
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "ID invalido" }, 400);

      const visit = await getScopedVisit(id, member);
      if (!visit) return c.json({ error: "Visita nao encontrada" }, 404);
      if (visit.status === "PROPOSED") {
        return c.json({ error: "Confirme a visita antes de concluí-la" }, 409);
      }
      if (VISIT_TERMINAL.has(visit.status)) {
        return c.json({ error: "Visita ja finalizada ou cancelada" }, 409);
      }

      const [updated] = await db
        .update(calibrationVisit)
        .set({ status: "COMPLETED" })
        .where(eq(calibrationVisit.id, id))
        .returning();

      return c.json(updated);
    },
  );

/**
 * Visit-jobs sub-router — mounted separately to avoid Hono type chain length
 * limits (TS7056) on the main visitsRouter.
 *
 * REQ-VISITJOB-001,002,003,004,005,006,007,008,009,010
 */
export const visitJobsRouter = new Hono<{ Variables: AuthVariables }>()
  // ===========================================================================
  // POST /:id/jobs — add an instrument (calibration job) to a PROPOSED visit
  // ===========================================================================
  .post(
    "/:id/jobs",
    ...withLabPermission({ request: ["update"] }),
    zValidator("json", AddVisitJobSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "ID invalido" }, 400);
      const { assetId, serviceId } = c.req.valid("json");

      // REQ-VISITJOB-005: scope via getScopedVisit (org+unit scoped)
      const visit = await getScopedVisit(id, member);
      if (!visit) return c.json({ error: "Visita nao encontrada" }, 404);

      // REQ-VISITJOB-003: visit must be PROPOSED
      const statusGuard = canAddJobToVisit(visit);
      if (!statusGuard.ok) {
        return c.json({ error: statusGuard.body }, statusGuard.status);
      }

      // REQ-VISITJOB-004: asset must belong to visit's customer (scope via customer.labOrganizationId)
      const [foundAsset] = await db
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
        return c.json({ error: "Ativo nao encontrado" }, 400);
      }

      const customerGuard = assertAssetBelongsToVisitCustomer(
        foundAsset,
        visit,
      );
      if (!customerGuard.ok) {
        return c.json({ error: customerGuard.body }, customerGuard.status);
      }

      // REQ-VISITJOB-001,002: create job via createCalibrationJob with onsiteLocation
      try {
        const newJob = await createCalibrationJob({
          organizationId: member.organizationId,
          unitId: visit.unitId,
          createdBy: session.user.id,
          assetId,
          serviceId,
          notifyOnAssignment: false,
          onsiteLocation: {
            addressText: formatOnsiteAddressText(visit.address),
          },
          visitId: id,
        });
        return c.json(newJob, 201);
      } catch (error) {
        if (
          error instanceof Error &&
          jobCreationClientErrors.has(error.message)
        ) {
          return c.json({ error: error.message }, 400);
        }
        throw error;
      }
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
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const jobId = parseInt(c.req.param("jobId"), 10);
      if (isNaN(id) || isNaN(jobId))
        return c.json({ error: "ID invalido" }, 400);

      // REQ-VISITJOB-005: scope via getScopedVisit
      const visit = await getScopedVisit(id, member);
      if (!visit) return c.json({ error: "Visita nao encontrada" }, 404);

      // Load the job scoped to org
      const [foundJob] = await db
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
      const removalGuard = resolveVisitJobRemoval({
        visitStatus: visit.status,
        job: foundJob ?? null,
        visitId: id,
      });

      if (!removalGuard.ok) {
        return c.json({ error: removalGuard.body }, removalGuard.status);
      }
      // The guard already rejects a missing job with 404; narrow for TS.
      if (!foundJob) {
        return c.json({ error: "Job nao encontrado nesta visita" }, 404);
      }

      // REQ-VISITJOB-006: soft-cancel (CANCELED with single L per JobStatus enum)
      const [updatedJob] = await db
        .update(calibrationJob)
        .set({ status: "CANCELED" })
        .where(eq(calibrationJob.id, jobId))
        .returning();

      // Audit parity with the main job-cancel route (append-only ISO 17025 trail)
      await db.insert(jobAuditLog).values({
        jobId,
        action: "cancel",
        changes: {
          status: { old: foundJob.status, new: "CANCELED" },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: `Instrumento removido da visita #${id}`,
      });

      return c.json(updatedJob);
    },
  );
