import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SYNC_ENTITIES,
  SYNC_ENTITY_ORDER,
  syncChangeLogTables,
} from "@calibra-facil/contracts/sync-entities";
import { GLOBAL_TABLES, listTenancy } from "./tenancy";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const MIGRATION = read("../drizzle/0122_sync_change_log.sql");
const EXTRAS = read("../sql/schema-extras.sql");

function block(text: string, name: string): string {
  const begin = text.indexOf(`-- BEGIN ${name}`);
  const end = text.indexOf(`-- END ${name}`, begin);
  if (begin === -1 || end === -1) throw new Error(`no ${name} block`);
  return text.slice(begin, end + `-- END ${name}`.length);
}

describe("sync change log SQL: migration 0122 and schema-extras.sql", () => {
  it("REQ-CS-1: schema-extras.sql repeats the functions and the triggers of the migration verbatim", () => {
    for (const name of [
      "sync change log functions",
      "sync change log triggers",
    ]) {
      expect(block(EXTRAS, name)).toBe(block(MIGRATION, name));
    }
  });

  it("REQ-CS-1: the triggers are exactly the tables of the sync entity list, an insert/delete trigger and an update trigger each", () => {
    const triggers = block(MIGRATION, "sync change log triggers");
    const created = Array.from(
      triggers.matchAll(
        /CREATE TRIGGER sync_change_log_(\w+?)_(write|update)\n[^;]*?calibra_sync_change_log\('(\w+)'\)/g,
      ),
      (match) => `${match[1]}:${match[2]}:${match[3]}`,
    );
    const expected = syncChangeLogTables().flatMap((entry) => [
      `${entry.table}:write:${entry.entityType}`,
      `${entry.table}:update:${entry.entityType}`,
    ]);
    expect(created.toSorted()).toEqual(expected.toSorted());
  });

  it("REQ-CS-1: every logged table exists in the schema, and the sync entity table lists each entity type once", () => {
    const tenant = new Set(listTenancy().map((table) => table.name));
    const tables = syncChangeLogTables();
    for (const { table } of tables) {
      expect(tenant.has(table) || table in GLOBAL_TABLES, table).toBe(true);
    }
    expect(new Set(SYNC_ENTITY_ORDER).size).toBe(SYNC_ENTITY_ORDER.length);
    expect(new Set(tables.map((entry) => entry.entityType))).toEqual(
      new Set(SYNC_ENTITY_ORDER),
    );
    expect(Object.keys(SYNC_ENTITIES).toSorted()).toEqual(
      [...SYNC_ENTITY_ORDER].toSorted(),
    );
  });

  it("REQ-CS-1: every trigger names its entity by the wire name of the sync entity table, and the entity's own table is the first one logged", () => {
    const logged = syncChangeLogTables();
    for (const entityType of SYNC_ENTITY_ORDER) {
      const own = logged.find((entry) => entry.entityType === entityType);
      expect(own?.table, entityType).toBe(SYNC_ENTITIES[entityType].cloudTable);
    }
  });

  it("REQ-CS-5: the log and its purge horizon are tenant tables with the laboratory removed on cascade", () => {
    const byName = new Map(listTenancy().map((table) => [table.name, table]));
    for (const name of ["sync_change_log", "sync_change_log_purge"]) {
      const table = byName.get(name);
      expect(table, `${name} must be classified TENANT`).toBeDefined();
      const foreignKey = table?.singleForeignKeys.find(
        (key) => key.column === "organization_id",
      );
      expect(foreignKey?.onDelete.toLowerCase()).toBe("cascade");
    }
  });

  it("REQ-CS-1: the migration creates the log keyed for the pull read, (organization_id, xid, seq)", () => {
    expect(MIGRATION).toContain(
      '"xid" xid8 DEFAULT pg_current_xact_id() NOT NULL',
    );
    expect(MIGRATION).toContain(
      'ON "sync_change_log" USING btree ("organization_id", "xid", "seq")',
    );
  });
});
