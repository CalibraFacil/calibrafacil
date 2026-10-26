/**
 * Migration journal hygiene (`drizzle/meta/_journal.json`).
 *
 * drizzle's migrator applies a migration only when its `when` is greater than the `created_at`
 * of the last one applied, so an entry whose `when` is not strictly larger than every entry
 * before it is silently skipped on a database that already has a later one. The journal is
 * hand-written (CLAUDE.md), so nothing else keeps it honest. History is not rewritten: the
 * violations that already exist are listed explicitly below, and everything after them must
 * follow the rule.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type JournalEntry = { idx: number; version: string; when: number; tag: string };

const DRIZZLE_DIR = new URL("../drizzle/", import.meta.url);

function readJournal(): JournalEntry[] {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL("meta/_journal.json", DRIZZLE_DIR), "utf8"),
  );
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("entries" in parsed) ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error("_journal.json has no entries array");
  }
  return parsed.entries.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("idx" in entry) ||
      typeof entry.idx !== "number" ||
      !("when" in entry) ||
      typeof entry.when !== "number" ||
      !("tag" in entry) ||
      typeof entry.tag !== "string"
    ) {
      throw new Error(`malformed journal entry: ${JSON.stringify(entry)}`);
    }
    return { idx: entry.idx, version: "7", when: entry.when, tag: entry.tag };
  });
}

/**
 * Entries whose `when` is not above the largest `when` before them. Historical: migrations
 * 0058-0067 were authored on a branch while 0057 carried a later timestamp, and 0072-0076 while
 * 0071 did. The last historical entry is `LAST_HISTORICAL_WHEN_TAG`; every entry after it is held
 * to the strict rule.
 */
const HISTORICAL_NON_MONOTONIC_WHEN: readonly string[] = [
  "0058_dusty_paibok",
  "0059_youthful_unicorn",
  "0060_integration_composite_unique",
  "0061_cron_run",
  "0062_outbox_claim_lease",
  "0063_permissionaria_authorization",
  "0064_email_suppression",
  "0065_customer_owned_calibration_interval",
  "0066_legal_metrology_regime",
  "0067_asset_installed_at",
  "0072_material_catalog",
  "0073_billing_item_material",
  "0074_material_stock_snapshot",
  "0075_legal_verification_due_index",
  "0076_official_sealing_mark_terminology",
];
const LAST_HISTORICAL_WHEN_TAG = "0076_official_sealing_mark_terminology";

/**
 * Migration 0121 was never committed, so from 0122 on `idx` runs one ahead of the array
 * position. This is a fixed historical offset: no further gap may be introduced.
 */
const FIRST_TAG_AFTER_IDX_GAP = "0122_sync_change_log";
const IDX_GAP_OFFSET = 1;

const journal = readJournal();

describe("migration journal", () => {
  it("idx is the array position (offset by the one historical 0121 gap)", () => {
    const gapPosition = journal.findIndex(
      (entry) => entry.tag === FIRST_TAG_AFTER_IDX_GAP,
    );
    expect(gapPosition, "the 0122 entry is gone").toBeGreaterThan(0);
    const mismatches = journal.flatMap((entry, position) => {
      const expected =
        position < gapPosition ? position : position + IDX_GAP_OFFSET;
      return entry.idx === expected
        ? []
        : [`${entry.tag}: idx ${entry.idx}, expected ${expected}`];
    });
    expect(mismatches).toEqual([]);
  });

  it("each tag starts with its idx and has its .sql file, and every .sql file is journaled", () => {
    const files = readdirSync(DRIZZLE_DIR)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => file.slice(0, -".sql".length))
      .sort();
    expect(files).toEqual(journal.map((entry) => entry.tag).sort());
    for (const entry of journal) {
      expect(
        entry.tag.startsWith(`${String(entry.idx).padStart(4, "0")}_`),
      ).toBe(true);
    }
  });

  it("the historical non-monotonic `when` entries are exactly the allowlisted ones", () => {
    const lastHistorical = journal.findIndex(
      (entry) => entry.tag === LAST_HISTORICAL_WHEN_TAG,
    );
    expect(lastHistorical, "the last historical entry is gone").toBeGreaterThan(
      0,
    );
    let highest = 0;
    const offenders: string[] = [];
    for (const entry of journal.slice(0, lastHistorical + 1)) {
      if (entry.when <= highest) offenders.push(entry.tag);
      highest = Math.max(highest, entry.when);
    }
    expect(offenders).toEqual([...HISTORICAL_NON_MONOTONIC_WHEN]);
  });

  it("every entry after the historical ones has a `when` above all entries before it", () => {
    const lastHistorical = journal.findIndex(
      (entry) => entry.tag === LAST_HISTORICAL_WHEN_TAG,
    );
    const offenders: string[] = [];
    let highest = Math.max(
      ...journal.slice(0, lastHistorical + 1).map((entry) => entry.when),
    );
    for (const entry of journal.slice(lastHistorical + 1)) {
      if (entry.when <= highest) {
        offenders.push(
          `${entry.tag}: when ${entry.when} is not above ${highest}; use a strictly larger \`when\` than the last entry`,
        );
      }
      highest = Math.max(highest, entry.when);
    }
    expect(offenders).toEqual([]);
  });
});
