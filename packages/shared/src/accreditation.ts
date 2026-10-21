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

// The vigência window is a pair of CALENDAR DAYS of the laboratory, not a pair
// of UTC instants. The API and worker clocks run in UTC, so an instant at
// 23:30 -03:00 on the window's last day is already the next UTC day.
// (Same zone as `LAB_TIME_ZONE` in @calibra-facil/documents, which depends on
// this package and so cannot be imported here.)
const ACCREDITATION_TIME_ZONE = "America/Sao_Paulo";

const LAB_CLOCK = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: ACCREDITATION_TIME_ZONE,
});

function labClock(date: Date) {
  const parts = Object.fromEntries(
    LAB_CLOCK.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function dayKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The laboratory's calendar day of an instant, as "2027-03-05". */
function labDayKey(date: Date): string {
  const { year, month, day } = labClock(date);
  return dayKey(year, month, day);
}

/** The instant the laboratory's calendar day `year-month-day` begins (00:00). */
function startOfLabDayInstant(year: number, month: number, day: number): Date {
  const wallClockAsUtc = Date.UTC(year, month - 1, day);
  let instant = wallClockAsUtc;
  // The zone's offset on that day, found by reading the guess back in the zone
  // (a second pass settles days whose offset differs from the first guess's).
  for (let pass = 0; pass < 2; pass += 1) {
    const read = labClock(new Date(instant));
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
