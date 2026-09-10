import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  Delete02Icon,
  PlusSignIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  ACTION_BUTTON_CLASS,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import {
  useCreateSpcReading,
  useEscalateSpcChart,
  useRecalculateSpcChart,
  useRemoveSpcReading,
  useSpcChartDetailData,
  useUpdateSpcChart,
} from '@/features/spc/queries'
import {
  parseChartConfigForm,
  parseReadingForm,
  type ChartConfigFormData,
  type SpcReadingFormData,
} from '@/features/spc/forms'
import {
  SPC_CHART_TYPE_LABELS,
  SPC_STATUS_LABELS,
  type SpcChartDetail,
  type SpcChartType,
  type SpcRuleSeverity,
} from '@/features/spc/types'
import {
  SPC_STATUS_TONES,
  SpcStatusBadge,
} from '@/features/spc/components/spc-status-badge'
import { StandardRecallCallout } from '@/features/spc/components/standard-recall-callout'

const chartConfig: ChartConfig = {
  value: {
    label: 'Leitura',
    color: 'hsl(217.2 91.2% 59.8%)',
  },
  signalValue: {
    label: 'Sinal',
    color: 'hsl(0 84.2% 60.2%)',
  },
}

const RULE_SEVERITY_LABELS: Record<SpcRuleSeverity, string> = {
  trending: 'Tendência',
  out_of_control: 'Fora de controle',
}

const RULE_SEVERITY_BADGE_CLASSES: Record<SpcRuleSeverity, string> = {
  trending:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  out_of_control: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

function parseSpcChartType(value: string | null): SpcChartType | null {
  switch (value) {
    case 'i_mr':
    case 'xbar_r':
    case 'cusum':
    case 'ewma':
      return value
    default:
      return null
  }
}

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('pt-BR')
}

function localDatetimeInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function SpcChartPage({ id }: { id: string }) {
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()

  const { data: chart, isLoading } = useSpcChartDetailData({
    id,
    enabled: !cloudOnlyUnavailable,
  })

  const recalculateMutation = useRecalculateSpcChart(id)
  const escalateMutation = useEscalateSpcChart(id)

  if (cloudOnlyUnavailable) {
    return (
      <CloudOnlyOfflineState title="Carta de controle indisponível offline" />
    )
  }

  if (isLoading) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        Carregando...
      </div>
    )
  }

  if (!chart) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        Carta de controle não encontrada
      </div>
    )
  }

  const evaluation = chart.lastEvaluation
  const canEscalate =
    (chart.status === 'trending' || chart.status === 'out_of_control') &&
    !chart.capaId

  const handleRecalculate = () => {
    recalculateMutation.mutate(undefined, {
      onSuccess: (updated) => {
        toast.success(
          `Carta recalculada — status: ${SPC_STATUS_LABELS[updated.status]}`,
        )
      },
      onError: (error) => {
        toast.error(error.message)
      },
    })
  }

  const handleEscalate = () => {
    escalateMutation.mutate(
      {},
      {
        onSuccess: (result) => {
          toast.success(
            `${result.data.capa.capaNumber} aberta para tratar o sinal`,
          )
        },
        onError: (error) => {
          toast.error(error.message)
        },
      },
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <Panel className="relative overflow-hidden p-6">
        <BlueprintOverlay />
        <div className="relative space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Carta de controle
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-3">
                <h1 className="text-balance text-2xl font-semibold tracking-tight">
                  {chart.parameter}
                </h1>
                <SpcStatusBadge status={chart.status} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {SPC_CHART_TYPE_LABELS[chart.chartType]} ·{' '}
                <Link
                  to="/dashboard/standards/$id"
                  params={{ id: String(chart.standardId) }}
                  className="text-primary hover:underline"
                >
                  {chart.standardName ?? `Padrão #${chart.standardId}`}
                </Link>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleRecalculate}
                disabled={recalculateMutation.isPending}
                className={ACTION_BUTTON_CLASS}
              >
                <HugeiconsIcon icon={RefreshIcon} className="mr-2 size-4" />
                {recalculateMutation.isPending
                  ? 'Recalculando...'
                  : 'Recalcular'}
              </Button>
              {chart.capaId ? (
                <Button
                  variant="outline"
                  render={
                    <Link
                      to="/dashboard/capa/$id"
                      params={{ id: String(chart.capaId) }}
                    />
                  }
                  className={ACTION_BUTTON_CLASS}
                >
                  CAPA #{chart.capaId}
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  onClick={handleEscalate}
                  disabled={!canEscalate || escalateMutation.isPending}
                  className={ACTION_BUTTON_CLASS}
                >
                  <HugeiconsIcon icon={Alert02Icon} className="mr-2 size-4" />
                  {escalateMutation.isPending
                    ? 'Escalando...'
                    : 'Escalar para CAPA'}
                </Button>
              )}
            </div>
          </div>

          <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
            <StaggerItem>
              <SignalTile
                label="Status"
                value={SPC_STATUS_LABELS[chart.status]}
                tone={SPC_STATUS_TONES[chart.status]}
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                label="Leituras avaliadas"
                value={evaluation?.sampleSize ?? 0}
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                label="Sinais ativos"
                value={evaluation?.ruleHits.length ?? 0}
                tone={(evaluation?.ruleHits.length ?? 0) > 0 ? 'warning' : 'ok'}
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                label="Última avaliação"
                value={
                  chart.lastEvaluatedAt
                    ? new Date(chart.lastEvaluatedAt).toLocaleDateString(
                        'pt-BR',
                      )
                    : '—'
                }
                tone="neutral"
              />
            </StaggerItem>
          </StaggerGroup>
        </div>
      </Panel>

      {/* §7.10 tie-in: OOC chart may mean out-of-tolerance issued results */}
      {chart.status === 'out_of_control' && (
        <StandardRecallCallout
          standardId={chart.standardId}
          standardName={chart.standardName}
          message="Carta fora de controle — considere revisar os certificados emitidos com este padrão (recall de padrão)."
        />
      )}

      {/* Control chart */}
      <ControlChartPanel chart={chart} />

      {/* Rule hits + provenance */}
      {evaluation && (
        <Panel className="p-4 sm:p-5">
          <PanelHeader
            title="Regras de controle"
            description="Sinais detectados pelo motor de avaliação sobre a série de leituras."
          />
          <div className="mt-4 space-y-3">
            {evaluation.ruleHits.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
                Nenhuma regra violada na última avaliação.
              </div>
            ) : (
              evaluation.ruleHits.map((hit, index) => (
                <div
                  key={`${hit.rule}-${index}`}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{hit.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Regra {hit.rule} · pontos{' '}
                      {hit.pointIndices.map((i) => i + 1).join(', ')}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={RULE_SEVERITY_BADGE_CLASSES[hit.severity]}
                  >
                    {RULE_SEVERITY_LABELS[hit.severity]}
                  </Badge>
                </div>
              ))
            )}
            <p className="font-mono text-xs text-muted-foreground">
              Motor {evaluation.engineVersion} · fingerprint{' '}
              {evaluation.fingerprint}
              {evaluation.evaluatedAt
                ? ` · avaliado em ${formatDateTime(evaluation.evaluatedAt)}`
                : ''}
            </p>
          </div>
        </Panel>
      )}

      {/* Readings entry + table */}
      <ReadingsPanel chart={chart} chartId={id} />

      {/* Chart configuration */}
      <ChartConfigPanel key={chart.updatedAt} chart={chart} chartId={id} />
    </div>
  )
}

/** Reversed copy without Array#reverse/#toReversed (ES2022 lib target). */
function newestFirst<T>(items: T[]): T[] {
  const result: T[] = []
  for (let i = items.length - 1; i >= 0; i -= 1) {
    result.push(items[i])
  }
  return result
}

function ControlChartPanel({ chart }: { chart: SpcChartDetail }) {
  const limits = chart.lastEvaluation?.limits ?? null
  const signalIndices = new Set(
    chart.lastEvaluation?.ruleHits.flatMap((hit) => hit.pointIndices) ?? [],
  )

  // The API returns readings chronologically (measuredAt asc, id asc) — the
  // same order the evaluation engine uses, so rule-hit indices line up.
  const readings = chart.readings

  const data = readings.map((reading, index) => ({
    index,
    date: reading.measuredAt,
    value: reading.value,
    signalValue: signalIndices.has(index) ? reading.value : null,
  }))

  const values = data.map((point) => point.value)
  const rawLo = Math.min(...values, limits ? limits.lcl : Infinity)
  const rawHi = Math.max(...values, limits ? limits.ucl : -Infinity)
  const pad = (rawHi - rawLo || Math.abs(rawHi) || 1) * 0.15
  const domain: [number, number] = [rawLo - pad, rawHi + pad]

  return (
    <Panel className="p-4 sm:p-5">
      <PanelHeader
        title="Carta de controle"
        description={
          limits
            ? `LC ${limits.centerline} · LSC ${limits.ucl} · LIC ${limits.lcl} (±3σ)`
            : 'Limites de controle serão calculados quando houver leituras suficientes.'
        }
      />
      <div className="mt-4">
        {data.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center text-muted-foreground">
            Nenhuma leitura registrada ainda
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <LineChart
              data={data}
              margin={{ left: 0, right: 16, top: 10, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                className="stroke-muted"
              />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => {
                  const date = new Date(value)
                  return date.toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: 'short',
                  })
                }}
                className="text-xs text-muted-foreground"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={64}
                domain={domain}
                tickFormatter={(value) =>
                  Number(value).toLocaleString('pt-BR', {
                    maximumFractionDigits: 4,
                  })
                }
                className="text-xs text-muted-foreground"
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      new Date(value).toLocaleString('pt-BR')
                    }
                    indicator="dot"
                  />
                }
              />
              {limits && (
                <ReferenceArea
                  y1={limits.centerline - 2 * limits.sigma}
                  y2={limits.centerline + 2 * limits.sigma}
                  fill="hsl(217.2 91.2% 59.8%)"
                  fillOpacity={0.06}
                />
              )}
              {limits && (
                <ReferenceLine
                  y={limits.centerline}
                  stroke="hsl(142.1 76.2% 36.3%)"
                  strokeWidth={1.5}
                  label={{
                    value: 'LC',
                    position: 'right',
                    fontSize: 11,
                  }}
                />
              )}
              {limits && (
                <ReferenceLine
                  y={limits.ucl}
                  stroke="hsl(0 84.2% 60.2%)"
                  strokeDasharray="6 4"
                  label={{
                    value: 'LSC',
                    position: 'right',
                    fontSize: 11,
                  }}
                />
              )}
              {limits && (
                <ReferenceLine
                  y={limits.lcl}
                  stroke="hsl(0 84.2% 60.2%)"
                  strokeDasharray="6 4"
                  label={{
                    value: 'LIC',
                    position: 'right',
                    fontSize: 11,
                  }}
                />
              )}
              <Line
                type="linear"
                dataKey="value"
                stroke="var(--color-value)"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="signalValue"
                stroke="transparent"
                strokeWidth={0}
                dot={{
                  r: 5,
                  fill: 'var(--color-signalValue)',
                  strokeWidth: 0,
                }}
                activeDot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </div>
    </Panel>
  )
}

function ReadingsPanel({
  chart,
  chartId,
}: {
  chart: SpcChartDetail
  chartId: string
}) {
  const [form, setForm] = useState<SpcReadingFormData>(() => ({
    value: '',
    uncertainty: '',
    measuredAt: localDatetimeInputValue(new Date()),
  }))

  const createMutation = useCreateSpcReading(chartId)
  const removeMutation = useRemoveSpcReading(chartId)

  // API order is chronological; the table shows the newest reading first.
  const readings = newestFirst(chart.readings)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseReadingForm(chart.standardId, chart.parameter, form)
    if (!parsed.success) {
      toast.error(parsed.message)
      return
    }

    createMutation.mutate(parsed.data, {
      onSuccess: () => {
        toast.success('Leitura registrada')
        setForm({
          value: '',
          uncertainty: '',
          measuredAt: localDatetimeInputValue(new Date()),
        })
      },
      onError: (error) => {
        toast.error(error.message)
      },
    })
  }

  const handleRemove = (readingId: number) => {
    removeMutation.mutate(readingId, {
      onSuccess: () => {
        toast.success('Leitura removida')
      },
      onError: (error) => {
        toast.error(error.message)
      },
    })
  }

  return (
    <Panel className="p-4 sm:p-5">
      <PanelHeader
        title="Leituras do padrão de verificação"
        description="Cada leitura reavalia automaticamente os limites e regras da carta."
      />

      <form
        onSubmit={handleSubmit}
        className="mt-4 grid grid-cols-1 items-end gap-3 md:grid-cols-4"
      >
        <div className="space-y-1.5">
          <Label>Valor medido</Label>
          <Input
            inputMode="decimal"
            value={form.value}
            onChange={(e) =>
              setForm((current) => ({ ...current, value: e.target.value }))
            }
            placeholder="Ex: 100.003"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Incerteza (opcional)</Label>
          <Input
            inputMode="decimal"
            value={form.uncertainty}
            onChange={(e) =>
              setForm((current) => ({
                ...current,
                uncertainty: e.target.value,
              }))
            }
            placeholder="Ex: 0.002"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Medido em</Label>
          <Input
            type="datetime-local"
            value={form.measuredAt}
            onChange={(e) =>
              setForm((current) => ({
                ...current,
                measuredAt: e.target.value,
              }))
            }
          />
        </div>
        <Button
          type="submit"
          className={ACTION_BUTTON_CLASS}
          disabled={createMutation.isPending}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
          {createMutation.isPending ? 'Registrando...' : 'Registrar leitura'}
        </Button>
      </form>

      <div className="mt-5">
        {readings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
            Nenhuma leitura registrada para este parâmetro.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40">
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    Medido em
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    Valor
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    Incerteza
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    Origem
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {readings.map((reading) => (
                  <tr
                    key={reading.id}
                    className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/35"
                  >
                    <td className="px-3 py-2.5 font-mono tabular-nums">
                      {formatDateTime(reading.measuredAt)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {reading.value}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {reading.uncertainty ?? '-'}
                    </td>
                    <td className="px-3 py-2.5">
                      {reading.sourceJobId
                        ? `Calibração #${reading.sourceJobId}`
                        : 'Manual'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(reading.id)}
                        disabled={removeMutation.isPending}
                        aria-label={`Remover leitura ${reading.id}`}
                      >
                        <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  )
}

function ChartConfigPanel({
  chart,
  chartId,
}: {
  chart: SpcChartDetail
  chartId: string
}) {
  const [form, setForm] = useState<ChartConfigFormData>(() => ({
    chartType: chart.chartType,
    baselineWindow:
      chart.params?.baselineWindow != null
        ? String(chart.params.baselineWindow)
        : '',
    subgroupSize:
      chart.params?.subgroupSize != null
        ? String(chart.params.subgroupSize)
        : '',
  }))

  const updateMutation = useUpdateSpcChart(chartId)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseChartConfigForm(form)
    if (!parsed.success) {
      toast.error(parsed.message)
      return
    }

    updateMutation.mutate(parsed.data, {
      onSuccess: () => {
        toast.success('Configuração da carta atualizada')
      },
      onError: (error) => {
        toast.error(error.message)
      },
    })
  }

  return (
    <Panel className="p-4 sm:p-5">
      <PanelHeader
        title="Configuração da carta"
        description="Alterar o tipo ou a janela base dispara um recálculo dos limites."
      />
      <form
        onSubmit={handleSubmit}
        className="mt-4 grid grid-cols-1 items-end gap-3 md:grid-cols-4"
      >
        <div className="space-y-1.5">
          <Label>Tipo de carta</Label>
          <Select
            value={form.chartType}
            onValueChange={(v) => {
              const chartType = parseSpcChartType(v)
              if (chartType) {
                setForm((current) => ({ ...current, chartType }))
              }
            }}
          >
            <SelectTrigger>
              <span
                className="flex flex-1 text-left line-clamp-1"
                data-slot="select-value"
              >
                {SPC_CHART_TYPE_LABELS[form.chartType]}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="i_mr">I-MR (individuais)</SelectItem>
              <SelectItem value="xbar_r">X̄-R (subgrupos)</SelectItem>
              <SelectItem value="cusum">CUSUM</SelectItem>
              <SelectItem value="ewma">EWMA</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Janela base</Label>
          <Input
            inputMode="numeric"
            value={form.baselineWindow}
            onChange={(e) =>
              setForm((current) => ({
                ...current,
                baselineWindow: e.target.value,
              }))
            }
            placeholder="Ex: 20"
          />
        </div>
        {form.chartType === 'xbar_r' && (
          <div className="space-y-1.5">
            <Label>Tamanho do subgrupo</Label>
            <Input
              inputMode="numeric"
              value={form.subgroupSize}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  subgroupSize: e.target.value,
                }))
              }
              placeholder="Ex: 4"
            />
          </div>
        )}
        <Button
          type="submit"
          variant="secondary"
          className={ACTION_BUTTON_CLASS}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? 'Salvando...' : 'Salvar configuração'}
        </Button>
      </form>
    </Panel>
  )
}
