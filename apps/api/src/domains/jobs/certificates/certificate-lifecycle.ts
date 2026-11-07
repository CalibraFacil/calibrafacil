import {
  issuedCertificateSnapshot,
  issuedCertificateStatusEvent,
} from "@calibra-facil/db/schema";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import {
  deriveCertificateLifecycle,
  type CertificateLifecycle,
  type CertificateStatusEventLike,
} from "@calibra-facil/schemas";
import { asc, inArray } from "drizzle-orm";

/**
 * Reads of the certificate lifecycle (ISO/IEC 17025 §7.8.8, §7.10): the state of
 * an issued certificate is the latest row of its append-only status stream
 * (`issued_certificate_status_event`, migration 0130). The verification page,
 * the portal and the lab app all derive it here, with the same pure function the
 * worker uses (`deriveCertificateLifecycle` in `@calibra-facil/schemas`).
 */

export type CertificateLifecycleReader = Pick<OrgExecutor, "select">;

/** What a lifecycle read needs to know about a job. */
export type LifecycleJobRef = {
  id: number;
  /** The job's own `superseded_by_id`, used when the stream has no event yet. */
  supersededById: number | null;
};

/**
 * The lifecycle of each job's certificate. A job that has no issued certificate
 * (still a draft, say) is absent from the result. `reader` is bound to the
 * laboratory (an `orgDb` handle, or the portal's `orgSetDb`), so the read stays
 * in the tenant.
 */
export async function loadCertificateLifecycles(
  reader: CertificateLifecycleReader,
  jobs: readonly LifecycleJobRef[],
): Promise<Map<number, CertificateLifecycle>> {
  const lifecycles = new Map<number, CertificateLifecycle>();
  if (jobs.length === 0) return lifecycles;
  const jobIds = jobs.map((job) => job.id);

  const certificates = await reader
    .select({ jobId: issuedCertificateSnapshot.jobId })
    .from(issuedCertificateSnapshot)
    .where(inArray(issuedCertificateSnapshot.jobId, jobIds));
  const issuedJobIds = new Set(certificates.map((row) => row.jobId));

  const rows = await reader
    .select({
      id: issuedCertificateStatusEvent.id,
      jobId: issuedCertificateStatusEvent.jobId,
      event: issuedCertificateStatusEvent.event,
      reason: issuedCertificateStatusEvent.reason,
      occurredAt: issuedCertificateStatusEvent.occurredAt,
    })
    .from(issuedCertificateStatusEvent)
    .where(inArray(issuedCertificateStatusEvent.jobId, jobIds))
    .orderBy(asc(issuedCertificateStatusEvent.id));
  const eventsByJob = new Map<number, CertificateStatusEventLike[]>();
  for (const { jobId, ...event } of rows) {
    const events = eventsByJob.get(jobId) ?? [];
    events.push(event);
    eventsByJob.set(jobId, events);
  }

  for (const job of jobs) {
    if (!issuedJobIds.has(job.id)) continue;
    lifecycles.set(
      job.id,
      deriveCertificateLifecycle(
        eventsByJob.get(job.id) ?? [],
        job.supersededById,
      ),
    );
  }
  return lifecycles;
}

/** The withdrawal, when the certificate's latest state is WITHDRAWN. */
export function withdrawalOf(lifecycle: CertificateLifecycle | undefined): {
  withdrawnAt: Date;
  reason: string | null;
} | null {
  if (!lifecycle || lifecycle.status !== "WITHDRAWN" || !lifecycle.latest) {
    return null;
  }
  return {
    withdrawnAt: new Date(lifecycle.latest.occurredAt),
    reason: lifecycle.latest.reason,
  };
}
