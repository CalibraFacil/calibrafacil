import { db } from "@calibra-facil/db";
import { customer, customerGroup } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import {
  loadCustomerActiveCommercialAgreement,
  loadCustomerFinancialSummary,
} from "./finance";

export async function getLabCustomerById(
  customerId: number,
  labOrganizationId: string,
) {
  const [foundCustomer] = await db
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

  const [financialSummary, activeCommercialAgreement, group] =
    await Promise.all([
      loadCustomerFinancialSummary(labOrganizationId, foundCustomer.id),
      loadCustomerActiveCommercialAgreement(labOrganizationId, foundCustomer.id),
      // Secondary lookup (keeps the whole-row select() above intact) so the
      // detail payload can show which group/rede the customer belongs to.
      foundCustomer.groupId === null
        ? Promise.resolve(null)
        : db
            .select({ id: customerGroup.id, name: customerGroup.name })
            .from(customerGroup)
            .where(eq(customerGroup.id, foundCustomer.groupId))
            .limit(1)
            .then((rows) => rows[0] ?? null),
    ]);

  return {
    ...foundCustomer,
    financialSummary,
    activeCommercialAgreement,
    group,
  };
}
