import { Link } from '@tanstack/react-router'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  PlusSignIcon,
  AlertCircleIcon,
  CalendarRemove01Icon,
  Clock01Icon,
  CheckmarkCircle01Icon,
  HelpCircleIcon,
  Notebook01Icon,
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
  ACTION_BUTTON_CLASS,
  Panel,
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
  usePtListData,
  usePtSummaryData,
} from '@/features/proficiency-tests/queries'
import {
  PT_ACTIVITY_TYPES,
  PT_ACTIVITY_TYPE_LABELS,
  PT_STATUSES,
  PT_STATUS_LABELS,
  type PtActivityType,
  type PtStatus,
} from '@/features/proficiency-tests/types'
import { ptColumns } from '@/features/proficiency-tests/components/pt-columns'

function parsePtStatusFilter(value: string | null): PtStatus | '' {
  switch (value) {
    case 'pending':
    case 'satisfactory':
    case 'questionable':
    case 'unsatisfactory':
      return value
    default:
      return ''
  }
}

function parsePtActivityTypeFilter(value: string | null): PtActivityType | '' {
  switch (value) {
    case 'proficiency_test':
    case 'interlab_comparison':
      return value
    default:
      return ''
  }
}

export function ProficiencyTestListPage() {
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useQueryState(
    'query',
    parseAsString.withDefault(''),
  )
  const [statusFilter, setStatusFilter] = useQueryState(
    'status',
    parseAsStringLiteral([...PT_STATUSES, '']).withDefault(''),
  )
  const [activityTypeFilter, setActivityTypeFilter] = useQueryState(
    'activityType',
    parseAsStringLiteral([...PT_ACTIVITY_TYPES, '']).withDefault(''),
  )

  const organizationId = activeOrganizationId ?? 'no-org'
  const canLoad =
    !cloudOnlyUnavailable &&
    Boolean(activeOrganizationId) &&
    !isContextSwitching

  const { data, isLoading, error } = usePtListData({
    organizationId,
    page,
    search,
    statusFilter,
    activityTypeFilter,
    enabled: canLoad,
  })

  const { data: summary } = usePtSummaryData({
    organizationId,
    enabled: canLoad,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  const hasFilters = search || statusFilter || activityTypeFilter

  if (cloudOnlyUnavailable) {
    return (
      <CloudOnlyOfflineState title="Ensaios de proficiência indisponíveis offline" />
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
          Erro ao carregar ensaios de proficiência: {error.message}
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
            Ensaios de proficiência
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Participações em EP e comparações interlaboratoriais, com escores e
            tratamento de resultados insatisfatórios.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="outline"
            render={<Link to="/dashboard/proficiency-tests/plan" />}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon icon={Notebook01Icon} className="mr-2 size-4" />
            Plano de participação
          </Button>
          <Button
            render={<Link to="/dashboard/proficiency-tests/new" />}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
            Novo ensaio
          </Button>
        </div>
      </div>

      {summary && (
        <StaggerGroup className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StaggerItem>
            <SignalTile
              icon={Clock01Icon}
              label="Pendentes"
              value={summary.pending}
              tone={summary.pending > 0 ? 'info' : 'neutral'}
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={CheckmarkCircle01Icon}
              label="Satisfatórios"
              value={summary.satisfactory}
              tone="ok"
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={HelpCircleIcon}
              label="Questionáveis"
              value={summary.questionable}
              tone={summary.questionable > 0 ? 'warning' : 'neutral'}
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={AlertCircleIcon}
              label="Insatisfatórios"
              value={summary.unsatisfactory}
              tone={summary.unsatisfactory > 0 ? 'critical' : 'neutral'}
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={CalendarRemove01Icon}
              label="Plano vencido"
              value={summary.planOverdue}
              tone={summary.planOverdue > 0 ? 'critical' : 'ok'}
            />
          </StaggerItem>
        </StaggerGroup>
      )}

      <Panel className="p-4 sm:p-5">
        <div>
          {/* Filters */}
          <form onSubmit={handleSearch} className="flex flex-wrap gap-4 mb-6">
            <Input
              placeholder="Buscar por rodada, provedor ou escopo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(parsePtStatusFilter(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="w-48">
                <span>
                  {statusFilter
                    ? PT_STATUS_LABELS[statusFilter]
                    : 'Todos os resultados'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os resultados</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="satisfactory">Satisfatório</SelectItem>
                <SelectItem value="questionable">Questionável</SelectItem>
                <SelectItem value="unsatisfactory">Insatisfatório</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={activityTypeFilter}
              onValueChange={(v) => {
                setActivityTypeFilter(parsePtActivityTypeFilter(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="w-60">
                <span>
                  {activityTypeFilter
                    ? PT_ACTIVITY_TYPE_LABELS[activityTypeFilter]
                    : 'Todas as atividades'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todas as atividades</SelectItem>
                <SelectItem value="proficiency_test">
                  Ensaio de proficiência
                </SelectItem>
                <SelectItem value="interlab_comparison">
                  Comparação interlaboratorial
                </SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" variant="secondary">
              Buscar
            </Button>
          </form>

          {/* Empty State */}
          {!isLoading && data?.data.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={AlertCircleIcon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum ensaio encontrado</EmptyTitle>
                <EmptyDescription>
                  {hasFilters
                    ? 'Nenhum ensaio encontrado para os filtros aplicados.'
                    : 'Comece registrando sua primeira participação em EP.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!hasFilters && (
                  <Button
                    render={<Link to="/dashboard/proficiency-tests/new" />}
                  >
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Novo ensaio
                  </Button>
                )}
                {hasFilters && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('')
                      setActivityTypeFilter('')
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
              columns={ptColumns}
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
