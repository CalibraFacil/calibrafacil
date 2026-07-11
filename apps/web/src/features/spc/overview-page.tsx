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
import { Label } from '@/components/ui/label'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { DataTable } from '@/components/ui/data-table'
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
  SPC_CHART_TYPE_LABELS,
  SPC_STATUSES,
  SPC_STATUS_LABELS,
  type SpcChartType,
  type SpcStatus,
} from '@/features/spc/types'
import { spcChartColumns } from '@/features/spc/components/spc-chart-columns'

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
            Qualidade · ISO/IEC 17025 §7.7.1
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Cartas de controle (CEP)
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Controle estatístico das leituras de verificação intermediária dos
            padrões de referência.
          </p>
        </div>
      </div>

      {summary && (
        <StaggerGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StaggerItem>
            <SignalTile
              icon={CheckmarkCircle01Icon}
              label="Sob controle"
              value={statusCount('in_control')}
              tone="ok"
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={Analytics01Icon}
              label="Tendência"
              value={statusCount('trending')}
              tone={statusCount('trending') > 0 ? 'warning' : 'neutral'}
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={Alert02Icon}
              label="Fora de controle"
              value={statusCount('out_of_control')}
              tone={statusCount('out_of_control') > 0 ? 'critical' : 'neutral'}
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={AlertCircleIcon}
              label="Dados insuficientes"
              value={statusCount('insufficient_data')}
              tone="neutral"
            />
          </StaggerItem>
        </StaggerGroup>
      )}

      <NewChartPanel initialStandardId={standardIdParam} canLoad={canLoad} />

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
                {hasFilters && (
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
    </div>
  )
}

function NewChartPanel({
  initialStandardId,
  canLoad,
}: {
  initialStandardId: string
  canLoad: boolean
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(Boolean(initialStandardId))
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

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)} className={ACTION_BUTTON_CLASS}>
          <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
          Nova carta
        </Button>
      </div>
    )
  }

  return (
    <Panel className="p-4 sm:p-5">
      <PanelHeader
        eyebrow="Monitoramento"
        title="Nova carta de controle"
        description="Escolha o padrão e o parâmetro monitorado. Os limites de controle são calculados a partir da janela base de leituras."
      />
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Padrão de referência</Label>
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
          </div>

          <div className="space-y-2">
            <Label>Parâmetro / ponto de medição</Label>
            <Input
              value={form.parameter}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  parameter: e.target.value,
                }))
              }
              placeholder="Ex: Ponto 100 g"
            />
          </div>

          <div className="space-y-2">
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

          <div className="space-y-2">
            <Label>Janela base (opcional)</Label>
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
            <div className="space-y-2">
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
        </div>

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
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
        </div>
      </form>
    </Panel>
  )
}
