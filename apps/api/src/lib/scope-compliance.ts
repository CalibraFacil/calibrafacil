/**
 * Accredited-scope (CMC) classification for a calibration job — the server
 * side of the ISO/IEC 17025 §7.6/§7.8.3 · ILAC P14 guard (#427 Phase 0).
 *
 * Runs at submit (technician warning) and at approval (authoritative,
 * frozen into `calibration_job.scope_compliance_*`). Server-side on purpose:
 * the check must not be bypassable by the client. Pure comparison logic lives
 * in `@calibra-facil/shared` (scope-compliance.ts) so desktop can share it.
 *
 * Returns `null` (nothing stamped) when the guard does not apply: the
 * certificate would not carry the accreditation seal, or the lab has no
 * scope lines configured for the job's unit. Phase 0 never blocks.
 */

import { db } from "@calibra-facil/db";
import {
  accreditedScopeLine,
  organization,
  type AssetSnapshot,
  type MethodSnapshot,
} from "@calibra-facil/db/schema";
import {
  evaluateScopeCompliance,
  extractScopeEvaluationPoints,
  shouldRenderAccreditationSeal,
  type ScopeComplianceResult,
  type ScopeEnforcementMode,
} from "@calibra-facil/shared";
import { and, eq } from "drizzle-orm";

export type JobScopeClassification = {
  /** Null when the guard does not apply (no seal, or no scope lines). */
  compliance: ScopeComplianceResult | null;
  /** Org-level guard behavior (#427 Phase 1); 'warn' when the org is absent. */
  enforcementMode: ScopeEnforcementMode;
};

/** An adverse classification — the two statuses enforce mode blocks on. */
export function isAdverseScopeCompliance(
  compliance: ScopeComplianceResult | null | undefined,
): boolean {
  return (
    compliance?.status === "OUT_OF_SCOPE" ||
    compliance?.status === "U_BELOW_CMC"
  );
}

export async function classifyJobScopeCompliance(input: {
  organizationId: string;
  unitId: number;
  methodSnapshot: MethodSnapshot;
  assetSnapshot: AssetSnapshot | null;
  data: Record<string, unknown> | null;
  results: Record<string, unknown> | null;
  /** Evaluation instant — emission date at approval, now at submit. */
  atDate: Date;
}): Promise<JobScopeClassification> {
  const [lab] = await db
    .select({
      accreditationActive: organization.accreditationActive,
      accreditationNumber: organization.accreditationNumber,
      accreditationValidFrom: organization.accreditationValidFrom,
      accreditationValidUntil: organization.accreditationValidUntil,
      scopeEnforcementMode: organization.scopeEnforcementMode,
    })
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1);
  const enforcementMode = lab?.scopeEnforcementMode ?? "warn";

  const sealWouldRender =
    lab !== undefined &&
    shouldRenderAccreditationSeal({
      lab,
      methodAccreditedScope: input.methodSnapshot.accreditedScope ?? false,
      atDate: input.atDate,
    });
  if (!sealWouldRender) return { compliance: null, enforcementMode };

  const scopeLines = await db
    .select()
    .from(accreditedScopeLine)
    .where(
      and(
        eq(accreditedScopeLine.organizationId, input.organizationId),
        eq(accreditedScopeLine.unitId, input.unitId),
      ),
    );
  if (scopeLines.length === 0) return { compliance: null, enforcementMode };

  const points = extractScopeEvaluationPoints({
    data: input.data,
    results: input.results,
    formulas: input.methodSnapshot.formulas ?? [],
    dataFields: input.methodSnapshot.dataFields ?? [],
    fallbackUnit: input.assetSnapshot?.baseMeasurementUnit ?? null,
  });

  return {
    compliance: evaluateScopeCompliance({
      scopeLines,
      points,
      atDate: input.atDate,
    }),
    enforcementMode,
  };
}
