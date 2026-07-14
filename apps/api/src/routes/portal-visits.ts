import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  calibrationVisit,
  customer,
  user,
  visitAuditLog,
  visitRescheduleRequest,
} from "@calibra-facil/db/schema";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { PortalVisitRescheduleRequestSchema } from "@calibra-facil/schemas";
import {
  notifyVisitCustomerConfirmed,
  notifyVisitRescheduleRequested,
} from "@calibra-facil/notifications";
import {
  requirePermission,
  requirePortalProtected,
  type AuthVariables,
} from "../middleware/permission";
import { resolveLabOrganizationIdByPortalHostname } from "../lib/portal-domains";
import { resolvePortalCustomerScope } from "../lib/portal-customer-scope";

async function getPortalLabScope(c: {
  req: { header: (name: string) => string | undefined };
}) {
  const origin = c.req.header("origin") ?? c.req.header("referer") ?? null;
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return resolveLabOrganizationIdByPortalHostname(url.hostname);
  } catch {
    return null;
  }
}

function requestIp(c: {
  req: { header: (name: string) => string | undefined };
}) {
  return (
    c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? null
  );
}

function requestUserAgent(c: {
  req: { header: (name: string) => string | undefined };
}) {
  return c.req.header("user-agent") ?? null;
}

/** Loads a visit only if it belongs to a customer in the portal scope. */
async function getPortalScopedVisit(id: number, customerIds: number[]) {
  const [visit] = await db
    .select()
    .from(calibrationVisit)
    .where(
      and(
        eq(calibrationVisit.id, id),
        inArray(calibrationVisit.customerId, customerIds),
      ),
    )
    .limit(1);
  return visit ?? null;
}

/**
 * Customer-facing on-site visit tracking. Scoped to the portal customer (or
 * every branch in group mode); customer-facing only, so it never exposes
 * internal actor ids or notes — just the date, técnico name, status, address
 * and instrument count the client needs to plan for the trip.
 */
export const portalVisitsRouter = new Hono<{ Variables: AuthVariables }>()
  .get(
    "/",
    ...requirePortalProtected,
    requirePermission({ request: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const portalLabScope = await getPortalLabScope(c);

      const scope = await resolvePortalCustomerScope({
        activeOrgId: member.organizationId,
        labScope: portalLabScope,
      });

      if (!scope || scope.customerIds.length === 0) {
        return c.json({ data: [] });
      }

      const visits = await db
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
        return c.json({ data: [] });
      }

      const visitIds = visits.map((visit) => visit.id);
      const counts = await db
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
      const rescheduleRows = await db
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

      return c.json({
        data: visits.map((visit) => ({
          ...visit,
          assetCount: assetCountByVisit.get(visit.id) ?? 0,
          rescheduleRequest: latestRescheduleByVisit.get(visit.id) ?? null,
        })),
      });
    },
  )
  /**
   * #739: customer confirms attendance ("Confirmar presença"). An
   * acknowledgement, not a status transition — the lab lifecycle is untouched.
   * Gated on request:["read"] like the quote-approve precedent: the write
   * authority is the customer scope, enforced below.
   */
  .post(
    "/:id/confirm",
    ...requirePortalProtected,
    requirePermission({ request: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "ID invalido" }, 400);

      const portalLabScope = await getPortalLabScope(c);
      const scope = await resolvePortalCustomerScope({
        activeOrgId: member.organizationId,
        labScope: portalLabScope,
      });
      if (!scope || scope.customerIds.length === 0) {
        return c.json({ error: "Visita nao encontrada" }, 404);
      }

      const visit = await getPortalScopedVisit(id, scope.customerIds);
      if (!visit) return c.json({ error: "Visita nao encontrada" }, 404);
      if (visit.status !== "PROPOSED" && visit.status !== "CONFIRMED") {
        return c.json(
          { error: "Esta visita nao pode mais ser confirmada" },
          409,
        );
      }
      if (!visit.scheduledAt || visit.scheduledAt.getTime() <= Date.now()) {
        return c.json(
          { error: "A visita ainda nao tem uma data futura agendada" },
          409,
        );
      }
      if (visit.customerConfirmedAt) {
        // Idempotent: re-confirming an already-confirmed visit is a no-op.
        return c.json({
          ok: true,
          customerConfirmedAt: visit.customerConfirmedAt,
        });
      }

      const customerConfirmedAt = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(calibrationVisit)
          .set({
            customerConfirmedBy: session.user.id,
            customerConfirmedAt,
          })
          .where(eq(calibrationVisit.id, id));

        await tx.insert(visitAuditLog).values({
          visitId: id,
          action: "customer_confirm",
          changes: {
            customerConfirmedAt: { old: null, new: customerConfirmedAt },
            scheduledAt: visit.scheduledAt,
          },
          performedBy: session.user.id,
          ipAddress: requestIp(c),
          userAgent: requestUserAgent(c),
        });
      });

      try {
        await notifyVisitCustomerConfirmed(id, session.user.id);
      } catch (error) {
        console.error(
          "[PortalVisits] Failed to notify customer confirmation:",
          error,
        );
      }

      return c.json({ ok: true, customerConfirmedAt });
    },
  )
  /**
   * #739: customer asks the lab to move the visit ("Solicitar reagendamento").
   * Creates a first-class PENDING request the lab resolves — it does NOT move
   * the visit. At most one PENDING request per visit.
   */
  .post(
    "/:id/reschedule-request",
    ...requirePortalProtected,
    requirePermission({ request: ["create"] }),
    zValidator("json", PortalVisitRescheduleRequestSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "ID invalido" }, 400);
      const input = c.req.valid("json");

      const portalLabScope = await getPortalLabScope(c);
      const scope = await resolvePortalCustomerScope({
        activeOrgId: member.organizationId,
        labScope: portalLabScope,
      });
      if (!scope || scope.customerIds.length === 0) {
        return c.json({ error: "Visita nao encontrada" }, 404);
      }

      const visit = await getPortalScopedVisit(id, scope.customerIds);
      if (!visit) return c.json({ error: "Visita nao encontrada" }, 404);
      if (visit.status !== "PROPOSED" && visit.status !== "CONFIRMED") {
        return c.json(
          { error: "Esta visita nao pode mais ser reagendada" },
          409,
        );
      }

      const [pending] = await db
        .select({ id: visitRescheduleRequest.id })
        .from(visitRescheduleRequest)
        .where(
          and(
            eq(visitRescheduleRequest.visitId, id),
            eq(visitRescheduleRequest.status, "PENDING"),
          ),
        )
        .limit(1);
      if (pending) {
        return c.json(
          { error: "Ja existe uma solicitacao de reagendamento pendente" },
          409,
        );
      }

      try {
        const requestId = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(visitRescheduleRequest)
            .values({
              visitId: id,
              organizationId: visit.organizationId,
              customerId: visit.customerId,
              requestedBy: session.user.id,
              reason: input.reason ?? null,
              preferredWindows: input.preferredWindows,
            })
            .returning();
          if (!created) {
            throw new Error("Falha ao criar a solicitacao de reagendamento");
          }

          await tx.insert(visitAuditLog).values({
            visitId: id,
            action: "reschedule_request",
            changes: {
              rescheduleRequestId: created.id,
              preferredWindows: input.preferredWindows,
            },
            performedBy: session.user.id,
            ipAddress: requestIp(c),
            userAgent: requestUserAgent(c),
            reason: input.reason ?? null,
          });

          return created.id;
        });

        try {
          await notifyVisitRescheduleRequested(id, session.user.id);
        } catch (error) {
          console.error(
            "[PortalVisits] Failed to notify reschedule request:",
            error,
          );
        }

        return c.json({ ok: true, requestId });
      } catch (error) {
        // Unique partial index backstop: a concurrent request slipped past
        // the pre-check above.
        if (
          error instanceof Error &&
          error.message.includes("visit_reschedule_request_pending_uidx")
        ) {
          return c.json(
            { error: "Ja existe uma solicitacao de reagendamento pendente" },
            409,
          );
        }
        throw error;
      }
    },
  );
