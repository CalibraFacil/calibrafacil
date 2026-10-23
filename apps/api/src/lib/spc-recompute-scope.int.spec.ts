/**
 * spc-recompute-scope.int.spec.ts - P2-18d [HIGH RISK].
 *
 * The SPC nightly sweep (ISO/IEC 17025 §7.7.1, jobs-core `processSpcRecompute`)
 * runs outside a request: nobody names a laboratory. Proves, against the real
 * database and with the sweep's application connection as `calibra_app` (bound by
 * the `tenant_isolation` policies):
 *
 *   REQ-18D-SPC-1  Every laboratory's charts are re-evaluated from THAT laboratory's
 *                  readings, each in its own organization-naming transaction (the
 *                  sweep still reaches both laboratories without a request).
 *   REQ-18D-SPC-2  A laboratory's reading never feeds another laboratory's chart: an
 *                  out-of-control series in lab B leaves lab A's stable chart in
 *                  control (and the other way round).
 *   REQ-18D-SPC-3  The sweep is not an edit of the chart: `updated_at` (the order of
 *                  the chart list) is untouched, the evaluation is stamped.
 *   REQ-18D-SPC-4  Sanity (negative): the same session, with no organization named,
 *                  sees no chart at all, so the passes above are not an artefact of a
 *                  bypassing connection.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { checkStandardReading, controlChart } from "@calibra-facil/db/schema";
import { processSpcRecompute } from "@calibra-facil/jobs-core/spc-recompute";
import { truncateAll } from "../../test/integration/db";
import { openAppRoleDb } from "../../test/integration/rls";
import { seedOrg, seedStandard } from "../../test/integration/seed";

/** Stable in-control series (same fixture as the SPC engine spec). */
const STABLE = [
  10.01, 9.99, 10.02, 9.98, 10.0, 10.01, 9.99, 10.02, 9.98, 10.0, 10.01, 9.99,
];

const STALE_UPDATED_AT = new Date("2026-01-15T12:00:00.000Z");

async function seedLabWithChart(tag: "a" | "b", values: number[]) {
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
      updatedAt: STALE_UPDATED_AT,
    })
    .returning({ id: controlChart.id });
  if (!chart) throw new Error("control chart not seeded");
  await db.insert(checkStandardReading).values(
    values.map((value, index) => ({
      organizationId: org.orgId,
      standardId,
      parameter: "100 g",
      value,
      measuredAt: new Date(Date.UTC(2026, 0, 1 + index)),
      createdBy: org.userId,
    })),
  );
  return { org, standardId, chartId: chart.id };
}

async function chartRow(chartId: number) {
  const [row] = await db
    .select()
    .from(controlChart)
    .where(eq(controlChart.id, chartId));
  if (!row) throw new Error(`chart ${chartId} vanished`);
  return row;
}

describe("processSpcRecompute: per-laboratory sweep as calibra_app (P2-18d)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-18D-SPC-1/2/3: each lab's chart is evaluated from its own readings, untouched updated_at", async () => {
    const labA = await seedLabWithChart("a", STABLE);
    // Lab B breaches 3 sigma on the last reading.
    const labB = await seedLabWithChart("b", [...STABLE, 14.5]);

    const app = openAppRoleDb();
    const result = await processSpcRecompute({
      application: app.db,
      system: db,
    });

    expect(result.chartsEvaluated).toBe(2);
    expect(result.outOfControl).toBe(1);

    const a = await chartRow(labA.chartId);
    const b = await chartRow(labB.chartId);
    expect(a.status).toBe("in_control");
    expect(a.lastEvaluation?.sampleSize).toBe(STABLE.length);
    expect(a.lastEvaluatedAt).not.toBeNull();
    expect(b.status).toBe("out_of_control");
    expect(b.lastEvaluation?.sampleSize).toBe(STABLE.length + 1);

    // The sweep is not an edit: the list order (updated_at) is untouched.
    expect(a.updatedAt.toISOString()).toBe(STALE_UPDATED_AT.toISOString());
    expect(b.updatedAt.toISOString()).toBe(STALE_UPDATED_AT.toISOString());
  });

  it("REQ-18D-SPC-4: the application session with no organization named sees no chart", async () => {
    await seedLabWithChart("a", STABLE);
    const app = openAppRoleDb();

    const unscoped = await app.db
      .select({ id: controlChart.id })
      .from(controlChart);
    expect(unscoped).toEqual([]);
  });

  it("REQ-18D-SPC-5: a laboratory whose sweep fails does not stop the laboratories after it", async () => {
    const labA = await seedLabWithChart("a", STABLE);
    const labB = await seedLabWithChart("b", [...STABLE, 14.5]);
    const app = openAppRoleDb();

    // The first transaction the sweep opens (lab A's chart list) fails.
    let armed = true;
    const flaky = new Proxy(app.db, {
      get(target, property, receiver) {
        if (property === "transaction" && armed) {
          return () => {
            armed = false;
            return Promise.reject(new Error("lab A is unreachable"));
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const result = await processSpcRecompute({
      application: flaky,
      system: db,
    });

    expect(result.chartsEvaluated).toBe(1);
    expect((await chartRow(labA.chartId)).lastEvaluatedAt).toBeNull();
    expect((await chartRow(labB.chartId)).status).toBe("out_of_control");
  });

  it("REQ-18D-SPC-6: the sweep keeps updated_at as the row is now, not as the batch read it", async () => {
    const labA = await seedLabWithChart("a", STABLE);
    const later = new Date("2026-03-03T09:00:00.000Z");
    const app = openAppRoleDb();

    // A user edit lands after the batch read and before the sweep's write: the
    // chart-list read is the first transaction, the chart's own is the second.
    let opened = 0;
    const racing = new Proxy(app.db, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async (...args: unknown[]) => {
            opened += 1;
            if (opened === 2) {
              await db
                .update(controlChart)
                .set({ updatedAt: later })
                .where(eq(controlChart.id, labA.chartId));
            }
            return Reflect.apply(
              Reflect.get(target, "transaction", receiver),
              target,
              args,
            );
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    await processSpcRecompute({ application: racing, system: db });

    expect((await chartRow(labA.chartId)).updatedAt.toISOString()).toBe(
      later.toISOString(),
    );
  });
});
