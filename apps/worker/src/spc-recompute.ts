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

import { Client } from "pg";
import {
  evaluateChart,
  type SpcChartParams,
  type SpcChartType,
} from "@calibra-facil/interval-analysis";

interface SpcRecomputeEnv {
  DATABASE_URL: string;
}

interface ControlChartRow {
  id: number;
  organization_id: string;
  standard_id: number;
  parameter: string;
  chart_type: string;
  params: unknown;
}

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

export async function processSpcRecompute(env: SpcRecomputeEnv): Promise<{
  chartsEvaluated: number;
  outOfControl: number;
  trending: number;
}> {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  let chartsEvaluated = 0;
  let outOfControl = 0;
  let trending = 0;

  try {
    let offset = 0;
    let batch: ControlChartRow[];
    do {
      const result = await client.query<ControlChartRow>(
        `
        SELECT id, organization_id, standard_id, parameter, chart_type, params
        FROM control_chart
        ORDER BY id ASC
        LIMIT $1 OFFSET $2
        `,
        [BATCH_SIZE, offset],
      );
      batch = result.rows;

      for (const chart of batch) {
        try {
          const readings = await client.query<{ value: number }>(
            `
            SELECT value
            FROM check_standard_reading
            WHERE organization_id = $1
              AND standard_id = $2
              AND parameter = $3
            ORDER BY measured_at ASC, id ASC
            `,
            [chart.organization_id, chart.standard_id, chart.parameter],
          );

          const evaluation = {
            ...evaluateChart(
              readings.rows.map((r) => r.value),
              toChartType(chart.chart_type),
              toChartParams(chart.params),
            ),
            evaluatedAt: new Date().toISOString(),
          };

          await client.query(
            `
            UPDATE control_chart
            SET status = $2, last_evaluation = $3, last_evaluated_at = NOW()
            WHERE id = $1
            `,
            [chart.id, evaluation.status, JSON.stringify(evaluation)],
          );

          chartsEvaluated += 1;
          if (evaluation.status === "out_of_control") outOfControl += 1;
          if (evaluation.status === "trending") trending += 1;
        } catch (error) {
          console.error(`[SPC] Error recomputing chart ${chart.id}:`, error);
        }
      }

      offset += batch.length;
    } while (batch.length === BATCH_SIZE);
  } finally {
    await client.end();
  }

  console.log(
    `[SPC] Recompute complete: ${chartsEvaluated} charts (${outOfControl} out-of-control, ${trending} trending)`,
  );

  return { chartsEvaluated, outOfControl, trending };
}
