import { readFileSync } from "node:fs";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION_YEARS,
  EVIDENCE_REGISTRY,
  MINIMUM_RETENTION_YEARS,
  OWNED_PART_EDGES,
  PLATFORM_EVIDENCE_TABLES,
  SOFT_REFERENCE_LOGS,
  edgeLabel,
  evidenceCategory,
  evidenceImpactOf,
  findEvidenceDeleteViolations,
  findStaleOwnedPartEdges,
  isEvidenceTable,
  listEvidenceTables,
  listForeignKeys,
  listTables,
  organizationErasureOrder,
  organizationFootprint,
  organizationScopeSql,
  recordDateColumns,
  scopeSourcesOf,
} from "./records-retention";
import { replaceInventoryBlock } from "./records-retention-doc";
import { organization } from "./schema";
import { getTableConfig } from "drizzle-orm/pg-core";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function normalized(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

describe("REQ-RET-1: the retention inventory is derived from schema.ts", () => {
  it("REQ-RET-1: docs/architecture/records-retention.md matches the schema", async () => {
    const path = "../../../docs/architecture/records-retention.md";
    const onDisk = read(path);
    const expected = await prettier.format(replaceInventoryBlock(onDisk), {
      filepath: "records-retention.md",
    });
    expect(onDisk, "run `pnpm --dir packages/db retention:inventory`").toEqual(
      expected,
    );
  });

  it("REQ-RET-1: names every evidence family the decision lists", () => {
    const evidence = new Set(listEvidenceTables());
    for (const table of [
      "calibration_job",
      "issued_certificate_snapshot",
      "job_audit_log",
      "organization_event_log",
      "service_order_event_log",
      "platform_event_log",
      "reference_standard_certificate_document",
      "non_conformance",
      "corrective_action",
      "service_order",
      "service_order_attachment",
      "billing_document",
      "receivable_installment",
    ]) {
      expect(evidence.has(table), table).toBe(true);
    }
  });

  it("REQ-RET-1: every audit and event log table is evidence, without a registry entry", () => {
    const logs = listTables()
      .map((table) => table.name)
      .filter((name) => /_(audit|event)_log$/.test(name));
    expect(logs.length).toBeGreaterThanOrEqual(26);
    for (const name of logs) {
      expect(isEvidenceTable(name), name).toBe(true);
    }
  });

  it("REQ-RET-1: the registry only names tables that exist", () => {
    const tables = new Set(listTables().map((table) => table.name));
    for (const name of Object.keys(EVIDENCE_REGISTRY)) {
      expect(tables.has(name), name).toBe(true);
    }
    for (const edge of OWNED_PART_EDGES) {
      expect(tables.has(edge.table), edge.table).toBe(true);
      expect(tables.has(edge.parent), edge.parent).toBe(true);
    }
  });

  it("REQ-RET-1: every audit log is reachable from its organization (own column or soft reference)", () => {
    const tables = new Map(listTables().map((table) => [table.name, table]));
    for (const entry of SOFT_REFERENCE_LOGS) {
      const table = tables.get(entry.table);
      expect(table?.columns, entry.table).toContain(entry.column);
      expect(tables.has(entry.entity), entry.entity).toBe(true);
      // A soft reference is a column WITHOUT a foreign key: if it gains one it
      // belongs to the FK paths, not here.
      expect(
        listForeignKeys().some(
          (edge) =>
            edge.table === entry.table && edge.columns.includes(entry.column),
        ),
        `${entry.table}.${entry.column} gained a foreign key`,
      ).toBe(false);
    }
    for (const name of listEvidenceTables()) {
      if (PLATFORM_EVIDENCE_TABLES.includes(name)) continue;
      expect(
        scopeSourcesOf(name).length,
        `${name} has no organization`,
      ).toBeGreaterThan(0);
      expect(
        recordDateColumns(name).length,
        `${name} has no record date`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("REQ-RET-2: no foreign key cascades a delete into evidence", () => {
  it("REQ-RET-2: every cascade into an evidence table is an owned-part edge", () => {
    expect(findEvidenceDeleteViolations().map(edgeLabel)).toEqual([]);
  });

  it("REQ-RET-2: every owned-part edge still exists and cascades", () => {
    expect(findStaleOwnedPartEdges()).toEqual([]);
  });

  it("REQ-RET-2: deleting an organization, customer, asset or user deletes no evidence", () => {
    for (const root of ["organization", "customer", "asset", "user"] as const) {
      const deleted = evidenceImpactOf(root).filter(
        (impact) => impact.effect === "deletes",
      );
      expect(
        deleted.map((impact) => edgeLabel(impact.edge)),
        root,
      ).toEqual([]);
    }
  });

  it("REQ-RET-2: SET NULL on evidence leaves the row; only actors and pointers are nulled", () => {
    const nulled = listForeignKeys().filter(
      (edge) => isEvidenceTable(edge.table) && edge.onDelete === "set null",
    );
    expect(nulled.length).toBeGreaterThan(0);
    for (const edge of nulled) {
      expect(edge.nullable, edgeLabel(edge)).toBe(true);
    }
  });

  it("REQ-RET-2: migration 0117 converts exactly foreign keys that schema.ts now declares RESTRICT", () => {
    const migration = read("../drizzle/0117_records_retention.sql");
    const tuples = [
      ...migration.matchAll(/\('([a-z_]+)', '([a-z_]+)', '([a-z_]+)'\)/g),
    ].map(([, table, column, parent]) => `${table}.${column}>${parent}`);
    expect(tuples.length).toBeGreaterThan(30);
    expect(new Set(tuples).size).toBe(tuples.length);

    const edges = listForeignKeys();
    for (const tuple of tuples) {
      const [from, parent] = tuple.split(">");
      const edge = edges.find(
        (candidate) =>
          edgeLabel(candidate) === from && candidate.parent === parent,
      );
      expect(edge, tuple).toBeDefined();
      expect(edge?.onDelete, tuple).toBe("restrict");
      expect(isEvidenceTable(edge?.table ?? ""), tuple).toBe(true);
    }
  });
});

describe("REQ-RET-3 / REQ-RET-4: organization columns and SQL objects", () => {
  it("REQ-RET-4: organization carries retention_years (default 10), legal_hold and the soft-delete columns", () => {
    const columns = new Map(
      getTableConfig(organization).columns.map((column) => [
        column.name,
        column,
      ]),
    );
    expect(columns.get("retention_years")?.default).toBe(
      DEFAULT_RETENTION_YEARS,
    );
    expect(columns.get("retention_years")?.notNull).toBe(true);
    expect(columns.get("legal_hold")?.default).toBe(false);
    for (const name of ["deleted_at", "deleted_by", "deletion_reason"]) {
      expect(columns.has(name), name).toBe(true);
    }
    expect(MINIMUM_RETENTION_YEARS).toBe(5);
  });

  it("REQ-RET-3: schema-extras.sql repeats the retention objects of migration 0117", () => {
    const migration = normalized(read("../drizzle/0117_records_retention.sql"));
    const extras = normalized(read("../sql/schema-extras.sql"));
    const shared = migration.slice(
      migration.indexOf(
        "ALTER TABLE organization DROP CONSTRAINT IF EXISTS organization_retention_years_min",
      ),
    );
    expect(shared).toContain("calibra_org_purge_allowed");
    expect(shared).toContain("organization_lab_delete_guard");
    expect(shared).toContain("calibra_retain_until");
    expect(extras).toContain(shared);
  });

  it("REQ-RET-3: the migration is journaled after 0116 with a larger timestamp", () => {
    const journal: unknown = JSON.parse(read("../drizzle/meta/_journal.json"));
    const entries =
      typeof journal === "object" && journal !== null && "entries" in journal
        ? journal.entries
        : [];
    if (!Array.isArray(entries)) throw new Error("journal has no entries");
    const whens = entries.map((entry: unknown) =>
      typeof entry === "object" && entry !== null && "when" in entry
        ? Number(entry.when)
        : Number.NaN,
    );
    expect(whens.length).toBeGreaterThan(117);
    // drizzle applies a migration only when its `when` is newer than the last
    // applied one, so what matters is that the newest entry is the largest.
    const latest = whens.at(-1) ?? 0;
    expect(latest).toBe(Math.max(...whens));
    expect(latest).toBeGreaterThan(whens.at(-2) ?? 0);
  });
});

describe("REQ-RET-5: organization footprint used by the purge job", () => {
  it("REQ-RET-5: every evidence table of an organization is in its footprint and has an erasure order", () => {
    const footprint = new Set(organizationFootprint());
    for (const name of listEvidenceTables()) {
      if (PLATFORM_EVIDENCE_TABLES.includes(name)) continue;
      expect(footprint.has(name), name).toBe(true);
    }
    const order = organizationErasureOrder();
    expect(new Set(order).size).toBe(order.length);
    expect(new Set(order)).toEqual(footprint);
    // Children are deleted before the rows they reference.
    expect(order.indexOf("calibration_job")).toBeLessThan(
      order.indexOf("customer"),
    );
    expect(order.indexOf("issued_certificate_snapshot")).toBeLessThan(
      order.indexOf("calibration_job"),
    );
    expect(order.indexOf("asset")).toBeGreaterThan(
      order.indexOf("calibration_job"),
    );
  });

  it("REQ-RET-5: scope SQL for an audit log without organization column goes through its entity", () => {
    const scope = organizationScopeSql("asset_audit_log", "org-1");
    expect(scope).not.toBeNull();
    expect(evidenceCategory("asset_audit_log")).toBe("audit-log");
  });
});
