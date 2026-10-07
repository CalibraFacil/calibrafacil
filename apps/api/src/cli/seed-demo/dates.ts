import type { Rng } from "./prng";

/**
 * Brazil (the demo lab's clock) is UTC-3 all year. All "working day" logic is
 * done on this shifted clock; the returned instants are plain UTC dates, which
 * is how the database stores them.
 */
export const LAB_UTC_OFFSET_HOURS = -3;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const OFFSET_MS = LAB_UTC_OFFSET_HOURS * HOUR_MS;

const WORK_START_HOUR = 8.5;
const WORK_END_HOUR = 17.5;

/** Wall-clock fields of `date` on the lab clock (read them with the getUTC* methods). */
export function labClock(date: Date): Date {
  return new Date(date.getTime() + OFFSET_MS);
}

/** Instant for a wall-clock time on the lab clock (inverse of `labClock`). */
export function fromLabClock(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  return new Date(Date.UTC(year, month, day, hour, minute) - OFFSET_MS);
}

export function labDayStart(date: Date): Date {
  const clock = labClock(date);
  return fromLabClock(
    clock.getUTCFullYear(),
    clock.getUTCMonth(),
    clock.getUTCDate(),
  );
}

export function isLabWeekday(date: Date): boolean {
  const day = labClock(date).getUTCDay();
  return day >= 1 && day <= 5;
}

/** First instant of the calendar month containing `now`, on the lab clock. */
export function labMonthStart(now: Date): Date {
  const clock = labClock(now);
  return fromLabClock(clock.getUTCFullYear(), clock.getUTCMonth(), 1);
}

function workTime(dayStart: Date, hour: number): Date {
  return new Date(dayStart.getTime() + hour * HOUR_MS);
}

/**
 * Moves an instant backwards, never forwards, to the nearest working moment:
 * weekends fall back to Friday afternoon, evenings to the end of that day's
 * work, early mornings to the previous day's afternoon.
 */
export function toWorkingTime(date: Date): Date {
  let current = date;
  for (let guard = 0; guard < 10; guard += 1) {
    const clock = labClock(current);
    const hour = clock.getUTCHours() + clock.getUTCMinutes() / 60;
    const dayStart = labDayStart(current);
    if (!isLabWeekday(current)) {
      current = workTime(new Date(dayStart.getTime() - DAY_MS), 16.2);
      continue;
    }
    if (hour < WORK_START_HOUR) {
      current = workTime(new Date(dayStart.getTime() - DAY_MS), 16.4);
      continue;
    }
    if (hour > WORK_END_HOUR) return workTime(dayStart, 17.2);
    return current;
  }
  return current;
}

type Day = { start: Date; weight: number; latest: Date };

/**
 * Candidate working days between `from` and `now` (inclusive), each with a
 * random volume weight. A day cannot receive an instant later than `latest`, so
 * today is capped at `now`, and a day that has barely begun gets no weight.
 */
function workingDays(
  from: Date,
  now: Date,
  rng: Rng,
  recencyBoost: boolean,
): Day[] {
  const days: Day[] = [];
  const latestAllowed = new Date(now.getTime() - 10 * 60_000);
  for (
    let start = labDayStart(from);
    start.getTime() <= now.getTime();
    start = new Date(start.getTime() + DAY_MS)
  ) {
    if (!isLabWeekday(start)) continue;
    const dayEnd = workTime(start, WORK_END_HOUR);
    const latest =
      dayEnd.getTime() < latestAllowed.getTime() ? dayEnd : latestAllowed;
    const earliest = workTime(start, WORK_START_HOUR);
    if (latest.getTime() <= earliest.getTime() + 20 * 60_000) continue;
    const open =
      (latest.getTime() - earliest.getTime()) /
      ((WORK_END_HOUR - WORK_START_HOUR) * HOUR_MS);
    const volume = Math.exp(rng.normal(0, 0.35));
    const age = (now.getTime() - start.getTime()) / DAY_MS;
    const recency = recencyBoost ? 1 + Math.max(0, 30 - age) / 60 : 1;
    days.push({ start, weight: volume * recency * Math.min(1, open), latest });
  }
  return days;
}

function instantOn(day: Day, rng: Rng): Date {
  const earliest = workTime(day.start, WORK_START_HOUR);
  const span = day.latest.getTime() - earliest.getTime();
  return new Date(earliest.getTime() + Math.floor(rng.next() * span));
}

function drawFrom(days: readonly Day[], count: number, rng: Rng): Date[] {
  if (days.length === 0 || count <= 0) return [];
  const weights = days.map((day) => day.weight);
  return Array.from({ length: count }, () =>
    instantOn(rng.weighted(days, weights), rng),
  );
}

export type ApprovalSpread = {
  /** Number of approvals to place. */
  total: number;
  /** How many of them fall in the last 30 days (the dashboard's default chart). */
  inLast30Days: number;
  /** Floor for the current calendar month, so "approved this month" is never empty. */
  minThisMonth: number;
  /** Total window, in days. */
  windowDays: number;
};

/**
 * Decision timestamps for the demo history: working days only, working hours
 * only, never in the future. Most land in the last 30 days (the default chart
 * window), the rest taper off back to `windowDays`, and the current month is
 * guaranteed at least `minThisMonth` of them.
 */
export function spreadApprovals(
  now: Date,
  spec: ApprovalSpread,
  rng: Rng,
): Date[] {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const windowStart = new Date(now.getTime() - spec.windowDays * DAY_MS);
  const monthStart = labMonthStart(now);

  const recentDays = workingDays(thirtyDaysAgo, now, rng, true);
  const olderDays = workingDays(
    windowStart,
    new Date(thirtyDaysAgo.getTime() - DAY_MS),
    rng,
    false,
  );
  const recent = drawFrom(recentDays, spec.inLast30Days, rng);
  const older = drawFrom(olderDays, spec.total - spec.inLast30Days, rng);

  const all = [...older, ...recent];
  const monthDays = workingDays(monthStart, now, rng, true);
  const inMonth = all.filter(
    (date) => date.getTime() >= monthStart.getTime(),
  ).length;
  const shortfall = spec.minThisMonth - inMonth;
  if (shortfall > 0) {
    // Pull the earliest approvals of the window forward into this month.
    all.sort((a, b) => a.getTime() - b.getTime());
    if (monthDays.length > 0) {
      const moved = drawFrom(monthDays, shortfall, rng);
      all.splice(0, moved.length, ...moved);
    } else {
      // The month has barely started (a weekend or the first minutes of the 1st):
      // spread the shortfall evenly over what is left of it, outside working hours.
      const span = Math.max(
        now.getTime() - 10 * 60_000 - monthStart.getTime(),
        60_000,
      );
      const moved = Array.from(
        { length: shortfall },
        () => new Date(monthStart.getTime() + Math.floor(rng.next() * span)),
      );
      all.splice(0, moved.length, ...moved);
    }
  }
  return all.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Rejection timestamps: two inside the current month (the dashboard shows
 * "rejected this month") and one earlier in the last 30 days.
 */
export function spreadRejections(now: Date, rng: Rng): Date[] {
  const monthStart = labMonthStart(now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const monthDays = workingDays(monthStart, now, rng, false);
  const earlierEnd = new Date(
    Math.min(monthStart.getTime(), now.getTime()) - DAY_MS,
  );
  const earlierDays = workingDays(thirtyDaysAgo, earlierEnd, rng, false);
  const inMonth = drawFrom(
    monthDays.length > 0 ? monthDays : earlierDays,
    2,
    rng,
  );
  const earlier = drawFrom(
    earlierDays.length > 0 ? earlierDays : monthDays,
    1,
    rng,
  );
  return [...earlier, ...inMonth].sort((a, b) => a.getTime() - b.getTime());
}

/** A time on a given day offset from today, at a fixed lab-clock hour (e.g. a due date). */
export function labTimeOnDay(now: Date, dayOffset: number, hour: number): Date {
  const clock = labClock(new Date(now.getTime() + dayOffset * DAY_MS));
  return fromLabClock(
    clock.getUTCFullYear(),
    clock.getUTCMonth(),
    clock.getUTCDate(),
    Math.floor(hour),
    Math.round((hour % 1) * 60),
  );
}
