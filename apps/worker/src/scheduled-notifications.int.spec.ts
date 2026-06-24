import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { processScheduledNotifications } from "./scheduled";
import { db, truncateAll } from "../test/integration/db";
import {
  daysFromNow,
  seedCompetence,
  seedReferenceStandard,
  seedScheduledNotification,
  seedScheduledOrg,
  seedUser,
} from "../test/integration/seed-scheduled";

// Real-DB integration tier for the worker's processScheduledNotifications handler
// (the ISO 17025 daily compliance sweep). The handler takes its entire outside
// world via the narrow env `{ DATABASE_URL }` and connects with its own raw
// pg.Client, so it is directly invocable. We seed via drizzle (same physical
// Postgres).
//
// The sweep's step 1 (checkAssetsDueForRecalibration) was crashing the WHOLE run
// with Postgres SQLSTATE 42703 (undefined_column: asset.organization_id) — the
// asset table is unit-scoped (unit_id -> organization_unit.organization_id), it
// has no direct organization_id. Because step 1 runs unconditionally and OUTSIDE
// the per-row try/catch, that rejection propagated through withDbClient and aborted
// the sweep before the regulated competence auto-expire (step 6) and every other
// step could run. The fix joins organization_unit and reads ou.organization_id.
// These tests now exercise the FULL sweep end-to-end against the real handler.
//
// The notify* helpers the sweep calls resolve recipients via
// getRecipientsByRole(org, ["admin","owner"]) reading the `member` table. The
// seeds DELIBERATELY omit member rows, so those helpers no-op (no email — RESEND
// is unset — and no `notification` insert), keeping the DB effects under assertion
// (competence status / audit log / scheduled_notification) clean. The notify* DB
// reads run REAL (no mock); they just find zero recipients and return.
//
// The worker imports the whole notifications barrel, which transitively pulls in
// @calibra-facil/email (React-Email `.tsx`). The worker integration Vitest config
// loads @vitejs/plugin-react so those `.tsx` files transform; nothing here renders
// an email, but the import graph must compile.

function buildEnv() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "[worker-int] scheduled spec ran before setup.ts set DATABASE_URL",
    );
  }
  return { DATABASE_URL: databaseUrl };
}

// Drizzle's db.execute returns either a `{ rows }` shape (Neon-serverless) or a
// bare row array (postgres-js). Normalize to a plain unknown[] without any `as`
// assertion (banned by oxlint), then read fields through type-narrowing helpers.
function toRows(result: unknown): unknown[] {
  if (result && typeof result === "object" && "rows" in result) {
    const inner = Reflect.get(result, "rows");
    return Array.isArray(inner) ? inner : [];
  }
  return Array.isArray(result) ? result : [];
}

function field(row: unknown, key: string): unknown {
  return row && typeof row === "object" && key in row
    ? Reflect.get(row, key)
    : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

async function competenceStatus(competenceId: number): Promise<string> {
  const result = await db.execute(
    sql`SELECT status FROM personnel_competence WHERE id = ${competenceId}`,
  );
  const row = toRows(result)[0];
  return asString(field(row, "status"));
}

async function competenceExpireAuditRows(competenceId: number) {
  const result = await db.execute(
    sql`SELECT action, changes, performed_by
        FROM personnel_competence_audit_log
        WHERE competence_id = ${competenceId} AND action = 'expire'
        ORDER BY id`,
  );
  return toRows(result).map((row) => ({
    action: asString(field(row, "action")),
    changes: field(row, "changes"),
    performed_by: asString(field(row, "performed_by")),
  }));
}

async function scheduledNotificationRows(filters?: {
  type?: string;
  entityType?: string;
  entityId?: number;
}) {
  const result = await db.execute(
    sql`SELECT organization_id, type, entity_type, entity_id, lead_time_days, sent_at
        FROM scheduled_notification
        ORDER BY entity_type, entity_id, type`,
  );
  return toRows(result)
    .map((row) => ({
      organization_id: asString(field(row, "organization_id")),
      type: asString(field(row, "type")),
      entity_type: asString(field(row, "entity_type")),
      entity_id: asNumber(field(row, "entity_id")),
      lead_time_days: asNumber(field(row, "lead_time_days")),
      sent_at: field(row, "sent_at"),
    }))
    .filter((row) => {
      if (filters?.type && row.type !== filters.type) return false;
      if (filters?.entityType && row.entity_type !== filters.entityType)
        return false;
      if (
        filters?.entityId !== undefined &&
        row.entity_id !== filters.entityId
      )
        return false;
      return true;
    });
}

beforeEach(async () => {
  await truncateAll();
});

describe("processScheduledNotifications (worker real-DB integration)", () => {
  // ── REQ-WSN-001 [HIGH RISK]: regulated competence auto-expire (step 6) ──────
  // The sweep's ISO 17025 Clause 6.2.3 auto-expire: an ACTIVE competence whose
  // expires_at is in the past must be flipped to EXPIRED and recorded in the
  // append-only personnel_competence_audit_log (action='expire', performed_by=
  // 'system'). A second run must be idempotent — the `AND status='ACTIVE'` guard
  // skips the now-EXPIRED row, so no re-expire and no duplicate audit entry.
  it("REQ-WSN-001 competence auto-expire: ACTIVE+past-expiry -> EXPIRED + 'expire' audit row; 2nd run idempotent", async () => {
    const org = await seedScheduledOrg({ orgId: "org-1", userId: "owner-1" });
    await seedUser({ userId: "tech-1", name: "Técnico Um" });
    await seedUser({ userId: "tech-2", name: "Técnico Dois" });
    const competenceId = await seedCompetence({
      organizationId: org.orgId,
      userId: "tech-1",
      status: "ACTIVE",
      expiresAt: daysFromNow(-3),
    });

    // A non-ACTIVE competence (already SUSPENDED) must be left untouched by the
    // auto-expire (the WHERE filters on status='ACTIVE'). A different user keeps
    // the (org, user, asset_type=NULL) unique index from colliding with above.
    const suspendedId = await seedCompetence({
      organizationId: org.orgId,
      userId: "tech-2",
      scopeDescription: "Calibração de pressão",
      status: "SUSPENDED",
      expiresAt: daysFromNow(-10),
    });

    const first = await processScheduledNotifications(buildEnv());
    expect(first.competencesExpiredProcessed).toBe(1);

    // Status flipped to EXPIRED + exactly one 'expire' audit row by 'system'.
    expect(await competenceStatus(competenceId)).toBe("EXPIRED");
    const audit = await competenceExpireAuditRows(competenceId);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.performed_by).toBe("system");

    // The non-ACTIVE competence is untouched (no expire, no audit row).
    expect(await competenceStatus(suspendedId)).toBe("SUSPENDED");
    expect(await competenceExpireAuditRows(suspendedId)).toHaveLength(0);

    // Idempotent: a 2nd run does not re-expire and does not write a 2nd audit row.
    const second = await processScheduledNotifications(buildEnv());
    expect(second.competencesExpiredProcessed).toBe(0);
    expect(await competenceStatus(competenceId)).toBe("EXPIRED");
    expect(await competenceExpireAuditRows(competenceId)).toHaveLength(1);
  });

  // ── REQ-WSN-002 [HIGH RISK]: dedupe guard ───────────────────────────────────
  // Running the sweep twice must yield exactly ONE scheduled_notification per
  // (org, type, entity, lead_time). Two guards combine: the NOT EXISTS recency
  // window in each check* query suppresses re-selection, and the recorder's
  // ON CONFLICT keeps a single row. We also prove a pre-seeded recent sent_at row
  // suppresses a fresh run entirely.
  it("REQ-WSN-002 dedupe: two sweeps yield exactly one scheduled_notification per (type, entity); pre-seeded sent_at suppresses", async () => {
    const org = await seedScheduledOrg({ orgId: "org-1", userId: "owner-1" });

    // An EXPIRED reference standard (next_calibration_date in the past).
    const expiredStdId = await seedReferenceStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.ownerUserId,
      serialNumber: "SN-EXPIRED",
      certificateNumber: "CERT-EXPIRED",
      nextCalibrationDate: daysFromNow(-5),
    });

    const first = await processScheduledNotifications(buildEnv());
    expect(first.standardsExpiredProcessed).toBe(1);
    expect(
      await scheduledNotificationRows({
        type: "STANDARD_EXPIRED",
        entityType: "standard",
        entityId: expiredStdId,
      }),
    ).toHaveLength(1);

    // Second run: the NOT EXISTS recency guard skips it; ON CONFLICT keeps one row.
    const second = await processScheduledNotifications(buildEnv());
    expect(second.standardsExpiredProcessed).toBe(0);
    expect(
      await scheduledNotificationRows({
        type: "STANDARD_EXPIRED",
        entityType: "standard",
        entityId: expiredStdId,
      }),
    ).toHaveLength(1);

    // A DIFFERENT expired standard that was already notified recently (pre-seeded
    // sent_at within the 7-day window) is suppressed on a fresh sweep.
    const preNotifiedStdId = await seedReferenceStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.ownerUserId,
      serialNumber: "SN-PRENOTIFIED",
      certificateNumber: "CERT-PRENOTIFIED",
      nextCalibrationDate: daysFromNow(-5),
    });
    await seedScheduledNotification({
      organizationId: org.orgId,
      type: "STANDARD_EXPIRED",
      entityType: "standard",
      entityId: preNotifiedStdId,
      leadTimeDays: 0,
      sentAt: new Date(),
    });

    const third = await processScheduledNotifications(buildEnv());
    expect(third.standardsExpiredProcessed).toBe(0);
    expect(
      await scheduledNotificationRows({
        type: "STANDARD_EXPIRED",
        entityType: "standard",
        entityId: preNotifiedStdId,
      }),
    ).toHaveLength(1);
  });

  // ── REQ-WSN-003: multi-tenant tagging ───────────────────────────────────────
  // With two seeded orgs each owning an expired standard, every recorded
  // scheduled_notification must carry ITS OWN organization_id — no cross-tenant
  // leak (a regression where the asset query read the wrong org would surface here).
  it("REQ-WSN-003 multi-tenant: each scheduled_notification is tagged to its own organization_id", async () => {
    const orgA = await seedScheduledOrg({ orgId: "org-a", userId: "owner-a" });
    const orgB = await seedScheduledOrg({ orgId: "org-b", userId: "owner-b" });

    const stdA = await seedReferenceStandard({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      createdBy: orgA.ownerUserId,
      serialNumber: "SN-A",
      certificateNumber: "CERT-A",
      nextCalibrationDate: daysFromNow(-5),
    });
    const stdB = await seedReferenceStandard({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      createdBy: orgB.ownerUserId,
      serialNumber: "SN-B",
      certificateNumber: "CERT-B",
      nextCalibrationDate: daysFromNow(-5),
    });

    const result = await processScheduledNotifications(buildEnv());
    expect(result.standardsExpiredProcessed).toBe(2);

    const rowsA = await scheduledNotificationRows({
      entityType: "standard",
      entityId: stdA,
    });
    const rowsB = await scheduledNotificationRows({
      entityType: "standard",
      entityId: stdB,
    });
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0]?.organization_id).toBe(orgA.orgId);
    expect(rowsB[0]?.organization_id).toBe(orgB.orgId);
  });

  // ── happy-path: a clean multi-entity sweep ──────────────────────────────────
  // One org with an ACTIVE+expired competence, an EXPIRED standard, and an
  // EXPIRING (within 30 days) standard. A single clean sweep records exactly the
  // expected scheduled_notification rows and processed counts across the steps.
  it("happy-path: a clean multi-entity sweep records the expected rows + processed counts", async () => {
    const org = await seedScheduledOrg({ orgId: "org-1", userId: "owner-1" });
    await seedUser({ userId: "tech-1", name: "Técnico Um" });

    const competenceId = await seedCompetence({
      organizationId: org.orgId,
      userId: "tech-1",
      status: "ACTIVE",
      expiresAt: daysFromNow(-2),
    });
    const expiredStdId = await seedReferenceStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.ownerUserId,
      serialNumber: "SN-EXP",
      certificateNumber: "CERT-EXP",
      nextCalibrationDate: daysFromNow(-5),
    });
    const expiringStdId = await seedReferenceStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.ownerUserId,
      serialNumber: "SN-SOON",
      certificateNumber: "CERT-SOON",
      nextCalibrationDate: daysFromNow(15),
    });

    const result = await processScheduledNotifications(buildEnv());

    expect(result.competencesExpiredProcessed).toBe(1);
    expect(result.standardsExpiredProcessed).toBe(1);
    expect(result.standardsProcessed).toBe(1);
    expect(result.assetsProcessed).toBe(0);
    expect(result.jobsProcessed).toBe(0);
    expect(result.visitsProcessed).toBe(0);

    expect(
      await scheduledNotificationRows({
        type: "COMPETENCE_EXPIRED",
        entityType: "competence",
        entityId: competenceId,
      }),
    ).toHaveLength(1);
    expect(
      await scheduledNotificationRows({
        type: "STANDARD_EXPIRED",
        entityType: "standard",
        entityId: expiredStdId,
      }),
    ).toHaveLength(1);
    expect(
      await scheduledNotificationRows({
        type: "STANDARD_EXPIRING",
        entityType: "standard",
        entityId: expiringStdId,
      }),
    ).toHaveLength(1);

    // The competence was also auto-expired as part of the same sweep.
    expect(await competenceStatus(competenceId)).toBe("EXPIRED");
  });
});
