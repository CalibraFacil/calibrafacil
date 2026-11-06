import { readFileSync, readdirSync } from "node:fs";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";
import {
  statusGuardBegin,
  statusGuardBlockIn,
  statusGuardSqlBlock,
  statusGuardTriggerSql,
} from "./status-guard-sql";
import { STATUS_GUARDED_COLUMNS } from "./status-machines";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const MIGRATIONS_DIR = new URL("../drizzle/", import.meta.url);

function migrationsDefining(marker: string): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) =>
      readFileSync(new URL(name, MIGRATIONS_DIR), "utf8").includes(marker),
    );
}

const tables = new Map<string, PgTable>();
for (const value of Object.values(schema)) {
  if (is(value, PgTable)) tables.set(getTableConfig(value).name, value);
}

describe("status guards generated from the state machines", () => {
  it("each column is guarded once and exists in schema.ts", () => {
    const keys = STATUS_GUARDED_COLUMNS.map((g) => `${g.table}.${g.column}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const guarded of STATUS_GUARDED_COLUMNS) {
      const table = tables.get(guarded.table);
      expect(
        table,
        `${guarded.table} is not a table of schema.ts`,
      ).toBeDefined();
      if (!table) continue;
      const column = getTableConfig(table).columns.find(
        (c) => c.name === guarded.column,
      );
      expect(column, `${guarded.table}.${guarded.column}`).toBeDefined();
      expect(column?.notNull ?? false).toBe(!guarded.nullable);
    }
  });

  it("the column default is a state the machine creates rows in", () => {
    for (const guarded of STATUS_GUARDED_COLUMNS) {
      const table = tables.get(guarded.table);
      if (!table) continue;
      const column = getTableConfig(table).columns.find(
        (c) => c.name === guarded.column,
      );
      if (column?.default === undefined) continue;
      expect(
        guarded.machine.creationStates(),
        `${guarded.table}.${guarded.column} defaults to ${String(column.default)}`,
      ).toContain(column.default);
    }
  });

  it("every move of a machine is in its block and nothing else is", () => {
    for (const guarded of STATUS_GUARDED_COLUMNS) {
      const block = statusGuardSqlBlock(guarded);
      const pairs = Array.from(
        block.matchAll(/^ {4}\('([^']+)', '([^']+)'\),?$/gm),
        (match) => `${match[1]}>${match[2]}`,
      );
      expect(new Set(pairs)).toEqual(
        new Set(
          guarded.machine.statePairs().map(([from, to]) => `${from}>${to}`),
        ),
      );
      expect(block).toContain("calibra_history_rewrite_allowed()");
      expect(block).toMatch(
        /calibra_session_is_owner\(\)\s+AND coalesce\(current_setting\('calibra\.allow_status_repair'/,
      );
      expect(block).toContain("current_setting('calibra.allow_status_repair'");
    }
  });

  it("sql/schema-extras.sql carries exactly the blocks and triggers the machines generate", () => {
    const extras = read("../sql/schema-extras.sql");
    for (const guarded of STATUS_GUARDED_COLUMNS) {
      expect(
        statusGuardBlockIn(extras, guarded),
        `schema-extras.sql: stale or missing ${guarded.table}.${guarded.column} guard; paste \`pnpm --filter @calibra-facil/db gen:status-guards-sql\``,
      ).toBe(statusGuardSqlBlock(guarded));
      expect(extras).toContain(statusGuardTriggerSql(guarded));
    }
  });

  it("the newest migration defining each guard carries exactly the block the machine generates", () => {
    for (const guarded of STATUS_GUARDED_COLUMNS) {
      const defining = migrationsDefining(statusGuardBegin(guarded));
      expect(
        defining.length,
        `no migration defines the ${guarded.table}.${guarded.column} guard`,
      ).toBeGreaterThan(0);
      const newest = defining.at(-1) ?? "";
      const migration = readFileSync(new URL(newest, MIGRATIONS_DIR), "utf8");
      expect(
        statusGuardBlockIn(migration, guarded),
        `${newest} is stale for ${guarded.table}.${guarded.column}: ship a new migration with the output of \`pnpm --filter @calibra-facil/db gen:status-guards-sql\``,
      ).toBe(statusGuardSqlBlock(guarded));
      expect(migration).toContain(statusGuardTriggerSql(guarded));
    }
  });
});
