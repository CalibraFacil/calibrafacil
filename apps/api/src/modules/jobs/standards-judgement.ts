import { db } from "@calibra-facil/db";
import {
  referenceStandard,
  type StandardSnapshot,
} from "@calibra-facil/db/schema";
import { assessStandardValidity } from "@calibra-facil/schemas";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Submit-time judgement of the standards a job will be recorded with (Q12).
 * Every standard of the FINAL snapshot is read from the standards table and
 * judged on the laboratory day of the FINAL performed date:
 *  - expired on that day: refused;
 *  - valid on that day but expired as of today (the record depends on being
 *    back-dated): refused unless a written justification came with it, even
 *    when the backdate is within the usual 7 days.
 */
export async function judgeSnapshotStandards(input: {
  standardsSnapshot: StandardSnapshot[] | null;
  organizationId: string;
  performedAt: Date;
  now: Date;
  backdateReason: string | undefined;
}): Promise<
  | { ok: true; standardIds: number[]; validOnlyBecauseBackdated: string[] }
  | { ok: false; error: string }
> {
  const standardIds = [
    ...new Set((input.standardsSnapshot ?? []).map((standard) => standard.id)),
  ];
  if (standardIds.length === 0) {
    return { ok: true, standardIds: [], validOnlyBecauseBackdated: [] };
  }

  const rows = await db
    .select({
      id: referenceStandard.id,
      name: referenceStandard.name,
      nextCalibrationDate: referenceStandard.nextCalibrationDate,
    })
    .from(referenceStandard)
    .where(
      and(
        inArray(referenceStandard.id, standardIds),
        eq(referenceStandard.organizationId, input.organizationId),
      ),
    );
  if (rows.length !== standardIds.length) {
    const found = new Set(rows.map((row) => row.id));
    return {
      ok: false,
      error: `Padroes nao encontrados ou nao pertencem a organizacao: ${standardIds.filter((id) => !found.has(id)).join(", ")}`,
    };
  }

  const assessment = assessStandardValidity(rows, input.performedAt, input.now);
  if (assessment.expiredAtPerformed.length > 0) {
    return {
      ok: false,
      error: `Os seguintes padroes estao com certificado vencido: ${assessment.expiredAtPerformed.join(", ")}`,
    };
  }
  if (
    assessment.validOnlyBecauseBackdated.length > 0 &&
    !input.backdateReason
  ) {
    return {
      ok: false,
      error: `O certificado de ${assessment.validOnlyBecauseBackdated.join(", ")} venceu apos a data de execucao; e necessario justificar o lancamento retroativo (motivo do registro retroativo)`,
    };
  }
  return {
    ok: true,
    standardIds,
    validOnlyBecauseBackdated: assessment.validOnlyBecauseBackdated,
  };
}
