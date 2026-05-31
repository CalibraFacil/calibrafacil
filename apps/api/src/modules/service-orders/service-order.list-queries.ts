import { db } from "@calibra-facil/db";
import {
  asset,
  customer,
  organizationUnit,
  serviceOrder,
  user,
} from "@calibra-facil/db/schema";
import { SERVICE_ORDER_STATUS_LABELS } from "@calibra-facil/shared";
import { and, count, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import type { AuthVariables } from "../../middleware/permission";
import { buildUnitScopeCondition } from "../../lib/units";

type ServiceOrderRow = typeof serviceOrder.$inferSelect;

export type ServiceOrdersListQuery = {
  page: number;
  limit: number;
  status?: ServiceOrderRow["status"];
  customerId?: number;
  assetId?: number;
  technicianId?: string;
  unitId?: number;
  awaitingApproval?: boolean;
  readyForPickup?: boolean;
  warranty?: boolean;
  dateFrom?: string;
  dateTo?: string;
  query?: string;
};

export async function getPortalCustomerForAuthOrganization(
  authOrganizationId: string,
  labOrganizationId?: string | null,
) {
  const [linkedCustomer] = await db
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.authOrganizationId, authOrganizationId),
        labOrganizationId
          ? eq(customer.labOrganizationId, labOrganizationId)
          : undefined,
      ),
    )
    .limit(1);

  return linkedCustomer ?? null;
}

/**
 * Resolve a service order's opaque public id to its numeric id, scoped to the
 * given customer. Returns null when the order doesn't exist or isn't theirs,
 * so the portal can route by `publicId` without exposing the serial id.
 */
export async function resolvePortalServiceOrderIdByPublicId(
  publicId: string,
  customerId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ id: serviceOrder.id })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.publicId, publicId),
        eq(serviceOrder.customerId, customerId),
      ),
    )
    .limit(1);

  return row?.id ?? null;
}

export async function listServiceOrdersForLab(
  member: AuthVariables["member"],
  query: ServiceOrdersListQuery,
) {
  const page = query.page;
  const limit = query.limit;
  const offset = (page - 1) * limit;
  const conditions = [
    eq(serviceOrder.organizationId, member.organizationId),
    buildUnitScopeCondition(serviceOrder.unitId, member),
  ];

  if (query.status) conditions.push(eq(serviceOrder.status, query.status));
  if (query.customerId)
    conditions.push(eq(serviceOrder.customerId, query.customerId));
  if (query.assetId) conditions.push(eq(serviceOrder.assetId, query.assetId));
  if (query.technicianId)
    conditions.push(
      eq(serviceOrder.responsibleTechnicianId, query.technicianId),
    );
  if (query.unitId) conditions.push(eq(serviceOrder.unitId, query.unitId));
  if (query.awaitingApproval)
    conditions.push(eq(serviceOrder.status, "awaiting_quote_approval"));
  if (query.readyForPickup)
    conditions.push(eq(serviceOrder.status, "ready_for_pickup"));
  if (query.warranty) conditions.push(eq(serviceOrder.priority, "warranty"));
  if (query.dateFrom)
    conditions.push(gte(serviceOrder.openedAt, new Date(query.dateFrom)));
  if (query.dateTo)
    conditions.push(lte(serviceOrder.openedAt, new Date(query.dateTo)));
  if (query.query) {
    const searchCondition = or(
      ilike(serviceOrder.serviceOrderNumber, `%${query.query}%`),
      ilike(customer.name, `%${query.query}%`),
      ilike(asset.name, `%${query.query}%`),
      ilike(asset.serialNumber, `%${query.query}%`),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const whereCondition = and(...conditions);
  const [total] = await db
    .select({ total: count() })
    .from(serviceOrder)
    .innerJoin(customer, eq(serviceOrder.customerId, customer.id))
    .innerJoin(asset, eq(serviceOrder.assetId, asset.id))
    .where(whereCondition);

  const rows = await db
    .select({
      id: serviceOrder.id,
      serviceOrderNumber: serviceOrder.serviceOrderNumber,
      customerName: customer.name,
      assetName: asset.name,
      assetSerialNumber: asset.serialNumber,
      status: serviceOrder.status,
      priority: serviceOrder.priority,
      responsibleTechnicianName: user.name,
      openedAt: serviceOrder.openedAt,
      quotedAt: serviceOrder.quotedAt,
      approvedAt: serviceOrder.approvedAt,
      totalApprovedCents: serviceOrder.totalApprovedCents,
      totalQuotedCents: serviceOrder.totalQuotedCents,
      unitName: organizationUnit.name,
    })
    .from(serviceOrder)
    .innerJoin(customer, eq(serviceOrder.customerId, customer.id))
    .innerJoin(asset, eq(serviceOrder.assetId, asset.id))
    .innerJoin(organizationUnit, eq(serviceOrder.unitId, organizationUnit.id))
    .leftJoin(user, eq(serviceOrder.responsibleTechnicianId, user.id))
    .where(whereCondition)
    .orderBy(desc(serviceOrder.openedAt))
    .limit(limit)
    .offset(offset);

  return {
    data: rows.map((row) => ({
      ...row,
      statusLabel: SERVICE_ORDER_STATUS_LABELS[row.status],
    })),
    pagination: {
      page,
      limit,
      total: total?.total ?? 0,
      totalPages: Math.ceil((total?.total ?? 0) / limit),
    },
  };
}

export async function getServiceOrderSummaryReport(
  member: AuthVariables["member"],
) {
  const rows = await db
    .select({
      id: serviceOrder.id,
      status: serviceOrder.status,
      unitId: serviceOrder.unitId,
      unitName: organizationUnit.name,
      customerId: serviceOrder.customerId,
      customerName: customer.name,
      technicianId: serviceOrder.responsibleTechnicianId,
      technicianName: user.name,
      openedAt: serviceOrder.openedAt,
      evaluatedAt: serviceOrder.evaluatedAt,
      quotedAt: serviceOrder.quotedAt,
      approvedAt: serviceOrder.approvedAt,
      rejectedAt: serviceOrder.rejectedAt,
      closedAt: serviceOrder.closedAt,
      totalApprovedCents: serviceOrder.totalApprovedCents,
      priority: serviceOrder.priority,
    })
    .from(serviceOrder)
    .innerJoin(customer, eq(serviceOrder.customerId, customer.id))
    .innerJoin(organizationUnit, eq(serviceOrder.unitId, organizationUnit.id))
    .leftJoin(user, eq(serviceOrder.responsibleTechnicianId, user.id))
    .where(
      and(
        eq(serviceOrder.organizationId, member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, member),
      ),
    );

  const byStatus = new Map<string, number>();
  const byUnit = new Map<
    string,
    { unitId: number; unitName: string; total: number }
  >();
  const byTechnician = new Map<
    string,
    { technicianId: string | null; technicianName: string; total: number }
  >();
  const byCustomer = new Map<
    number,
    { customerId: number; customerName: string; total: number }
  >();
  let approvedQuoteCount = 0;
  let rejectedQuoteCount = 0;
  let warrantyCount = 0;
  let revenueApprovedCents = 0;
  let closedCycleMs = 0;
  let closedCycleCount = 0;

  for (const row of rows) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
    const unitKey = String(row.unitId);
    const unit = byUnit.get(unitKey) ?? {
      unitId: row.unitId,
      unitName: row.unitName,
      total: 0,
    };
    unit.total += 1;
    byUnit.set(unitKey, unit);

    const techKey = row.technicianId ?? "unassigned";
    const technician = byTechnician.get(techKey) ?? {
      technicianId: row.technicianId,
      technicianName: row.technicianName ?? "Sem técnico",
      total: 0,
    };
    technician.total += 1;
    byTechnician.set(techKey, technician);

    const customerSummary = byCustomer.get(row.customerId) ?? {
      customerId: row.customerId,
      customerName: row.customerName,
      total: 0,
    };
    customerSummary.total += 1;
    byCustomer.set(row.customerId, customerSummary);

    if (row.approvedAt) approvedQuoteCount += 1;
    if (row.rejectedAt) rejectedQuoteCount += 1;
    if (row.priority === "warranty") warrantyCount += 1;
    revenueApprovedCents += row.totalApprovedCents ?? 0;

    if (row.closedAt) {
      closedCycleMs += row.closedAt.getTime() - row.openedAt.getTime();
      closedCycleCount += 1;
    }
  }

  return {
    total: rows.length,
    byStatus: Array.from(byStatus, ([status, total]) => ({
      status,
      statusLabel:
        Object.entries(SERVICE_ORDER_STATUS_LABELS).find(
          ([statusKey]) => statusKey === status,
        )?.[1] ?? status,
      total,
    })),
    byUnit: Array.from(byUnit.values()),
    byTechnician: Array.from(byTechnician.values()),
    topCustomers: Array.from(byCustomer.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10),
    approval: {
      approvedQuoteCount,
      rejectedQuoteCount,
      approvalRate:
        approvedQuoteCount + rejectedQuoteCount > 0
          ? approvedQuoteCount / (approvedQuoteCount + rejectedQuoteCount)
          : null,
    },
    warranty: {
      warrantyCount,
      warrantyRate: rows.length > 0 ? warrantyCount / rows.length : null,
    },
    revenueApprovedCents,
    averageClosedCycleHours:
      closedCycleCount > 0
        ? closedCycleMs / closedCycleCount / 1000 / 60 / 60
        : null,
  };
}

export async function listServiceOrdersForPortalCustomer(
  customerId: number,
  query: ServiceOrdersListQuery,
) {
  const searchTerm = query.query?.trim();
  const whereCondition = and(
    eq(serviceOrder.customerId, customerId),
    query.status ? eq(serviceOrder.status, query.status) : undefined,
    searchTerm
      ? or(
          ilike(serviceOrder.serviceOrderNumber, `%${searchTerm}%`),
          ilike(asset.name, `%${searchTerm}%`),
          ilike(asset.serialNumber, `%${searchTerm}%`),
        )
      : undefined,
  );

  const [countResult] = await db
    .select({ total: count() })
    .from(serviceOrder)
    .innerJoin(asset, eq(serviceOrder.assetId, asset.id))
    .where(whereCondition);

  const rows = await db
    .select({
      id: serviceOrder.id,
      publicId: serviceOrder.publicId,
      serviceOrderNumber: serviceOrder.serviceOrderNumber,
      status: serviceOrder.status,
      openedAt: serviceOrder.openedAt,
      readyAt: serviceOrder.readyAt,
      assetName: asset.name,
      assetSerialNumber: asset.serialNumber,
    })
    .from(serviceOrder)
    .innerJoin(asset, eq(serviceOrder.assetId, asset.id))
    .where(whereCondition)
    .orderBy(desc(serviceOrder.openedAt))
    .limit(query.limit)
    .offset((query.page - 1) * query.limit);

  const total = countResult?.total ?? 0;

  return {
    data: rows.map((row) => ({
      ...row,
      statusLabel: SERVICE_ORDER_STATUS_LABELS[row.status],
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}
