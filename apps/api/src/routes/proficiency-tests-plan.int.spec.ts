/**
 * proficiency-tests-plan.int.spec.ts - P2-18d.
 *
 * The participation-plan handlers and the audit log of proficiency-tests.int.spec.ts'
 * neighbours (ISO/IEC 17025 §7.7.2, NIT-DICLA-026 §9.4): GET /plan, PUT /plan/:id,
 * DELETE /plan/:id and GET /:id/audit-log. Success paths and cross-laboratory
 * negatives, run as the owner here and as `calibra_app` by
 * `pnpm --filter @calibra-facil/api rls:shadow-report`.
 *
 *   REQ-18D-PT-1  GET /plan lists only the lab's plan items.
 *   REQ-18D-PT-2  PUT /plan/:id recomputes next_due_at from last_satisfactory_at + the
 *                 frequency; DELETE /plan/:id removes the item.
 *   REQ-18D-PT-3  GET /:id/audit-log returns the round's trail, names the actor.
 *   REQ-18D-PT-4  Lab B's plan item / round ids in lab A's session are 404 and lab B's
 *                 rows are untouched.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { ptPlanItem } from "@calibra-facil/db/schema";
import { proficiencyTestsRouter } from "./proficiency-tests";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" } as const;

async function seedPlanItem(
  organizationId: string,
  userId: string,
  scopePart: string,
) {
  const [row] = await db
    .insert(ptPlanItem)
    .values({
      organizationId,
      scopePart,
      frequencyMonths: 48,
      nextDueAt: new Date("2030-01-01T00:00:00.000Z"),
      createdBy: userId,
    })
    .returning({ id: ptPlanItem.id });
  if (!row) throw new Error("plan item not seeded");
  return row.id;
}

async function twoLabs() {
  const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
  const b = await seedOrg({ orgId: "org-b", userId: "user-b" });
  return { a, b };
}

describe("proficiency-tests router: plan and audit log (P2-18d)", () => {
  beforeEach(async () => {
    await truncateAll();
    logout();
  });

  it("REQ-18D-PT-1: GET /plan lists only the lab's own plan items", async () => {
    const { a, b } = await twoLabs();
    await seedPlanItem(a.orgId, a.userId, "Massa A");
    await seedPlanItem(b.orgId, b.userId, "Massa B");
    loginAs({ userId: a.userId, organizationId: a.orgId });

    const res = await proficiencyTestsRouter.request("/plan");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      body.data.map((item: { scopePart: string }) => item.scopePart),
    ).toEqual(["Massa A"]);
  });

  it("REQ-18D-PT-2: PUT /plan/:id recomputes the next due date; DELETE removes the item", async () => {
    const { a } = await twoLabs();
    const id = await seedPlanItem(a.orgId, a.userId, "Massa A");
    loginAs({ userId: a.userId, organizationId: a.orgId });

    const put = await proficiencyTestsRouter.request(`/plan/${id}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        frequencyMonths: 12,
        lastSatisfactoryAt: "2026-01-15T00:00:00.000Z",
      }),
    });
    expect(put.status).toBe(200);
    const [row] = await db
      .select()
      .from(ptPlanItem)
      .where(eq(ptPlanItem.id, id));
    expect(row?.frequencyMonths).toBe(12);
    expect(row?.nextDueAt?.getUTCFullYear()).toBe(2027);
    expect(row?.nextDueAt?.getUTCMonth()).toBe(0);

    const del = await proficiencyTestsRouter.request(`/plan/${id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    expect(
      await db.select().from(ptPlanItem).where(eq(ptPlanItem.id, id)),
    ).toEqual([]);
  });

  it("REQ-18D-PT-3: GET /:id/audit-log returns the round's trail with the actor's name", async () => {
    const { a } = await twoLabs();
    loginAs({ userId: a.userId, organizationId: a.orgId });
    const created = await proficiencyTestsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        activityType: "proficiency_test",
        provider: "Rede Metrológica RS",
        ptRound: "PT-2026-77",
        scopePart: "Massa — pesos E2",
        registrationDate: "2026-02-01",
      }),
    });
    expect(created.status).toBe(201);
    const { id } = await created.json();

    const res = await proficiencyTestsRouter.request(`/${id}/audit-log`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const logs = Array.isArray(body) ? body : body.data;
    expect(logs.map((log: { action: string }) => log.action)).toEqual([
      "create",
    ]);
    expect(logs[0].performedByName ?? logs[0].performedBy).toBeTruthy();
  });

  it("REQ-18D-PT-4: lab B's plan item and round are 404 in lab A's session; lab B's rows stay", async () => {
    const { a, b } = await twoLabs();
    const foreignPlan = await seedPlanItem(b.orgId, b.userId, "Massa B");
    loginAs({ userId: b.userId, organizationId: b.orgId });
    const created = await proficiencyTestsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        activityType: "proficiency_test",
        provider: "Rede B",
        ptRound: "PT-B-9",
        scopePart: "Massa B",
        registrationDate: "2026-02-01",
      }),
    });
    const { id: foreignRound } = await created.json();

    loginAs({ userId: a.userId, organizationId: a.orgId });
    const put = await proficiencyTestsRouter.request(`/plan/${foreignPlan}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ frequencyMonths: 6 }),
    });
    expect(put.status).toBe(404);
    const del = await proficiencyTestsRouter.request(`/plan/${foreignPlan}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(404);
    const audit = await proficiencyTestsRouter.request(
      `/${foreignRound}/audit-log`,
    );
    expect(audit.status).toBe(404);

    const [row] = await db
      .select()
      .from(ptPlanItem)
      .where(eq(ptPlanItem.id, foreignPlan));
    expect(row?.frequencyMonths).toBe(48);
  });
});
