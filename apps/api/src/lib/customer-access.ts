import type { OrgDb } from "@calibra-facil/db/for-org";
import { customer, customerGroup } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import {
  loadCustomerActiveCommercialAgreement,
  loadCustomerFinancialSummary,
} from "./finance";
import { inOrgTransaction } from "./org-transaction";

/**
 * The laboratory's customer with its financial summary, active agreement and
 * group. `executor` is the caller's org-bound transaction when it has one
 * (row-level security); without it the reads run in a transaction of their own
 * that names `labOrganizationId`.
 */
export async function getLabCustomerById(
  customerId: number,
  labOrganizationId: string,
  executor?: OrgDb,
) {
  return inOrgTransaction(labOrganizationId, executor, async (o) => {
    const [foundCustomer] = await o
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

    // Sequential: the statements share one transaction (one connection).
    const financialSummary = await loadCustomerFinancialSummary(
      labOrganizationId,
      foundCustomer.id,
      o,
    );
    const activeCommercialAgreement =
      await loadCustomerActiveCommercialAgreement(
        labOrganizationId,
        foundCustomer.id,
        o,
      );
    // Secondary lookup (keeps the whole-row select() above intact) so the
    // detail payload can show which group/rede the customer belongs to.
    let group: { id: number; name: string } | null = null;
    if (foundCustomer.groupId !== null) {
      const [groupRow] = await o
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
  });
}
