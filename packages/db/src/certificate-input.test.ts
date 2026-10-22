import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evidenceCategory } from "./records-retention";
import { classifyTables, tenancyOf } from "./tenancy";

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

describe("REQ-CIN-5: certificate_input is a classified, tenant-keyed 1:1 table", () => {
  it("REQ-CIN-5: it is a tenant table with a NOT NULL organization_id, RESTRICT, indexed", () => {
    expect(
      classifyTables().tenant.map(({ name }) => name),
      "certificate_input must be classified TENANT",
    ).toContain("certificate_input");
    const table = tenancyOf("certificate_input");
    expect(table?.tenantColumns).toEqual([
      {
        name: "organization_id",
        notNull: true,
        organizationFk: "restrict",
        indexed: true,
      },
    ]);
  });

  it("REQ-CIN-5: it points at its job through the composite (job_id, organization_id) tenant key", () => {
    expect(tenancyOf("certificate_input")?.compositeKeys).toEqual([
      {
        name: "certificate_input_job_id_tenant_fk",
        table: "certificate_input",
        column: "job_id",
        parent: "calibration_job",
        parentOrgColumn: "organization_id",
        onDelete: "restrict",
      },
    ]);
  });

  it("REQ-CIN-5: it is certificate evidence for the retention inventory", () => {
    expect(evidenceCategory("certificate_input")).toBe("certificate");
  });

  it("REQ-CIN-5: migration 0120 is journaled with a larger timestamp than every earlier entry", () => {
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
    const index = rows.findIndex((row) => row.tag === "0120_certificate_input");
    expect(index).toBeGreaterThan(0);
    const earlier = rows.slice(0, index).map((row) => row.when);
    expect(rows[index]?.when).toBeGreaterThan(Math.max(...earlier));
  });
});

describe("REQ-CIN-3: the immutability guard is in the migration and in schema-extras.sql", () => {
  it("REQ-CIN-3: schema-extras.sql repeats the migration's function and trigger", () => {
    const migration = normalized(read("../drizzle/0120_certificate_input.sql"));
    const extras = normalized(read("../sql/schema-extras.sql"));
    const guard = migration.slice(
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION calibra_certificate_input_guard",
      ),
    );
    expect(guard).toContain("certificate_input_immutable_guard");
    expect(extras).toContain(guard);
  });
});
