import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { processScheduledNotifications } from "@calibra-facil/jobs-core/scheduled";
import { db, truncateAll } from "../test/integration/db";
import {
  asString,
  envAsApplicationRole,
  field,
  toRows,
} from "../test/integration/application-role";
import {
  daysFromNow,
  seedCompetence,
  seedReferenceStandard,
  seedScheduledAsset,
  seedScheduledOrg,
  seedUser,
} from "../test/integration/seed-scheduled";

/**
 * The daily compliance sweep as `calibra_app` (P2-18j). The laboratories are
 * listed on the owner connection (`DATABASE_OWNER_URL`, one statement); every
 * step then runs per laboratory on the application connection, each statement in
 * a short transaction that names the laboratory, and every `check*` query also
 * carries an explicit `organization_id = $3`. Without the setting the sweep
 * would read no row as `calibra_app` (or be refused by WITH CHECK on the audit
 * and notification writes).
 *
 *   REQ-WRLS-SCH-1  two laboratories, one sweep: each laboratory's own rows are processed (competence
 *                   auto-expire with its audit row, expired / expiring standards, legal verification)
 *   REQ-WRLS-SCH-2  every audit row and scheduled_notification row is written in the laboratory that owns
 *                   the entity (no row crosses laboratories); the totals are summed across laboratories
 *   REQ-WRLS-SCH-3  a second sweep is idempotent per laboratory
 *
 * The notify* helpers find no admin/owner member (the seeds create none), so no
 * e-mail goes out and no in-app notification is written.
 */

async function competenceStatus(id: number): Promise<string> {
  return asString(
    field(
      toRows(
        await db.execute(
          sql`SELECT status FROM personnel_competence WHERE id = ${id}`,
        ),
      )[0],
      "status",
    ),
  );
}

async function competenceAudit(id: number) {
  return toRows(
    await db.execute(
      sql`SELECT organization_id, action, performed_by
          FROM personnel_competence_audit_log
          WHERE competence_id = ${id} ORDER BY id`,
    ),
  ).map((row) => ({
    organizationId: asString(field(row, "organization_id")),
    action: asString(field(row, "action")),
    performedBy: asString(field(row, "performed_by")),
  }));
}

async function notifications() {
  return toRows(
    await db.execute(
      sql`SELECT organization_id, type, entity_type, entity_id
          FROM scheduled_notification ORDER BY organization_id, type, entity_id`,
    ),
  ).map((row) => ({
    organizationId: asString(field(row, "organization_id")),
    type: asString(field(row, "type")),
    entityType: asString(field(row, "entity_type")),
    entityId: Number(field(row, "entity_id")),
  }));
}

async function seedTwoLabs() {
  const orgA = await seedScheduledOrg({ orgId: "org-A", userId: "owner-A" });
  const orgB = await seedScheduledOrg({ orgId: "org-B", userId: "owner-B" });
  await seedUser({ userId: "tech-A" });
  await seedUser({ userId: "tech-B" });

  const competenceA = await seedCompetence({
    organizationId: orgA.orgId,
    userId: "tech-A",
    expiresAt: daysFromNow(-3),
  });
  const competenceB = await seedCompetence({
    organizationId: orgB.orgId,
    userId: "tech-B",
    expiresAt: daysFromNow(-4),
  });
  // Laboratory A: an expired standard. Laboratory B: one expiring in 10 days.
  const standardA = await seedReferenceStandard({
    organizationId: orgA.orgId,
    unitId: orgA.unitId,
    createdBy: orgA.ownerUserId,
    serialNumber: "SN-A",
    nextCalibrationDate: daysFromNow(-5),
  });
  const standardB = await seedReferenceStandard({
    organizationId: orgB.orgId,
    unitId: orgB.unitId,
    createdBy: orgB.ownerUserId,
    serialNumber: "SN-B",
    nextCalibrationDate: daysFromNow(10),
  });
  // Laboratory B: an asset whose recalibration is due in 3 days (asset rows
  // reach their laboratory through organization_unit).
  const assetB = await seedScheduledAsset({
    organizationId: orgB.orgId,
    unitId: orgB.unitId,
    tag: "TAG-B",
    nextCalibrationDate: daysFromNow(3),
  });
  return { orgA, orgB, competenceA, competenceB, standardA, standardB, assetB };
}

beforeEach(async () => {
  await truncateAll();
});

describe("scheduled compliance sweep as calibra_app (P2-18j)", () => {
  it("REQ-WRLS-SCH-1 REQ-WRLS-SCH-2 [HIGH RISK] each laboratory's own rows are processed, each row written in its own laboratory", async () => {
    const lab = await seedTwoLabs();

    const totals = await processScheduledNotifications(envAsApplicationRole());

    expect(totals.competencesExpiredProcessed).toBe(2);
    expect(totals.standardsExpiredProcessed).toBe(1);
    expect(totals.standardsProcessed).toBe(1);
    expect(totals.assetsProcessed).toBe(1);

    expect(await competenceStatus(lab.competenceA)).toBe("EXPIRED");
    expect(await competenceStatus(lab.competenceB)).toBe("EXPIRED");
    expect(await competenceAudit(lab.competenceA)).toEqual([
      { organizationId: "org-A", action: "expire", performedBy: "system" },
    ]);
    expect(await competenceAudit(lab.competenceB)).toEqual([
      { organizationId: "org-B", action: "expire", performedBy: "system" },
    ]);

    expect(await notifications()).toEqual([
      {
        organizationId: "org-A",
        type: "COMPETENCE_EXPIRED",
        entityType: "competence",
        entityId: lab.competenceA,
      },
      {
        organizationId: "org-A",
        type: "STANDARD_EXPIRED",
        entityType: "standard",
        entityId: lab.standardA,
      },
      {
        organizationId: "org-B",
        type: "ASSET_DUE_FOR_RECALIBRATION",
        entityType: "asset",
        entityId: lab.assetB.assetId,
      },
      {
        organizationId: "org-B",
        type: "COMPETENCE_EXPIRED",
        entityType: "competence",
        entityId: lab.competenceB,
      },
      {
        organizationId: "org-B",
        type: "STANDARD_EXPIRING",
        entityType: "standard",
        entityId: lab.standardB,
      },
    ]);
  });

  it("REQ-WRLS-SCH-3 a second sweep processes nothing again, in either laboratory", async () => {
    await seedTwoLabs();
    const env = envAsApplicationRole();
    await processScheduledNotifications(env);

    const second = await processScheduledNotifications(env);

    expect(second).toEqual({
      assetsProcessed: 0,
      legalVerificationsProcessed: 0,
      standardsProcessed: 0,
      standardsExpiredProcessed: 0,
      jobsProcessed: 0,
      competencesExpiringProcessed: 0,
      competencesExpiredProcessed: 0,
      visitsProcessed: 0,
      signingCertsProcessed: 0,
      accreditationsProcessed: 0,
      scopeLinesProcessed: 0,
      ptPlanItemsProcessed: 0,
    });
    expect(await notifications()).toHaveLength(5);
  });
});
