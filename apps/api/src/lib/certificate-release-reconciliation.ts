import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  serviceOrder,
  serviceOrderCertificateLink,
} from "@calibra-facil/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { recomputeCertificateRelease } from "./certificate-release";

/**
 * Read every calibration job linked (via service_order_certificate_link)
 * to any service order pointing at the given billing document, then trigger
 * a release-state recompute for each. Read-only with respect to
 * `calibration_job.status` and `issued_certificate_snapshot.status` — the
 * recompute only writes `certificate_release` + `certificate_release_audit_log`.
 *
 * Called after the financial reconciliation loop writes a billing-document
 * or installment status change.
 */
export async function recomputeCertificateReleasesForBillingDocument(params: {
  organizationId: string;
  billingDocumentId: number;
}): Promise<{ recomputedJobIds: number[] }> {
  const linkedJobs = await db
    .select({
      jobId: calibrationJob.id,
    })
    .from(serviceOrderCertificateLink)
    .innerJoin(
      serviceOrder,
      eq(serviceOrder.id, serviceOrderCertificateLink.serviceOrderId),
    )
    .innerJoin(
      calibrationJob,
      eq(
        calibrationJob.id,
        serviceOrderCertificateLink.certificateJobId,
      ),
    )
    .where(
      and(
        eq(serviceOrder.organizationId, params.organizationId),
        eq(serviceOrder.billingDocumentId, params.billingDocumentId),
        inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
      ),
    );

  const recomputedJobIds: number[] = [];
  for (const link of linkedJobs) {
    const result = await recomputeCertificateRelease({
      calibrationJobId: link.jobId,
      source: "system_reconciliation",
      actorUserId: null,
    });
    if (result) recomputedJobIds.push(link.jobId);
  }

  return { recomputedJobIds };
}
