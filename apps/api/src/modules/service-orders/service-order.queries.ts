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
) {
  const [quote] = await inOrgTransaction(organizationId, executor, (o) =>
    o
      .select()
      .from(serviceOrderQuote)
      .where(
        and(
          eq(serviceOrderQuote.id, quoteId),
          eq(serviceOrderQuote.serviceOrderId, serviceOrderId),
          eq(serviceOrderQuote.organizationId, organizationId),
        ),
      )
      .limit(1),
  );
  return quote ?? null;
}

export async function getScopedServiceOrder(
  id: number,
  member: AuthVariables["member"],
  // The caller's org-bound handle, when it is inside a transaction already.
  executor?: OrgDb,
) {
  const [order] = await inOrgTransaction(member.organizationId, executor, (o) =>
    o
      .select()
      .from(serviceOrder)
      .where(
        and(
          eq(serviceOrder.id, id),
          eq(serviceOrder.organizationId, member.organizationId),
          buildUnitScopeCondition(serviceOrder.unitId, member),
        ),
      )
      .limit(1),
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
