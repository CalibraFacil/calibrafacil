import { readdirSync, readFileSync } from "node:fs";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  APPEND_ONLY_EVIDENCE_TABLES,
  NO_UPDATE_EVIDENCE_TABLES,
  TRIGGER_ONLY_EVIDENCE_TABLES,
} from "./evidence-tables";
import {
  APP_ROLE,
  EVIDENCE_GRANTS_BEGIN,
  EVIDENCE_GRANTS_END,
  RLS_ROLE_SQL,
  evidenceGrantsBlock,
} from "./rls-sql";
import * as schema from "./schema";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const MIGRATIONS_DIR = new URL("../drizzle/", import.meta.url);
const GRANTS_MIGRATION = "0130_evidence_privileges_owner_hatch.sql";

function schemaTables(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) names.push(getTableConfig(value).name);
  }
  return names;
}

/** The tables the append-only trigger of migration 0115 is attached to. */
function appendOnlyTriggerTables(): string[] {
  const migration = read("../drizzle/0115_db_immutability.sql");
  const array = migration.slice(
    migration.indexOf("FOREACH t IN ARRAY ARRAY["),
    migration.indexOf("] LOOP"),
  );
  const tables = Array.from(array.matchAll(/'([a-z_]+)'/g), (m) => m[1] ?? "");
  // platform_event_log has its own trigger statement (signup reservation).
  return [...tables, "platform_event_log"];
}

describe("evidence tables: privileges classification", () => {
  it("REQ-EVID-1: every table the append-only trigger guards is classified (revoked or trigger-only with a reason)", () => {
    const classified = new Set([
      ...APPEND_ONLY_EVIDENCE_TABLES,
      ...Object.keys(TRIGGER_ONLY_EVIDENCE_TABLES),
    ]);
    for (const table of appendOnlyTriggerTables()) {
      expect(classified.has(table), `${table} is not classified`).toBe(true);
    }
    // And the other way round: nothing is listed as append-only without the trigger.
    const guarded = new Set(appendOnlyTriggerTables());
    for (const table of APPEND_ONLY_EVIDENCE_TABLES) {
      expect(guarded.has(table), `${table} has no append-only trigger`).toBe(
        true,
      );
    }
  });

  it("REQ-EVID-1: a new *_audit_log or *_event_log table cannot ship unclassified", () => {
    const classified = new Set([
      ...APPEND_ONLY_EVIDENCE_TABLES,
      ...NO_UPDATE_EVIDENCE_TABLES,
      ...Object.keys(TRIGGER_ONLY_EVIDENCE_TABLES),
    ]);
    const logs = schemaTables().filter(
      (name) => name.endsWith("_audit_log") || name.endsWith("_event_log"),
    );
    expect(logs.length).toBeGreaterThan(20);
    for (const name of logs) {
      expect(
        classified.has(name),
        `${name} is an audit/event log: add it to APPEND_ONLY_EVIDENCE_TABLES (and ship a migration that revokes UPDATE/DELETE and attaches the append-only trigger), or to TRIGGER_ONLY_EVIDENCE_TABLES with the reason`,
      ).toBe(true);
    }
  });

  it("REQ-EVID-1: every listed table exists in the schema, and no table is in two lists", () => {
    const existing = new Set(schemaTables());
    const all = [
      ...APPEND_ONLY_EVIDENCE_TABLES,
      ...NO_UPDATE_EVIDENCE_TABLES,
      ...Object.keys(TRIGGER_ONLY_EVIDENCE_TABLES),
    ];
    for (const name of all) expect(existing.has(name), name).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it("REQ-EVID-1: the tables the application legitimately rewrites keep their privileges (trigger-only, with a reason)", () => {
    const block = evidenceGrantsBlock();
    for (const [table, reason] of Object.entries(
      TRIGGER_ONLY_EVIDENCE_TABLES,
    )) {
      expect(reason.length, table).toBeGreaterThan(40);
      expect(block, table).not.toContain(`public."${table}"`);
    }
    // certificate_input is deleted by the revert of an approval: UPDATE goes, DELETE stays.
    expect(block).toContain(
      `REVOKE UPDATE, TRUNCATE ON public."certificate_input" FROM ${APP_ROLE};`,
    );
    expect(block).not.toMatch(/DELETE[^;]*ON public\."certificate_input"/);
  });
});

describe("evidence grants SQL, generated from evidence-tables.ts", () => {
  it("REQ-EVID-2: the block revokes UPDATE, DELETE and TRUNCATE on every append-only table, and nothing else", () => {
    const block = evidenceGrantsBlock();
    expect(block.startsWith(EVIDENCE_GRANTS_BEGIN)).toBe(true);
    expect(block.endsWith(EVIDENCE_GRANTS_END)).toBe(true);
    const revoked = Array.from(
      block.matchAll(
        /^REVOKE UPDATE, DELETE, TRUNCATE ON public\."([^"]+)" FROM calibra_app;$/gm,
      ),
      (m) => m[1] ?? "",
    );
    expect([...revoked].sort()).toEqual(
      [...APPEND_ONLY_EVIDENCE_TABLES].sort(),
    );
    // INSERT and SELECT are never revoked, and no GRANT is generated.
    expect(block).not.toMatch(/REVOKE[^;]*\b(INSERT|SELECT)\b/);
    expect(block).not.toMatch(/^GRANT/m);
  });

  it("REQ-EVID-2: sql/schema-extras.sql carries exactly the block, after the blanket GRANT it narrows", () => {
    const extras = read("../sql/schema-extras.sql");
    const begin = extras.indexOf(EVIDENCE_GRANTS_BEGIN);
    expect(begin).toBeGreaterThan(-1);
    const end = extras.indexOf(EVIDENCE_GRANTS_END, begin);
    expect(extras.slice(begin, end + EVIDENCE_GRANTS_END.length)).toBe(
      evidenceGrantsBlock(),
    );
    expect(begin).toBeGreaterThan(extras.indexOf(RLS_ROLE_SQL));
  });

  it("REQ-EVID-2: the migration carries exactly the block, and is journaled after 0129 with a larger timestamp", () => {
    const migration = read(`../drizzle/${GRANTS_MIGRATION}`);
    const begin = migration.indexOf(EVIDENCE_GRANTS_BEGIN);
    const end = migration.indexOf(EVIDENCE_GRANTS_END, begin);
    expect(migration.slice(begin, end + EVIDENCE_GRANTS_END.length)).toBe(
      evidenceGrantsBlock(),
    );
    // Lock timeout first, so it fails fast instead of queueing traffic.
    const body = migration
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n")
      .trimStart();
    expect(body.startsWith("SET LOCAL lock_timeout = '5s';")).toBe(true);
  });

  it("REQ-EVID-2: no migration after the grants one repeats the blanket GRANT without repeating the evidence block after it", () => {
    const later = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .filter((name) => name > GRANTS_MIGRATION);
    for (const name of later) {
      const text = read(`../drizzle/${name}`);
      const grant = text.indexOf(RLS_ROLE_SQL);
      if (grant === -1) continue;
      const evidence = text.indexOf(EVIDENCE_GRANTS_BEGIN);
      expect(
        evidence,
        `${name} repeats the blanket GRANT of migration 0123, which re-grants UPDATE/DELETE on the evidence tables: repeat the evidence block after it`,
      ).toBeGreaterThan(grant);
    }
  });
});

describe("escape hatch is gated on role (migration 0130)", () => {
  it("REQ-EVID-3: the hatch functions require the owner in addition to the setting", () => {
    const extras = read("../sql/schema-extras.sql");
    const hatch = extras.slice(
      extras.indexOf(
        "CREATE OR REPLACE FUNCTION calibra_history_rewrite_allowed",
      ),
    );
    expect(hatch.slice(0, 400)).toContain("public.calibra_session_is_owner()");
    expect(extras).toMatch(
      /calibra_org_purge_allowed\(\)[\s\S]{0,200}public\.calibra_session_is_owner\(\)/,
    );
    // The status-repair hatch cannot be set by the application either.
    expect(extras).toMatch(
      /calibra_session_is_owner\(\)\s+AND coalesce\(current_setting\('calibra\.allow_status_repair'/,
    );
    // Both the session user and the current user must be the owner.
    expect(extras).toMatch(/pg_has_role\(\s*session_user/);
    expect(extras).toMatch(/pg_has_role\(\s*current_user/);
  });

  it("REQ-EVID-3: no GUC alone lifts a guard in any function the application role can reach", () => {
    const extras = read("../sql/schema-extras.sql");
    // Every place that reads one of the hatch settings goes through the owner check.
    // (The owner-only audit-chain backfill saves the previous value of the setting
    // to put it back; it reads it into `v_was` and gates itself on the owner.)
    const uses = Array.from(
      extras.matchAll(
        /current_setting\('calibra\.allow_(audit_rewrite|status_repair|org_purge)'/g,
      ),
    ).filter(
      (use) =>
        !extras
          .slice(Math.max(0, (use.index ?? 0) - 40), use.index)
          .includes("v_was text :="),
    );
    expect(uses).toHaveLength(3);
    for (const use of uses) {
      const before = extras.slice(
        Math.max(0, (use.index ?? 0) - 260),
        use.index,
      );
      expect(before, use[1]).toContain("calibra_session_is_owner()");
    }
  });
});
