import { customerGroup } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { invalid, notFound } from "../../lib/domain-errors";
import { orgDb } from "../../lib/org-db";

/** The numeric id of a customer-group route parameter; throws 400 when unreadable. */
export function requireGroupRouteId(routeIdentifier: string): number {
  const id = Number.parseInt(routeIdentifier, 10);
  if (Number.isNaN(id)) throw invalid("invalid_request", "ID invalido");
  return id;
}

/**
 * The laboratory's customer group a route parameter names, with the CLIENT
 * organization behind it: the cross-tenant gate of the group's member and
 * invitation endpoints. Throws 400 for an unreadable id and 404 when the group
 * is not this laboratory's.
 */
export async function requireLabGroup(
  routeIdentifier: string,
  labOrganizationId: string,
) {
  const id = requireGroupRouteId(routeIdentifier);
  const [group] = await orgDb(labOrganizationId).transaction((o) =>
    o
      .select({
        id: customerGroup.id,
        authOrganizationId: customerGroup.authOrganizationId,
      })
      .from(customerGroup)
      .where(
        and(
          eq(customerGroup.id, id),
          eq(customerGroup.labOrganizationId, labOrganizationId),
        ),
      )
      .limit(1),
  );
  if (!group) {
    throw notFound("customer_group_not_found", "Grupo nao encontrado");
  }
  return group;
}
