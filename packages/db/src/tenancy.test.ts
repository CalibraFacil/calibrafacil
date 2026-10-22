import { readFileSync } from "node:fs";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import {
  CREATED_AFTER_0118,
  GLOBAL_TABLES,
  ORGANIZATION_BACKFILL,
  TENANT_COLUMNS,
  classifyTables,
  listTenancy,
  parentPathOf,
  tenancyOf,
  unpairedPointers,
} from "./tenancy";
import { replaceTenancyBlock } from "./tenancy-doc";
import { listForeignKeys } from "./records-retention";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const MIGRATION = read("../drizzle/0118_organization_id_everywhere.sql");

/** The VALUES tuples of the migration's backfill step: (ord, table, column, parent, parent org column). */
function migrationBackfill() {
  return [
    ...MIGRATION.matchAll(
      /\((\d+), '([a-z_]+)', '([a-z_]+)', '([a-z_]+)', '([a-z_]+)'\)/g,
    ),
  ].map(([, ord, table, column, parent, parentOrgColumn]) => ({
    ord: Number(ord),
    table,
    column,
    parent,
    parentOrgColumn,
  }));
}

/** The composite-key tuples: (table, column, parent, parent org column, ACTION, name). */
function migrationComposites() {
  return [
    ...MIGRATION.matchAll(
      /\('([a-z_]+)', '([a-z_]+)', '([a-z_]+)', '([a-z_]+)', '([A-Z ]+)', '([a-z_]+_tenant_fk)'\)/g,
    ),
  ];
}

describe("REQ-ORG-1: every table is classified tenant or global", () => {
  it("REQ-ORG-1: docs/architecture/tenancy.md matches the schema", async () => {
    const path = "../../../docs/architecture/tenancy.md";
    const onDisk = read(path);
    const expected = await prettier.format(replaceTenancyBlock(onDisk), {
      filepath: "tenancy.md",
    });
    expect(onDisk, "run `pnpm --dir packages/db tenancy:doc`").toEqual(
      expected,
    );
  });

  it("REQ-ORG-1: no table without an organization column is left unclassified", () => {
    expect(
      classifyTables().unclassified,
      "classify these in GLOBAL_TABLES (with a reason) or give them organization_id",
    ).toEqual([]);
  });

  it("REQ-ORG-1: a global table has no organization column and a reason", () => {
    const { staleGlobal, unknownGlobal } = classifyTables();
    expect(staleGlobal, "global but carries an organization column").toEqual(
      [],
    );
    expect(unknownGlobal, "classified global but not in schema.ts").toEqual([]);
    for (const [name, reason] of Object.entries(GLOBAL_TABLES)) {
      expect(reason.trim().length, name).toBeGreaterThan(20);
    }
  });

  it("REQ-ORG-1: tenant + global is every table", () => {
    const { tenant, global } = classifyTables();
    expect(tenant.length + global.length).toBe(listTenancy().length);
    expect(global.map(({ table }) => table.name).toSorted()).toEqual(
      Object.keys(GLOBAL_TABLES).toSorted(),
    );
  });

  it("REQ-ORG-1: every backfilled table has a parent path ending at a native organization column", () => {
    for (const entry of ORGANIZATION_BACKFILL) {
      const path = parentPathOf(entry.table);
      const last = path.at(-1) ?? "";
      const root = tenancyOf(last);
      expect(path.length, entry.table).toBeGreaterThan(1);
      expect(
        ORGANIZATION_BACKFILL.some((other) => other.table === last),
        `${entry.table} path ${path.join(" -> ")} ends at another backfilled table`,
      ).toBe(false);
      expect(root?.tenantColumns.length, last).toBeGreaterThan(0);
    }
  });
});

describe("REQ-ORG-2: organization_id is NOT NULL, RESTRICT, indexed", () => {
  it("REQ-ORG-2: every tenant table has a NOT NULL organization column, except the soft-reference audit logs (nullable + CHECK NOT VALID)", () => {
    const auditLogs = new Set(
      ORGANIZATION_BACKFILL.filter((entry) => entry.soft).map(
        (entry) => entry.table,
      ),
    );
    expect(auditLogs.size).toBe(16);
    for (const table of classifyTables().tenant) {
      expect(table.tenantColumns.length, table.name).toBeGreaterThan(0);
      for (const column of table.tenantColumns) {
        expect(column.notNull, `${table.name}.${column.name}`).toBe(
          !auditLogs.has(table.name),
        );
        expect(TENANT_COLUMNS).toContain(column.name);
      }
    }
  });

  it("REQ-ORG-2: every audit log has the CHECK (organization_id IS NOT NULL) NOT VALID in the migration and in schema-extras.sql", () => {
    const extras = read("../sql/schema-extras.sql");
    const audit = ORGANIZATION_BACKFILL.filter((entry) => entry.soft);
    expect(MIGRATION).toContain(
      "CHECK (organization_id IS NOT NULL) NOT VALID",
    );
    expect(extras).toContain("CHECK (organization_id IS NOT NULL) NOT VALID");
    expect(extras).toContain("_organization_id_required");
    for (const entry of audit) {
      expect(extras, entry.table).toContain(`'${entry.table}'`);
      // The migration marks it as an audit log in its index list.
      expect(MIGRATION, entry.table).toContain(
        `('${entry.table}', 'organization_id, performed_at', '${entry.table}_org_performed_at_idx', true)`,
      );
      expect(
        `${entry.table}_organization_id_required`.length,
      ).toBeLessThanOrEqual(63);
    }
    // The hard children keep SET NOT NULL and the pre-check; none is flagged as an audit log.
    for (const entry of ORGANIZATION_BACKFILL.filter((other) => !other.soft)) {
      expect(MIGRATION, entry.table).toContain(
        `('${entry.table}', 'organization_id', '${entry.table}_org_idx', false)`,
      );
    }
  });

  it("REQ-ORG-2: every table of migration 0118 has organization_id with an FK to organization ON DELETE RESTRICT (NOT NULL except the audit logs)", () => {
    for (const entry of ORGANIZATION_BACKFILL) {
      const column = tenancyOf(entry.table)?.tenantColumns.find(
        (candidate) => candidate.name === "organization_id",
      );
      expect(column, entry.table).toBeDefined();
      expect(column?.notNull, entry.table).toBe(!entry.soft);
      expect(column?.organizationFk, entry.table).toBe("restrict");
    }
  });

  it("REQ-ORG-2: ... and an index led by organization_id", () => {
    for (const entry of ORGANIZATION_BACKFILL) {
      const column = tenancyOf(entry.table)?.tenantColumns.find(
        (candidate) => candidate.name === "organization_id",
      );
      expect(column?.indexed, entry.table).toBe(true);
    }
  });

  it("REQ-ORG-2: the migration backfills exactly the tables of the registry, parents first", () => {
    const tuples = migrationBackfill();
    expect(
      tuples.map(({ table, column, parent, parentOrgColumn }) => ({
        table,
        column,
        parent,
        parentOrgColumn,
      })),
    ).toEqual(
      ORGANIZATION_BACKFILL.map(
        ({ table, column, parent, parentOrgColumn }) => ({
          table,
          column,
          parent,
          parentOrgColumn,
        }),
      ),
    );
    expect(tuples.map((tuple) => tuple.ord)).toEqual(
      tuples.map((_, index) => index + 1),
    );
    const position = new Map(tuples.map((tuple) => [tuple.table, tuple.ord]));
    for (const tuple of tuples) {
      const parentPosition = position.get(tuple.parent);
      if (parentPosition !== undefined) {
        expect(
          parentPosition,
          `${tuple.table} before ${tuple.parent}`,
        ).toBeLessThan(tuple.ord);
      }
    }
  });

  it("REQ-ORG-2: every backfill entry names real columns and a real parent", () => {
    for (const entry of ORGANIZATION_BACKFILL) {
      const child = tenancyOf(entry.table);
      const parent = tenancyOf(entry.parent);
      expect(child?.columns, entry.table).toContain(entry.column);
      expect(parent?.columns, entry.parent).toContain(entry.parentOrgColumn);
      expect(parent?.columns, entry.parent).toContain("id");
      const pointer = child?.singleForeignKeys.find(
        (foreignKey) => foreignKey.column === entry.column,
      );
      // A hard pointer must be a foreign key to the parent; a soft one is not.
      if (entry.soft) expect(pointer, entry.table).toBeUndefined();
      else expect(pointer?.parent, entry.table).toBe(entry.parent);
    }
  });

  it("REQ-ORG-2: the migration is idempotent, set-based, raises on orphan children before NOT NULL and only NOTICEs orphan audit rows", () => {
    expect(MIGRATION).toContain("ADD COLUMN IF NOT EXISTS organization_id");
    expect(MIGRATION).toMatch(
      /UPDATE public\.%I c SET organization_id = p\.%I FROM public\.%I p/,
    );
    expect(MIGRATION).toContain("AND c.organization_id IS NULL");
    expect(MIGRATION).toContain("CREATE INDEX IF NOT EXISTS");
    const raise = MIGRATION.indexOf("cannot attribute rows to an organization");
    const notNull = MIGRATION.indexOf("SET NOT NULL");
    expect(raise).toBeGreaterThan(0);
    expect(notNull).toBeGreaterThan(raise);
    // The composite keys are added NOT VALID (existing rows are checked by the pre-check) and a
    // CONCURRENTLY pre-built unique index is adopted (DEPLOYMENT.md).
    expect(MIGRATION).toContain("ON UPDATE NO ACTION NOT VALID");
    expect(MIGRATION).toContain("UNIQUE USING INDEX");
    // Orphan audit rows (entity hard-deleted) are attributed from their own data, counted, never raised.
    expect(MIGRATION).toContain(
      "RAISE NOTICE 'migration 0118: % has % audit row(s)",
    );
    expect(MIGRATION).toContain("changes -> %L -> ''old'' ->> %L");
    const raiseSection = MIGRATION.slice(
      MIGRATION.indexOf("-- 2. Pre-check"),
      MIGRATION.indexOf("-- 3. Pre-check"),
    );
    expect(raiseSection).not.toContain("'job_audit_log', 'job_id'");
    expect(raiseSection).toContain("'job_standard', 'job_id'");
    // The append-only audit logs need the transaction-local escape hatch, and it is put back.
    expect(MIGRATION).toContain(
      "set_config('calibra.allow_audit_rewrite', 'on', true)",
    );
    expect(MIGRATION).toContain(
      "set_config('calibra.allow_audit_rewrite', '', true)",
    );
  });

  it("REQ-ORG-2: the migration is journaled with a timestamp larger than every earlier entry", () => {
    const journal: unknown = JSON.parse(read("../drizzle/meta/_journal.json"));
    const entries =
      typeof journal === "object" && journal !== null && "entries" in journal
        ? journal.entries
        : [];
    if (!Array.isArray(entries)) throw new Error("journal has no entries");
    const rows = entries.map((entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      "when" in entry &&
      "tag" in entry
        ? { when: Number(entry.when), tag: String(entry.tag) }
        : { when: Number.NaN, tag: "" },
    );
    // Later migrations (0119, 0120...) follow it: it stays journaled, and what matters
    // is that no entry is older than the one before it.
    const index = rows.findIndex(
      (row) => row.tag === "0118_organization_id_everywhere",
    );
    expect(index).toBeGreaterThan(0);
    // drizzle applies a migration only when its `when` is newer than the last
    // applied one: the new entry must be larger than every earlier one.
    for (let position = index; position < rows.length; position += 1) {
      const earlier = rows.slice(0, position).map((row) => row.when);
      expect(rows[position]?.when).toBeGreaterThan(Math.max(...earlier));
    }
  });
});

describe("REQ-ORG-3: composite (organization_id, parent_id) keys", () => {
  it("REQ-ORG-3: every hard pointer to a tenant parent is paired, with the same delete action", () => {
    for (const entry of ORGANIZATION_BACKFILL) {
      const table = tenancyOf(entry.table);
      for (const foreignKey of table?.singleForeignKeys ?? []) {
        const parent = tenancyOf(foreignKey.parent);
        if (!parent || parent.tenantColumns.length === 0) continue;
        if (foreignKey.onDelete === "set null") continue;
        const composite = table?.compositeKeys.find(
          (key) => key.column === foreignKey.column,
        );
        const label = `${entry.table}.${foreignKey.column}`;
        expect(composite, label).toBeDefined();
        expect(composite?.parent, label).toBe(foreignKey.parent);
        expect(composite?.onDelete, label).toBe(foreignKey.onDelete);
        expect(
          parent.orgIdUniques.map((unique) => unique.orgColumn),
          `${foreignKey.parent} UNIQUE (id, organization)`,
        ).toContain(composite?.parentOrgColumn);
      }
    }
  });

  it("REQ-ORG-3: the pointers left unpaired are exactly the nullable SET NULL ones", () => {
    const skipped = unpairedPointers();
    expect(skipped.map((p) => `${p.table}.${p.column}>${p.parent}`)).toEqual([
      "billing_document_item.job_commercial_snapshot_id>job_commercial_snapshot",
      "billing_document_item.job_id>calibration_job",
      "billing_document_item.material_id>material",
      "calibration_request_item.converted_job_id>calibration_job",
      "service_order_execution_item.material_id>material",
      "service_order_execution_item.quote_item_id>service_order_quote_item",
      "service_order_quote_item.material_id>material",
    ]);
    for (const pointer of skipped) {
      const foreignKey = tenancyOf(pointer.table)?.singleForeignKeys.find(
        (candidate) => candidate.column === pointer.column,
      );
      expect(foreignKey?.nullable, `${pointer.table}.${pointer.column}`).toBe(
        true,
      );
    }
  });

  it("REQ-ORG-3: the migration adds the same unique constraints and composite keys as schema.ts", () => {
    const composites = [
      ...new Set(
        migrationComposites().map(
          ([, table, column, parent, parentOrgColumn, onDelete, name]) =>
            `${name}:${table}.${column}>${parent}.${parentOrgColumn}:${onDelete}`,
        ),
      ),
    ];
    // Tables created by later migrations carry their own composite keys in
    // their own migration (0120 certificate_input).
    const fromSchema = listTenancy()
      .filter((table) => !CREATED_AFTER_0118.includes(table.name))
      .flatMap((table) =>
        table.compositeKeys.map(
          (key) =>
            `${key.name}:${key.table}.${key.column}>${key.parent}.${key.parentOrgColumn}:${key.onDelete.toUpperCase()}`,
        ),
      );
    expect(composites.toSorted()).toEqual(fromSchema.toSorted());
    expect(composites.length).toBeGreaterThan(20);

    const uniques = [
      ...MIGRATION.matchAll(
        /\('([a-z_]+)', '([a-z_]+)', '([a-z_]+_id_org_uidx)'\)/g,
      ),
    ].map(([, table, orgColumn, name]) => `${name}:${table}.${orgColumn}`);
    const uniquesFromSchema = listTenancy().flatMap((table) =>
      table.orgIdUniques.map(
        (unique) => `${unique.name}:${table.name}.${unique.orgColumn}`,
      ),
    );
    expect(uniques.toSorted()).toEqual(uniquesFromSchema.toSorted());
  });

  it("REQ-ORG-3: the pairing keys are not delete edges of the retention graph", () => {
    const edges = listForeignKeys();
    for (const key of listTenancy().flatMap((table) => table.compositeKeys)) {
      expect(
        edges.some(
          (edge) => edge.table === key.table && edge.columns.length > 1,
        ),
        `${key.table} lists a multi-column edge`,
      ).toBe(false);
    }
  });
});
