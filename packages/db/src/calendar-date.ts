import { customType } from "drizzle-orm/pg-core";
import {
  calendarDateFromKey,
  calendarDateKey,
} from "@calibra-facil/shared/calendar-date";

/**
 * Column type for a CALENDAR DAY (a due date, a standard's next calibration
 * date, an accreditation bound): a Postgres `date`, not a `timestamp`.
 *
 * In TypeScript it stays a `Date`, so callers and DTOs do not change:
 *  - writing, any `Date` is stored as the day it names. One rule decides that
 *    day (see `calendarDateKey`): an exact-UTC-midnight value is its UTC day,
 *    any other instant is its America/Sao_Paulo day. A typed day (UTC
 *    midnight), the web's local noon (~15:00Z) and a generated instant with a
 *    time of day all land on the day the user means.
 *  - reading, the stored day comes back as UTC midnight of that day.
 *
 * Drizzle operators on the column (`lt(col, date)`, `gte`, `between`...) send
 * their `Date` parameter through the same write conversion, so they compare
 * days. "Today" is `labToday()` (@calibra-facil/shared), never `new Date()`
 * passed raw by accident of the UTC server clock.
 */
export const calendarDateColumnType = {
  dataType: () => "date",
  toDriver(value: Date): string {
    return calendarDateKey(value);
  },
  fromDriver(value: string | Date): Date {
    const day = driverValueToDay(value);
    if (!day) throw new RangeError(`Invalid calendar date from driver`);
    return day;
  },
};

function driverValueToDay(value: string | Date): Date | null {
  if (typeof value === "string") return calendarDateFromKey(value);
  if (Number.isNaN(value.getTime())) return null;
  // Some drivers parse a `date` into a Date at midnight of the process's zone
  // (node-postgres); the runtime zone is UTC in production, but read the
  // wall-clock day that driver meant when it is not.
  if (
    value.getUTCHours() !== 0 &&
    value.getHours() === 0 &&
    value.getMinutes() === 0 &&
    value.getSeconds() === 0 &&
    value.getMilliseconds() === 0
  ) {
    return new Date(
      Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
    );
  }
  return calendarDateFromKey(calendarDateKey(value));
}

export const calendarDate = customType<{
  data: Date;
  driverData: string | Date;
}>(calendarDateColumnType);
