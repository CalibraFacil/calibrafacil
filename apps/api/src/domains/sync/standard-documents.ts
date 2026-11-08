import { and, eq, inArray } from "drizzle-orm";
import { referenceStandardCertificateDocument } from "@calibra-facil/db/schema";
import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  finalizedStandardCertificateDocument,
  standardCertificateDocumentSnapshot,
} from "@calibra-facil/db/standard-certificate-documents";

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
        finalizedStandardCertificateDocument(),
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
