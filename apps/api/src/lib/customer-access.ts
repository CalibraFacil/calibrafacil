import { db } from "@calibra-facil/db";
import { customer } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";

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

  return foundCustomer ?? null;
}
