import { formatLabDayKey } from "@calibra-facil/documents";

const HOUR_MS = 60 * 60 * 1000;

/**
 * The instant the laboratory's calendar day of `date` began. The server clock
 * runs in UTC, so `setHours(0, 0, 0, 0)` would start the day three hours into
 * the previous evening in Sao Paulo.
 *
 * Found by walking back hour by hour from `date` until the previous hour is a
 * different laboratory day (the zone's offsets are whole hours).
 */
export function startOfLabDay(date: Date): Date {
  const key = formatLabDayKey(date);
  let candidate = new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
  // The day is at most 25 hours long (a DST change); the bound guards the loop.
  for (let step = 0; step < 26; step += 1) {
    const earlier = new Date(candidate.getTime() - HOUR_MS);
    if (formatLabDayKey(earlier) !== key) return candidate;
    candidate = earlier;
  }
  return candidate;
}

/** The last millisecond of the laboratory's calendar day of `date`. */
export function endOfLabDay(date: Date): Date {
  const start = startOfLabDay(date);
  // Any instant inside the next day, then back to that day's start.
  const nextDay = new Date(start.getTime() + 30 * HOUR_MS);
  return new Date(startOfLabDay(nextDay).getTime() - 1);
}
