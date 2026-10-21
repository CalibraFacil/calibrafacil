import { db } from "@calibra-facil/db";
import {
  referenceStandard,
  type StandardSnapshot,
} from "@calibra-facil/db/schema";
import {
  judgeExecutionStandards,
  type JudgedStandardFacts,
  type StandardsJudgement,
  type StandardsJudgementMode,
  type StandardsJudgementRefusalCode,
} from "@calibra-facil/schemas";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { ApiErrorCode } from "@calibra-facil/contracts";
import { invalid } from "../../lib/domain-errors";

/**
 * The cloud's runtime of the one standards judgement (Q12). This file is only a
 * thin fact loader (Drizzle) and the mapping of the refusal codes to the cloud's
 * error surfaces; every rule lives in `judgeExecutionStandards`
 * (`packages/schemas`), shared with the desktop sync apply and the offline
 * local database.
 */

export type StandardsRefusal = Extract<StandardsJudgement, { ok: false }>;

/** The standards a stored snapshot names, once each, in order. */
export function snapshotStandardIds(
  snapshot: StandardSnapshot[] | null | undefined,
): number[] {
  return [...new Set((snapshot ?? []).map((standard) => standard.id))];
}

/**
 * The standards as the standards table has them, for the pure judgement.
 * Tenant-scoped in SQL: only rows of the organization (and, when given, the
 * caller's unit scope) are read, so anything else is simply "not found".
 */
export async function loadStandardFacts(input: {
  standardIds: readonly number[];
  organizationId: string;
  /** The caller's unit scope, as `buildUnitScopeCondition` builds it. */
  unitScope?: SQL;
}): Promise<JudgedStandardFacts[]> {
  if (input.standardIds.length === 0) return [];
  const rows = await db
    .select({
      id: referenceStandard.id,
      name: referenceStandard.name,
      status: referenceStandard.status,
      deletedAt: referenceStandard.deletedAt,
      nextCalibrationDate: referenceStandard.nextCalibrationDate,
    })
    .from(referenceStandard)
    .where(
      and(
        inArray(referenceStandard.id, [...input.standardIds]),
        eq(referenceStandard.organizationId, input.organizationId),
        input.unitScope,
      ),
    );
  return rows.map((row) => ({ ...row, inScope: true }));
}

/**
 * Judge the standards of a job at the cloud: load them from the standards
 * table (organization-scoped) and call the one judgement.
 */
export async function judgeSnapshotStandards(input: {
  standardIds: readonly number[];
  organizationId: string;
  unitScope?: SQL;
  performedAt: Date | null;
  now: Date;
  backdateReason?: string | null;
  mode: StandardsJudgementMode;
  requireBackdateReason?: boolean;
}): Promise<StandardsJudgement> {
  const facts = await loadStandardFacts(input);
  return judgeExecutionStandards(
    {
      standardIds: input.standardIds,
      performedAt: input.performedAt,
      today: input.now,
      backdateReason: input.backdateReason,
      mode: input.mode,
      requireBackdateReason: input.requireBackdateReason,
    },
    facts,
  );
}

/** The pt-BR text of a refusal (names for standards in scope, ids otherwise). */
export function standardsRefusalMessage(refusal: StandardsRefusal): string {
  const names = refusal.standardNames.join(", ");
  switch (refusal.code) {
    case "standard_not_found":
      return `Padroes nao encontrados ou nao pertencem a organizacao: ${refusal.standardIds.join(", ")}`;
    case "standard_deleted":
      return `Os seguintes padroes foram excluidos: ${names}`;
    case "standard_inactive":
      return `Os seguintes padroes nao estao ativos: ${names}`;
    case "standard_expired":
      return `Os seguintes padroes estao com certificado vencido: ${names}`;
    case "standard_backdate_reason_required":
      return `O certificado de ${names} venceu apos a data de execucao; e necessario justificar o lancamento retroativo (motivo do registro retroativo)`;
  }
}

const REFUSAL_API_CODES = {
  standard_not_found: "standard_not_found",
  standard_deleted: "standard_deleted",
  standard_inactive: "standard_inactive",
  standard_expired: "standard_expired",
  standard_backdate_reason_required: "standard_backdate_reason_required",
} satisfies Record<StandardsJudgementRefusalCode, ApiErrorCode>;

/** The registry code (`API_ERROR_CODES`) of a refusal, cloud and public API alike. */
export function standardsRefusalApiCode(
  refusal: StandardsRefusal,
): ApiErrorCode {
  return REFUSAL_API_CODES[refusal.code];
}

/** The cloud's error for a refusal: 400 with the stable code, as before. */
export function standardsRefusalDomainError(refusal: StandardsRefusal) {
  return invalid(
    standardsRefusalApiCode(refusal),
    standardsRefusalMessage(refusal),
    { details: { standardIds: refusal.standardIds } },
  );
}
