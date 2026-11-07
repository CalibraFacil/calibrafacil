import {
  parseNumericRouteIdentifier,
  serviceRouteId,
} from "@calibra-facil/shared/route-identifiers";
import type { OrgDb } from "@calibra-facil/db/for-org";
import { service } from "@calibra-facil/db/schema";
import { and, eq, or } from "drizzle-orm";
import type { AuthVariables } from "../middleware/permission";
import { invalid, notFound } from "./domain-errors";
import { buildUnitScopeCondition } from "./units";

/**
 * The id of the service in the member's unit scope that a route parameter names
 * (numeric id, name or route slug), or null when none matches. `o` is the
 * caller's org-bound transaction (row-level security).
 */
async function resolveServiceRouteId(
  identifier: string,
  member: AuthVariables["member"],
  o: OrgDb,
): Promise<number | null> {
  const legacyId = parseNumericRouteIdentifier(identifier);
  const directConditions = [eq(service.name, identifier)];

  if (legacyId !== null) {
    directConditions.unshift(eq(service.id, legacyId));
  }

  const [directMatch] = await o
    .select({ id: service.id })
    .from(service)
    .where(
      and(
        eq(service.organizationId, member.organizationId),
        buildUnitScopeCondition(service.unitId, member),
        or(...directConditions)!,
      ),
    )
    .limit(1);

  if (directMatch) {
    return directMatch.id;
  }

  const scopedServices = await o
    .select({ id: service.id, name: service.name })
    .from(service)
    .where(
      and(
        eq(service.organizationId, member.organizationId),
        buildUnitScopeCondition(service.unitId, member),
      ),
    );

  const match = scopedServices.find(
    (candidate) => serviceRouteId(candidate) === identifier,
  );

  return match?.id ?? null;
}

/** The id a route parameter names; throws 400 for an unreadable identifier. */
export async function requireServiceRouteId(
  identifier: string,
  member: AuthVariables["member"],
  o: OrgDb,
): Promise<number> {
  const id = await resolveServiceRouteId(identifier, member, o);
  if (id === null) throw invalid("invalid_request", "ID inválido");
  return id;
}

/**
 * The service in the member's unit scope that a route parameter names, whole
 * row. Throws 400 for an unreadable identifier and 404 when it is not in scope.
 */
export async function requireLabService(
  identifier: string,
  member: AuthVariables["member"],
  o: OrgDb,
) {
  const id = await requireServiceRouteId(identifier, member, o);
  const [found] = await o
    .select()
    .from(service)
    .where(
      and(
        eq(service.id, id),
        eq(service.organizationId, member.organizationId),
        buildUnitScopeCondition(service.unitId, member),
      ),
    )
    .limit(1);
  if (!found) throw notFound("service_not_found", "Serviço não encontrado");
  return found;
}
