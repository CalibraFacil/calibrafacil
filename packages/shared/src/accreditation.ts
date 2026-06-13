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
};

export type AccreditationStatus = "inactive" | "incomplete" | "active";

/**
 * Single source of truth for "the lab is accredited": the explicit toggle is
 * on AND an accreditation number is present. Drives both the holographic
 * state of the settings seal and seal emission on issued certificates.
 */
export function getAccreditationStatus(
  profile: AccreditationProfile,
): AccreditationStatus {
  if (!profile.accreditationActive) return "inactive";
  return formatAccreditationNumber(profile.accreditationNumber)
    ? "active"
    : "incomplete";
}

export function isAccreditationActive(profile: AccreditationProfile): boolean {
  return getAccreditationStatus(profile) === "active";
}

/**
 * A certificate carries the accreditation seal only when the lab is
 * accredited AND the method that produced it is inside the accredited scope.
 */
export function shouldRenderAccreditationSeal(params: {
  lab: AccreditationProfile;
  methodAccreditedScope: boolean | null | undefined;
}): boolean {
  return (
    isAccreditationActive(params.lab) && params.methodAccreditedScope === true
  );
}
