import { parseNumericRouteIdentifier } from "@calibra-facil/shared/route-identifiers";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import { calibrationJob } from "@calibra-facil/db/schema";
import { and, eq, or } from "drizzle-orm";
import type { MemberData } from "../../middleware/permission";
import { decodeRouteIdentifier } from "./commands/helpers";
import { notFound } from "../../lib/domain-errors";
import { orgDb } from "../../lib/org-db";
import { buildUnitScopeCondition } from "../../lib/units";

/** The 404 of every job route: no job of this laboratory and unit scope matches. */
export function jobNotFound() {
  return notFound("job_not_found", "Job nao encontrado");
}

/**
 * The job a route identifier names (a numeric id or the certificate number), in
 * the caller's organization and unit scope; `null` when none matches. Reads
 * through the caller's org-bound handle when it passes one, else in a short
 * transaction of its own that names the laboratory (row-level security).
 */
export async function resolveJobRouteId(
  identifier: string,
  memberData: MemberData,
  executor: Pick<OrgExecutor, "select">,
): Promise<number | null> {
  const routeIdentifier = decodeRouteIdentifier(identifier);
  const legacyId = parseNumericRouteIdentifier(routeIdentifier);

  const [job] = await executor
    .select({ id: calibrationJob.id })
    .from(calibrationJob)
    .where(
      and(
        legacyId
          ? or(
              eq(calibrationJob.id, legacyId),
              eq(calibrationJob.jobId, routeIdentifier),
            )
          : eq(calibrationJob.jobId, routeIdentifier),
        eq(calibrationJob.organizationId, memberData.organizationId),
        buildUnitScopeCondition(calibrationJob.unitId, memberData),
      ),
    )
    .limit(1);
  return job?.id ?? null;
}

/** The id of the job a route parameter names; throws 404 when none matches. */
export async function requireJobRouteId(
  identifier: string,
  memberData: MemberData,
): Promise<number> {
  const id = await orgDb(memberData.organizationId).transaction((o) =>
    resolveJobRouteId(identifier, memberData, o),
  );
  if (id === null) throw jobNotFound();
  return id;
}
