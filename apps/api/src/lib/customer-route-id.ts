import { parseNumericRouteIdentifier } from "@calibra-facil/shared/route-identifiers";
import { slugifyRouteIdentifier } from "@calibra-facil/shared/route-identifiers";
import type { OrgDb } from "@calibra-facil/db/for-org";
import { customer } from "@calibra-facil/db/schema";
import { and, asc, eq, or } from "drizzle-orm";

const CUSTOMER_ROUTE_SLUG_SCAN_LIMIT = 500;
// `customer.id` is a 32-bit integer: a longer run of digits (a CNPJ) is a tax id,
// and comparing it to the column would make Postgres refuse the whole statement.
const MAX_CUSTOMER_ID = 2_147_483_647;

/**
 * `executor` is the caller's org-bound transaction when it has one (row-level
 * security); without it the lookup runs in a transaction of its own that names
 * `labOrganizationId`.
 */
export async function resolveCustomerRouteId(
  identifier: string,
  labOrganizationId: string,
  executor: OrgDb,
): Promise<number | null> {
  const legacyId = parseNumericRouteIdentifier(identifier);
  const directConditions = [eq(customer.taxId, identifier)];
  if (legacyId !== null && legacyId <= MAX_CUSTOMER_ID) {
    directConditions.unshift(eq(customer.id, legacyId));
  }
  const [directMatch] = await executor
    .select({ id: customer.id })
    .from(customer)
    .where(
      and(
        eq(customer.labOrganizationId, labOrganizationId),
        or(...directConditions)!,
      ),
    )
    .limit(1);
  if (directMatch) {
    return directMatch.id;
  }
  const scopedCustomers = await executor
    .select({
      id: customer.id,
      name: customer.name,
      taxId: customer.taxId,
    })
    .from(customer)
    .where(eq(customer.labOrganizationId, labOrganizationId))
    .orderBy(asc(customer.id))
    .limit(CUSTOMER_ROUTE_SLUG_SCAN_LIMIT);
  const match = scopedCustomers.find(
    (candidate) =>
      (candidate.taxId &&
        slugifyRouteIdentifier(candidate.taxId) === identifier) ||
      slugifyRouteIdentifier(candidate.name) === identifier,
  );
  return match?.id ?? null;
}
