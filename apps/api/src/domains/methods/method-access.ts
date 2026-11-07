import { methodRouteId } from "@calibra-facil/shared/route-identifiers";
import { parseNumericRouteIdentifier } from "@calibra-facil/shared/route-identifiers";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import { calibrationMethod } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "../../lib/domain-errors";

/**
 * The id of the laboratory's method a route parameter names (numeric id or
 * route slug), or null when none matches.
 */
export async function resolveMethodRouteId(
  identifier: string,
  organizationId: string,
  executor: Pick<OrgExecutor, "select">,
): Promise<number | null> {
  const numericRouteId = parseNumericRouteIdentifier(identifier);

  if (numericRouteId) {
    const [method] = await executor
      .select({ id: calibrationMethod.id })
      .from(calibrationMethod)
      .where(
        and(
          eq(calibrationMethod.id, numericRouteId),
          eq(calibrationMethod.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (method) return method.id;
  }

  const methods = await executor
    .select({
      id: calibrationMethod.id,
      name: calibrationMethod.name,
      version: calibrationMethod.version,
    })
    .from(calibrationMethod)
    .where(eq(calibrationMethod.organizationId, organizationId));

  return (
    methods.find((method) => methodRouteId(method) === identifier)?.id ?? null
  );
}

/** Like {@link resolveMethodRouteId}; throws 404 when no method matches. */
export async function requireMethodRouteId(
  identifier: string,
  organizationId: string,
  executor: Pick<OrgExecutor, "select">,
): Promise<number> {
  const id = await resolveMethodRouteId(identifier, organizationId, executor);
  if (id === null) throw notFound("method_not_found", "Método nao encontrado");
  return id;
}

/**
 * The laboratory's method a route parameter names, whole row. Throws 404 when
 * no method of this laboratory matches.
 */
export async function requireLabMethod(
  identifier: string,
  organizationId: string,
  executor: Pick<OrgExecutor, "select">,
) {
  const id = await requireMethodRouteId(identifier, organizationId, executor);
  const [found] = await executor
    .select()
    .from(calibrationMethod)
    .where(
      and(
        eq(calibrationMethod.id, id),
        eq(calibrationMethod.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!found) throw notFound("method_not_found", "Método nao encontrado");
  return found;
}
