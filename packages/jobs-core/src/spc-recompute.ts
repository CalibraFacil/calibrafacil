/**
 * SPC nightly recompute (issue #60, ISO/IEC 17025 §7.7.1).
 *
 * Re-evaluates every control chart against its stored check-standard readings
 * so trending / out-of-control statuses stay current even when no new reading
 * was recorded that day. The evaluation itself is the pure, engine-versioned
 * `evaluateChart` from @calibra-facil/interval-analysis — the same code path
 * the API uses on reading ingestion and manual recalculation, so the nightly
 * sweep can never disagree with the interactive one.
 */

import { db, systemDb } from "@calibra-facil/db";
import { forOrg, type OrgExecutor } from "@calibra-facil/db/for-org";
import {
  checkStandardReading,
  controlChart,
  type SpcEvaluation,
} from "@calibra-facil/db/schema";
import {
  evaluateChart,
  type SpcChartParams,
  type SpcChartType,
} from "@calibra-facil/interval-analysis";
import { and, asc, eq, sql } from "drizzle-orm";

type ChartRow = Pick<
  typeof controlChart.$inferSelect,
  "id" | "standardId" | "parameter" | "chartType" | "params"
>;

const CHART_TYPES: readonly SpcChartType[] = [
  "i_mr",
  "xbar_r",
  "cusum",
  "ewma",
];

function toChartType(value: string): SpcChartType {
  const match = CHART_TYPES.find((t) => t === value);
  return match ?? "i_mr";
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Narrow the raw jsonb params column to the engine's SpcChartParams shape. */
function toChartParams(value: unknown): SpcChartParams {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = Object.fromEntries(Object.entries(value));
  const enabledRules = Array.isArray(record.enabledRules)
    ? record.enabledRules.filter(
        (rule): rule is string => typeof rule === "string",
      )
    : undefined;
  return {
    baselineWindow: numberOrUndefined(record.baselineWindow) ?? null,
    centerline: numberOrUndefined(record.centerline) ?? null,
    sigma: numberOrUndefined(record.sigma) ?? null,
    subgroupSize: numberOrUndefined(record.subgroupSize) ?? null,
    cusumK: numberOrUndefined(record.cusumK) ?? null,
    cusumH: numberOrUndefined(record.cusumH) ?? null,
    ewmaLambda: numberOrUndefined(record.ewmaLambda) ?? null,
    ewmaK: numberOrUndefined(record.ewmaK) ?? null,
    enabledRules: enabledRules ?? null,
  };
}

const BATCH_SIZE = 100;

/**
 * The two connections the sweep uses. The defaults are the real ones; a test
 * passes a `calibra_app` session as `application` to prove the sweep names the
 * laboratory on every statement it runs there.
 */
export type SpcRecomputeConnections = {
  /** Per-laboratory work: runs under `calibra.organization_id` (row-level security). */
  application: OrgExecutor;
  /** Only the lookup of which laboratories own a chart (cross-laboratory by design). */
  system: Pick<OrgExecutor, "selectDistinct">;
};

export async function processSpcRecompute(
  connections: SpcRecomputeConnections = { application: db, system: systemDb },
): Promise<{
  chartsEvaluated: number;
  outOfControl: number;
  trending: number;
}> {
  let chartsEvaluated = 0;
  let outOfControl = 0;
  let trending = 0;

  // The sweep is a cron job: no request names a laboratory. The laboratories
  // that own a control chart are learnt here, on the system path (the owner
  // connection), because row-level security names one laboratory per
  // transaction and this is the one statement that has to look across all of
  // them. Everything after it runs per laboratory in `forOrg(db, lab)`
  // transactions, so each statement carries `calibra.organization_id`.
  const labs = await connections.system
    .selectDistinct({ organizationId: controlChart.organizationId })
    .from(controlChart)
    .orderBy(controlChart.organizationId);

  for (const { organizationId } of labs) {
    // One laboratory failing (its chart list cannot be read) must not stop the
    // sweep of the laboratories after it.
    try {
      const lab = forOrg(connections.application, organizationId);
      let offset = 0;
      let batch: ChartRow[];
      do {
        batch = await lab.transaction((tx) =>
          tx
            .select({
              id: controlChart.id,
              standardId: controlChart.standardId,
              parameter: controlChart.parameter,
              chartType: controlChart.chartType,
              params: controlChart.params,
            })
            .from(controlChart)
            .orderBy(asc(controlChart.id))
            .limit(BATCH_SIZE)
            .offset(offset),
        );

        for (const chart of batch) {
          try {
            const evaluation = await lab.transaction(async (tx) => {
              const readings = await tx
                .select({ value: checkStandardReading.value })
                .from(checkStandardReading)
                .where(
                  and(
                    eq(checkStandardReading.standardId, chart.standardId),
                    eq(checkStandardReading.parameter, chart.parameter),
                  ),
                )
                .orderBy(
                  asc(checkStandardReading.measuredAt),
                  asc(checkStandardReading.id),
                );

              const evaluated: SpcEvaluation = {
                ...evaluateChart(
                  readings.map((r) => r.value),
                  toChartType(chart.chartType),
                  toChartParams(chart.params),
                ),
                evaluatedAt: new Date().toISOString(),
              };

              await tx
                .update(controlChart)
                .set({
                  status: evaluated.status,
                  lastEvaluation: evaluated,
                  lastEvaluatedAt: new Date(),
                  // The sweep is not an edit of the chart: keep the list order
                  // the users see (it sorts by the last real change). Keeping the
                  // column itself (not the value read with the batch) cannot undo
                  // an edit made since.
                  updatedAt: sql`${controlChart.updatedAt}`,
                })
                .where(eq(controlChart.id, chart.id));
              return evaluated;
            });

            chartsEvaluated += 1;
            if (evaluation.status === "out_of_control") outOfControl += 1;
            if (evaluation.status === "trending") trending += 1;
          } catch (error) {
            console.error(`[SPC] Error recomputing chart ${chart.id}:`, error);
          }
        }

        offset += batch.length;
      } while (batch.length === BATCH_SIZE);
    } catch (error) {
      console.error(
        `[SPC] Error sweeping laboratory ${organizationId}:`,
        error,
      );
    }
  }

  console.log(
    `[SPC] Recompute complete: ${chartsEvaluated} charts (${outOfControl} out-of-control, ${trending} trending)`,
  );

  return { chartsEvaluated, outOfControl, trending };
}
