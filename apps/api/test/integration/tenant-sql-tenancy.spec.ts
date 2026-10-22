import { describe, expect, it } from "vitest";
import {
  GLOBAL_TABLES,
  ORGANIZATION_BACKFILL,
  classifyTables,
} from "@calibra-facil/db/tenancy";
import { analyzeStatement, deriveTenantTables } from "./tenant-sql-analyzer";

// REQ-ORG-4: the tenant SQL guard derives its tenant tables from the
// organization columns of schema.ts, so a table that gained organization_id in
// migration 0118 is now under it, and a statement on it without an
// organization predicate is a finding.

describe("REQ-ORG-4: the tenant SQL guard sees every tenant table", () => {
  it("REQ-ORG-4: its tenant tables are exactly the tables classified tenant, its untenanted ones exactly the global ones", () => {
    const { tenant, untenanted } = deriveTenantTables();
    expect([...tenant.keys()].toSorted()).toEqual(
      classifyTables()
        .tenant.map((table) => table.name)
        .toSorted(),
    );
    expect(untenanted).toEqual(Object.keys(GLOBAL_TABLES).toSorted());
  });

  it("REQ-ORG-4: every table of migration 0118 is a tenant table of the guard", () => {
    const { tenant } = deriveTenantTables();
    for (const entry of ORGANIZATION_BACKFILL) {
      expect(tenant.get(entry.table), entry.table).toEqual(["organization_id"]);
    }
  });

  it("REQ-ORG-4: an unscoped read of a finance child is flagged, a scoped one is not", () => {
    const { tenant } = deriveTenantTables();
    const unscoped = analyzeStatement(
      'select "id" from "payment_receipt" where "payment_receipt"."installment_id" = $1',
      tenant,
    );
    expect(unscoped.findings).toEqual([
      {
        kind: "select",
        tables: ["payment_receipt"],
        reason: "no-org-predicate",
      },
    ]);
    const scoped = analyzeStatement(
      'select "id" from "payment_receipt" where "payment_receipt"."installment_id" = $1 and "payment_receipt"."organization_id" = $2',
      tenant,
    );
    expect(scoped.findings).toEqual([]);
  });

  it("REQ-ORG-4: an insert into an audit log without organization_id is flagged", () => {
    const { tenant } = deriveTenantTables();
    const missing = analyzeStatement(
      'insert into "job_audit_log" ("id", "job_id", "action", "performed_by") values (default, $1, $2, $3)',
      tenant,
    );
    expect(missing.findings).toEqual([
      {
        kind: "insert",
        tables: ["job_audit_log"],
        reason: "insert-without-org-column",
      },
    ]);
    const present = analyzeStatement(
      'insert into "job_audit_log" ("id", "organization_id", "job_id", "action", "performed_by") values (default, $1, $2, $3, $4)',
      tenant,
    );
    expect(present.findings).toEqual([]);
  });
});
