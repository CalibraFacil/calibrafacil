import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import {
  accreditedScopeLineAuditLog,
  organization,
} from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Migration 0128 (Q45): the scope enforcement mode becomes "never chosen" (NULL)
// where it was only the old column default, and an explicit choice survives. The
// test database is built from schema.ts (already nullable), so the SQL of the
// migration is run here against rows seeded the way a pre-0128 database holds them.

const MIGRATION = new URL(
  "../../../../packages/db/drizzle/0128_scope_enforcement_default.sql",
  import.meta.url,
);

async function runMigration() {
  const statements = readFileSync(MIGRATION, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

async function modeOf(orgId: string) {
  const [row] = await db
    .select({ mode: organization.scopeEnforcementMode })
    .from(organization)
    .where(eq(organization.id, orgId));
  return row?.mode;
}

describe("migration 0128 — scope enforcement default (Q45)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-ENF-007 [HIGH RISK]: a 'warn' that was only the column default becomes unset; an explicit choice, in either direction, is untouched", async () => {
    const byDefault = await seedOrg({ orgId: "org-default", userId: "u-d" });
    const chosenWarn = await seedOrg({
      orgId: "org-chose-warn",
      userId: "u-w",
    });
    const chosenEnforce = await seedOrg({
      orgId: "org-enforce",
      userId: "u-e",
    });
    for (const id of ["org-default", "org-chose-warn"]) {
      await db
        .update(organization)
        .set({ scopeEnforcementMode: "warn" })
        .where(eq(organization.id, id));
    }
    await db
      .update(organization)
      .set({ scopeEnforcementMode: "enforce" })
      .where(eq(organization.id, "org-enforce"));
    // The lab that chose 'warn' got there by switching away from 'enforce' once:
    // the audit trail is what tells it from the default.
    await db.insert(accreditedScopeLineAuditLog).values({
      scopeLineId: null,
      organizationId: chosenWarn.orgId,
      action: "enforcement_mode_change",
      changes: { scopeEnforcementMode: { old: "enforce", new: "warn" } },
      performedBy: chosenWarn.userId,
    });

    await runMigration();

    expect(await modeOf(byDefault.orgId)).toBeNull();
    expect(await modeOf(chosenWarn.orgId)).toBe("warn");
    expect(await modeOf(chosenEnforce.orgId)).toBe("enforce");
  });

  it("REQ-ENF-007: it is idempotent: a second run changes nothing", async () => {
    const org = await seedOrg({ orgId: "org-twice", userId: "u-t" });
    await db
      .update(organization)
      .set({ scopeEnforcementMode: "warn" })
      .where(eq(organization.id, org.orgId));

    await runMigration();
    await runMigration();

    expect(await modeOf(org.orgId)).toBeNull();
  });
});
