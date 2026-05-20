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
