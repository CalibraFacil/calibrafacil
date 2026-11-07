import { db } from "@calibra-facil/db";
import { legalMetrologyRegulation } from "@calibra-facil/db/schema";

/**
 * Reads of the GLOBAL legal-metrology regulation catalog
 * (routes/legal-metrology-regulations.ts). `legal_metrology_regulation` has no
 * organization column and no row-level-security policy (tenancy.ts): the same
 * Portarias apply to every laboratory, so any connection role may read it and
 * the statement stays on the plain `db` handle, in a lib.
 */
export async function listLegalMetrologyRegulations() {
  return db
    .select({
      id: legalMetrologyRegulation.id,
      category: legalMetrologyRegulation.category,
      kind: legalMetrologyRegulation.kind,
      valueMonths: legalMetrologyRegulation.valueMonths,
      byTechnology: legalMetrologyRegulation.byTechnology,
      anchor: legalMetrologyRegulation.anchor,
      operationalizedByDelegate:
        legalMetrologyRegulation.operationalizedByDelegate,
      regulationReference: legalMetrologyRegulation.regulationReference,
      provenance: legalMetrologyRegulation.provenance,
      note: legalMetrologyRegulation.note,
    })
    .from(legalMetrologyRegulation)
    .orderBy(legalMetrologyRegulation.category);
}
