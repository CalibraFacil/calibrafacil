/**
 * spc-charts-readings.int.spec.ts - P2-18d.
 *
 * The SPC handlers spc.int.spec.ts does not reach (ISO/IEC 17025 §7.7.1): PUT and
 * DELETE /charts/:id, GET /readings, DELETE /readings/:id. Success paths and the
 * cross-laboratory negatives, run as the owner here and as `calibra_app` by
 * `pnpm --filter @calibra-facil/api rls:shadow-report`.
 *
 *   REQ-18D-SPC-A  PUT /charts/:id changes the chart type, re-evaluates it and audits.
 *   REQ-18D-SPC-B  DELETE /charts/:id removes the chart and leaves the "delete" audit row.
 *   REQ-18D-SPC-C  GET /readings lists the lab's chronological readings of a standard;
 *                  lab B's standard id in lab A's session lists nothing.
 *   REQ-18D-SPC-D  DELETE /readings/:id removes the reading and re-evaluates the chart.
 *   REQ-18D-SPC-E  Lab B's chart / reading ids in lab A's session are a 404 and lab B's
 *                  rows are untouched.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  checkStandardReading,
  controlChart,
  controlChartAuditLog,
} from "@calibra-facil/db/schema";
import { spcRouter } from "./spc";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedStandard } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" } as const;

const STABLE = [
  10.01, 9.99, 10.02, 9.98, 10.0, 10.01, 9.99, 10.02, 9.98, 10.0, 10.01, 9.99,
];

async function seedLab(tag: "a" | "b") {
  const org = await seedOrg({ orgId: `org-${tag}`, userId: `user-${tag}` });
  const standardId = await seedStandard({
    organizationId: org.orgId,
    unitId: org.unitId,
    createdBy: org.userId,
  });
  const [chart] = await db
    .insert(controlChart)
    .values({
      organizationId: org.orgId,
      standardId,
      parameter: "100 g",
      chartType: "i_mr",
      params: { baselineWindow: STABLE.length },
      createdBy: org.userId,
    })
    .returning({ id: controlChart.id });
  if (!chart) throw new Error("chart not seeded");
  const readings = await db
    .insert(checkStandardReading)
    .values(
      STABLE.map((value, index) => ({
        organizationId: org.orgId,
        standardId,
        parameter: "100 g",
        value,
        measuredAt: new Date(Date.UTC(2026, 0, 1 + index)),
        createdBy: org.userId,
      })),
    )
    .returning({ id: checkStandardReading.id });
  return {
    org,
    standardId,
    chartId: chart.id,
    readingIds: readings.map((r) => r.id),
  };
}

describe("spc router: chart update/delete and readings (P2-18d)", () => {
  beforeEach(async () => {
    await truncateAll();
    logout();
  });

  it("REQ-18D-SPC-A: PUT /charts/:id switches the chart type, re-evaluates and audits", async () => {
    const a = await seedLab("a");
    loginAs({ userId: a.org.userId, organizationId: a.org.orgId });

    const res = await spcRouter.request(`/charts/${a.chartId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ chartType: "ewma" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chartType).toBe("ewma");
    expect(body.lastEvaluation?.sampleSize).toBe(STABLE.length);
    expect(body.lastEvaluatedAt).not.toBeNull();

    const audit = await db
      .select({ action: controlChartAuditLog.action })
      .from(controlChartAuditLog)
      .where(eq(controlChartAuditLog.controlChartId, a.chartId));
    expect(audit.map((row) => row.action)).toContain("update");
  });

  it("REQ-18D-SPC-B: DELETE /charts/:id removes the chart and keeps the audit row", async () => {
    const a = await seedLab("a");
    loginAs({ userId: a.org.userId, organizationId: a.org.orgId });

    const res = await spcRouter.request(`/charts/${a.chartId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const left = await db
      .select({ id: controlChart.id })
      .from(controlChart)
      .where(eq(controlChart.id, a.chartId));
    expect(left).toEqual([]);
    const audit = await db
      .select({ action: controlChartAuditLog.action })
      .from(controlChartAuditLog)
      .where(eq(controlChartAuditLog.controlChartId, a.chartId));
    expect(audit.map((row) => row.action)).toEqual(["delete"]);
  });

  it("REQ-18D-SPC-C: GET /readings lists the standard's readings in order; lab B's standard lists nothing", async () => {
    const a = await seedLab("a");
    const b = await seedLab("b");
    loginAs({ userId: a.org.userId, organizationId: a.org.orgId });

    const own = await spcRouter.request(
      `/readings?standardId=${a.standardId}&parameter=${encodeURIComponent("100 g")}`,
    );
    expect(own.status).toBe(200);
    const ownBody = await own.json();
    expect(ownBody.data.map((r: { value: number }) => r.value)).toEqual(STABLE);
    expect(ownBody.data[0].createdByName).toBe(`User ${a.org.userId}`);

    const foreign = await spcRouter.request(
      `/readings?standardId=${b.standardId}`,
    );
    expect(foreign.status).toBe(200);
    expect((await foreign.json()).data).toEqual([]);
  });

  it("REQ-18D-SPC-D: DELETE /readings/:id removes the reading and re-evaluates the chart", async () => {
    const a = await seedLab("a");
    loginAs({ userId: a.org.userId, organizationId: a.org.orgId });
    const [first] = a.readingIds;
    if (first === undefined) throw new Error("no reading seeded");

    const res = await spcRouter.request(`/readings/${first}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const left = await db
      .select({ id: checkStandardReading.id })
      .from(checkStandardReading)
      .where(eq(checkStandardReading.standardId, a.standardId));
    expect(left).toHaveLength(STABLE.length - 1);
    const [chart] = await db
      .select()
      .from(controlChart)
      .where(eq(controlChart.id, a.chartId));
    expect(chart?.lastEvaluation?.sampleSize).toBe(STABLE.length - 1);
  });

  it("REQ-18D-SPC-E: lab B's chart and reading ids are a 404 in lab A's session; lab B's rows stay", async () => {
    const a = await seedLab("a");
    const b = await seedLab("b");
    loginAs({ userId: a.org.userId, organizationId: a.org.orgId });
    const [foreignReading] = b.readingIds;
    if (foreignReading === undefined) throw new Error("no reading seeded");

    const put = await spcRouter.request(`/charts/${b.chartId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ chartType: "ewma" }),
    });
    expect(put.status).toBe(404);
    const del = await spcRouter.request(`/charts/${b.chartId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(404);
    const delReading = await spcRouter.request(`/readings/${foreignReading}`, {
      method: "DELETE",
    });
    expect(delReading.status).toBe(404);

    const [chart] = await db
      .select({ chartType: controlChart.chartType })
      .from(controlChart)
      .where(eq(controlChart.id, b.chartId));
    expect(chart?.chartType).toBe("i_mr");
    const readings = await db
      .select({ id: checkStandardReading.id })
      .from(checkStandardReading)
      .where(eq(checkStandardReading.standardId, b.standardId));
    expect(readings).toHaveLength(STABLE.length);
  });
});
