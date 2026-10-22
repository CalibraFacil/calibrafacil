import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOB_TRANSITIONS, JobStatusSchema } from "@calibra-facil/schemas";
import {
  JOB_STATUS_TRIGGER_SQL,
  JOB_TRANSITIONS_SQL_BEGIN,
  JOB_TRANSITIONS_SQL_END,
  allowedStatusPairs,
  creationStatuses,
  jobTransitionsSqlBlock,
} from "./job-transitions-sql";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const MIGRATIONS_DIR = new URL("../drizzle/", import.meta.url);

/** The block between the generated markers of `text`, markers included. */
function blockOf(text: string): string | null {
  const begin = text.indexOf(JOB_TRANSITIONS_SQL_BEGIN);
  if (begin === -1) return null;
  const endMarker = text.indexOf(JOB_TRANSITIONS_SQL_END, begin);
  if (endMarker === -1) return null;
  return text.slice(begin, endMarker + JOB_TRANSITIONS_SQL_END.length);
}

/** Pairs written in the SQL block, as "FROM>TO". */
function pairsInBlock(block: string): string[] {
  return Array.from(
    block.matchAll(/^ {4}\('([A-Z_]+)', '([A-Z_]+)'\),?$/gm),
    (match) => `${match[1]}>${match[2]}`,
  );
}

describe("calibration_job status guard SQL, generated from JOB_TRANSITIONS", () => {
  it("REQ-TRX-3: the generated pairs are exactly the moves of the table (no more, no fewer)", () => {
    const expected = new Set<string>();
    for (const { from, to } of JOB_TRANSITIONS) {
      if (from !== null && from !== to) expected.add(`${from}>${to}`);
    }
    const generated = pairsInBlock(jobTransitionsSqlBlock());
    expect(new Set(generated)).toEqual(expected);
    expect(generated).toHaveLength(expected.size);
    expect(allowedStatusPairs()).toHaveLength(expected.size);
  });

  it("REQ-TRX-3: no way back out of APPROVED, SUPERSEDED or CANCELED in the generated SQL, and none into DRAFT", () => {
    const generated = pairsInBlock(jobTransitionsSqlBlock());
    expect(generated.filter((pair) => pair.startsWith("SUPERSEDED>"))).toEqual(
      [],
    );
    expect(generated.filter((pair) => pair.startsWith("CANCELED>"))).toEqual(
      [],
    );
    expect(generated.filter((pair) => pair.startsWith("APPROVED>"))).toEqual([
      "APPROVED>SUPERSEDED",
    ]);
    expect(generated.filter((pair) => pair.endsWith(">DRAFT"))).toEqual([]);
    for (const status of JobStatusSchema.options) {
      expect(generated).not.toContain(`${status}>${status}`);
    }
  });

  it("REQ-TRX-2: rows are created only in the status `create` lands in", () => {
    expect(creationStatuses()).toEqual(["DRAFT"]);
    expect(jobTransitionsSqlBlock()).toContain("NEW.status IN ('DRAFT')");
  });

  it("REQ-TRX-3: sql/schema-extras.sql carries exactly the block and the trigger the current table generates", () => {
    const extras = read("../sql/schema-extras.sql");
    expect(blockOf(extras)).toBe(jobTransitionsSqlBlock());
    expect(extras).toContain(JOB_STATUS_TRIGGER_SQL);
  });

  it("REQ-TRX-3: the newest migration that defines the guard carries exactly the block the current table generates", () => {
    const defining = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .filter((name) =>
        readFileSync(new URL(name, MIGRATIONS_DIR), "utf8").includes(
          JOB_TRANSITIONS_SQL_BEGIN,
        ),
      );
    expect(
      defining.length,
      "no migration defines the status guard",
    ).toBeGreaterThan(0);
    const newest = defining.at(-1) ?? "";
    const migration = readFileSync(new URL(newest, MIGRATIONS_DIR), "utf8");
    expect(
      blockOf(migration),
      `${newest} is stale: JOB_TRANSITIONS changed, so ship a new migration with the output of \`pnpm --filter @calibra-facil/db gen:job-transitions-sql\` and update sql/schema-extras.sql`,
    ).toBe(jobTransitionsSqlBlock());
    expect(migration).toContain(JOB_STATUS_TRIGGER_SQL);
  });

  it("REQ-TRX-5: the migration states that existing rows are not re-validated, and is journaled after 0118 with a larger timestamp", () => {
    const migration = read("../drizzle/0119_job_status_transition_guard.sql");
    const header = migration.slice(
      0,
      migration.indexOf(JOB_TRANSITIONS_SQL_BEGIN),
    );
    expect(header).toMatch(/not re-?validated/i);
    expect(header).toMatch(/UPDATE/);

    const journal: unknown = JSON.parse(read("../drizzle/meta/_journal.json"));
    const entries =
      typeof journal === "object" && journal !== null && "entries" in journal
        ? journal.entries
        : [];
    if (!Array.isArray(entries)) throw new Error("journal has no entries");
    const tagOf = (entry: unknown) =>
      typeof entry === "object" && entry !== null && "tag" in entry
        ? entry.tag
        : null;
    const whenOf = (entry: unknown) =>
      typeof entry === "object" && entry !== null && "when" in entry
        ? Number(entry.when)
        : Number.NaN;
    const index = entries.findIndex(
      (entry: unknown) => tagOf(entry) === "0119_job_status_transition_guard",
    );
    expect(index, "migration 0119 is not journaled").toBeGreaterThan(0);
    expect(whenOf(entries[index])).toBeGreaterThan(whenOf(entries[index - 1]));
  });

  it("REQ-TRX-4: the audited-repair setting is the only hatch besides the seed one", () => {
    const block = jobTransitionsSqlBlock();
    expect(block).toContain("calibra_history_rewrite_allowed()");
    expect(block).toContain("current_setting('calibra.allow_status_repair'");
  });
});
