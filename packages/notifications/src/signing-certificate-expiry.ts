/**
 * Pure decision logic for the ICP-Brasil A1 signing-certificate expiry alert
 * (issue #645 · CMP-02). Kept in its OWN module — no DB / wall-clock / email
 * imports — so it is directly unit-testable with fixed dates.
 *
 * An A1 certificate has ~1yr validity. Once it expires, issuance for the unit
 * FAILS CLOSED (P0-8: no unsigned PDF), so the lab is warned ahead of time.
 * This decider only READS the certificate's `validUntil` and decides whether to
 * warn. It does NOT touch signing crypto.
 *
 * Escalating lead windows (days before `validUntil`): 30 → 14 → 7 for signing
 * certificates (P0-8). On any given cron run a certificate belongs to exactly
 * one window — the smallest lead that is still ≥ the days remaining.
 * Idempotency is "per window": once an alert has been recorded for a window
 * (its `leadTimeDays`), that window never re-fires; crossing into the next,
 * smaller window fires a fresh, more urgent alert.
 *
 * The other validity alerts that reuse this decider (the accreditation vigência
 * and the accredited-scope lines) keep their 30 → 15 → 7 windows: they pass no
 * `leadDays`.
 */

/**
 * Lead windows in days before a signing certificate's `validUntil`, from widest
 * to narrowest. The widest (30) defines the overall "within ≤30 days" alerting
 * threshold (REQ-CMP-EXP-001).
 */
export const SIGNING_CERTIFICATE_EXPIRY_LEAD_DAYS = [30, 14, 7] as const;

/** Windows of the other validity alerts (accreditation vigência, scope lines). */
export const DEFAULT_EXPIRY_LEAD_DAYS = [30, 15, 7] as const;

export interface SigningCertificateExpiryInput {
  /** Lead windows to alert at; defaults to {@link DEFAULT_EXPIRY_LEAD_DAYS}. */
  leadDays?: readonly number[];
  /** The certificate's ICP-Brasil validity end (`organizationSigningCertificate.validUntil`). */
  validUntil: Date;
  /** Evaluation instant (the cron run's "now"). */
  now: Date;
  /**
   * Lead windows already alerted for this certificate (the `lead_time_days`
   * values recorded in `scheduled_notification`). Drives idempotency-per-window.
   */
  alreadyAlertedLeadDays: readonly number[];
}

export interface SigningCertificateExpiryDecision {
  /** Whether the cron should emit an alert for this certificate on this run. */
  shouldAlert: boolean;
  /** The window (lead days) the alert belongs to, or null when out of window. */
  leadTimeDays: number | null;
  /** Whole calendar days from `now` to `validUntil` (negative once expired). */
  daysUntilExpiry: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Whole calendar days between two instants, measured in UTC so the result is
 * timezone-stable (the cron runs under TZ=UTC). Positive when `target` is in
 * the future relative to `from`.
 */
export function daysUntilCalendar(from: Date, target: Date): number {
  return Math.round((utcMidnight(target) - utcMidnight(from)) / MS_PER_DAY);
}

/**
 * Decide whether a signing certificate warrants an expiry alert on this run.
 *
 * - REQ-CMP-EXP-001: days-until-expiry within ≤30 (and not yet expired) → alert.
 * - REQ-CMP-EXP-002: a window whose `leadTimeDays` is already recorded does not
 *   re-fire (idempotent per window).
 * - REQ-CMP-EXP-003: out of window (more than 30 days out, or already expired)
 *   → no alert.
 */
export function decideSigningCertificateExpiryAlert(
  input: SigningCertificateExpiryInput,
): SigningCertificateExpiryDecision {
  const daysUntilExpiry = daysUntilCalendar(input.now, input.validUntil);

  const leadDays = input.leadDays ?? DEFAULT_EXPIRY_LEAD_DAYS;
  const widest = Math.max(...leadDays);

  // Out of window: already expired (< 0 — CMP-01 territory, not an early
  // warning) or further out than the widest lead.
  if (daysUntilExpiry < 0 || daysUntilExpiry > widest) {
    return { shouldAlert: false, leadTimeDays: null, daysUntilExpiry };
  }

  // The active window is the smallest lead that still covers the days remaining
  // (30 → 14 → 7: 25 days → the 30 window; 12 → 14; 5 → 7).
  const ascending = [...leadDays].sort((a, b) => a - b);
  const leadTimeDays =
    ascending.find((lead) => daysUntilExpiry <= lead) ?? null;

  if (leadTimeDays === null) {
    return { shouldAlert: false, leadTimeDays: null, daysUntilExpiry };
  }

  // Idempotent per window: already alerted for this window → suppress.
  if (input.alreadyAlertedLeadDays.includes(leadTimeDays)) {
    return { shouldAlert: false, leadTimeDays, daysUntilExpiry };
  }

  return { shouldAlert: true, leadTimeDays, daysUntilExpiry };
}
