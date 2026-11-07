import { orgDb } from "../../lib/org-db";
import type { OrgDb } from "@calibra-facil/db/for-org";
import { customer, customerGroup } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import {
  loadCustomerActiveCommercialAgreement,
  loadCustomerFinancialSummary,
} from "../finance";
import { invalid, notFound } from "../../lib/domain-errors";
import { resolveCustomerRouteId } from "../../lib/customer-route-id";

/**
 * The laboratory's customer with its financial summary, active agreement and
 * group. `executor` is the caller's org-bound transaction when it has one
 * (row-level security); without it the reads run in a transaction of their own
 * that names `labOrganizationId`.
 */
export async function getLabCustomerById(
  customerId: number,
  labOrganizationId: string,
  executor: OrgDb,
) {
  const [foundCustomer] = await executor
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.labOrganizationId, labOrganizationId),
      ),
    )
    .limit(1);
  if (!foundCustomer) {
    return null;
  }
  const financialSummary = await loadCustomerFinancialSummary(
    labOrganizationId,
    foundCustomer.id,
    executor,
  );
  const activeCommercialAgreement = await loadCustomerActiveCommercialAgreement(
    labOrganizationId,
    foundCustomer.id,
    executor,
  );
  let group: { id: number; name: string } | null = null;
  if (foundCustomer.groupId !== null) {
    const [groupRow] = await executor
      .select({ id: customerGroup.id, name: customerGroup.name })
      .from(customerGroup)
      .where(eq(customerGroup.id, foundCustomer.groupId))
      .limit(1);
    group = groupRow ?? null;
  }
  return {
    ...foundCustomer,
    financialSummary,
    activeCommercialAgreement,
    group,
  };
}

/**
 * The id of the laboratory's customer a route parameter names (numeric id, tax
 * id or slug). Throws 400 for an unreadable identifier; a customer that is not
 * there is the caller's 404.
 */
export async function requireLabCustomerId(
  routeIdentifier: string,
  labOrganizationId: string,
) {
  const id = await orgDb(labOrganizationId).transaction((o) =>
    resolveCustomerRouteId(routeIdentifier, labOrganizationId, o),
  );
  if (id === null) throw invalid("invalid_request", "ID invalido");
  return id;
}

/**
 * The laboratory's customer a route parameter names (numeric id, tax id or
 * slug). Throws 400 for an unreadable identifier and 404 when no customer of
 * this laboratory matches.
 */
export async function requireLabCustomer(
  routeIdentifier: string,
  labOrganizationId: string,
) {
  const id = await requireLabCustomerId(routeIdentifier, labOrganizationId);
  const found = await orgDb(labOrganizationId).transaction((o) =>
    getLabCustomerById(id, labOrganizationId, o),
  );
  if (!found) throw notFound("customer_not_found", "Cliente nao encontrado");
  return found;
}
