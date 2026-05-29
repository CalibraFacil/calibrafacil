import { db } from "@calibra-facil/db";
import { customer } from "@calibra-facil/db/schema";
import { and, asc, eq, or } from "drizzle-orm";
import {
  parseLegacyNumericIdentifier,
  slugifyRouteIdentifier,
} from "./route-identifiers";

const CUSTOMER_ROUTE_SLUG_SCAN_LIMIT = 500;

export async function resolveCustomerRouteId(
  identifier: string,
  labOrganizationId: string,
): Promise<number | null> {
  const legacyId = parseLegacyNumericIdentifier(identifier);
  const directConditions = [eq(customer.taxId, identifier)];

  if (legacyId !== null) {
    directConditions.unshift(eq(customer.id, legacyId));
  }

  const [directMatch] = await db
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

  const scopedCustomers = await db
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
