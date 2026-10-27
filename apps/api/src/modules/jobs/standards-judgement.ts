import type { OrgExecutor } from "@calibra-facil/db/for-org";
import {
  referenceStandard,
  type StandardSnapshot,
} from "@calibra-facil/db/schema";
import {
  judgeDraftExecutionStandards,
  judgeExecutionStandards,
  type DraftStandardsJudgement,
  type JudgedStandardFacts,
  type StandardsJudgement,
  type StandardsJudgementMode,
  type StandardsJudgementRefusalCode,
} from "@calibra-facil/schemas";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { ApiErrorCode } from "@calibra-facil/contracts";
import { invalid } from "../../lib/domain-errors";
import { withOrgReader } from "../../lib/org-transaction";

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
async function loadStandardFacts(
  input: {
    standardIds: readonly number[];
    organizationId: string;
    /** The caller's unit scope, as `buildUnitScopeCondition` builds it. */
    unitScope?: SQL;
  },
  executor?: Pick<OrgExecutor, "select">,
): Promise<JudgedStandardFacts[]> {
  if (input.standardIds.length === 0) return [];
  const rows = await withOrgReader(input.organizationId, executor, (reader) =>
    reader
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
      ),
  );
  return rows.map((row) => ({ ...row, inScope: true }));
}

/**
 * Judge the standards of a job at the cloud: load them from the standards
 * table (organization-scoped) and call the one judgement.
 */
export async function judgeSnapshotStandards(
  input: {
    standardIds: readonly number[];
    organizationId: string;
    unitScope?: SQL;
    performedAt: Date | null;
    now: Date;
    backdateReason?: string | null;
    mode: StandardsJudgementMode;
    requireBackdateReason?: boolean;
  },
  // The caller's org-bound handle (row-level security); absent, a short
  // transaction of its own that names the laboratory.
  executor?: Pick<OrgExecutor, "select">,
): Promise<StandardsJudgement> {
  const facts = await loadStandardFacts(input, executor);
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

/**
 * The same, for a DRAFT save: a standard of the job's saved snapshot
 * (`savedStandardIds`) that has since gone stale is accepted and comes back as
 * a warning; every other standard is judged strictly.
 */
export async function judgeDraftSnapshotStandards(
  input: {
    standardIds: readonly number[];
    savedStandardIds: readonly number[];
    organizationId: string;
    unitScope?: SQL;
    performedAt: Date | null;
    now: Date;
    mode: StandardsJudgementMode;
  },
  executor?: Pick<OrgExecutor, "select">,
): Promise<DraftStandardsJudgement> {
  const facts = await loadStandardFacts(input, executor);
  return judgeDraftExecutionStandards(
    {
      standardIds: input.standardIds,
      savedStandardIds: input.savedStandardIds,
      performedAt: input.performedAt,
      today: input.now,
      mode: input.mode,
    },
    facts,
  );
}

/** The pt-BR text of a refusal (names for standards in scope, ids otherwise). */
function standardsRefusalMessage(refusal: StandardsRefusal): string {
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

/**
 * The same refusal when it is the APPROVAL that re-judged the standards: the
 * stable code and details are unchanged, the message says what to do about it.
 */
export function approvalStandardsRefusalDomainError(refusal: StandardsRefusal) {
  return invalid(
    standardsRefusalApiCode(refusal),
    `${standardsRefusalMessage(refusal)}. A aprovação foi recusada: os padrões de referência são julgados novamente na liberação do certificado (ISO/IEC 17025 §6.4). Substitua o padrão na calibração e submeta-a novamente.`,
    { details: { standardIds: refusal.standardIds } },
  );
}
