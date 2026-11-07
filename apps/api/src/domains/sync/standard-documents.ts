import { and, eq, inArray, like, not } from "drizzle-orm";
import {
  referenceStandardCertificateDocument,
  type ReferenceStandardCertificateDocumentSnapshot,
} from "@calibra-facil/db/schema";
import type { OrgDb } from "@calibra-facil/db/for-org";

/**
 * The current certificate document of each standard travels with the standard (the
 * desktop shows it offline). Read through the organization-bound handle.
 */
export async function attachReferenceStandardCertificateDocuments<
  TStandard extends Record<string, unknown>,
>(o: OrgDb, standards: TStandard[]) {
  const ids = standards.flatMap((standard) =>
    typeof standard.id === "number" ? [standard.id] : [],
  );
  if (ids.length === 0) {
    return standards.map((standard) => ({
      ...standard,
      certificateDocument: null,
    }));
  }

  const currentDocuments = await o
    .select()
    .from(referenceStandardCertificateDocument)
    .where(
      and(
        inArray(referenceStandardCertificateDocument.standardId, ids),
        eq(referenceStandardCertificateDocument.isCurrent, true),
        not(like(referenceStandardCertificateDocument.r2Key, "pending/%")),
      ),
    );
  const certificateNumbers = new Map(
    standards.flatMap((standard) =>
      typeof standard.id === "number"
        ? [[standard.id, standard.certificateNumber] as const]
        : [],
    ),
  );
  const documentsByStandardId = new Map(
    currentDocuments
      .filter(
        (document) =>
          certificateNumbers.get(document.standardId) ===
          document.certificateNumber,
      )
      .map((document) => [
        document.standardId,
        standardCertificateDocumentSnapshot(document),
      ]),
  );

  return standards.map((standard) => ({
    ...standard,
    certificateDocument:
      typeof standard.id === "number"
        ? (documentsByStandardId.get(standard.id) ?? null)
        : null,
  }));
}

function standardCertificateDocumentSnapshot(
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
