import { startOfLabMonth } from "@calibra-facil/documents";
import { endOfLabDay } from "./lab-day";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The time windows the dashboard counts over. "This month" and "today" are the
 * laboratory's calendar (Sao Paulo), not the server's: the API runs in UTC, so
 * reading them from the server clock would roll the month over, and close
 * "due today", three hours before the laboratory's midnight.
 */
export function getDashboardWindows(now: Date) {
  return {
    startOfMonth: startOfLabMonth(now),
    endOfToday: endOfLabDay(now),
    thirtyDaysFromNow: new Date(now.getTime() + 30 * DAY_MS),
    sevenDaysFromNow: new Date(now.getTime() + 7 * DAY_MS),
    ninetyDaysAgo: new Date(now.getTime() - 90 * DAY_MS),
  };
}
