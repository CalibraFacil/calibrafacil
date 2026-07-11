import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Analytics01Icon,
  ChartHistogramIcon,
  File01Icon,
  HelpCircleIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from "@/components/instrument-panel";
import { usePortalUnits } from "@/features/fleet/queries";
import { useFleetAnalytics } from "./queries";
import type {
  FleetAnalytics,
  FleetAnalyticsBucket,
  FleetTrendBucket,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Formatting + tone helpers                                                  */
/* -------------------------------------------------------------------------- */

/** "22,2%", or "—" when the rate has no KNOWN cycles behind it. */
function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function ootRateTone(rate: number | null): SignalTone {
  if (rate === null) return "neutral";
  if (rate >= 20) return "critical";
  if (rate > 0) return "warning";
  return "ok";
}

function coverageTone(pct: number | null): SignalTone {
  if (pct === null) return "neutral";
  return pct < 70 ? "warning" : "ok";
}

const PERIOD_OPTIONS = [
  { value: "12", label: "Últimos 12 meses" },
  { value: "24", label: "Últimos 24 meses" },
  { value: "36", label: "Últimos 36 meses" },
  { value: "60", label: "Últimos 60 meses" },
];

const BUCKET_OPTIONS: Array<{ value: FleetAnalyticsBucket; label: string }> = [
  { value: "quarter", label: "Por trimestre" },
  { value: "year", label: "Por ano" },
];

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function ReliabilityPage() {
  const [periodMonths, setPeriodMonths] = useState("24");
  const [bucket, setBucket] = useState<FleetAnalyticsBucket>("quarter");
  const [unitId, setUnitId] = useState("all");

  const unitsQuery = usePortalUnits();
  const units = unitsQuery.data?.units ?? [];
  const isGroup = units.length > 1;

  const analytics = useFleetAnalytics({
    periodMonths: Number(periodMonths),
    bucket,
    unitId: unitId === "all" ? undefined : Number(unitId),
  });
  const data = analytics.data;

  const periodLabel =
    PERIOD_OPTIONS.find((option) => option.value === periodMonths)?.label ??
    "Período";
  const bucketLabel =
    BUCKET_OPTIONS.find((option) => option.value === bucket)?.label ??
    "Agrupamento";
  const unitLabel =
    unitId === "all"
      ? "Todas as unidades"
      : (units.find((unit) => String(unit.id) === unitId)?.name ?? "Unidade");

  return (
    <div className="portal-shell space-y-5">
      {/* Hero */}
      <Panel className="relative overflow-hidden p-5 sm:p-6">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <HugeiconsIcon
                icon={Analytics01Icon}
                strokeWidth={2}
                className="text-muted-foreground size-4"
              />
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Qualidade · confiabilidade observada (EOPR)
              </p>
            </div>
            <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              Confiabilidade da frota
            </h1>
            <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">
              Desempenho dos instrumentos na condição &ldquo;como
              recebido&rdquo; (as-found): taxa fora de tolerância, cobertura do
              sinal e reincidência por equipamento.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Período</Label>
              <Select
                value={periodMonths}
                onValueChange={(value) => setPeriodMonths(String(value))}
              >
                <SelectTrigger className="w-44">
                  <span>{periodLabel}</span>
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">
                Agrupamento
              </Label>
              <Select
                value={bucket}
                onValueChange={(value) =>
                  setBucket(value === "year" ? "year" : "quarter")
                }
              >
                <SelectTrigger className="w-36">
                  <span>{bucketLabel}</span>
                </SelectTrigger>
                <SelectContent>
                  {BUCKET_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isGroup ? (
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Unidade</Label>
                <Select
                  value={unitId}
                  onValueChange={(value) => setUnitId(String(value))}
                >
                  <SelectTrigger className="w-44">
                    <span className="truncate">{unitLabel}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as unidades</SelectItem>
                    {units.map((unit) => (
                      <SelectItem key={unit.id} value={String(unit.id)}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        </div>
      </Panel>

      {analytics.isLoading ? (
        <ReliabilitySkeleton />
      ) : analytics.isError || !data ? (
        <Panel className="p-5">
          <div className="flex flex-col items-start gap-3">
            <p className="font-medium">
              Não foi possível carregar os indicadores
            </p>
            <p className="text-pretty text-sm text-muted-foreground">
              Tente novamente em instantes. Se o problema continuar, fale com o
              laboratório.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => analytics.refetch()}
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className="size-4"
              />
              Tentar novamente
            </Button>
          </div>
        </Panel>
      ) : (
        <ReliabilityContent data={data} />
      )}
    </div>
  );
}

function ReliabilityContent({ data }: { data: FleetAnalytics }) {
  const { totals } = data;

  return (
    <>
      {/* Vitals */}
      <StaggerGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem>
          <SignalTile
            icon={Analytics01Icon}
            label="Taxa fora de tolerância"
            value={formatPct(totals.ootRatePct)}
            hint="como recebido (as-found)"
            tone={ootRateTone(totals.ootRatePct)}
          />
        </StaggerItem>
        <StaggerItem>
          <SignalTile
            icon={File01Icon}
            label="Calibrações no período"
            value={totals.jobs}
            hint="aprovadas"
            tone={totals.jobs > 0 ? "info" : "neutral"}
          />
        </StaggerItem>
        <StaggerItem>
          <SignalTile
            icon={ChartHistogramIcon}
            label="Cobertura do sinal as-found"
            value={formatPct(totals.coveragePct)}
            hint="ciclos com parecer"
            tone={coverageTone(totals.coveragePct)}
          />
        </StaggerItem>
        <StaggerItem>
          <SignalTile
            icon={HelpCircleIcon}
            label="Sem sinal as-found"
            value={totals.unknown}
            hint="ciclos sem parecer"
            tone={totals.unknown > 0 ? "info" : "neutral"}
          />
        </StaggerItem>
      </StaggerGroup>

      {/* Coverage honesty line — always visible so nothing is overstated */}
      <Panel className="p-4">
        <p className="text-pretty text-sm text-muted-foreground">
          {totals.unknown} de {totals.jobs} calibrações sem sinal as-found no
          período.
          {data.legalExcluded > 0
            ? ` ${data.legalExcluded} calibrações de instrumentos em regime legal (Inmetro) não entram nos indicadores.`
            : ""}
        </p>
      </Panel>

      {/* Trend */}
      <Panel className="p-5">
        <PanelHeader
          eyebrow="Tendência"
          title="Taxa fora de tolerância por período"
          description="Percentual de calibrações reprovadas na condição 'como recebido', sobre os ciclos com parecer conhecido."
        />
        <div className="mt-4">
          <TrendBarChart trend={data.trend} />
        </div>
      </Panel>

      {/* By asset type */}
      <Panel className="p-5">
        <PanelHeader
          eyebrow="Distribuição"
          title="Por tipo de instrumento"
          description="Reprovações as-found por família de equipamento no período."
        />
        <div className="mt-4 overflow-x-auto">
          {data.byAssetType.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Calibrações</TableHead>
                  <TableHead className="text-right">Reprovações</TableHead>
                  <TableHead className="text-right">Taxa (%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byAssetType.map((row) => (
                  <TableRow key={row.assetTypeId ?? row.assetTypeName}>
                    <TableCell className="font-medium">
                      {row.assetTypeName}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.jobs}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.nonConforming}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono tabular-nums",
                        row.ootRatePct !== null &&
                          row.ootRatePct > 0 &&
                          "text-destructive",
                      )}
                    >
                      {formatPct(row.ootRatePct)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm">
              Nenhuma calibração no período.
            </p>
          )}
        </div>
      </Panel>

      {/* Worst offenders */}
      <Panel className="p-5">
        <PanelHeader
          eyebrow="Reincidência"
          title="Equipamentos com maior reincidência de reprovação as-found"
          description="Priorize a investigação destes instrumentos — encurtar a periodicidade ou substituir pode ser necessário."
        />
        <div className="mt-4 overflow-x-auto">
          {data.worstOffenders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">
                    Reprovações/Conhecidas
                  </TableHead>
                  <TableHead className="text-right">Taxa</TableHead>
                  <TableHead className="text-right">
                    Última reprovação
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.worstOffenders.map((offender) => (
                  <TableRow key={offender.assetId}>
                    <TableCell>
                      <Link
                        to="/assets/$id"
                        params={{ id: String(offender.assetId) }}
                        className="font-mono tabular-nums hover:underline"
                      >
                        {offender.tag}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-56 truncate font-medium">
                      {offender.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {offender.assetTypeName}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {offender.nonConforming}/{offender.known}
                    </TableCell>
                    <TableCell className="text-destructive text-right font-mono tabular-nums">
                      {formatPct(offender.failureRatePct)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatDate(offender.lastNonConformingAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm">
              Nenhuma reprovação as-found no período.
            </p>
          )}
        </div>
      </Panel>

      {/* Verdict attribution (ISO/IEC 17025 §7.8.6 / ILAC-G8) */}
      <p className="text-muted-foreground px-1 text-pretty text-xs">
        {data.attribution}
      </p>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend bar chart — recharts via the shared shadcn ChartContainer             */
/* -------------------------------------------------------------------------- */

const trendChartConfig = {
  ootRate: {
    label: "Taxa fora de tolerância",
    color: "var(--critical)",
  },
} satisfies ChartConfig;

function TrendBarChart({ trend }: { trend: Array<FleetTrendBucket> }) {
  const hasKnown = trend.some((entry) => entry.known > 0);
  if (trend.length === 0 || !hasKnown) {
    return (
      <div className="bg-muted/30 flex min-h-32 items-center justify-center rounded-xl p-6 text-center">
        <p className="text-muted-foreground max-w-sm text-pretty text-sm">
          Nenhuma calibração com sinal as-found no período — sem dados para a
          tendência.
        </p>
      </div>
    );
  }

  const chartData = trend.map((entry) => ({
    bucket: entry.bucket,
    ootRate: entry.ootRatePct ?? 0,
    hasSignal: entry.ootRatePct !== null,
    known: entry.known,
    jobs: entry.jobs,
    topLabel:
      entry.ootRatePct === null
        ? "—"
        : `${entry.ootRatePct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
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
                    ? `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% de ${known} com parecer`
                    : "sem sinal as-found";
                }}
              />
            }
          />
          <Bar dataKey="ootRate" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {chartData.map((entry) => (
              <Cell
                key={entry.bucket}
                fill={
                  !entry.hasSignal
                    ? "transparent"
                    : entry.ootRate > 0
                      ? "var(--critical)"
                      : "var(--ok)"
                }
                fillOpacity={0.8}
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
        período sem sinal as-found.
      </p>
    </div>
  );
}

function ReliabilitySkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {["oot", "jobs", "coverage", "unknown"].map((tile) => (
          <Skeleton key={tile} className="h-[5.5rem] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-14 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
      <Skeleton className="h-56 w-full rounded-2xl" />
      <Skeleton className="h-56 w-full rounded-2xl" />
    </div>
  );
}
