import { db } from "@calibra-facil/db";
import { serviceOrder, serviceOrderQuote } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import type { AuthVariables } from "../../middleware/permission";
import { buildUnitScopeCondition } from "../../lib/units";

export async function getQuoteForAction(
  serviceOrderId: number,
  quoteId: number,
) {
  const [quote] = await db
    .select()
    .from(serviceOrderQuote)
    .where(
      and(
        eq(serviceOrderQuote.id, quoteId),
        eq(serviceOrderQuote.serviceOrderId, serviceOrderId),
      ),
    )
    .limit(1);
  return quote ?? null;
}

export async function getScopedServiceOrder(
  id: number,
  member: AuthVariables["member"],
) {
  const [order] = await db
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
  const [row] = await db
    .select({ id: serviceOrder.id })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.publicId, publicId),
        eq(serviceOrder.organizationId, member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, member),
      ),
    )
    .limit(1);

  return row?.id ?? null;
}
