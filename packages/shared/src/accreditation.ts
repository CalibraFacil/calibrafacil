/**
 * ISO/IEC 17025 accreditation helpers shared by web, portal, API and worker.
 *
 * The accreditation number is stored as digits only ("0123"); the CGCRE/RBC
 * calibration prefix ("CAL") is a fixed display concern, never persisted.
 */

export const ACCREDITATION_NUMBER_PREFIX = "CAL";

export const ACCREDITATION_SEAL_TITLE = "Calibração";

/** Full prose form, used for labels/aria text. */
export const ACCREDITATION_SEAL_SUBTITLE = "NBR ISO/IEC 17025";

/** Seal header renders the subtitle split across two lines. */
export const ACCREDITATION_SEAL_SUBTITLE_LINE1 = "NBR ISO/IEC";

export const ACCREDITATION_SEAL_SUBTITLE_LINE2 = "17025";

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
 * AND the method that produced it is inside the accredited scope.
 */
export function shouldRenderAccreditationSeal(params: {
  lab: AccreditationProfile;
  methodAccreditedScope: boolean | null | undefined;
  atDate?: Date;
}): boolean {
  return (
    isAccreditationActive(params.lab, params.atDate) &&
    params.methodAccreditedScope === true
  );
}
