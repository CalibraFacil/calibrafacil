import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from 'nuqs'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  AlertCircleIcon,
  Analytics01Icon,
  CheckmarkCircle01Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { DataTable } from '@/components/ui/data-table'
import { cn } from '@/lib/utils'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  useCreateSpcChart,
  useSpcChartListData,
  useSpcChartStatusSummaryData,
  useSpcStandardOptionsData,
} from '@/features/spc/queries'
import {
  parseControlChartForm,
  type ControlChartFormData,
} from '@/features/spc/forms'
import {
  SPC_STATUSES,
  SPC_STATUS_LABELS,
  type SpcChartType,
  type SpcStatus,
} from '@/features/spc/types'
import { spcChartColumns } from '@/features/spc/components/spc-chart-columns'

const CHART_TYPE_OPTIONS: Array<{
  value: SpcChartType
  label: string
  hint: string
}> = [
  {
    value: 'i_mr',
    label: 'I-MR (individuais)',
    hint: 'Uma leitura por verificação. A escolha padrão para monitorar um ponto.',
  },
  {
    value: 'xbar_r',
    label: 'X̄-R (subgrupos)',
    hint: 'Médias de subgrupos de 2 a 10 leituras feitas na mesma sessão.',
  },
  {
    value: 'cusum',
    label: 'CUSUM',
    hint: 'Soma acumulada. Detecta desvios pequenos e persistentes da média.',
  },
  {
    value: 'ewma',
    label: 'EWMA',
    hint: 'Média móvel ponderada. Sensível a mudanças graduais no processo.',
  },
]

const STATUS_TILES: Array<{
  status: SpcStatus
  label: string
  icon: typeof Alert02Icon
  tone: (count: number) => SignalTone
}> = [
  {
    status: 'in_control',
    label: 'Sob controle',
    icon: CheckmarkCircle01Icon,
    tone: () => 'ok',
  },
  {
    status: 'trending',
    label: 'Tendência',
    icon: Analytics01Icon,
    tone: (count) => (count > 0 ? 'warning' : 'neutral'),
  },
  {
    status: 'out_of_control',
    label: 'Fora de controle',
    icon: Alert02Icon,
    tone: (count) => (count > 0 ? 'critical' : 'neutral'),
  },
  {
    status: 'insufficient_data',
    label: 'Dados insuficientes',
    icon: AlertCircleIcon,
    tone: () => 'neutral',
  },
]

function parseSpcStatusFilter(value: string | null): SpcStatus | '' {
  switch (value) {
    case 'insufficient_data':
    case 'in_control':
    case 'trending':
    case 'out_of_control':
      return value
    default:
      return ''
  }
}

function numericStandardId(value: string): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export function SpcOverviewPage() {
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [statusFilter, setStatusFilter] = useQueryState(
    'status',
    parseAsStringLiteral([...SPC_STATUSES, '']).withDefault(''),
  )
  const [standardIdParam, setStandardIdParam] = useQueryState(
    'standardId',
    parseAsString.withDefault(''),
  )
  const [createOpen, setCreateOpen] = useState(Boolean(standardIdParam))

  const standardId = numericStandardId(standardIdParam)

  const organizationId = activeOrganizationId ?? 'no-org'
  const canLoad =
    !cloudOnlyUnavailable &&
    Boolean(activeOrganizationId) &&
    !isContextSwitching

  const { data, isLoading, error } = useSpcChartListData({
    organizationId,
    page,
    standardId,
    statusFilter,
    enabled: canLoad,
  })

  const { data: summary } = useSpcChartStatusSummaryData({
    organizationId,
    enabled: canLoad,
  })

  const statusCount = (status: SpcStatus) =>
    summary?.data.filter((chart) => chart.status === status).length ?? 0

  const toggleStatusFilter = (status: SpcStatus) => {
    setStatusFilter(statusFilter === status ? '' : status)
    setPage(1)
  }

  const hasFilters = Boolean(statusFilter || standardId)

  if (cloudOnlyUnavailable) {
    return (
      <CloudOnlyOfflineState title="Cartas de controle indisponíveis offline" />
    )
  }

  if (isContextSwitching) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Carregando o contexto da organização ativa.
        </p>
      </Panel>
    )
  }

  if (error) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          Erro ao carregar cartas de controle: {error.message}
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Qualidade
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Cartas de controle
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Acompanhe as leituras de verificação dos padrões de referência e
            receba sinais quando algo sair do esperado.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className={ACTION_BUTTON_CLASS}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
          Nova carta
        </Button>
      </div>

      {summary && (
        <StaggerGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STATUS_TILES.map((tile) => {
            const count = statusCount(tile.status)
            const active = statusFilter === tile.status
            return (
              <StaggerItem key={tile.status}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleStatusFilter(tile.status)}
                  title={
                    active ? 'Remover filtro' : `Filtrar por "${tile.label}"`
                  }
                  className={cn(
                    'block w-full rounded-xl text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active &&
                      'ring-2 ring-primary/60 ring-offset-2 ring-offset-background',
                  )}
                >
                  <SignalTile
                    icon={tile.icon}
                    label={tile.label}
                    value={count}
                    tone={tile.tone(count)}
                  />
                </button>
              </StaggerItem>
            )
          })}
        </StaggerGroup>
      )}

      <Panel className="p-4 sm:p-5">
        <div>
          {/* Filters */}
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(parseSpcStatusFilter(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="w-52">
                <span>
                  {statusFilter
                    ? SPC_STATUS_LABELS[statusFilter]
                    : 'Todos os status'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os status</SelectItem>
                <SelectItem value="in_control">Sob controle</SelectItem>
                <SelectItem value="trending">Tendência</SelectItem>
                <SelectItem value="out_of_control">Fora de controle</SelectItem>
                <SelectItem value="insufficient_data">
                  Dados insuficientes
                </SelectItem>
              </SelectContent>
            </Select>
            {standardId !== undefined && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStandardIdParam('')
                  setPage(1)
                }}
              >
                Limpar filtro de padrão (#{standardId})
              </Button>
            )}
          </div>

          {/* Empty State */}
          {!isLoading && data?.data.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Analytics01Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhuma carta de controle</EmptyTitle>
                <EmptyDescription>
                  {hasFilters
                    ? 'Nenhuma carta encontrada para os filtros aplicados.'
                    : 'Crie a primeira carta para monitorar um padrão de referência.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {hasFilters ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setStatusFilter('')
                      setStandardIdParam('')
                      setPage(1)
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : (
                  <Button
                    onClick={() => setCreateOpen(true)}
                    className={ACTION_BUTTON_CLASS}
                  >
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Criar primeira carta
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : (
            <DataTable
              columns={spcChartColumns}
              data={data?.data ?? []}
              isLoading={isLoading}
              pagination={data?.pagination}
              onPageChange={setPage}
            />
          )}
        </div>
      </Panel>

      <NewChartDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialStandardId={standardIdParam}
        canLoad={canLoad}
      />
    </div>
  )
}

function NewChartDialog({
  open,
  onOpenChange,
  initialStandardId,
  canLoad,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialStandardId: string
  canLoad: boolean
}) {
  const navigate = useNavigate()
  const [form, setForm] = useState<ControlChartFormData>({
    standardId: initialStandardId,
    parameter: '',
    chartType: 'i_mr',
    baselineWindow: '',
    subgroupSize: '',
  })

  const { data: standardsData } = useSpcStandardOptionsData({
    enabled: canLoad && open,
  })

  const createMutation = useCreateSpcChart()

  const selectedStandard = standardsData?.data.find(
    (standard) => String(standard.id) === form.standardId,
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseControlChartForm(form)
    if (!parsed.success) {
      toast.error(parsed.message)
      return
    }

    createMutation.mutate(parsed.data, {
      onSuccess: (chart) => {
        toast.success('Carta de controle criada')
        onOpenChange(false)
        navigate({
          to: '/dashboard/spc/$id',
          params: { id: String(chart.id) },
        })
      },
      onError: (error) => {
        toast.error(error.message)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova carta de controle</DialogTitle>
          <DialogDescription>
            Escolha o padrão e o ponto monitorado. Os limites de controle são
            calculados automaticamente a partir das primeiras leituras.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>Padrão de referência *</FieldLabel>
              <Select
                value={form.standardId}
                onValueChange={(v) =>
                  setForm((current) => ({ ...current, standardId: v ?? '' }))
                }
              >
                <SelectTrigger>
                  <span
                    className="flex flex-1 text-left line-clamp-1"
                    data-slot="select-value"
                  >
                    {selectedStandard
                      ? selectedStandard.name
                      : 'Selecione o padrão'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {standardsData?.data.map((standard) => (
                    <SelectItem key={standard.id} value={String(standard.id)}>
                      {standard.name} ({standard.serialNumber})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="spc-parameter">
                Parâmetro / ponto de medição *
              </FieldLabel>
              <Input
                id="spc-parameter"
                value={form.parameter}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    parameter: e.target.value,
                  }))
                }
                placeholder="Ex: Ponto 100 g"
              />
              <FieldDescription>
                O ponto verificado. Cada ponto do padrão tem a própria carta.
              </FieldDescription>
            </Field>
          </div>

          <Field>
            <FieldLabel>Tipo de carta</FieldLabel>
            <div
              role="radiogroup"
              aria-label="Tipo de carta"
              className="grid gap-2 sm:grid-cols-2"
            >
              {CHART_TYPE_OPTIONS.map((option) => {
                const selected = form.chartType === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        chartType: option.value,
                      }))
                    }
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-[background-color,box-shadow,transform] active:scale-[0.98]',
                      selected
                        ? 'border-transparent bg-primary/5 shadow-[0_0_0_1.5px_hsl(var(--primary))]'
                        : 'border-border/70 hover:bg-muted/40',
                    )}
                  >
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-xs leading-4 text-muted-foreground">
                      {option.hint}
                    </span>
                  </button>
                )
              })}
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="spc-baseline">Janela base</FieldLabel>
              <Input
                id="spc-baseline"
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
              <FieldDescription>
                Opcional. Quantas leituras iniciais definem os limites de
                controle.
              </FieldDescription>
            </Field>

            {form.chartType === 'xbar_r' && (
              <Field>
                <FieldLabel htmlFor="spc-subgroup">
                  Tamanho do subgrupo *
                </FieldLabel>
                <Input
                  id="spc-subgroup"
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
                <FieldDescription>
                  Leituras por sessão de verificação (2 a 10).
                </FieldDescription>
              </Field>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className={ACTION_BUTTON_CLASS}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Criando...' : 'Criar carta'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
