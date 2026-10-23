/**
 * competences-workflow.int.spec.ts - P2-18d [HIGH RISK].
 *
 * Success paths (and a cross-laboratory negative for each) of the competence
 * workflow handlers that competences.int.spec.ts does not reach: label,
 * assign-training, start-training, complete-training, cancel, suspend, renew
 * (ISO/IEC 17025 §6.2.3). Run as the owner here and, through
 * `pnpm --filter @calibra-facil/api rls:shadow-report`, as `calibra_app` under
 * the `tenant_isolation` policies.
 *
 *   REQ-18D-COMP-1  Each transition moves the status exactly as the state machine
 *                   says and writes its audit row (DB-verified).
 *   REQ-18D-COMP-2  assign-training links only training records of the same lab AND
 *                   the same technician; lab B's training record id from lab A is a
 *                   400 and nothing is linked.
 *   REQ-18D-COMP-3  Lab B's competence id in lab A's session is a 404 on every
 *                   handler and lab B's row is untouched.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  assetType,
  personnelCompetence,
  personnelCompetenceAuditLog,
  trainingRecord,
} from "@calibra-facil/db/schema";
import { competencesRouter } from "./competences";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" } as const;

type Status = (typeof personnelCompetence.$inferInsert)["status"];

let assetTypeSequence = 0;

/** One competence per (lab, technician, asset type): each seed takes its own asset type. */
async function seedCompetence(params: {
  organizationId: string;
  userId: string;
  status: Status;
}): Promise<number> {
  assetTypeSequence += 1;
  const [type] = await db
    .insert(assetType)
    .values({
      name: `Tipo ${assetTypeSequence}`,
      slug: `tipo-${assetTypeSequence}`,
      definition: [],
    })
    .returning({ id: assetType.id });
  if (!type) throw new Error("seedCompetence: asset type insert failed");
  const [row] = await db
    .insert(personnelCompetence)
    .values({
      organizationId: params.organizationId,
      userId: params.userId,
      assetTypeId: type.id,
      requestedBy: params.userId,
      createdBy: params.userId,
      scopeDescription: "Calibração de manômetros",
      status: params.status,
    })
    .returning({ id: personnelCompetence.id });
  if (!row) throw new Error("seedCompetence: insert failed");
  return row.id;
}

async function seedTraining(params: {
  organizationId: string;
  userId: string;
}): Promise<number> {
  const [row] = await db
    .insert(trainingRecord)
    .values({
      organizationId: params.organizationId,
      userId: params.userId,
      createdBy: params.userId,
      title: "Treinamento GUM",
      type: "internal",
      status: "planned",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
    })
    .returning({ id: trainingRecord.id });
  if (!row) throw new Error("seedTraining: insert failed");
  return row.id;
}

async function competenceRow(id: number) {
  const [row] = await db
    .select()
    .from(personnelCompetence)
    .where(eq(personnelCompetence.id, id));
  if (!row) throw new Error(`competence ${id} vanished`);
  return row;
}

async function auditActions(competenceId: number) {
  const rows = await db
    .select({ action: personnelCompetenceAuditLog.action })
    .from(personnelCompetenceAuditLog)
    .where(eq(personnelCompetenceAuditLog.competenceId, competenceId));
  return rows.map((row) => row.action);
}

function post(path: string, body?: unknown) {
  return competencesRouter.request(path, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body ?? {}),
  });
}

async function twoLabs() {
  const a = await seedOrg({ orgId: "org-a", role: "admin" });
  const b = await seedOrg({ orgId: "org-b", role: "admin" });
  loginAs({ userId: a.userId, organizationId: a.orgId });
  return { a, b };
}

describe("competences router: workflow handlers (P2-18d)", () => {
  beforeEach(async () => {
    await truncateAll();
    logout();
    assetTypeSequence = 0;
  });

  it("REQ-18D-COMP-1: GET /:id/label returns the technician's name; lab B's competence is a 404", async () => {
    const { a, b } = await twoLabs();
    const own = await seedCompetence({
      organizationId: a.orgId,
      userId: a.userId,
      status: "ACTIVE",
    });
    const foreign = await seedCompetence({
      organizationId: b.orgId,
      userId: b.userId,
      status: "ACTIVE",
    });

    const ok = await competencesRouter.request(`/${own}/label`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ id: own, label: `User ${a.userId}` });

    const denied = await competencesRouter.request(`/${foreign}/label`);
    expect(denied.status).toBe(404);
  });

  it("REQ-18D-COMP-1/2: assign-training links the technician's own training records and moves REQUESTED to TRAINING_ASSIGNED", async () => {
    const { a, b } = await twoLabs();
    const compId = await seedCompetence({
      organizationId: a.orgId,
      userId: a.userId,
      status: "REQUESTED",
    });
    const trainingId = await seedTraining({
      organizationId: a.orgId,
      userId: a.userId,
    });
    const foreignTrainingId = await seedTraining({
      organizationId: b.orgId,
      userId: b.userId,
    });

    const res = await post(`/${compId}/assign-training`, {
      trainingRecordIds: [trainingId],
    });
    expect(res.status).toBe(200);
    expect((await competenceRow(compId)).status).toBe("TRAINING_ASSIGNED");
    const [linked] = await db
      .select({ competenceId: trainingRecord.competenceId })
      .from(trainingRecord)
      .where(eq(trainingRecord.id, trainingId));
    expect(linked?.competenceId).toBe(compId);
    expect(await auditActions(compId)).toContain("assign_training");

    // Lab B's training record never links, and the competence stays put.
    const secondComp = await seedCompetence({
      organizationId: a.orgId,
      userId: a.userId,
      status: "REQUESTED",
    });
    const refused = await post(`/${secondComp}/assign-training`, {
      trainingRecordIds: [foreignTrainingId],
    });
    expect(refused.status).toBe(400);
    expect((await competenceRow(secondComp)).status).toBe("REQUESTED");
    const [untouched] = await db
      .select({ competenceId: trainingRecord.competenceId })
      .from(trainingRecord)
      .where(eq(trainingRecord.id, foreignTrainingId));
    expect(untouched?.competenceId).toBeNull();
  });

  it("REQ-18D-COMP-1: start-training then complete-training walk TRAINING_ASSIGNED to PENDING_EVALUATION", async () => {
    const { a } = await twoLabs();
    const compId = await seedCompetence({
      organizationId: a.orgId,
      userId: a.userId,
      status: "TRAINING_ASSIGNED",
    });

    const started = await post(`/${compId}/start-training`);
    expect(started.status).toBe(200);
    expect((await competenceRow(compId)).status).toBe("IN_TRAINING");

    const completed = await post(`/${compId}/complete-training`);
    expect(completed.status).toBe(200);
    expect((await competenceRow(compId)).status).toBe("PENDING_EVALUATION");
    expect(await auditActions(compId)).toEqual(
      expect.arrayContaining(["start_training", "complete_training"]),
    );
  });

  it("REQ-18D-COMP-1: cancel, suspend and renew move the status and audit with their reason", async () => {
    const { a } = await twoLabs();
    const toCancel = await seedCompetence({
      organizationId: a.orgId,
      userId: a.userId,
      status: "IN_TRAINING",
    });
    const cancelled = await post(`/${toCancel}/cancel`, {
      notes: "Desistência do técnico",
    });
    expect(cancelled.status).toBe(200);
    const cancelledRow = await competenceRow(toCancel);
    expect(cancelledRow.status).toBe("CANCELLED");
    expect(cancelledRow.notes).toBe("Desistência do técnico");

    const toSuspend = await seedCompetence({
      organizationId: a.orgId,
      userId: a.userId,
      status: "ACTIVE",
    });
    const suspended = await post(`/${toSuspend}/suspend`);
    expect(suspended.status).toBe(200);
    expect((await competenceRow(toSuspend)).status).toBe("SUSPENDED");

    const renewed = await post(`/${toSuspend}/renew`, {
      passed: true,
      expiresAt: "2030-01-01T00:00:00.000Z",
      notes: "Reavaliado",
    });
    expect(renewed.status).toBe(200);
    const renewedRow = await competenceRow(toSuspend);
    expect(renewedRow.status).toBe("ACTIVE");
    expect(renewedRow.approvedBy).toBe(a.userId);
    expect(renewedRow.expiresAt?.toISOString()).toBe(
      "2030-01-01T00:00:00.000Z",
    );

    expect(await auditActions(toCancel)).toContain("cancel");
    expect(await auditActions(toSuspend)).toEqual(
      expect.arrayContaining(["suspend", "renew"]),
    );
  });

  it("REQ-18D-COMP-3: lab B's competence id is a 404 on every workflow handler and lab B's row is untouched", async () => {
    const { a, b } = await twoLabs();
    const cases: Array<{ path: string; status: Status; body?: unknown }> = [
      {
        path: "assign-training",
        status: "REQUESTED",
        body: { trainingRecordIds: [1] },
      },
      { path: "start-training", status: "TRAINING_ASSIGNED" },
      { path: "complete-training", status: "IN_TRAINING" },
      { path: "cancel", status: "REQUESTED", body: { notes: "x" } },
      { path: "suspend", status: "ACTIVE" },
      { path: "renew", status: "SUSPENDED", body: { passed: true } },
    ];

    for (const { path, status, body } of cases) {
      const foreign = await seedCompetence({
        organizationId: b.orgId,
        userId: b.userId,
        status,
      });
      const res = await post(`/${foreign}/${path}`, body);
      expect(res.status, path).toBe(404);
      expect((await competenceRow(foreign)).status, path).toBe(status);
      const audit = await db
        .select({ id: personnelCompetenceAuditLog.id })
        .from(personnelCompetenceAuditLog)
        .where(
          and(
            eq(personnelCompetenceAuditLog.competenceId, foreign),
            eq(personnelCompetenceAuditLog.organizationId, b.orgId),
          ),
        );
      expect(audit, path).toEqual([]);
    }
    expect(a.orgId).toBe("org-a");
  });
});
