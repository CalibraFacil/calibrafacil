import type { OrgDb } from "@calibra-facil/db/for-org";
import { serviceOrder, serviceOrderQuote } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import type { AuthVariables } from "../../middleware/permission";
import { orgDb } from "../../lib/org-db";
import { inOrgTransaction } from "../../lib/org-transaction";
import { buildUnitScopeCondition } from "../../lib/units";

export async function getQuoteForAction(
  serviceOrderId: number,
  quoteId: number,
  organizationId: string,
  // The caller's org-bound handle, when it is inside a transaction already.
  executor?: OrgDb,
  // Lock the row for the caller's transaction: a lifecycle command reads the
  // status, checks it against SERVICE_ORDER_QUOTE_MACHINE and writes, and a
  // concurrent command waits instead of acting on the same stale status.
  options: { lock?: boolean } = {},
) {
  const [quote] = await inOrgTransaction(organizationId, executor, (o) => {
    const query = o
      .select()
      .from(serviceOrderQuote)
      .where(
        and(
          eq(serviceOrderQuote.id, quoteId),
          eq(serviceOrderQuote.serviceOrderId, serviceOrderId),
          eq(serviceOrderQuote.organizationId, organizationId),
        ),
      )
      .limit(1);
    return options.lock ? query.for("update") : query;
  });
  return quote ?? null;
}

/**
 * The order's status, read under a row lock for the caller's transaction: a
 * lifecycle command checks it against SERVICE_ORDER_MACHINE and writes, and a
 * concurrent command waits instead of acting on the same stale status. Lock the
 * quote first when both are locked (every quote decision does).
 */
export async function lockServiceOrderStatus(
  o: OrgDb,
  serviceOrderId: number,
  organizationId: string,
) {
  const [row] = await o
    .select({ status: serviceOrder.status })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for("update");
  return row?.status ?? null;
}

export async function getScopedServiceOrder(
  id: number,
  member: AuthVariables["member"],
  // The caller's org-bound handle, when it is inside a transaction already.
  executor?: OrgDb,
  // Lock the row for the caller's transaction (see getQuoteForAction).
  options: { lock?: boolean } = {},
) {
  const [order] = await inOrgTransaction(
    member.organizationId,
    executor,
    (o) => {
      const query = o
        .select()
        .from(serviceOrder)
        .where(
          and(
            eq(serviceOrder.id, id),
            eq(serviceOrder.organizationId, member.organizationId),
            buildUnitScopeCondition(serviceOrder.unitId, member),
          ),
        )
        .limit(1);
      return options.lock ? query.for("update") : query;
    },
  );

  return order ?? null;
}

/**
 * Resolve a service order's opaque public id to its numeric id inside the
 * caller's org and unit scope. The lab dashboard routes by publicId so its URLs
 * never carry the enumerable serial; every other endpoint keeps taking the
 * numeric id, which the page has from the loaded detail.
 *
 * Returns null when it does not exist or is out of scope — the caller answers
 * 404 either way, so an out-of-scope id is indistinguishable from a missing one.
 */
export async function resolveServiceOrderIdByPublicId(
  publicId: string,
  member: AuthVariables["member"],
): Promise<number | null> {
  const [row] = await orgDb(member.organizationId).transaction((o) =>
    o
      .select({ id: serviceOrder.id })
      .from(serviceOrder)
      .where(
        and(
          eq(serviceOrder.publicId, publicId),
          eq(serviceOrder.organizationId, member.organizationId),
          buildUnitScopeCondition(serviceOrder.unitId, member),
        ),
      )
      .limit(1),
  );

  return row?.id ?? null;
}
