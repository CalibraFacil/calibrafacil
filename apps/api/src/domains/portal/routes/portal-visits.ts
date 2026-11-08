import { createRouter } from "../../../server/router";
import { requirePortalLabScope } from "../portal-lab-scope";
import { portalVisitEndpoints } from "@calibra-facil/contracts";
import {
  calibrationJob,
  calibrationVisit,
  customer,
  user,
  visitRescheduleRequest,
} from "@calibra-facil/db/schema";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { notify } from "@calibra-facil/notifications";
import {
  requirePermission,
  requirePortalProtected,
  type AuthVariables,
} from "../../../middleware/permission";
import { resolvePortalCustomerScope } from "../portal-customer-scope";
import { orgDb } from "../../../lib/org-db";
import { mount } from "../../../lib/endpoint-mount";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import { requireRouteId } from "../../../lib/route-id";
import { conflict, notFound } from "../../../lib/domain-errors";

/**
 * The customers and laboratory the portal session reaches. Throws 404 when it
 * reaches none (the same answer as a visit that is not theirs), 403 for a
 * blocked host.
 */
async function requirePortalVisitScope(
  c: Parameters<typeof requirePortalLabScope>[0],
  activeOrgId: string,
) {
  const scope = await resolvePortalCustomerScope({
    activeOrgId,
    labScope: await requirePortalLabScope(c),
  });
  if (!scope || scope.customerIds.length === 0) {
    throw notFound("visit_not_found", "Visita nao encontrada");
  }
  return scope;
}

/**
 * Loads a visit only if it belongs to a customer in the portal scope, inside
 * the laboratory that scope resolved to. Throws 404 otherwise.
 */
async function requirePortalScopedVisit(
  id: number,
  customerIds: number[],
  labOrganizationId: string,
) {
  const [visit] = await orgDb(labOrganizationId).transaction((o) =>
    o
      .select()
      .from(calibrationVisit)
      .where(
        and(
          eq(calibrationVisit.id, id),
          inArray(calibrationVisit.customerId, customerIds),
        ),
      )
      .limit(1),
  );
  if (!visit) throw notFound("visit_not_found", "Visita nao encontrada");
  return visit;
}

function pendingRescheduleExists() {
  return conflict(
    "visit_reschedule_pending",
    "Ja existe uma solicitacao de reagendamento pendente",
  );
}

/**
 * Customer-facing on-site visit tracking. Scoped to the portal customer (or
 * every branch in group mode); customer-facing only, so it never exposes
 * internal actor ids or notes — just the date, técnico name, status, address
 * and instrument count the client needs to plan for the trip.
 */
const PREFIX = "/api/portal/visits";

export const portalVisitsRouter = createRouter<{ Variables: AuthVariables }>();

mount(
  portalVisitsRouter,
  PREFIX,
  portalVisitEndpoints.list,
  [...requirePortalProtected, requirePermission({ request: ["read"] })],
  async (c) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!scope || scope.customerIds.length === 0) {
      return { data: [] };
    }

    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const visits = await o
        .select({
          id: calibrationVisit.id,
          status: calibrationVisit.status,
          scheduledAt: calibrationVisit.scheduledAt,
          scheduledEndAt: calibrationVisit.scheduledEndAt,
          address: calibrationVisit.address,
          customerName: customer.name,
          technicianName: user.name,
          sourceRequestId: calibrationVisit.sourceRequestId,
          cancelReason: calibrationVisit.cancelReason,
          customerConfirmedAt: calibrationVisit.customerConfirmedAt,
        })
        .from(calibrationVisit)
        .innerJoin(customer, eq(calibrationVisit.customerId, customer.id))
        .leftJoin(user, eq(calibrationVisit.technicianId, user.id))
        .where(
          and(
            inArray(calibrationVisit.customerId, scope.customerIds),
            ne(calibrationVisit.status, "CANCELLED"),
          ),
        )
        .orderBy(sql`${calibrationVisit.scheduledAt} desc nulls last`)
        .limit(50);

      if (visits.length === 0) {
        return { data: [] };
      }

      const visitIds = visits.map((visit) => visit.id);
      const counts = await o
        .select({
          visitId: calibrationJob.visitId,
          total: count(),
        })
        .from(calibrationJob)
        .where(inArray(calibrationJob.visitId, visitIds))
        .groupBy(calibrationJob.visitId);

      const assetCountByVisit = new Map<number, number>();
      for (const row of counts) {
        if (row.visitId !== null) {
          assetCountByVisit.set(row.visitId, row.total);
        }
      }

      // Latest reschedule request per visit (any status): the panel shows a
      // "reagendamento solicitado" chip while PENDING and the resolution
      // (accepted date / decline note) afterwards.
      const rescheduleRows = await o
        .select({
          id: visitRescheduleRequest.id,
          visitId: visitRescheduleRequest.visitId,
          status: visitRescheduleRequest.status,
          reason: visitRescheduleRequest.reason,
          preferredWindows: visitRescheduleRequest.preferredWindows,
          resolutionNote: visitRescheduleRequest.resolutionNote,
          createdAt: visitRescheduleRequest.createdAt,
          resolvedAt: visitRescheduleRequest.resolvedAt,
        })
        .from(visitRescheduleRequest)
        .where(inArray(visitRescheduleRequest.visitId, visitIds))
        .orderBy(
          desc(visitRescheduleRequest.createdAt),
          desc(visitRescheduleRequest.id),
        );

      const latestRescheduleByVisit = new Map<
        number,
        Omit<(typeof rescheduleRows)[number], "visitId">
      >();
      for (const { visitId, ...request } of rescheduleRows) {
        if (!latestRescheduleByVisit.has(visitId)) {
          latestRescheduleByVisit.set(visitId, request);
        }
      }

      return {
        data: visits.map((visit) => ({
          ...visit,
          assetCount: assetCountByVisit.get(visit.id) ?? 0,
          rescheduleRequest: latestRescheduleByVisit.get(visit.id) ?? null,
        })),
      };
    });
  },
);

/**
 * Customer confirms attendance ("Confirmar presença"). An
 * acknowledgement, not a status transition — the lab lifecycle is untouched.
 * Gated on request:["read"] like the quote-approve precedent: the write
 * authority is the customer scope, enforced below.
 */
mount(
  portalVisitsRouter,
  PREFIX,
  portalVisitEndpoints.confirm,
  [...requirePortalProtected, requirePermission({ request: ["read"] })],
  async (c, { params }) => {
    const member = c.get("member");
    const id = requireRouteId(params.id);

    const scope = await requirePortalVisitScope(c, member.organizationId);
    const visit = await requirePortalScopedVisit(
      id,
      scope.customerIds,
      scope.labOrganizationId,
    );
    if (visit.status !== "PROPOSED" && visit.status !== "CONFIRMED") {
      throw conflict(
        "visit_closed",
        "Esta visita nao pode mais ser confirmada",
      );
    }
    if (!visit.scheduledAt || visit.scheduledAt.getTime() <= Date.now()) {
      throw conflict(
        "visit_not_scheduled",
        "A visita ainda nao tem uma data futura agendada",
      );
    }
    if (visit.customerConfirmedAt) {
      // Idempotent: re-confirming an already-confirmed visit is a no-op.
      return {
        ok: true,
        customerConfirmedAt: visit.customerConfirmedAt,
      };
    }

    const customerConfirmedAt = new Date();
    await withOrg(scope.labOrganizationId, requestActor(c), async (ctx) => {
      await ctx.o
        .update(calibrationVisit)
        .set({
          customerConfirmedBy: ctx.actor.userId,
          customerConfirmedAt,
        })
        .where(eq(calibrationVisit.id, id));

      await ctx.audit("visit", id, {
        action: "customer_confirm",
        changes: {
          customerConfirmedAt: { old: null, new: customerConfirmedAt },
          scheduledAt: visit.scheduledAt,
        },
      });

      ctx.afterCommit(() =>
        notify("VISIT_CUSTOMER_CONFIRMED", {
          visitId: id,
          actorUserId: ctx.actor.userId,
        }),
      );
    });

    return {
      ok: true,
      customerConfirmedAt,
    };
  },
);

/**
 * Customer asks the lab to move the visit ("Solicitar reagendamento").
 * Creates a first-class PENDING request the lab resolves — it does NOT move
 * the visit. At most one PENDING request per visit.
 */
mount(
  portalVisitsRouter,
  PREFIX,
  portalVisitEndpoints.requestReschedule,
  [...requirePortalProtected, requirePermission({ request: ["create"] })],
  async (c, { params, body }) => {
    const member = c.get("member");
    const id = requireRouteId(params.id);
    const input = body;

    const scope = await requirePortalVisitScope(c, member.organizationId);
    const visit = await requirePortalScopedVisit(
      id,
      scope.customerIds,
      scope.labOrganizationId,
    );
    if (visit.status !== "PROPOSED" && visit.status !== "CONFIRMED") {
      throw conflict(
        "visit_closed",
        "Esta visita nao pode mais ser reagendada",
      );
    }

    const [pending] = await orgDb(scope.labOrganizationId).transaction((o) =>
      o
        .select({ id: visitRescheduleRequest.id })
        .from(visitRescheduleRequest)
        .where(
          and(
            eq(visitRescheduleRequest.visitId, id),
            eq(visitRescheduleRequest.status, "PENDING"),
          ),
        )
        .limit(1),
    );
    if (pending) throw pendingRescheduleExists();

    try {
      const requestId = await withOrg(
        scope.labOrganizationId,
        requestActor(c),
        async (ctx) => {
          const [created] = await ctx.o
            .insert(visitRescheduleRequest)
            .values({
              visitId: id,
              organizationId: visit.organizationId,
              customerId: visit.customerId,
              requestedBy: ctx.actor.userId,
              reason: input.reason ?? null,
              preferredWindows: input.preferredWindows,
            })
            .returning();
          if (!created) {
            throw new Error("Falha ao criar a solicitacao de reagendamento");
          }

          await ctx.audit("visit", id, {
            action: "reschedule_request",
            changes: {
              rescheduleRequestId: created.id,
              preferredWindows: input.preferredWindows,
            },
            reason: input.reason ?? null,
          });

          ctx.afterCommit(() =>
            notify("VISIT_RESCHEDULE_REQUESTED", {
              visitId: id,
              actorUserId: ctx.actor.userId,
            }),
          );
          return created.id;
        },
      );

      return {
        ok: true,
        requestId,
      };
    } catch (error) {
      // Unique partial index backstop: a concurrent request slipped past
      // the pre-check above.
      if (
        error instanceof Error &&
        error.message.includes("visit_reschedule_request_pending_uidx")
      ) {
        throw pendingRescheduleExists();
      }
      throw error;
    }
  },
);
