import { calendarDateFromKey, calendarDateKey } from "@calibra-facil/shared";

/**
 * A calendar date (an instrument's next calibration, a standard's validity, a
 * job's due date) as "15/10/2026", the day it names: UTC midnight of that day
 * for a stored `date` value, the Sao Paulo day for any other instant. Printed
 * in UTC so it does not move with the zone the server runs in.
 */
export function formatCalendarDateBR(date: Date): string {
  const day = calendarDateFromKey(calendarDateKey(date));
  if (!day) return "";
  return day.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}
