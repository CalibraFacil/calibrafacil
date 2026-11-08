import { parseNumericRouteIdentifier } from "@calibra-facil/shared/route-identifiers";
import { slugifyRouteIdentifier } from "@calibra-facil/shared/route-identifiers";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import { referenceStandard } from "@calibra-facil/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { notFound } from "../../lib/domain-errors";
import { buildUnitScopeCondition } from "../../lib/units";
import type { MemberData } from "../../middleware/permission";

async function resolveStandardRouteId(
  identifier: string,
  member: MemberData,
  executor: Pick<OrgExecutor, "select">,
): Promise<number | null> {
  const stableId =
    parseNumericRouteIdentifier(identifier) ??
    parseTrailingNumericRouteIdentifier(identifier);
  const canMatchSerialNumber = !isPlaceholderSerialIdentifier(identifier);

  const directConditions = [
    eq(referenceStandard.organizationId, member.organizationId),
    buildUnitScopeCondition(referenceStandard.unitId, member),
    isNull(referenceStandard.deletedAt),
  ];

  const [directMatch] = await executor
    .select({
      id: referenceStandard.id,
    })
    .from(referenceStandard)
    .where(
      and(
        ...directConditions,
        stableId
          ? or(
              eq(referenceStandard.id, stableId),
              ...(canMatchSerialNumber
                ? [eq(referenceStandard.serialNumber, identifier)]
                : []),
              eq(referenceStandard.name, identifier),
              eq(referenceStandard.certificateNumber, identifier),
            )
          : or(
              ...(canMatchSerialNumber
                ? [eq(referenceStandard.serialNumber, identifier)]
                : []),
              eq(referenceStandard.name, identifier),
              eq(referenceStandard.certificateNumber, identifier),
            ),
      ),
    )
    .limit(1);

  if (directMatch) return directMatch.id;

  const standards = await executor
    .select({
      id: referenceStandard.id,
      name: referenceStandard.name,
      serialNumber: referenceStandard.serialNumber,
    })
    .from(referenceStandard)
    .where(and(...directConditions));

  return (
    standards.find(
      (standard) =>
        (!isPlaceholderSerialIdentifier(standard.serialNumber) &&
          slugifyRouteIdentifier(standard.serialNumber) === identifier) ||
        slugifyRouteIdentifier(standard.name) === identifier,
    )?.id ?? null
  );
}

function parseTrailingNumericRouteIdentifier(
  identifier: string,
): number | null {
  const match = /-(\d+)$/.exec(identifier);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isPlaceholderSerialIdentifier(value: string | null | undefined) {
  if (!value) return true;
  const normalized = slugifyRouteIdentifier(value);
  return normalized === "n-a" || normalized === "na";
}

/**
 * The id of the laboratory's reference standard a route parameter names
 * (numeric id, serial number, name, certificate number or slug), within the
 * member's unit scope. Throws 404 when none matches.
 */
export async function requireLabStandardId(
  identifier: string,
  member: MemberData,
  executor: Pick<OrgExecutor, "select">,
  message = "Padrão não encontrado",
): Promise<number> {
  const id = await resolveStandardRouteId(identifier, member, executor);
  if (id === null) throw notFound("standard_not_found", message);
  return id;
}

/**
 * The laboratory's live reference standard a route parameter names, within the
 * member's unit scope. Throws 404 when none matches.
 */
export async function requireLabStandard(
  identifier: string,
  member: MemberData,
  executor: Pick<OrgExecutor, "select">,
) {
  const id = await requireLabStandardId(identifier, member, executor);
  const [found] = await executor
    .select()
    .from(referenceStandard)
    .where(
      and(
        eq(referenceStandard.id, id),
        eq(referenceStandard.organizationId, member.organizationId),
        buildUnitScopeCondition(referenceStandard.unitId, member),
        isNull(referenceStandard.deletedAt),
      ),
    )
    .limit(1);
  if (!found) throw notFound("standard_not_found", "Padrão não encontrado");
  return found;
}
