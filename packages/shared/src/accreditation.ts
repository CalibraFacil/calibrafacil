/**
 * ISO/IEC 17025 accreditation helpers shared by web, portal, API and worker.
 *
 * The accreditation number is stored as digits only ("0123"); the CGCRE/RBC
 * calibration prefix ("CAL") is a fixed display concern, never persisted.
 */

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

/**
 * Whether `atDate` falls inside the accreditation vigência window. Bounds are
 * independent: a missing side imposes no constraint, so orgs that never filled
 * the window keep the pre-#647 behavior (REQ-CMP-VIG-004).
 */
export function isWithinAccreditationWindow(
  profile: AccreditationProfile,
  atDate: Date,
): boolean {
  const from = toDate(profile.accreditationValidFrom);
  const until = toDate(profile.accreditationValidUntil);
  if (from && atDate < from) return false;
  if (until && atDate > until) return false;
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

/**
 * A certificate carries the accreditation seal only when the lab is accredited
 * (within vigência at `atDate` — the emission date for stored certificates)
 * AND the method that produced it is inside the accredited scope AND the
 * issuance was not downgraded by a documented scope-violation override
 * (#427 Phase 1: an override never issues "accredited anyway" — it issues
 * WITHOUT the seal, per NIE-Cgcre-009/ILAC P8 symbol rules).
 */
export function shouldRenderAccreditationSeal(params: {
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
}): boolean {
  if (params.hasExternalProviderResults === true) return false;

  return (
    isAccreditationActive(params.lab, params.atDate) &&
    params.methodAccreditedScope === true &&
    !params.scopeOverrideJustification?.trim()
  );
}
