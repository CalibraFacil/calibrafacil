import { db } from "@calibra-facil/db";
import { customer } from "@calibra-facil/db/schema";
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

  const [financialSummary, activeCommercialAgreement] = await Promise.all([
    loadCustomerFinancialSummary(labOrganizationId, foundCustomer.id),
    loadCustomerActiveCommercialAgreement(labOrganizationId, foundCustomer.id),
  ]);

  return {
    ...foundCustomer,
    financialSummary,
    activeCommercialAgreement,
  };
}
