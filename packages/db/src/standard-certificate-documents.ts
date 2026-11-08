import { PENDING_OBJECT_KEY_PREFIX } from "@calibra-facil/shared/storage-keys";
import { like, not } from "drizzle-orm";
import {
  referenceStandardCertificateDocument,
  type ReferenceStandardCertificateDocumentSnapshot,
} from "./schema";

/**
 * A reference standard's certificate document, as the other tables see it.
 *
 * The row is written BEFORE its file is uploaded, under a placeholder key
 * (`pendingStandardCertificateKey`); a failed upload leaves that row, which must
 * never count as the current certificate. Every reader (the standards routes,
 * the frozen job snapshot, the desktop pull, the portal) tells a finalized
 * document from a placeholder with these, never with its own copy of the
 * convention.
 */
/** SQL: the certificate document rows whose file was uploaded. */
export function finalizedStandardCertificateDocument() {
  return not(
    like(
      referenceStandardCertificateDocument.r2Key,
      `${PENDING_OBJECT_KEY_PREFIX}%`,
    ),
  );
}

/** The fields of a document row a job snapshot and the desktop pull freeze. */
export function standardCertificateDocumentSnapshot(
  document: typeof referenceStandardCertificateDocument.$inferSelect,
): ReferenceStandardCertificateDocumentSnapshot {
  return {
    documentId: document.id,
    r2Key: document.r2Key,
    fileName: document.fileName,
    fileSize: document.fileSize,
    sha256: document.sha256,
    uploadedAt: document.uploadedAt,
    certificateNumber: document.certificateNumber,
    calibrationDate: document.calibrationDate,
    nextCalibrationDate: document.nextCalibrationDate,
  };
}
