import { db } from "@calibra-facil/db";
import { certificateRelease } from "@calibra-facil/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { CertificateReleaseStatus } from "@calibra-facil/shared";

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
 * `certificateUrl` for the portal. Callers must already have scoped the
 * job ids by tenant (the portal customer / org access check that precedes
 * the query in the portal route).
 *
 * `organizationId` is optional defense-in-depth: when provided, the lookup
 * restricts to that org (single-tenant route). For multi-org portal
 * surfaces, pass null/undefined — the unique index on
 * `certificate_release.calibration_job_id` keeps the lookup deterministic.
 */
export async function loadPortalReleaseStatuses(params: {
  organizationId?: string | null;
  calibrationJobIds: number[];
}): Promise<Map<number, PortalReleaseStatus>> {
  const out = new Map<number, PortalReleaseStatus>();
  if (params.calibrationJobIds.length === 0) return out;

  const orgScope = params.organizationId
    ? eq(certificateRelease.organizationId, params.organizationId)
    : undefined;

  const rows = await db
    .select({
      calibrationJobId: certificateRelease.calibrationJobId,
      status: certificateRelease.status,
    })
    .from(certificateRelease)
    .where(
      orgScope
        ? and(
            orgScope,
            inArray(
              certificateRelease.calibrationJobId,
              params.calibrationJobIds,
            ),
          )
        : inArray(
            certificateRelease.calibrationJobId,
            params.calibrationJobIds,
          ),
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
  organizationId?: string | null,
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
