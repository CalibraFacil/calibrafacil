import { Suspense, lazy } from "react";

import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
} from "@/components/instrument-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDriftSeries } from "./queries";

// recharts/d3 weigh ~350 kB: only fetch them once a chart is drawn.
const DriftChart = lazy(() =>
  import("./drift-chart").then((module) => ({ default: module.DriftChart })),
);

/**
 * Per-point as-found margin over time toward the tolerance limit (margin 0),
 * with the OLS drift regression drawn when available (ILAC-G24 Method 2).
 * Degrades honestly: fewer than 3 cycles with margins → note, no chart.
 */
export function DriftChartPanel({ assetId }: { assetId: number }) {
  const query = useDriftSeries(assetId);
  const data = query.data;

  return (
    <Panel className="p-5">
      <PanelHeader
        title="Deriva do instrumento"
        description="Margem de conformidade 'como recebido' de cada ponto medido ao longo do tempo — margem 0 é o limite de tolerância."
      />
      <div className="mt-4 space-y-3">
        {query.isPending ? (
          <Skeleton className="h-56 w-full rounded-xl" />
        ) : query.isError || !data ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm text-pretty">
              Não foi possível carregar a análise de deriva.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              className={ACTION_BUTTON_CLASS}
            >
              Tentar novamente
            </Button>
          </div>
        ) : data.coverage.cyclesWithMargins < 3 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            Sem histórico “como recebido” suficiente para análise de deriva (
            {data.coverage.cyclesWithMargins} de {data.coverage.totalCycles}{" "}
            calibrações com sinal).
          </p>
        ) : (
          <Suspense fallback={<Skeleton className="h-56 w-full rounded-xl" />}>
            <DriftChart data={data} />
          </Suspense>
        )}
        {data ? (
          <p className="text-muted-foreground text-xs text-pretty">
            {data.attribution}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
