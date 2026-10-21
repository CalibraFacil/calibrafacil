import { describe, expect, it } from "vitest";
import { analyzeStatement, deriveTenantTables } from "./tenant-sql-analyzer";

// Pure unit spec for the tenant SQL guard's statement analyzer (no Docker).
// Statements mirror what drizzle emits for the postgres-js driver.

const { tenant, untenanted } = deriveTenantTables();

function findings(statement: string) {
  return analyzeStatement(statement, tenant).findings;
}

describe("deriveTenantTables", () => {
  it("derives tenant tables from schema.ts by organization column", () => {
    expect(tenant.get("calibration_job")).toEqual(["organization_id"]);
    expect(tenant.get("customer")).toEqual(["lab_organization_id"]);
    expect(untenanted).toContain("session");
    expect(untenanted).toContain("organization");
  });
});

describe("analyzeStatement", () => {
  it("accepts a parameterized organization predicate", () => {
    expect(
      findings(
        `select "id" from "calibration_job" where ("calibration_job"."organization_id" = $1 and "calibration_job"."id" = $2)`,
      ),
    ).toEqual([]);
  });

  it("flags a select by primary key only", () => {
    expect(
      findings(
        `select "id" from "calibration_job" where "calibration_job"."id" = $1`,
      ),
    ).toEqual([
      {
        kind: "select",
        tables: ["calibration_job"],
        reason: "no-org-predicate",
      },
    ]);
  });

  it("does not take the select list for a predicate", () => {
    expect(
      findings(
        `select "id", "organization_id" from "calibration_job" where "id" = $1`,
      ),
    ).toHaveLength(1);
  });

  it("accepts IN lists, ANY and the lab_organization_id column", () => {
    expect(
      findings(
        `select "id" from "customer" where "customer"."lab_organization_id" in ($1, $2)`,
      ),
    ).toEqual([]);
    expect(
      findings(
        `select "id" from "service_order" where "service_order"."organization_id" = any($1)`,
      ),
    ).toEqual([]);
  });

  it("flags an update whose only organization reference is the SET list", () => {
    expect(
      findings(
        `update "calibration_job" set "organization_id" = $1 where "calibration_job"."id" = $2`,
      ),
    ).toEqual([
      {
        kind: "update",
        tables: ["calibration_job"],
        reason: "no-org-predicate",
      },
    ]);
  });

  it("accepts a scoped update and a scoped delete", () => {
    expect(
      findings(
        `update "calibration_job" set "status" = $1 where ("calibration_job"."id" = $2 and "calibration_job"."organization_id" = $3)`,
      ),
    ).toEqual([]);
    expect(
      findings(
        `delete from "notification" where "notification"."organization_id" = $1`,
      ),
    ).toEqual([]);
  });

  it("flags an unscoped delete", () => {
    expect(
      findings(`delete from "notification" where "notification"."id" = $1`),
    ).toHaveLength(1);
  });

  it("checks that inserts carry the organization column", () => {
    expect(
      findings(
        `insert into "notification" ("id", "organization_id", "title") values ($1, $2, $3)`,
      ),
    ).toEqual([]);
    expect(
      findings(`insert into "notification" ("id", "title") values ($1, $2)`),
    ).toEqual([
      {
        kind: "insert",
        tables: ["notification"],
        reason: "insert-without-org-column",
      },
    ]);
  });

  it("does not treat ON CONFLICT DO UPDATE SET as an unscoped update", () => {
    expect(
      findings(
        `insert into "notification" ("id", "organization_id") values ($1, $2) on conflict ("id") do update set "organization_id" = excluded."organization_id"`,
      ),
    ).toEqual([]);
  });

  it("ignores statements that touch no tenant table", () => {
    expect(
      analyzeStatement(`select "id" from "session" where "token" = $1`, tenant)
        .tenantTables,
    ).toEqual([]);
    expect(findings(`truncate table "session"`)).toEqual([]);
  });

  it("accepts a predicate in a join condition", () => {
    expect(
      findings(
        `select "a"."id" from "customer" "a" inner join "calibration_job" on ("calibration_job"."organization_id" = $1 and "calibration_job"."customer_id" = "a"."id")`,
      ),
    ).toEqual([]);
  });

  it("flags a join that only equates organization columns between tables", () => {
    expect(
      findings(
        `select "a"."id" from "customer" "a" inner join "calibration_job" on "calibration_job"."organization_id" = "a"."lab_organization_id" where "a"."id" = $1`,
      ),
    ).toHaveLength(1);
  });
});
