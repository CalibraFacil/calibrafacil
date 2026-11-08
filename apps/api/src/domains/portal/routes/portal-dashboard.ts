// The portal dashboard: overview, upcoming-dues calendar, branch units and their summary.

import { createRouter } from "../../../server/router";
import { mount } from "../../../lib/endpoint-mount";
import { requirePortalLabScope } from "../portal-lab-scope";
import {
  customer,
  calibrationJob,
  calibrationRequest,
  calibrationRequestItem,
  serviceOrder,
  asset,
  assetType,
} from "@calibra-facil/db/schema";
import {
  portalDashboardEndpoints,
  type PortalOverviewResponse,
  type ServerShape,
} from "@calibra-facil/contracts";
import {
  eq,
  and,
  inArray,
  asc,
  desc,
  isNull,
  isNotNull,
  lt,
  gte,
  sql,
} from "drizzle-orm";
import {
  requirePermission,
  requirePortalProtected,
  type AuthVariables,
} from "../../../middleware/permission";
import { type R2Env } from "../../../lib/storage";
import { assetInLab, fleetDueCountsByCustomer } from "../../assets";
import { applyPortalCertificateReleaseGate } from "../portal-certificate-release-gate";
import {
  applyUnitFilter,
  resolvePortalCustomerScope,
} from "../portal-customer-scope";
import { orgDb } from "../../../lib/org-db";
import { invalid } from "../../../lib/domain-errors";

// Upcoming-dues calendar: a bounded date window of instruments coming due.
// The frontend asks for the visible month grid padded by a day on each side,
// so the cap just guards against unbounded scans.
const CALENDAR_MAX_RANGE_DAYS = 100;

function emptyOverview(): ServerShape<PortalOverviewResponse> {
  return {
    equipment: {
      total: 0,
      overdue: 0,
      dueSoon: 0,
      scheduled: 0,
      unscheduled: 0,
      inLab: 0,
      attention: [],
    },
    certificates: { available: 0, recent: [] },
    requests: { total: 0, open: 0, rejected: 0, recent: [] },
    serviceOrders: {
      total: 0,
      inProgress: 0,
      awaitingQuoteApproval: 0,
      readyForPickup: 0,
      awaitingQuote: [],
      recent: [],
    },
  };
}

/**
 * Portal routes - endpoints specific to the client portal.
 * These routes handle client-facing functionality.
 * Uses Portal auth (portal_session cookie) for authentication.
 */
const PREFIX = "/api/portal";

export const portalDashboardRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>();

// =========================================================================
// GET /overview - Command-center aggregation for the active portal org
// =========================================================================
// One round-trip that powers the dashboard with accurate, fleet-wide numbers
// (not guessed from the first page of a list). Scoped to the active org's
// linked customer, exactly like /assets.
// =========================================================================
mount(
  portalDashboardRouter,
  PREFIX,
  portalDashboardEndpoints.overview,
  [...requirePortalProtected],
  async (c) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    // Resolve the active org to a single branch customer or, for a group org,
    // the whole set of branch customers (consolidated cockpit).
    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!scope || scope.customerIds.length === 0) {
      return emptyOverview();
    }
    const { customerIds } = scope;
    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const equipmentWhere = and(
        inArray(asset.customerId, customerIds),
        eq(asset.status, "ACTIVE"),
        isNull(asset.deletedAt),
      );
      // Group mode aggregates requests across branches whose authOrg differs
      // from the active (group) org, so scope by customerId alone.
      // The counts and the recent list share one predicate: the portal customer's
      // requests, inside the laboratory the scope resolved to.
      const requestWhere = inArray(calibrationRequest.customerId, customerIds);
      const certificateWhere = and(
        inArray(calibrationJob.customerId, customerIds),
        eq(calibrationJob.status, "APPROVED"),
      );
      const serviceOrderWhere = inArray(serviceOrder.customerId, customerIds);

      const [
        equipmentCountsByCustomer,
        equipmentAttention,
        certificateCounts,
        recentCertificatesRaw,
        requestCounts,
        recentRequests,
        serviceOrderCounts,
        awaitingQuoteOrders,
        recentServiceOrders,
      ] = await Promise.all([
        fleetDueCountsByCustomer(o, customerIds, { inLab: true }),
        o
          .select({
            id: asset.id,
            publicId: asset.publicId,
            name: asset.name,
            tag: asset.tag,
            nextCalibrationDate: asset.nextCalibrationDate,
            customerId: asset.customerId,
            customerName: customer.name,
          })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .where(and(equipmentWhere, isNotNull(asset.nextCalibrationDate)))
          .orderBy(asc(asset.nextCalibrationDate))
          .limit(6),
        o
          .select({ available: sql<number>`cast(count(*) as int)` })
          .from(calibrationJob)
          .where(certificateWhere),
        o
          .select({
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            approvedAt: calibrationJob.approvedAt,
            certificateUrl: calibrationJob.certificateUrl,
            assetName: asset.name,
            assetTag: asset.tag,
          })
          .from(calibrationJob)
          .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
          .where(certificateWhere)
          .orderBy(desc(calibrationJob.approvedAt))
          .limit(5),
        o
          .select({
            total: sql<number>`cast(count(*) as int)`,
            open: sql<number>`cast(count(*) filter (where ${calibrationRequest.status} in ('PENDING','UNDER_REVIEW')) as int)`,
            rejected: sql<number>`cast(count(*) filter (where ${calibrationRequest.status} = 'REJECTED') as int)`,
          })
          .from(calibrationRequest)
          .where(requestWhere),
        o
          .select({
            id: calibrationRequest.id,
            status: calibrationRequest.status,
            submittedAt: calibrationRequest.submittedAt,
            itemCount: sql<number>`cast((select count(*) from ${calibrationRequestItem} where ${calibrationRequestItem.requestId} = ${calibrationRequest.id}) as int)`,
          })
          .from(calibrationRequest)
          .where(requestWhere)
          .orderBy(desc(calibrationRequest.submittedAt))
          .limit(5),
        o
          .select({
            total: sql<number>`cast(count(*) as int)`,
            inProgress: sql<number>`cast(count(*) filter (where ${serviceOrder.status} not in ('delivered','closed','canceled')) as int)`,
            awaitingQuoteApproval: sql<number>`cast(count(*) filter (where ${serviceOrder.status} = 'awaiting_quote_approval') as int)`,
            readyForPickup: sql<number>`cast(count(*) filter (where ${serviceOrder.status} = 'ready_for_pickup') as int)`,
          })
          .from(serviceOrder)
          .where(serviceOrderWhere),
        o
          .select({
            id: serviceOrder.id,
            publicId: serviceOrder.publicId,
            serviceOrderNumber: serviceOrder.serviceOrderNumber,
            status: serviceOrder.status,
            openedAt: serviceOrder.openedAt,
            assetName: asset.name,
          })
          .from(serviceOrder)
          .leftJoin(asset, eq(serviceOrder.assetId, asset.id))
          .where(
            and(
              serviceOrderWhere,
              eq(serviceOrder.status, "awaiting_quote_approval"),
            ),
          )
          .orderBy(desc(serviceOrder.openedAt))
          .limit(5),
        o
          .select({
            id: serviceOrder.id,
            publicId: serviceOrder.publicId,
            serviceOrderNumber: serviceOrder.serviceOrderNumber,
            status: serviceOrder.status,
            openedAt: serviceOrder.openedAt,
            assetName: asset.name,
          })
          .from(serviceOrder)
          .leftJoin(asset, eq(serviceOrder.assetId, asset.id))
          .where(serviceOrderWhere)
          .orderBy(desc(serviceOrder.openedAt))
          .limit(5),
      ]);

      const recentCertificates = (
        await applyPortalCertificateReleaseGate(
          recentCertificatesRaw,
          scope.labOrganizationId,
        )
      ).map((cert) => ({
        id: cert.id,
        jobId: cert.jobId,
        approvedAt: cert.approvedAt,
        assetName: cert.assetName,
        assetTag: cert.assetTag,
        releaseStatus: cert.releaseStatus,
        ready: cert.certificateUrl !== null,
      }));

      // The network's totals: the counts of every branch added up.
      const equipment = [...equipmentCountsByCustomer.values()].reduce(
        (sum, counts) => ({
          total: sum.total + counts.total,
          overdue: sum.overdue + counts.overdue,
          dueSoon: sum.dueSoon + counts.dueSoon,
          scheduled: sum.scheduled + counts.scheduled,
          unscheduled: sum.unscheduled + counts.unscheduled,
          inLab: sum.inLab + counts.inLab,
        }),
        {
          total: 0,
          overdue: 0,
          dueSoon: 0,
          scheduled: 0,
          unscheduled: 0,
          inLab: 0,
        },
      );
      const requests = requestCounts[0] ?? { total: 0, open: 0, rejected: 0 };
      const orders = serviceOrderCounts[0] ?? {
        total: 0,
        inProgress: 0,
        awaitingQuoteApproval: 0,
        readyForPickup: 0,
      };

      return {
        equipment: { ...equipment, attention: equipmentAttention },
        certificates: {
          available: certificateCounts[0]?.available ?? 0,
          recent: recentCertificates,
        },
        requests: { ...requests, recent: recentRequests },
        serviceOrders: {
          ...orders,
          awaitingQuote: awaitingQuoteOrders,
          recent: recentServiceOrders,
        },
      };
    });
  },
);

// =========================================================================
// GET /calendar - Instruments coming due inside a date window
// =========================================================================
// Powers the portal's upcoming-dues calendar. Same customer scoping as
// /assets; the window is inclusive of both bounds and capped so a client
// can't request an unbounded scan.
// =========================================================================
mount(
  portalDashboardRouter,
  PREFIX,
  portalDashboardEndpoints.calendar,
  [...requirePortalProtected, requirePermission({ equipment: ["read"] })],
  async (c, { query }) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const { from, to, unitId } = query;
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toExclusive = new Date(`${to}T00:00:00.000Z`);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

    const rangeDays = (toExclusive.getTime() - fromDate.getTime()) / 86_400_000;
    if (
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toExclusive.getTime()) ||
      rangeDays <= 0 ||
      rangeDays > CALENDAR_MAX_RANGE_DAYS
    ) {
      throw invalid("invalid_request", "Periodo invalido");
    }

    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!scope) {
      return { data: [] };
    }
    const customerIds = applyUnitFilter(scope, unitId);
    if (customerIds.length === 0) {
      return { data: [] };
    }

    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const dues = await o
        .select({
          id: asset.id,
          publicId: asset.publicId,
          name: asset.name,
          tag: asset.tag,
          assetTypeName: sql<string>`coalesce(${assetType.name}, 'Sem tipo')`,
          nextCalibrationDate: asset.nextCalibrationDate,
          inLab: assetInLab(o),
          customerId: asset.customerId,
          customerName: customer.name,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .leftJoin(assetType, eq(asset.assetTypeId, assetType.id))
        .where(
          and(
            inArray(asset.customerId, customerIds),
            eq(asset.status, "ACTIVE"),
            isNull(asset.deletedAt),
            gte(asset.nextCalibrationDate, fromDate),
            lt(asset.nextCalibrationDate, toExclusive),
          ),
        )
        .orderBy(asc(asset.nextCalibrationDate), asc(asset.tag));

      // The window filter above keeps only dated assets; narrow the type with it.
      const data = dues.flatMap((due) =>
        due.nextCalibrationDate
          ? [{ ...due, nextCalibrationDate: due.nextCalibrationDate }]
          : [],
      );
      return { data };
    });
  },
);

// =========================================================================
// GET /units - Units (branch customers) in the active scope
// =========================================================================
// Powers the group cockpit's unit filter. Single mode returns the one
// customer; group mode returns every branch. The portal shows the filter
// only when more than one unit is present.
// =========================================================================
mount(
  portalDashboardRouter,
  PREFIX,
  portalDashboardEndpoints.units,
  [...requirePortalProtected],
  async (c) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!scope) {
      return { units: [] };
    }

    const units = [...scope.customerById.values()]
      .map((unit) => ({ id: unit.id, name: unit.name }))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

    return {
      mode: scope.mode,
      units,
    };
  },
);

// =========================================================================
// GET /units/summary - Per-unit calibration status breakdown (group KPIs)
// =========================================================================
// For the network manager: each unit (branch) with its overdue / due-soon /
// total active-instrument counts, worst-first. Single mode returns one row;
// the portal shows the breakdown only in group mode.
// =========================================================================
mount(
  portalDashboardRouter,
  PREFIX,
  portalDashboardEndpoints.unitsSummary,
  [...requirePortalProtected],
  async (c) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!scope || scope.customerIds.length === 0) {
      return { units: [] };
    }

    const byId = await orgDb(scope.labOrganizationId).transaction((o) =>
      fleetDueCountsByCustomer(o, scope.customerIds),
    );
    const units = [...scope.customerById.values()]
      .map((unit) => {
        const counts = byId.get(unit.id);
        return {
          id: unit.id,
          name: unit.name,
          total: counts?.total ?? 0,
          overdue: counts?.overdue ?? 0,
          dueSoon: counts?.dueSoon ?? 0,
        };
      })
      .sort(
        (left, right) =>
          right.overdue - left.overdue ||
          right.dueSoon - left.dueSoon ||
          left.name.localeCompare(right.name, "pt-BR"),
      );

    return {
      mode: scope.mode,
      units,
    };
  },
);
