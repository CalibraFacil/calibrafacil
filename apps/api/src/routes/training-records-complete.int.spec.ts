/**
 * training-records-complete.int.spec.ts - P2-18d.
 *
 * POST /:id/complete (ISO/IEC 17025 §6.2.3 training evidence) had no integration
 * spec. Success path plus the cross-laboratory negative, run as the owner here and
 * as `calibra_app` by `pnpm --filter @calibra-facil/api rls:shadow-report`.
 *
 *   REQ-18D-TR-1  complete marks the record `completed`, stamps the end date when it
 *                 had none, and writes the "complete" audit row (DB-verified).
 *   REQ-18D-TR-2  Lab B's training record id in lab A's session is a 404; lab B's
 *                 row stays `planned` and gains no audit row.
 *   REQ-18D-TR-3  RBAC unchanged: a technician (competence:update denied) gets 403.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  trainingRecord,
  trainingRecordAuditLog,
} from "@calibra-facil/db/schema";
import { trainingRecordsRouter } from "./training-records";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

async function seedTrainingRecord(organizationId: string, userId: string) {
  const [row] = await db
    .insert(trainingRecord)
    .values({
      organizationId,
      userId,
      createdBy: userId,
      title: "Treinamento GUM",
      type: "internal",
      status: "planned",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
    })
    .returning({ id: trainingRecord.id });
  if (!row) throw new Error("seedTrainingRecord: insert failed");
  return row.id;
}

async function recordRow(id: number) {
  const [row] = await db
    .select()
    .from(trainingRecord)
    .where(eq(trainingRecord.id, id));
  if (!row) throw new Error(`training record ${id} vanished`);
  return row;
}

describe("training records router: complete (P2-18d)", () => {
  beforeEach(async () => {
    await truncateAll();
    logout();
  });

  it("REQ-18D-TR-1: complete marks the record completed, stamps the end date and audits", async () => {
    const a = await seedOrg({ orgId: "org-a", role: "admin" });
    const id = await seedTrainingRecord(a.orgId, a.userId);
    loginAs({ userId: a.userId, organizationId: a.orgId });

    const res = await trainingRecordsRouter.request(`/${id}/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const row = await recordRow(id);
    expect(row.status).toBe("completed");
    expect(row.endDate).not.toBeNull();
    const audit = await db
      .select({ action: trainingRecordAuditLog.action })
      .from(trainingRecordAuditLog)
      .where(eq(trainingRecordAuditLog.trainingRecordId, id));
    expect(audit.map((entry) => entry.action)).toEqual(["complete"]);
  });

  it("REQ-18D-TR-2: lab B's training record is a 404 in lab A's session and stays untouched", async () => {
    const a = await seedOrg({ orgId: "org-a", role: "admin" });
    const b = await seedOrg({ orgId: "org-b", role: "admin" });
    const foreign = await seedTrainingRecord(b.orgId, b.userId);
    loginAs({ userId: a.userId, organizationId: a.orgId });

    const res = await trainingRecordsRouter.request(`/${foreign}/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(404);

    expect((await recordRow(foreign)).status).toBe("planned");
    const audit = await db
      .select({ id: trainingRecordAuditLog.id })
      .from(trainingRecordAuditLog)
      .where(eq(trainingRecordAuditLog.trainingRecordId, foreign));
    expect(audit).toEqual([]);
  });

  it("REQ-18D-TR-3: a technician cannot complete a record (competence:update denied)", async () => {
    const a = await seedOrg({ orgId: "org-a", role: "technician" });
    const id = await seedTrainingRecord(a.orgId, a.userId);
    loginAs({ userId: a.userId, organizationId: a.orgId });

    const res = await trainingRecordsRouter.request(`/${id}/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
    expect((await recordRow(id)).status).toBe("planned");
  });
});
