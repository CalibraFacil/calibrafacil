import { db } from "@calibra-facil/db";
import {
  memberVisualSignature,
  referenceStandardCertificateDocument,
  serviceOrder,
  serviceOrderAttachment,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";

import { sumStorageUsageForOrganization } from "./storage-usage";

// =============================================================================
// STORAGE USAGE METERING — database wrapper
// =============================================================================
//
// Only the source tables that record an object's byte size on its row can be
// summed accurately without a full (slow/expensive) R2 listing:
//
//   - reference_standard_certificate_document.file_size  (org-scoped column)
//   - service_order_attachment.size_bytes                (org via service_order)
//   - member_visual_signature.file_size                  (org-scoped column)
//
// KNOWN LIMITATION: generated certificate/document PDFs and XLSX workbooks store
// only an `r2_key` (no byte-size column), so they are NOT yet counted. This is a
// partial-but-honest measure — it counts every size-tracked object today and
// grows automatically as more upload paths start recording sizes. Making the
// generated-document tables size-aware is a follow-up (schema migration +
// recording size at write time), deliberately out of scope here to avoid a
// heavy, backfill-requiring change.

/**
 * Real storage usage (bytes) for an organization, summed across every
 * size-tracked source table. Each query is scoped to `organizationId` (the
 * attachment source is scoped through its parent service_order), so no row from
 * another tenant is ever counted.
 */
export async function getOrganizationStorageBytes(
  organizationId: string,
): Promise<number> {
  const [certificateDocuments, attachments, visualSignatures] =
    await Promise.all([
      db
        .select({
          organizationId: referenceStandardCertificateDocument.organizationId,
          bytes: referenceStandardCertificateDocument.fileSize,
        })
        .from(referenceStandardCertificateDocument)
        .where(
          eq(
            referenceStandardCertificateDocument.organizationId,
            organizationId,
          ),
        ),
      db
        .select({
          organizationId: serviceOrder.organizationId,
          bytes: serviceOrderAttachment.sizeBytes,
        })
        .from(serviceOrderAttachment)
        .innerJoin(
          serviceOrder,
          eq(serviceOrderAttachment.serviceOrderId, serviceOrder.id),
        )
        .where(eq(serviceOrder.organizationId, organizationId)),
      db
        .select({
          organizationId: memberVisualSignature.organizationId,
          bytes: memberVisualSignature.fileSize,
        })
        .from(memberVisualSignature)
        .where(eq(memberVisualSignature.organizationId, organizationId)),
    ]);

  return sumStorageUsageForOrganization(organizationId, [
    ...certificateDocuments,
    ...attachments,
    ...visualSignatures,
  ]);
}
