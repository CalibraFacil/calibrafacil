import { certificateRelease } from "@calibra-facil/db/schema";
import { inArray } from "drizzle-orm";
import type { CertificateReleaseStatus } from "@calibra-facil/shared";
import { orgSetDb } from "./org-db";

/**
 * Customer-facing release indicator. Provider-neutral. The portal must not
 * see policy modes, audit details, or ERP / provider vocabulary.
 */
export type PortalReleaseStatus = "RELEASED" | "PAYMENT_PENDING";

const HELD_STATUSES: ReadonlySet<CertificateReleaseStatus> = new Set([
  "HELD_FOR_BILLING",
  "HELD_FOR_PAYMENT",
]);

export function toPortalReleaseStatus(
  status: CertificateReleaseStatus | null | undefined,
): PortalReleaseStatus {
  if (status && HELD_STATUSES.has(status)) return "PAYMENT_PENDING";
  // Anything else (RELEASED, RELEASED_BY_EXCEPTION, missing row) defaults to
  // RELEASED so legacy jobs without a release row keep working — backfill
  // already wrote RELEASED rows on migration.
  return "RELEASED";
}

/**
 * Read certificate_release for a list of calibration job ids. Returns a
 * map of jobId → portal release status that callers can use to gate
 * `certificateUrl` for the portal.
 *
 * `organizationId` is the laboratory (or, for the surfaces that list across
 * every laboratory a customer user belongs to, the set of laboratories) the
 * job ids belong to: the lookup runs through the org-bound handle, so a
 * release row of any other laboratory can never be read.
 */
export async function loadPortalReleaseStatuses(params: {
  organizationId: string | readonly string[];
  calibrationJobIds: number[];
}): Promise<Map<number, PortalReleaseStatus>> {
  const out = new Map<number, PortalReleaseStatus>();
  if (params.calibrationJobIds.length === 0) return out;

  const organizationIds =
    typeof params.organizationId === "string"
      ? [params.organizationId]
      : params.organizationId;

  const rows = await orgSetDb(organizationIds)
    .select({
      calibrationJobId: certificateRelease.calibrationJobId,
      status: certificateRelease.status,
    })
    .from(certificateRelease)
    .where(
      inArray(certificateRelease.calibrationJobId, params.calibrationJobIds),
    );

  for (const row of rows) {
    out.set(row.calibrationJobId, toPortalReleaseStatus(row.status));
  }
  return out;
}

/**
 * Apply the portal release gate to a list of rows that include
 * `id` and `certificateUrl`. Returns the same rows with:
 *  - `certificateUrl` set to null when the release is held.
 *  - A `releaseStatus` indicator the portal can render.
 *
 * Provider-neutral by construction. The portal sees no policy or ERP
 * vocabulary.
 */
export async function applyPortalCertificateReleaseGate<
  T extends { id: number; certificateUrl: string | null },
>(
  rows: T[],
  organizationId: string | readonly string[],
): Promise<Array<T & { releaseStatus: PortalReleaseStatus }>> {
  const statuses = await loadPortalReleaseStatuses({
    organizationId,
    calibrationJobIds: rows.map((row) => row.id),
  });

  return rows.map((row) => {
    const status = statuses.get(row.id) ?? "RELEASED";
    return {
      ...row,
      certificateUrl: status === "PAYMENT_PENDING" ? null : row.certificateUrl,
      releaseStatus: status,
    };
  });
}
