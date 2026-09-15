/**
 * spc.int.spec.ts — Real-DB + real-RBAC integration tests for the ISO/IEC
 * 17025 §7.7.1 check-standard SPC module (issue #60 Phase 1).
 *
 * REQ-SPC-001  Tenant isolation on charts
 * REQ-SPC-002  Reading ingestion re-evaluates the chart:
 *              insufficient_data → in_control → out_of_control (3σ breach)
 * REQ-SPC-003  Escalation opens ONE CAPA (source=spc_signal); in-control
 *              charts and already-escalated charts are rejected
 * REQ-SPC-004  RBAC: member (read-only) cannot record readings
 */

import { beforeEach, describe, expect, it } from "vitest";
import { spcRouter } from "./spc";
import { db } from "@calibra-facil/db";
import { correctiveAction, controlChart } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedStandard } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" } as const;

/** Stable in-control series (same fixture as the engine spec). */
const STABLE = [
  10.01, 9.99, 10.02, 9.98, 10.0, 10.01, 9.99, 10.02, 9.98, 10.0, 10.01, 9.99,
];

async function createChart(standardId: number, parameter = "100 g") {
  const res = await spcRouter.request("/charts", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      standardId,
      parameter,
      chartType: "i_mr",
      params: { baselineWindow: STABLE.length },
    }),
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function postReading(
  standardId: number,
  value: number,
  index: number,
  parameter = "100 g",
) {
  const measuredAt = new Date(Date.UTC(2026, 0, 1 + index)).toISOString();
  const res = await spcRouter.request("/readings", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ standardId, parameter, value, measuredAt }),
  });
  expect(res.status).toBe(201);
}

describe("spc router (integration)", () => {
  beforeEach(async () => {
    await truncateAll();
    logout();
  });

  it("REQ-SPC-001: org A cannot read or recalculate org B's charts", async () => {
    const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const orgB = await seedOrg({ orgId: "org-b", userId: "user-b" });

    loginAs({ userId: orgB.userId, organizationId: orgB.orgId });
    const bStandard = await seedStandard({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      createdBy: orgB.userId,
    });
    const bChart = await createChart(bStandard);

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const listRes = await spcRouter.request("/charts", {
      headers: JSON_HEADERS,
    });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.pagination.total).toBe(0);

    const getRes = await spcRouter.request(`/charts/${bChart.id}`, {
      headers: JSON_HEADERS,
    });
    expect(getRes.status).toBe(404);

    const recalcRes = await spcRouter.request(
      `/charts/${bChart.id}/recalculate`,
      { method: "POST", headers: JSON_HEADERS },
    );
    expect(recalcRes.status).toBe(404);
  });

  it("REQ-SPC-002: readings drive insufficient_data → in_control → out_of_control", async () => {
    const org = await seedOrg();
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const standardId = await seedStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });

    const chart = await createChart(standardId);
    expect(chart.status).toBe("insufficient_data");

    for (const [i, value] of STABLE.entries()) {
      await postReading(standardId, value, i);
    }
    let detailRes = await spcRouter.request(`/charts/${chart.id}`, {
      headers: JSON_HEADERS,
    });
    let detail = await detailRes.json();
    expect(detail.status).toBe("in_control");
    expect(detail.readings).toHaveLength(STABLE.length);
    expect(detail.lastEvaluation.limits.centerline).toBeCloseTo(10.0, 3);
    expect(detail.lastEvaluation.fingerprint).toMatch(/^sha256:/);

    // 3σ breach (baseline frozen to the first 12 readings by baselineWindow)
    await postReading(standardId, 10.6, STABLE.length);
    detailRes = await spcRouter.request(`/charts/${chart.id}`, {
      headers: JSON_HEADERS,
    });
    detail = await detailRes.json();
    expect(detail.status).toBe("out_of_control");
    expect(
      detail.lastEvaluation.ruleHits.some(
        (h: { rule: string }) => h.rule === "weco_1_beyond_3sigma",
      ),
    ).toBe(true);
  });

  it("REQ-SPC-003: escalation opens one CAPA; in-control and double escalation rejected", async () => {
    const org = await seedOrg();
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const standardId = await seedStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });
    const chart = await createChart(standardId);

    // insufficient_data → cannot escalate
    const early = await spcRouter.request(`/charts/${chart.id}/escalate`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(early.status).toBe(400);

    for (const [i, value] of STABLE.entries()) {
      await postReading(standardId, value, i);
    }
    await postReading(standardId, 10.6, STABLE.length);

    const res = await spcRouter.request(`/charts/${chart.id}/escalate`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.capa.source).toBe("spc_signal");
    expect(body.data.capa.severity).toBe("major");
    expect(body.data.chart.capaId).toBe(body.data.capa.id);

    const again = await spcRouter.request(`/charts/${chart.id}/escalate`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(again.status).toBe(400);

    const capas = await db
      .select({ id: correctiveAction.id })
      .from(correctiveAction)
      .where(eq(correctiveAction.organizationId, org.orgId));
    expect(capas).toHaveLength(1);

    const [chartRow] = await db
      .select({ capaId: controlChart.capaId })
      .from(controlChart)
      .where(eq(controlChart.id, chart.id));
    expect(chartRow?.capaId).toBe(body.data.capa.id);
  });

  it("REQ-SPC-004: member (read-only) cannot record readings or create charts", async () => {
    const admin = await seedOrg({ orgId: "org-x", userId: "user-adm" });
    const standardId = await seedStandard({
      organizationId: admin.orgId,
      unitId: admin.unitId,
      createdBy: admin.userId,
    });

    const member = await seedOrg({
      orgId: "org-ro",
      userId: "user-ro",
      role: "member",
    });
    loginAs({ userId: member.userId, organizationId: member.orgId });

    const chartRes = await spcRouter.request("/charts", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ standardId, parameter: "100 g" }),
    });
    expect(chartRes.status).toBe(403);

    const readingRes = await spcRouter.request("/readings", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        standardId,
        parameter: "100 g",
        value: 10,
        measuredAt: "2026-01-01T00:00:00.000Z",
      }),
    });
    expect(readingRes.status).toBe(403);
  });
});
