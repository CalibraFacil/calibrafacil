import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { jobAuditLog } from "./schema";

/**
 * Migration 0131 creates the audit hash-chain functions, the trigger and the unique
 * index; a database built from schema.ts gets the same objects from
 * sql/schema-extras.sql (the columns and the index are in schema.ts). The two files
 * repeat the same SQL on purpose (a migration is forward-only, the extras file is
 * rebuilt), so these guards fail when one is edited without the other.
 */
function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const BEGIN = "-- BEGIN audit hash chain functions (migration 0131)";
const END = "-- END audit hash chain functions (migration 0131)";

/** The block between the markers, minus the drizzle breakpoints, whitespace-normalized. */
function chainBlock(text: string): string {
  const begin = text.indexOf(BEGIN);
  const end = text.indexOf(END, begin);
  expect(begin, "BEGIN marker").toBeGreaterThan(-1);
  expect(end, "END marker").toBeGreaterThan(begin);
  return text
    .slice(begin, end)
    .split("\n")
    .filter((line) => !line.startsWith("-->"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

const MIGRATION = "../drizzle/0131_audit_hash_chain.sql";

/** Statements of a file with comment lines removed, whitespace-normalized. */
function code(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

describe("audit hash chain SQL: migration 0131 and schema-extras.sql", () => {
  it("REQ-CHAIN-1: schema-extras.sql repeats the functions of the migration verbatim", () => {
    expect(chainBlock(read("../sql/schema-extras.sql"))).toBe(
      chainBlock(read(MIGRATION)),
    );
  });

  it("REQ-CHAIN-1: both create the trigger and the unique index the chain depends on", () => {
    for (const text of [read(MIGRATION), read("../sql/schema-extras.sql")]) {
      const sql = code(text);
      expect(sql).toContain(
        "CREATE TRIGGER job_audit_log_hash_chain BEFORE INSERT ON public.job_audit_log FOR EACH ROW EXECUTE FUNCTION calibra_audit_chain_before_insert()",
      );
      expect(sql).toContain(
        "CREATE UNIQUE INDEX IF NOT EXISTS job_audit_log_org_chain_seq_uidx ON public.job_audit_log USING btree (organization_id, chain_seq)",
      );
    }
  });

  it("REQ-CHAIN-2: the migration locks the table, adds the columns, backfills, indexes and only then creates the trigger", () => {
    const sql = code(read(MIGRATION));
    const order = [
      "SET LOCAL lock_timeout = '5s'",
      "LOCK TABLE public.job_audit_log IN SHARE ROW EXCLUSIVE MODE",
      "ADD COLUMN IF NOT EXISTS chain_seq bigint",
      "CREATE OR REPLACE FUNCTION calibra_audit_chain_backfill",
      "SELECT public.calibra_audit_chain_backfill('job_audit_log')",
      "CREATE UNIQUE INDEX IF NOT EXISTS job_audit_log_org_chain_seq_uidx",
      "CREATE TRIGGER job_audit_log_hash_chain",
    ].map((needle) => sql.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("REQ-CHAIN-2: the migration is journaled after 0130 with a larger timestamp", () => {
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
      (entry: unknown) => tagOf(entry) === "0131_audit_hash_chain",
    );
    expect(index).toBeGreaterThan(0);
    expect(tagOf(entries[index - 1])).toBe(
      "0130_evidence_privileges_owner_hatch",
    );
    expect(whenOf(entries[index])).toBeGreaterThan(whenOf(entries[index - 1]));
  });

  it("REQ-CHAIN-3: the chain covers every column of job_audit_log except its own three, so a new column cannot slip out unhashed", () => {
    const block = chainBlock(read("../sql/schema-extras.sql"));
    const list = /WHEN 'job_audit_log' THEN ARRAY\[(.*?)\]/.exec(block)?.[1];
    expect(list, "column list").toBeDefined();
    const covered = Array.from(
      (list ?? "").matchAll(/'([a-z_]+)'/g),
      (m) => m[1] ?? "",
    );
    const columns = getTableConfig(jobAuditLog).columns.map((c) => c.name);
    const chainOwn = ["chain_seq", "prev_hash", "row_hash"];
    expect([...covered].sort()).toEqual(
      columns.filter((name) => !chainOwn.includes(name)).sort(),
    );
    for (const name of chainOwn) expect(columns).toContain(name);
  });

  it("REQ-CHAIN-3: the trigger serialises per organization with an advisory transaction lock and overwrites whatever the insert carried", () => {
    const block = chainBlock(read("../sql/schema-extras.sql"));
    expect(block).toContain(
      "pg_advisory_xact_lock( hashtextextended(TG_TABLE_NAME || ':' || NEW.organization_id, 7041))",
    );
    expect(block).toContain("NEW.chain_seq := coalesce(v_head_seq, 0) + 1;");
    expect(block).toContain("NEW.prev_hash := v_head_hash;");
    expect(block).toContain("NEW.row_hash := public.calibra_audit_chain_hash(");
  });

  it("REQ-CHAIN-3: the backfill and the rebuild are owner-only", () => {
    const block = chainBlock(read("../sql/schema-extras.sql"));
    const backfill = block.slice(
      block.indexOf("CREATE OR REPLACE FUNCTION calibra_audit_chain_backfill"),
    );
    expect(backfill).toContain("IF NOT public.calibra_session_is_owner() THEN");
  });
});
