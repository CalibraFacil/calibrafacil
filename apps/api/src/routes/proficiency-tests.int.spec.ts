/**
 * proficiency-tests.int.spec.ts — Real-DB + real-RBAC integration tests for
 * the ISO/IEC 17025 §7.7.2 proficiency-testing register (issue #60 Phase 0).
 *
 * Only the better-auth session is mocked (see test/integration/setup.ts).
 * requireLabAuth → requireOrganization → withLabPermission all run for real
 * against the seeded Postgres.
 *
 * REQ-PT-001  Tenant isolation: org A cannot read/update/delete org B's rounds
 * REQ-PT-002  Satisfactory En results: scores computed server-side, no CAPA,
 *             participation-plan clock advanced for the scope part
 * REQ-PT-003  Unsatisfactory results auto-open a CAPA (§7.7.3) with
 *             source=proficiency_test; re-recording does NOT open a second one
 * REQ-PT-004  RBAC: member (read-only) cannot create rounds
 * REQ-PT-005  Plan items compute nextDueAt from lastSatisfactoryAt + frequency
 */

import { beforeEach, describe, expect, it } from "vitest";
import { proficiencyTestsRouter } from "./proficiency-tests";
import { db } from "@calibra-facil/db";
import {
  correctiveAction,
  proficiencyTest,
  ptPlanItem,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" } as const;

function makeCreatePayload(overrides?: Record<string, unknown>) {
  return {
    activityType: "proficiency_test",
    provider: "Rede Metrológica RS",
    providerAccreditation: "Cgcre PEP 0002",
    ptRound: "PT-2026-01",
    scopePart: "Massa — pesos E2",
    registrationDate: "2026-02-01",
    participationDate: "2026-04-15",
    ...overrides,
  };
}

/** En = 0.05/√(0.04²+0.03²) = 1.0 → satisfactory (|En| ≤ 1). */
const SATISFACTORY_POINT = {
  label: "100 g",
  unit: "g",
  labValue: 100.05,
  labUncertainty: 0.04,
  refValue: 100.0,
  refUncertainty: 0.03,
  scoreType: "en",
};

/** En = 0.5/0.05 = 10 → unsatisfactory. */
const UNSATISFACTORY_POINT = {
  label: "200 g",
  unit: "g",
  labValue: 200.5,
  labUncertainty: 0.04,
  refValue: 200.0,
  refUncertainty: 0.03,
  scoreType: "en",
};

async function createRound(payload?: Record<string, unknown>) {
  const res = await proficiencyTestsRouter.request("/", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(makeCreatePayload(payload)),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.id;
}

describe("proficiency-tests router (integration)", () => {
  beforeEach(async () => {
    await truncateAll();
    logout();
  });

  it("REQ-PT-001: org A cannot read, update or delete org B's PT rounds", async () => {
    const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const orgB = await seedOrg({ orgId: "org-b", userId: "user-b" });

    loginAs({ userId: orgB.userId, organizationId: orgB.orgId });
    const bRoundId = await createRound({ ptRound: "PT-B-001" });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    await createRound({ ptRound: "PT-A-001" });

    const listRes = await proficiencyTestsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.pagination.total).toBe(1);
    expect(listBody.data[0].ptRound).toBe("PT-A-001");

    const getRes = await proficiencyTestsRouter.request(`/${bRoundId}`, {
      headers: JSON_HEADERS,
    });
    expect(getRes.status).toBe(404);

    const putRes = await proficiencyTestsRouter.request(`/${bRoundId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ provider: "Hijacked" }),
    });
    expect(putRes.status).toBe(404);

    const delRes = await proficiencyTestsRouter.request(`/${bRoundId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });
    expect(delRes.status).toBe(404);

    const [bRow] = await db
      .select({ provider: proficiencyTest.provider })
      .from(proficiencyTest)
      .where(eq(proficiencyTest.id, bRoundId));
    expect(bRow?.provider).toBe("Rede Metrológica RS");
  });

  it("REQ-PT-002: satisfactory En results — server-side scoring, no CAPA, plan clock advanced", async () => {
    const org = await seedOrg();
    loginAs({ userId: org.userId, organizationId: org.orgId });

    // Plan item for the same scope part, no satisfactory round yet
    const planRes = await proficiencyTestsRouter.request("/plan", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        scopePart: "Massa — pesos E2",
        frequencyMonths: 48,
        riskJustification: "Escopo principal do laboratório",
      }),
    });
    expect(planRes.status).toBe(201);
    const planItem = await planRes.json();

    const roundId = await createRound();
    const res = await proficiencyTestsRouter.request(`/${roundId}/results`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        resultReportedAt: "2026-06-01T00:00:00.000Z",
        results: [SATISFACTORY_POINT],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.overallStatus).toBe("satisfactory");
    expect(body.capaId).toBeNull();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].score).toBeCloseTo(1.0, 6);
    expect(body.results[0].verdict).toBe("satisfactory");

    // Plan clock: lastSatisfactoryAt = report date; nextDueAt = +48 months
    const [plan] = await db
      .select()
      .from(ptPlanItem)
      .where(eq(ptPlanItem.id, planItem.id));
    expect(plan?.lastSatisfactoryAt?.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
    expect(plan?.nextDueAt?.toISOString()).toBe("2030-06-01T00:00:00.000Z");
  });

  it("REQ-PT-003: unsatisfactory results auto-open ONE CAPA with source=proficiency_test", async () => {
    const org = await seedOrg();
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const roundId = await createRound();
    const res = await proficiencyTestsRouter.request(`/${roundId}/results`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        resultReportedAt: "2026-06-01T00:00:00.000Z",
        results: [SATISFACTORY_POINT, UNSATISFACTORY_POINT],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overallStatus).toBe("unsatisfactory");
    expect(body.capaId).not.toBeNull();

    const [capa] = await db
      .select()
      .from(correctiveAction)
      .where(eq(correctiveAction.id, body.capaId));
    expect(capa?.source).toBe("proficiency_test");
    expect(capa?.sourceReference).toContain("PT-2026-01");
    expect(capa?.status).toBe("OPEN");
    expect(capa?.severity).toBe("major");

    // Double-escalation guard: re-recording results keeps the same CAPA
    const res2 = await proficiencyTestsRouter.request(`/${roundId}/results`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        resultReportedAt: "2026-06-02T00:00:00.000Z",
        results: [UNSATISFACTORY_POINT],
      }),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.capaId).toBe(body.capaId);

    const capas = await db
      .select({ id: correctiveAction.id })
      .from(correctiveAction)
      .where(eq(correctiveAction.organizationId, org.orgId));
    expect(capas).toHaveLength(1);
  });

  it("REQ-PT-003b: z-score warning band maps to questionable without CAPA", async () => {
    const org = await seedOrg();
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const roundId = await createRound();
    // z = 0.5/0.2 = 2.5 → questionable (2 < |z| < 3)
    const res = await proficiencyTestsRouter.request(`/${roundId}/results`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        resultReportedAt: "2026-06-01T00:00:00.000Z",
        results: [
          {
            label: "10 V",
            labValue: 10.5,
            refValue: 10.0,
            sigmaPt: 0.2,
            scoreType: "z",
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].score).toBeCloseTo(2.5, 6);
    expect(body.results[0].verdict).toBe("questionable");
    expect(body.overallStatus).toBe("questionable");
    expect(body.capaId).toBeNull();
  });

  it("REQ-PT-004: member (read-only) cannot create PT rounds", async () => {
    const org = await seedOrg({
      orgId: "org-ro",
      userId: "user-ro",
      role: "member",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await proficiencyTestsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(makeCreatePayload()),
    });
    expect(res.status).toBe(403);

    const listRes = await proficiencyTestsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(listRes.status).toBe(200);
  });

  it("REQ-PT-005: plan item computes nextDueAt from lastSatisfactoryAt + frequencyMonths", async () => {
    const org = await seedOrg();
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await proficiencyTestsRouter.request("/plan", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        scopePart: "Dimensional — blocos padrão",
        frequencyMonths: 24,
        lastSatisfactoryAt: "2025-03-01T00:00:00.000Z",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(new Date(body.nextDueAt).toISOString()).toBe(
      "2027-03-01T00:00:00.000Z",
    );

    const summaryRes = await proficiencyTestsRouter.request("/summary", {
      headers: JSON_HEADERS,
    });
    expect(summaryRes.status).toBe(200);
    const summary = await summaryRes.json();
    expect(summary.planItems).toBe(1);
  });
});
