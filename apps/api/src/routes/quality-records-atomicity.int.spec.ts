/**
 * quality-records-atomicity.int.spec.ts - P2-18d [HIGH RISK].
 *
 * A regulated change and its audit entry commit together or not at all. The
 * proficiency-test results handler (ISO/IEC 17025 §7.7.2, §7.7.3) writes the
 * round, its audit row, the auto-opened CAPA and the plan clock; a write that
 * fails after the audit insert must leave NONE of them behind. A trigger that
 * raises stands in for the failing write.
 *
 *   REQ-18D-ATOM-1  The plan-clock update fails after the audit insert: the round keeps
 *                   its pending state, no "record_results" audit row, the plan item is
 *                   unchanged.
 *   REQ-18D-ATOM-2  The round update fails after the CAPA and its audit were written:
 *                   no CAPA, no CAPA audit row, no PT audit row remain.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  correctiveAction,
  correctiveActionAuditLog,
  proficiencyTest,
  proficiencyTestAuditLog,
  ptPlanItem,
} from "@calibra-facil/db/schema";
import { proficiencyTestsRouter } from "./proficiency-tests";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" } as const;

const SATISFACTORY_POINT = {
  label: "100 g",
  unit: "g",
  labValue: 100.05,
  labUncertainty: 0.04,
  refValue: 100.0,
  refUncertainty: 0.03,
  scoreType: "en",
};

const UNSATISFACTORY_POINT = {
  label: "200 g",
  unit: "g",
  labValue: 200.5,
  labUncertainty: 0.04,
  refValue: 200.0,
  refUncertainty: 0.03,
  scoreType: "en",
};

/** Makes every UPDATE of `table` fail, for the duration of `run`. */
async function withFailingUpdates<T>(table: string, run: () => Promise<T>) {
  await db.execute(
    sql.raw(`create or replace function p218d_fail_update() returns trigger
      language plpgsql as $$ begin raise exception 'p218d: forced failure'; end $$`),
  );
  await db.execute(
    sql.raw(
      `create trigger p218d_fail_update before update on "${table}"
       for each row execute function p218d_fail_update()`,
    ),
  );
  try {
    return await run();
  } finally {
    await db.execute(
      sql.raw(`drop trigger if exists p218d_fail_update on "${table}"`),
    );
  }
}

async function seedRound(orgId: string) {
  const res = await proficiencyTestsRouter.request("/", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      activityType: "proficiency_test",
      provider: "Rede Metrológica RS",
      ptRound: "PT-2026-ATOM",
      scopePart: "Massa — pesos E2",
      registrationDate: "2026-02-01",
    }),
  });
  expect(res.status).toBe(201);
  const { id }: { id: number } = await res.json();
  expect(orgId).toBeTruthy();
  return id;
}

function postResults(roundId: number, points: unknown[]) {
  return proficiencyTestsRouter.request(`/${roundId}/results`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      resultReportedAt: "2026-06-01T00:00:00.000Z",
      results: points,
    }),
  });
}

async function auditActions(roundId: number) {
  const rows = await db
    .select({ action: proficiencyTestAuditLog.action })
    .from(proficiencyTestAuditLog)
    .where(eq(proficiencyTestAuditLog.proficiencyTestId, roundId));
  return rows.map((row) => row.action);
}

describe("quality records: a failed write after the audit insert rolls everything back (P2-18d)", () => {
  beforeEach(async () => {
    await truncateAll();
    logout();
    // The forced failure is logged by Hono's default error handler.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("REQ-18D-ATOM-1: the plan-clock update fails after the audit insert: no result, no audit, plan item unchanged", async () => {
    const org = await seedOrg({ orgId: "org-a", userId: "user-a" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const roundId = await seedRound(org.orgId);
    const [plan] = await db
      .insert(ptPlanItem)
      .values({
        organizationId: org.orgId,
        scopePart: "Massa — pesos E2",
        frequencyMonths: 48,
        nextDueAt: new Date("2030-01-01T00:00:00.000Z"),
        createdBy: org.userId,
      })
      .returning({ id: ptPlanItem.id });
    if (!plan) throw new Error("plan item not seeded");

    const res = await withFailingUpdates("pt_plan_item", () =>
      postResults(roundId, [SATISFACTORY_POINT]),
    );
    expect(res.status).toBe(500);

    const [round] = await db
      .select()
      .from(proficiencyTest)
      .where(eq(proficiencyTest.id, roundId));
    expect(round?.overallStatus).toBe("pending");
    expect(round?.resultReportedAt).toBeNull();
    expect(await auditActions(roundId)).toEqual(["create"]);
    const [planAfter] = await db
      .select()
      .from(ptPlanItem)
      .where(eq(ptPlanItem.id, plan.id));
    expect(planAfter?.lastSatisfactoryAt).toBeNull();
    expect(planAfter?.nextDueAt?.toISOString()).toBe(
      "2030-01-01T00:00:00.000Z",
    );

    // The same request without the failure then succeeds: nothing was half-done.
    const retry = await postResults(roundId, [SATISFACTORY_POINT]);
    expect(retry.status).toBe(200);
    expect(await auditActions(roundId)).toContain("record_results");
  });

  it("REQ-18D-ATOM-2: the round update fails after the CAPA was opened: no CAPA, no CAPA audit, no PT audit", async () => {
    const org = await seedOrg({ orgId: "org-a", userId: "user-a" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const roundId = await seedRound(org.orgId);

    const res = await withFailingUpdates("proficiency_test", () =>
      postResults(roundId, [UNSATISFACTORY_POINT]),
    );
    expect(res.status).toBe(500);

    expect(
      await db
        .select({ id: correctiveAction.id })
        .from(correctiveAction)
        .where(eq(correctiveAction.organizationId, org.orgId)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: correctiveActionAuditLog.id })
        .from(correctiveActionAuditLog)
        .where(eq(correctiveActionAuditLog.organizationId, org.orgId)),
    ).toEqual([]);
    expect(await auditActions(roundId)).toEqual(["create"]);
  });
});
