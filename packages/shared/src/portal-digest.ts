/**
 * Client-portal due-calibration digest.
 *
 * The cron fires once a day; which opted-in users receive a digest on a given
 * run is purely a function of the date: DAILY subscribers on every run,
 * WEEKLY subscribers only on Mondays (UTC — the cron schedule's timezone).
 */

export type PortalDigestFrequency = "DAILY" | "WEEKLY";

export function portalDigestFrequenciesFor(
  date: Date,
): PortalDigestFrequency[] {
  return date.getUTCDay() === 1 ? ["DAILY", "WEEKLY"] : ["DAILY"];
}
