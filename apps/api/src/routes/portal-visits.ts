import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  calibrationVisit,
  customer,
  user,
} from "@calibra-facil/db/schema";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
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

/**
 * Customer-facing on-site visit tracking. Scoped to the portal customer (or
 * every branch in group mode); customer-facing only, so it never exposes
 * internal actor ids or notes — just the date, técnico name, status, address
 * and instrument count the client needs to plan for the trip.
 */
export const portalVisitsRouter = new Hono<{ Variables: AuthVariables }>().get(
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
        address: calibrationVisit.address,
        customerName: customer.name,
        technicianName: user.name,
        sourceRequestId: calibrationVisit.sourceRequestId,
        cancelReason: calibrationVisit.cancelReason,
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

    return c.json({
      data: visits.map((visit) => ({
        ...visit,
        assetCount: assetCountByVisit.get(visit.id) ?? 0,
      })),
    });
  },
);
