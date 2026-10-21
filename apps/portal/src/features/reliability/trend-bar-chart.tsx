import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { FleetTrendBucket } from "./types";
import { formatPercentPoints } from "@calibra-facil/shared/format";

/**
 * Trend bar chart — recharts via the shared shadcn ChartContainer. Kept in its
 * own module so recharts/d3 load only when a chart is actually drawn (the page
 * lazy-imports this file).
 */

const trendChartConfig = {
  ootRate: {
    label: "Taxa fora de tolerância",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function TrendBarChartBody({
  trend,
}: {
  trend: Array<FleetTrendBucket>;
}) {
  const chartData = trend.map((entry) => ({
    bucket: entry.bucket,
    ootRate: entry.ootRatePct ?? 0,
    hasSignal: entry.ootRatePct !== null,
    known: entry.known,
    jobs: entry.jobs,
    topLabel:
      entry.ootRatePct === null
        ? "—"
        : formatPercentPoints(entry.ootRatePct, { maxDecimals: 1 }),
  }));

  return (
    <div>
      <ChartContainer config={trendChartConfig} className="h-56 w-full">
        <BarChart
          data={chartData}
          margin={{ left: 0, right: 0, top: 20, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            className="stroke-muted"
          />
          <XAxis
            dataKey="bucket"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            className="font-mono text-[10px] tabular-nums text-muted-foreground"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={40}
            tickFormatter={(value: number) => `${value}%`}
            className="text-xs text-muted-foreground"
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value, _name, item) => {
                  const payload: unknown = item?.payload;
                  const hasSignal =
                    typeof payload === "object" &&
                    payload !== null &&
                    "hasSignal" in payload &&
                    payload.hasSignal === true;
                  const known =
                    typeof payload === "object" &&
                    payload !== null &&
                    "known" in payload &&
                    typeof payload.known === "number"
                      ? payload.known
                      : 0;
                  return hasSignal
                    ? `${formatPercentPoints(Number(value), { maxDecimals: 1 })} de ${known} com parecer`
                    : "sem parecer registrado";
                }}
              />
            }
          />
          <Bar dataKey="ootRate" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {/* One measure, one hue — the height carries the value; status
                colors stay reserved for status. No-signal buckets stay empty. */}
            {chartData.map((entry) => (
              <Cell
                key={entry.bucket}
                fill={entry.hasSignal ? "var(--chart-1)" : "transparent"}
                fillOpacity={0.85}
              />
            ))}
            <LabelList
              dataKey="topLabel"
              position="top"
              className="fill-foreground font-mono text-[11px] tabular-nums"
            />
          </Bar>
        </BarChart>
      </ChartContainer>
      <p className="text-muted-foreground mt-2 text-xs">
        Barras sobre os ciclos com parecer conhecido; &ldquo;—&rdquo; indica
        período sem parecer registrado.
      </p>
    </div>
  );
}
