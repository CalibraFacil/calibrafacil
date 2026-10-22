/**
 * The ONE judgement of whether the reference standards a calibration is
 * recorded with may be used (owner decisions Q12). Cloud submit, the public
 * API submit, the desktop sync apply and the offline local database all call
 * this function, each with the standards it loaded from its own store, so the
 * desktop cannot record what the cloud would refuse (nor refuse what it would
 * accept) and no path skips a check another one makes.
 *
 * Pure: no database, no clock. The caller loads the facts and passes `today`.
 *
 * The rules:
 *  - a standard that is not in the caller's scope (another organization, or
 *    outside the unit scope) or does not exist is `standard_not_found`;
 *  - a soft-deleted one is `standard_deleted`, a non-ACTIVE one
 *    `standard_inactive`;
 *  - it is valid THROUGH its next-calibration day, judged on the
 *    America/Sao_Paulo day of the instant the work is judged at
 *    (`isStandardValidOn`): expired then is `standard_expired`;
 *  - valid then but expired as of today (the record depends on being
 *    back-dated) needs a written reason, even within the usual 7 days:
 *    `standard_backdate_reason_required` without one.
 *
 * The instant the work is judged at depends on the mode:
 *  - `cloud`: the job's final performed date;
 *  - `desktop_explicit`: the performed date the technician entered offline;
 *  - `desktop_legacy`: an older desktop event carries no performed date, so it
 *    is judged at sync time (`today`), as it always was;
 *  - `public_api`: the route records the work as performed now (`today`), and
 *    takes no back-date reason.
 *
 * When several causes apply, the refusal reports the first in this order:
 * not found, deleted, inactive, expired, back-date reason required.
 */
import { isStandardValidOn } from "./standard-validity";

export type StandardsJudgementMode =
  | "cloud"
  | "public_api"
  | "desktop_explicit"
  | "desktop_legacy";

export type StandardsJudgementInput = {
  /** The ids of the standards of the FINAL snapshot (duplicates are ignored). */
  standardIds: readonly number[];
  /** When the work was performed; ignored by `public_api` and `desktop_legacy`. */
  performedAt: Date | null;
  /** The current instant: the day "expired as of today" is judged on. */
  today: Date;
  /** The written back-date justification that came with the record, if any. */
  backdateReason?: string | null;
  mode: StandardsJudgementMode;
  /**
   * A submission must justify a standard that is valid only because the work
   * is back-dated; a draft save is advisory and does not. Default: true.
   */
  requireBackdateReason?: boolean;
};

/** A standard as the caller's store has it. Absent from the list = not found. */
export type JudgedStandardFacts = {
  id: number;
  name: string;
  status: string;
  /** Set when the standard is soft-deleted. */
  deletedAt: Date | string | null;
  /** The certificate's last valid day; null/unreadable is never valid. */
  nextCalibrationDate: Date | string | null;
  /**
   * The standard belongs to the caller's organization (and, where the caller
   * scopes by unit, to a unit it may use). False reads as not found.
   */
  inScope: boolean;
};

export const STANDARDS_JUDGEMENT_REFUSAL_CODES = [
  "standard_not_found",
  "standard_deleted",
  "standard_inactive",
  "standard_expired",
  "standard_backdate_reason_required",
] as const;

export type StandardsJudgementRefusalCode =
  (typeof STANDARDS_JUDGEMENT_REFUSAL_CODES)[number];

export type StandardsJudgement =
  | {
      ok: true;
      /** Every distinct standard judged, in the order they were named. */
      standardIds: number[];
      /** The instant the standards were judged at. */
      standardsJudgedAt: Date;
      /**
       * Some standard is valid only because the work is back-dated, so the
       * record needs (and, when ok, has) a written reason.
       */
      reasonRequired: boolean;
      /** Those standards. */
      validOnlyBecauseBackdated: Array<{ id: number; name: string }>;
    }
  | {
      ok: false;
      code: StandardsJudgementRefusalCode;
      /** The standards that caused this refusal (every one of that cause). */
      standardIds: number[];
      /**
       * Their names, for messages. Empty for `standard_not_found`: a standard
       * outside the caller's scope never has its name disclosed.
       */
      standardNames: string[];
    };

export function judgeExecutionStandards(
  input: StandardsJudgementInput,
  facts: readonly JudgedStandardFacts[],
): StandardsJudgement {
  const standardIds = [...new Set(input.standardIds)];
  const judgedAt =
    input.mode === "cloud" || input.mode === "desktop_explicit"
      ? (input.performedAt ?? input.today)
      : input.today;

  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const judged: JudgedStandardFacts[] = [];
  const notFound: number[] = [];
  for (const id of standardIds) {
    const fact = factsById.get(id);
    if (fact && fact.inScope) judged.push(fact);
    else notFound.push(id);
  }

  const refuse = (
    code: StandardsJudgementRefusalCode,
    offending: readonly JudgedStandardFacts[],
  ): StandardsJudgement => ({
    ok: false,
    code,
    standardIds: offending.map((fact) => fact.id),
    standardNames: offending.map((fact) => fact.name),
  });

  if (notFound.length > 0) {
    return {
      ok: false,
      code: "standard_not_found",
      standardIds: notFound,
      standardNames: [],
    };
  }

  const deleted = judged.filter((fact) => Boolean(fact.deletedAt));
  if (deleted.length > 0) return refuse("standard_deleted", deleted);

  const inactive = judged.filter((fact) => fact.status !== "ACTIVE");
  if (inactive.length > 0) return refuse("standard_inactive", inactive);

  const validAt = (fact: JudgedStandardFacts, at: Date) =>
    fact.nextCalibrationDate !== null &&
    isStandardValidOn(fact.nextCalibrationDate, at);

  const expired = judged.filter((fact) => !validAt(fact, judgedAt));
  if (expired.length > 0) return refuse("standard_expired", expired);

  const validOnlyBecauseBackdated = judged.filter(
    (fact) => !validAt(fact, input.today),
  );
  const reasonRequired = validOnlyBecauseBackdated.length > 0;
  if (
    reasonRequired &&
    (input.requireBackdateReason ?? true) &&
    !input.backdateReason?.trim()
  ) {
    return refuse(
      "standard_backdate_reason_required",
      validOnlyBecauseBackdated,
    );
  }

  return {
    ok: true,
    standardIds,
    standardsJudgedAt: judgedAt,
    reasonRequired,
    validOnlyBecauseBackdated: validOnlyBecauseBackdated.map((fact) => ({
      id: fact.id,
      name: fact.name,
    })),
  };
}
