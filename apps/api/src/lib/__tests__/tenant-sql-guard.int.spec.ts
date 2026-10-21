import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import { calibrationJob, organizationUnit } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";
import { tenantSqlGuardForTests } from "../../../test/integration/tenant-sql-guard";

// End-to-end proof that the integration tier's tenant SQL guard is live: it
// sees real statements issued through the real db, attributes them to app vs
// harness code, and flags an app statement that touches a tenant table with no
// organization predicate.

describe("tenant SQL guard (integration tier)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("flags an application statement on a tenant table without an organization predicate", async () => {
    const guard = tenantSqlGuardForTests();
    guard.drain();

    await guard.runAsApp(async () => {
      await db
        .select({ id: organizationUnit.id })
        .from(organizationUnit)
        .where(eq(organizationUnit.id, 999999));
    });

    const violations = guard.drain();
    expect(violations).toHaveLength(1);
    expect(violations[0]?.finding).toEqual({
      kind: "select",
      tables: ["organization_unit"],
      reason: "no-org-predicate",
    });
  });

  it("accepts the same statement once it carries the organization predicate", async () => {
    const guard = tenantSqlGuardForTests();
    guard.drain();

    await guard.runAsApp(async () => {
      await db
        .select({ id: organizationUnit.id })
        .from(organizationUnit)
        .where(
          and(
            eq(organizationUnit.id, 999999),
            eq(organizationUnit.organizationId, "org-a"),
          ),
        );
    });

    expect(guard.drain()).toEqual([]);
  });

  it("flags an unscoped write (UPDATE by primary key only)", async () => {
    const guard = tenantSqlGuardForTests();
    guard.drain();

    await guard.runAsApp(async () => {
      await db
        .update(calibrationJob)
        .set({ status: "DRAFT" })
        .where(eq(calibrationJob.id, 1));
    });

    const violations = guard.drain();
    expect(violations.map((v) => v.finding.kind)).toEqual(["update"]);
  });

  it("does not check harness statements (seeds, assertions, truncation)", async () => {
    const guard = tenantSqlGuardForTests();
    guard.drain();

    const { orgId } = await seedOrg({ orgId: "org-a" });
    await db
      .select()
      .from(organizationUnit)
      .where(eq(organizationUnit.id, 999999));
    expect(orgId).toBe("org-a");

    expect(guard.drain()).toEqual([]);
  });
});
