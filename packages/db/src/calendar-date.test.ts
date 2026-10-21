import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calendarDate, calendarDateColumnType } from "./calendar-date";
import { getTableConfig, PgTable, pgTable, serial } from "drizzle-orm/pg-core";
import { getTableColumns, is } from "drizzle-orm";
import * as schema from "./schema";

describe("calendarDate column type (REQ-CAL-001)", () => {
  const { toDriver, fromDriver } = calendarDateColumnType;

  describe("toDriver: the day the value names", () => {
    it.each([
      // exact UTC midnight names its UTC day
      ["2026-10-15T00:00:00.000Z", "2026-10-15"],
      // 01:30Z and 02:59:59.999Z are the evening of the previous Sao Paulo day
      ["2026-10-15T01:30:00.000Z", "2026-10-14"],
      ["2026-10-15T02:59:59.999Z", "2026-10-14"],
      // 03:00Z is 00:00 in Sao Paulo (an accreditation window start)
      ["2026-10-15T03:00:00.000Z", "2026-10-15"],
      // local noon, as the web date field stores it
      ["2026-10-15T15:00:00.000Z", "2026-10-15"],
      ["2026-10-15T23:59:59.000Z", "2026-10-15"],
      // a hair after UTC midnight is NOT midnight: Sao Paulo evening before
      ["2026-10-15T00:00:00.001Z", "2026-10-14"],
      // pre-2019 DST (UTC-2): 02:30Z is already 00:30 the same day
      ["2018-01-10T02:30:00.000Z", "2018-01-10"],
      ["2018-01-10T01:59:00.000Z", "2018-01-09"],
    ])("%s names %s", (iso, day) => {
      expect(toDriver(new Date(iso))).toBe(day);
    });
  });

  describe("fromDriver: UTC midnight of the stored day", () => {
    it("reads the string a driver returns", () => {
      expect(fromDriver("2026-10-15").toISOString()).toBe(
        "2026-10-15T00:00:00.000Z",
      );
    });

    it("reads a Date a driver returns (UTC midnight, or a date-only Date parsed in local time)", () => {
      expect(
        fromDriver(new Date("2026-10-15T00:00:00.000Z")).toISOString(),
      ).toBe("2026-10-15T00:00:00.000Z");
    });

    it("reads a timestamp-shaped string by the day it names", () => {
      expect(fromDriver("2026-10-15 00:00:00").toISOString()).toBe(
        "2026-10-15T00:00:00.000Z",
      );
    });

    it("round-trips every shape of input to the same stored day", () => {
      for (const iso of [
        "2026-10-15T00:00:00.000Z",
        "2026-10-15T15:00:00.000Z",
        "2026-10-15T03:00:00.000Z",
        "2026-10-15T23:59:59.000Z",
      ]) {
        expect(fromDriver(toDriver(new Date(iso))).toISOString()).toBe(
          "2026-10-15T00:00:00.000Z",
        );
      }
    });
  });

  it("is a Postgres date column whose TypeScript type stays Date", () => {
    const table = pgTable("calendar_probe", {
      id: serial("id").primaryKey(),
      due: calendarDate("due_day").notNull(),
    });
    const column = getTableColumns(table).due;
    expect(column.getSQLType()).toBe("date");
    expect(getTableConfig(table).columns.map((c) => c.name)).toContain(
      "due_day",
    );
    const value: Date = column.mapFromDriverValue("2026-10-15");
    expect(value.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(column.mapToDriverValue(new Date("2026-10-15T15:00:00.000Z"))).toBe(
      "2026-10-15",
    );
  });
});

describe("schema.ts and migration 0116 name the same calendar-date columns (REQ-CAL-002)", () => {
  function declaredCalendarColumns(): string[] {
    const found: string[] = [];
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const config = getTableConfig(value);
      for (const column of config.columns) {
        if (column.getSQLType() === "date") {
          found.push(`${config.name}.${column.name}`);
        }
      }
    }
    return found.sort();
  }

  function migratedColumns(): string[] {
    const migration = readFileSync(
      new URL("../drizzle/0116_calendar_date_columns.sql", import.meta.url),
      "utf8",
    );
    return Array.from(
      migration.matchAll(
        /ALTER TABLE "(\w+)" ALTER COLUMN "(\w+)" TYPE date USING \(CASE WHEN "\2" = date_trunc\('day', "\2"\) THEN "\2"::date ELSE \(\("\2" AT TIME ZONE 'UTC'\) AT TIME ZONE 'America\/Sao_Paulo'\)::date END\);/g,
      ),
      (match) => `${match[1]}.${match[2]}`,
    ).sort();
  }

  it("converts every date column schema.ts declares, with the display rule, and nothing else", () => {
    expect(migratedColumns()).toEqual(declaredCalendarColumns());
    expect(migratedColumns()).toHaveLength(13);
  });

  it("is journaled, with a `when` after the one before it", () => {
    const journal: { entries: Array<{ tag: string; when: number }> } =
      JSON.parse(
        readFileSync(
          new URL("../drizzle/meta/_journal.json", import.meta.url),
          "utf8",
        ),
      );
    // Later migrations are appended after it, so find it by tag, not by position.
    const index = journal.entries.findIndex(
      (entry) => entry.tag === "0116_calendar_date_columns",
    );
    expect(index).toBeGreaterThan(0);
    const last = journal.entries[index];
    const previous = journal.entries[index - 1];
    expect(last?.tag).toBe("0116_calendar_date_columns");
    expect(last?.when).toBeGreaterThan(previous?.when ?? Infinity);
  });
});
