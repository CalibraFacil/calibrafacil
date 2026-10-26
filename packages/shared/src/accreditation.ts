/**
 * ISO/IEC 17025 accreditation helpers shared by web, portal, API and worker.
 *
 * The accreditation number is stored as digits only ("0123"); the CGCRE/RBC
 * calibration prefix ("CAL") is a fixed display concern, never persisted.
 */

import { getLabClock } from "./calendar-date.js";

export const ACCREDITATION_NUMBER_PREFIX = "CAL";

/**
 * Upper band of the accreditation symbol: the norm of the accreditation
 * scheme, per NIE-Cgcre-009 rev. 27 (Jul/2024) A.5 —
 * *"Na parte superior do símbolo de acreditação, o OAC deve inserir a norma
 * referente ao esquema de acreditação"*. Rendered on two lines, as in the
 * A.5/A.8 artwork.
 *
 * Rev. 27 changed these words: the previous band read
 * "Calibração / NBR ISO/IEC / 17025" on three lines. "Calibração" is gone —
 * the accreditation TYPE is carried by the `CAL` prefix in the lower band
 * ("codificação do tipo da acreditação", A.8), not spelled out up top.
 * See docs/referencias/nie-cgcre-009-simbolo-acreditacao.md.
 */
export const ACCREDITATION_SEAL_SCHEME = "ABNT NBR ISO/IEC 17025";

export const ACCREDITATION_SEAL_SCHEME_LINE1 = "ABNT NBR";

export const ACCREDITATION_SEAL_SCHEME_LINE2 = "ISO/IEC 17025";

/**
 * A.6.2 — *"A fonte da letra a ser usada no símbolo é a Arial obedecendo a
 * proporcionalidade do símbolo."* Liberation Sans is the metric-compatible
 * substitute present in the Gotenberg Chromium container; Carlito (a Calibri
 * clone) must NOT come first or it wins there and the symbol stops being set
 * in Arial.
 */
export const ACCREDITATION_SEAL_FONT_FAMILY =
  'Arial, "Liberation Sans", Helvetica, sans-serif';

/**
 * Normalizes free-form input (pasted "RBC 0123", "CAL-0123", "0123") down to
 * the digits that get persisted in `organization.accreditation_number`.
 */
export function normalizeAccreditationNumber(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

/** Display form used on seals and documents, e.g. "CAL 0123". */
export function formatAccreditationNumber(
  value: string | null | undefined,
): string | null {
  const digits = normalizeAccreditationNumber(value ?? "");
  return digits ? `${ACCREDITATION_NUMBER_PREFIX} ${digits}` : null;
}

export type AccreditationProfile = {
  accreditationActive?: boolean | null;
  accreditationNumber?: string | null;
  /** Vigência window (#647). Null bounds impose no constraint (REQ-CMP-VIG-004). */
  accreditationValidFrom?: Date | string | null;
  accreditationValidUntil?: Date | string | null;
};

export type AccreditationStatus =
  | "inactive"
  | "incomplete"
  | "active"
  | "expired";

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// The vigência window is a pair of CALENDAR DAYS of the laboratory, not a pair
// of UTC instants. The API and worker clocks run in UTC, so an instant at
// 23:30 -03:00 on the window's last day is already the next UTC day.
// (The laboratory's wall clock comes from ./calendar-date.)

function dayKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The laboratory's calendar day of an instant, as "2027-03-05". */
function labDayKey(date: Date): string {
  const { year, month, day } = getLabClock(date);
  return dayKey(year, month, day);
}

/** The instant the laboratory's calendar day `year-month-day` begins (00:00). */
function startOfLabDayInstant(year: number, month: number, day: number): Date {
  const wallClockAsUtc = Date.UTC(year, month - 1, day);
  let instant = wallClockAsUtc;
  // The zone's offset on that day, found by reading the guess back in the zone
  // (a second pass settles days whose offset differs from the first guess's).
  for (let pass = 0; pass < 2; pass += 1) {
    const read = getLabClock(new Date(instant));
    const readAsUtc = Date.UTC(
      read.year,
      read.month - 1,
      read.day,
      read.hour,
      read.minute,
      read.second,
    );
    instant = wallClockAsUtc - (readAsUtc - instant);
  }
  return new Date(instant);
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A window day ("2027-03-05", the value of a date field) as the instant the
 * laboratory's day starts (00:00) or ends (23:59:59.999) in São Paulo, so the
 * final vigência day is inclusive. Null for anything that is not a real
 * `YYYY-MM-DD` calendar day.
 */
export function accreditationDayToInstant(
  day: string,
  bound: "start" | "end",
): Date | null {
  const match = DAY_PATTERN.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, date));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== date
  ) {
    return null;
  }
  if (bound === "start") return startOfLabDayInstant(year, month, date);
  const nextDay = new Date(Date.UTC(year, month - 1, date + 1));
  const next = startOfLabDayInstant(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
  );
  return new Date(next.getTime() - 1);
}

/**
 * The calendar day a stored window bound names, as "2027-03-05" (null when
 * missing or unparseable). Bounds written by the lab-day anchor
 * ({@link accreditationDayToInstant}) are read in the laboratory's zone.
 * Legacy bounds were anchored in UTC: a start at exactly UTC midnight names
 * that UTC day (read in São Paulo it would be the evening before), and a UTC
 * 23:59:59.999 end already falls on its own day in São Paulo.
 */
export function accreditationBoundDay(
  value: Date | string | null | undefined,
): string | null {
  const date = toDate(value);
  if (!date) return null;
  const isUtcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  if (isUtcMidnight) {
    return dayKey(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    );
  }
  return labDayKey(date);
}

/**
 * Whether `atDate` falls inside the accreditation vigência window, judged by
 * the laboratory's calendar day (both bounds inclusive). Bounds are
 * independent: a missing side imposes no constraint, so orgs that never filled
 * the window keep the pre-#647 behavior (REQ-CMP-VIG-004).
 */
export function isWithinAccreditationWindow(
  profile: AccreditationProfile,
  atDate: Date,
): boolean {
  return isLabDayWithinBounds(
    profile.accreditationValidFrom,
    profile.accreditationValidUntil,
    atDate,
  );
}

/**
 * The same day-based test for any stored vigência pair (the accredited scope
 * lines share the window's anchor): `atDate`'s laboratory day against the
 * days the bounds name, both inclusive, a missing side unconstrained.
 */
export function isLabDayWithinBounds(
  validFrom: Date | string | null | undefined,
  validUntil: Date | string | null | undefined,
  atDate: Date,
): boolean {
  const from = accreditationBoundDay(validFrom);
  const until = accreditationBoundDay(validUntil);
  const day = labDayKey(atDate);
  if (from && day < from) return false;
  if (until && day > until) return false;
  return true;
}

/**
 * Single source of truth for "the lab is accredited": the explicit toggle is
 * on, an accreditation number is present AND `atDate` (default: now) falls
 * inside the vigência window (#647). Drives both the holographic state of the
 * settings seal and seal emission on issued certificates — callers evaluating
 * a stored certificate should pass its EMISSION date, not the viewing time.
 */
export function getAccreditationStatus(
  profile: AccreditationProfile,
  atDate: Date = /* @__PURE__ */ new Date(),
): AccreditationStatus {
  if (!profile.accreditationActive) return "inactive";
  if (!formatAccreditationNumber(profile.accreditationNumber)) {
    return "incomplete";
  }
  if (!isWithinAccreditationWindow(profile, atDate)) return "expired";
  return "active";
}

export function isAccreditationActive(
  profile: AccreditationProfile,
  atDate?: Date,
): boolean {
  return getAccreditationStatus(profile, atDate) === "active";
}

/** What decides whether the lab and the method are eligible for the seal at all. */
export type AccreditationSealEligibilityParams = {
  lab: AccreditationProfile;
  methodAccreditedScope: boolean | null | undefined;
  atDate?: Date;
  /** Frozen `calibration_job.scope_override_justification`; non-empty = downgraded. */
  scopeOverrideJustification?: string | null;
  /**
   * Whether ANY result on this certificate came from an external provider
   * (subcontracted work).
   *
   * FAIL-CLOSED TRIPWIRE, not a finished feature. Subcontracting is not
   * modelled anywhere in the product yet, so this is `undefined` at every
   * call site today and the behaviour is unchanged. It exists so that
   * whoever DOES model it cannot ship the certificate before handling:
   *
   *   NIE-Cgcre-009 §11.5.3 — a certificate bearing the symbol may contain
   *     only accredited results, whether the lab's own or an accredited
   *     external provider's;
   *   §11.5.4 — external results must be identified with the provider's name,
   *     accreditation number and accrediting body;
   *   §11.5.5 — the certificate may NOT bear the symbol at all if every
   *     result came from an external provider.
   *
   * Distinguishing "some external, all accredited" (allowed, §11.5.3 b) from
   * "all external" (forbidden, §11.5.5) needs per-result attribution that does
   * not exist. Until it does, the safe answer to "any external results?" is to
   * suppress the seal — an unsealed certificate is merely not-accredited,
   * whereas a wrongly sealed one is a symbol misuse under §11.1.8.
   */
  hasExternalProviderResults?: boolean;
};

/**
 * The first half of the seal rule: the lab is accredited at `atDate`, the
 * method is inside the accredited scope, nothing downgraded the issuance and
 * no result is external. It says nothing about the calibrated points: the
 * seal is decided by {@link decideAccreditationSeal}, which also needs the
 * frozen scope verdict. This predicate alone is what a record approved before
 * the verdict was frozen (no `certificate_input`) was sealed under.
 */
export function isAccreditationSealEligible(
  params: AccreditationSealEligibilityParams,
): boolean {
  return eligibilityWithheldReason(params) === null;
}

/**
 * The scope (CMC) evaluation frozen at approval, as the seal rule reads it.
 * Structural so the rule does not depend on the scope-compliance module (which
 * depends on this one): `status` is a `ScopeComplianceStatus`, `findings` the
 * frozen findings.
 */
export type AccreditationSealScopeEvaluation = {
  status: string;
  findings?: ReadonlyArray<{ kind: string }> | null;
};

/** Why a certificate was issued WITHOUT the accreditation seal. */
export type AccreditationSealWithheldReason =
  | "external_provider_results"
  | "lab_accreditation_inactive"
  | "lab_accreditation_incomplete"
  | "lab_accreditation_expired"
  | "method_not_in_scope"
  | "scope_override"
  | "scope_out_of_scope"
  | "scope_u_below_cmc"
  | "scope_partially_evaluated"
  | "scope_not_evaluated"
  | "scope_no_scope_lines"
  | "scope_not_assessed";

export type AccreditationSealDecision =
  | { accredited: true; withheldReason: null }
  | { accredited: false; withheldReason: AccreditationSealWithheldReason };

function eligibilityWithheldReason(
  params: AccreditationSealEligibilityParams,
): AccreditationSealWithheldReason | null {
  if (params.hasExternalProviderResults === true) {
    return "external_provider_results";
  }
  switch (getAccreditationStatus(params.lab, params.atDate)) {
    case "inactive":
      return "lab_accreditation_inactive";
    case "incomplete":
      return "lab_accreditation_incomplete";
    case "expired":
      return "lab_accreditation_expired";
    case "active":
      break;
  }
  if (params.methodAccreditedScope !== true) return "method_not_in_scope";
  if (params.scopeOverrideJustification?.trim()) return "scope_override";
  return null;
}

function scopeWithheldReason(
  evaluation: AccreditationSealScopeEvaluation | null | undefined,
): AccreditationSealWithheldReason | null {
  if (!evaluation) return "scope_not_assessed";
  switch (evaluation.status) {
    case "PASS":
      // A positive PASS has no point left unchecked. The findings are read as
      // well so a PASS stored before the partial status existed (it counted
      // as PASS with `not_evaluated` points) can never seal.
      return (evaluation.findings ?? []).some(
        (finding) => finding.kind === "not_evaluated",
      )
        ? "scope_partially_evaluated"
        : null;
    case "OUT_OF_SCOPE":
      return "scope_out_of_scope";
    case "U_BELOW_CMC":
      return "scope_u_below_cmc";
    case "PARTIALLY_EVALUATED":
      return "scope_partially_evaluated";
    case "NOT_EVALUATED":
      return "scope_not_evaluated";
    case "NO_SCOPE_LINES":
      return "scope_no_scope_lines";
    default:
      return "scope_not_assessed";
  }
}

/**
 * Q42 (P0-7). A certificate carries the accreditation seal only when ALL of:
 *
 *  1. the lab is accredited at `atDate` (the emission date for a stored
 *     certificate): toggle on, a number, and the vigência window covers it;
 *  2. the method is inside the accredited scope;
 *  3. no documented scope-violation override downgraded the issuance and no
 *     result is external;
 *  4. the frozen scope evaluation is a positive PASS: every calibrated point
 *     was compared to the accredited scope (zero `not_evaluated`). Anything
 *     else — OUT_OF_SCOPE, U_BELOW_CMC, partially evaluated, not evaluated,
 *     no scope lines configured, or no evaluation at all — issues WITHOUT the
 *     seal (NIE-Cgcre-009 / ILAC P8: an unsealed certificate is merely not
 *     accredited, a wrongly sealed one is a symbol misuse).
 *
 * `scopeEvaluation` has no default on purpose: a caller must say what it knows
 * (`null` = no evaluation), never silently skip the verdict. The decision is
 * taken ONCE, at approval, and frozen in the certificate input; render and
 * verification read it, they do not call this again.
 */
export function decideAccreditationSeal(
  params: AccreditationSealEligibilityParams & {
    scopeEvaluation: AccreditationSealScopeEvaluation | null;
  },
): AccreditationSealDecision {
  const reason =
    eligibilityWithheldReason(params) ??
    scopeWithheldReason(params.scopeEvaluation);
  return reason === null
    ? { accredited: true, withheldReason: null }
    : { accredited: false, withheldReason: reason };
}

export function shouldRenderAccreditationSeal(
  params: Parameters<typeof decideAccreditationSeal>[0],
): boolean {
  return decideAccreditationSeal(params).accredited;
}

/** pt-BR explanation of a withheld seal, for the job and the lab's screens. */
export const ACCREDITATION_SEAL_WITHHELD_MESSAGES_PT: Readonly<
  Record<AccreditationSealWithheldReason, string>
> = {
  external_provider_results:
    "O certificado tem resultados de provedor externo: o símbolo de acreditação não pode ser aplicado.",
  lab_accreditation_inactive:
    "A acreditação do laboratório não está ativa nas configurações.",
  lab_accreditation_incomplete:
    "O número da acreditação não está preenchido nas configurações do laboratório.",
  lab_accreditation_expired:
    "A data de emissão está fora da vigência da acreditação do laboratório.",
  method_not_in_scope: "O método não está no escopo acreditado.",
  scope_override:
    "A emissão foi liberada com justificativa de desvio do escopo acreditado.",
  scope_out_of_scope:
    "Há ponto calibrado fora do escopo acreditado (faixa ou grandeza sem linha de escopo).",
  scope_u_below_cmc:
    "A incerteza expandida reportada é menor que a CMC do escopo acreditado.",
  scope_partially_evaluated:
    "Parte dos pontos não pôde ser comparada ao escopo acreditado (unidade incompatível com a CMC).",
  scope_not_evaluated: "Nenhum ponto pôde ser comparado ao escopo acreditado.",
  scope_no_scope_lines:
    "A unidade não tem linhas de escopo acreditado (CMC) cadastradas; o escopo não pôde ser verificado.",
  scope_not_assessed: "O escopo acreditado não foi avaliado para este job.",
};

/** The pt-BR text for a stored reason code; null for none, the code itself when unknown. */
export function accreditationSealWithheldMessage(
  reason: string | null | undefined,
): string | null {
  if (!reason) return null;
  const known = Object.entries(ACCREDITATION_SEAL_WITHHELD_MESSAGES_PT).find(
    ([code]) => code === reason,
  );
  return known ? known[1] : reason;
}

/**
 * The seal decision of an ISSUED certificate, for the screens that show it
 * (public verification, portal, the lab's job page). The frozen decision
 * (`certificate_input.seal`) is the only authority: the lab's current
 * accreditation fields must not re-decide a certificate that was already
 * issued.
 *
 * A record approved before the input was frozen (migration 0120) has no
 * decision. It keeps the rule it was issued under — the eligibility of the lab
 * and method at the emission date — because the PDF in the customer's hands
 * carries whatever that rule printed; it is never re-judged under a newer rule.
 */
export function resolveIssuedAccreditationSeal(params: {
  frozenSeal:
    | { accredited?: unknown; withheldReason?: unknown }
    | null
    | undefined;
  legacy: AccreditationSealEligibilityParams;
}): {
  accredited: boolean;
  withheldReason: string | null;
  source: "frozen" | "legacy";
} {
  const frozen = params.frozenSeal;
  if (frozen && typeof frozen.accredited === "boolean") {
    return {
      accredited: frozen.accredited,
      withheldReason:
        frozen.accredited || typeof frozen.withheldReason !== "string"
          ? null
          : frozen.withheldReason,
      source: "frozen",
    };
  }
  return {
    accredited: isAccreditationSealEligible(params.legacy),
    withheldReason: null,
    source: "legacy",
  };
}
